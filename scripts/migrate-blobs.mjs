#!/usr/bin/env node
// Copies production Netlify Blobs into the AWS data bucket. Read-only on
// Netlify. Dry run by default; prints store names and counts only, never keys
// or values. Plan and probe: see the PR that added this file.
//
//   AWS_PROFILE=makeable node scripts/migrate-blobs.mjs            dry run, live stores
//   ... --apply                  copy new and changed records
//   ... --apply --delete-extra   also delete S3 records Netlify no longer has (final run)
//   ... --apply --archive        raw copy of every Netlify store under netlify-archive/
//   ... --stores waitlist,builder-sessions   limit to some stores
//
// Netlify login: the Netlify CLI's (netlify login) or NETLIFY_AUTH_TOKEN.
// Re-runnable: each S3 object keeps the Netlify etag in its metadata
// ("netlify-etag"), so unchanged records are skipped.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The stores the app reads in production (DeployContext=production names).
export const LIVE_STORES = [
  "builder-sessions",
  "community-builds",
  "makeable-build-images",
  "makeable-build-jobs",
  "makeable-build-quota-ledger",
  "makeable-social-analytics",
  "waitlist",
  "waitlist-sessions",
];
const NETLIFY_SITE_ID = "48e05fd1-e30a-457c-bc84-985d5d275f52";
const ARCHIVE_PREFIX = "netlify-archive";

export function planStore(sourceEntries, targetEntries) {
  const target = new Map(targetEntries.map((entry) => [entry.key, entry.etag]));
  const source = new Set(sourceEntries.map((entry) => entry.key));
  const copy = [];
  const unchanged = [];
  for (const { key, etag } of sourceEntries) {
    if (target.get(key) === etag && etag) unchanged.push(key);
    else copy.push(key);
  }
  const extra = targetEntries.map((entry) => entry.key).filter((key) => !source.has(key));
  return { copy, unchanged, extra };
}

export function contentTypeFor(bytes, metadata = {}) {
  if (typeof metadata.contentType === "string" && metadata.contentType) return metadata.contentType;
  try {
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return "application/json";
  } catch {
    return "application/octet-stream";
  }
}

export async function migrateStore({ source, target, apply = false, deleteExtra = false, log = () => {} }) {
  const plan = planStore(await source.list(), await target.list());
  if (!apply) {
    return { copied: 0, unchanged: plan.unchanged.length, extra: plan.extra.length, deleted: 0, toCopy: plan.copy.length };
  }
  let copied = 0;
  await pool(plan.copy, 8, async (key) => {
    const record = await source.read(key);
    const metadata = { ...stringValues(record.metadata), "netlify-etag": record.etag };
    await target.write(key, record.bytes, { contentType: contentTypeFor(record.bytes, record.metadata), metadata });
    copied += 1;
    if (copied % 250 === 0) log(`  ${copied}/${plan.copy.length} copied`);
  });
  let deleted = 0;
  if (deleteExtra) {
    for (const key of plan.extra) {
      await target.remove(key);
      deleted += 1;
    }
  }
  return { copied, unchanged: plan.unchanged.length, extra: plan.extra.length, deleted };
}

function stringValues(metadata = {}) {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]),
  );
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

function netlifyToken() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN;
  const file = path.join(process.env.APPDATA || path.join(process.env.HOME || "", ".config"), "netlify/Config/config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  return config.users[config.userId].auth.token;
}

function netlifySource(blobs, name) {
  const store = blobs.getStore({ name, siteID: NETLIFY_SITE_ID, token: netlifyToken(), consistency: "strong" });
  return {
    async list() {
      return (await store.list()).blobs.map(({ key, etag }) => ({ key, etag }));
    },
    async read(key) {
      const record = await store.getWithMetadata(key, { type: "arrayBuffer" });
      return { bytes: new Uint8Array(record.data), etag: record.etag, metadata: record.metadata || {} };
    },
  };
}

function s3Target(s3, client, bucket, prefix) {
  const root = `${prefix}/`;
  return {
    async list() {
      const keys = [];
      let token;
      do {
        const page = await client.send(new s3.ListObjectsV2Command({ Bucket: bucket, Prefix: root, ContinuationToken: token }));
        keys.push(...(page.Contents || []).map((object) => object.Key));
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      const entries = [];
      await pool(keys, 16, async (fullKey) => {
        const head = await client.send(new s3.HeadObjectCommand({ Bucket: bucket, Key: fullKey }));
        entries.push({ key: fullKey.slice(root.length), etag: head.Metadata?.["netlify-etag"] || "" });
      });
      return entries;
    },
    async write(key, data, { contentType, metadata }) {
      await client.send(new s3.PutObjectCommand({
        Bucket: bucket, Key: root + key, Body: data, ContentType: contentType, Metadata: metadata,
      }));
    },
    async remove(key) {
      await client.send(new s3.DeleteObjectCommand({ Bucket: bucket, Key: root + key }));
    },
    async read(key) {
      const object = await client.send(new s3.GetObjectCommand({ Bucket: bucket, Key: root + key }));
      return new Uint8Array(await object.Body.transformToByteArray());
    },
  };
}

// Byte-compares a few random records per store after a copy.
async function sampleCheck(source, target, keys, count = 5) {
  const sample = [...keys].sort(() => Math.random() - 0.5).slice(0, count);
  let same = 0;
  for (const key of sample) {
    const [a, b] = [(await source.read(key)).bytes, await target.read(key)];
    if (createHash("sha256").update(a).digest("hex") === createHash("sha256").update(b).digest("hex")) same += 1;
  }
  return `${same}/${sample.length}`;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const apply = args.includes("--apply");
  const deleteExtra = args.includes("--delete-extra");
  const archive = args.includes("--archive");
  const region = process.env.AWS_REGION || "us-east-1";

  const blobs = await import("@netlify/blobs");
  const s3 = await import("@aws-sdk/client-s3");
  const { CloudFormationClient, DescribeStacksCommand } = await import("@aws-sdk/client-cloudformation");
  const stack = (await new CloudFormationClient({ region }).send(
    new DescribeStacksCommand({ StackName: arg("--stack", "makeable-prod") }),
  )).Stacks[0];
  const bucket = stack.Outputs.find((output) => output.OutputKey === "DataBucketName").OutputValue;
  const client = new s3.S3Client({ region });

  const allStores = (await blobs.listStores({ siteID: NETLIFY_SITE_ID, token: netlifyToken() })).stores;
  const only = arg("--stores", "") ? arg("--stores", "").split(",") : null;
  const live = LIVE_STORES.filter((name) => !only || only.includes(name));
  const jobs = live.map((name) => ({ name, prefix: name }));
  if (archive) {
    jobs.push(...allStores.filter((name) => !only || only.includes(name)).map((name) => ({ name, prefix: `${ARCHIVE_PREFIX}/${name}`, archive: true })));
  }
  const missing = live.filter((name) => !allStores.includes(name));
  if (missing.length) console.log(`not on Netlify (skipped): ${missing.join(", ")}`);

  console.log(`${apply ? "APPLY" : "DRY RUN"} → s3://${bucket}${deleteExtra ? " (delete extra)" : ""}`);
  let failures = 0;
  for (const job of jobs) {
    if (!allStores.includes(job.name)) continue;
    const source = netlifySource(blobs, job.name);
    const target = s3Target(s3, client, bucket, job.prefix);
    const label = job.archive ? `${ARCHIVE_PREFIX}/${job.name}` : job.name;
    const result = await migrateStore({
      source, target, apply, deleteExtra: deleteExtra && !job.archive, log: (line) => console.log(line),
    });
    if (!apply) {
      console.log(`${label}: ${result.toCopy} to copy, ${result.unchanged} unchanged, ${result.extra} extra on S3`);
      continue;
    }
    const after = planStore(await source.list(), await target.list());
    const ok = after.copy.length === 0 && (!deleteExtra || job.archive || after.extra.length === 0);
    if (!ok) failures += 1;
    const sample = await sampleCheck(source, target, after.unchanged);
    console.log(`${label}: copied ${result.copied}, unchanged ${result.unchanged}, deleted ${result.deleted}, `
      + `extra ${after.extra.length} | verify: ${ok ? "in sync" : `${after.copy.length} still differ`}, sample bytes equal ${sample}`);
  }
  if (failures) {
    console.log(`${failures} store(s) not in sync`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
