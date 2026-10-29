#!/usr/bin/env node
// Copies production Netlify Blobs into the AWS data bucket. Read-only on
// Netlify. Dry run by default; prints store names and counts only, never keys
// or values. Plan and probe: see the PR that added this file.
//
//   AWS_PROFILE=makeable node scripts/migrate-blobs.mjs            dry run, live stores
//   ... --apply                  copy new and changed records
//   ... --apply --delete-extra   also delete S3 records Netlify no longer has (final run)
//   ... --apply --archive        raw copy of every Netlify store under netlify-archive/
//   ... --verify                 write nothing; compare S3 with Netlify (every JSON record, a sample of images)
//   ... --stores waitlist,builder-sessions   limit to some stores (also limits --archive)
//
// --delete-extra refuses for a store when Netlify lists nothing or when it would
// delete more than a fifth of what is on S3. Records that fail to read (Netlify
// is live during a run) are counted, not fatal; a rerun picks them up.
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
const MAX_DELETE_SHARE = 0.2;

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
  const sourceEntries = await source.list();
  const targetEntries = await target.list();
  const plan = planStore(sourceEntries, targetEntries);
  if (!apply) {
    return { copied: 0, unchanged: plan.unchanged.length, extra: plan.extra.length, deleted: 0, toCopy: plan.copy.length };
  }
  // Netlify stays live during a run: a record can be deleted or fail to read
  // between listing and reading. Count it and carry on; a rerun picks it up.
  let copied = 0;
  let failed = 0;
  await pool(plan.copy, 8, async (key) => {
    try {
      const record = await source.read(key);
      if (!record) throw new Error("gone");
      const metadata = { ...stringValues(record.metadata), "netlify-etag": record.etag };
      await target.write(key, record.bytes, { contentType: contentTypeFor(record.bytes, record.metadata), metadata });
      copied += 1;
      if (copied % 250 === 0) log(`  ${copied}/${plan.copy.length} copied`);
    } catch {
      failed += 1;
    }
  });
  const result = { copied, unchanged: plan.unchanged.length, extra: plan.extra.length, deleted: 0, failed };
  if (deleteExtra && plan.extra.length) {
    // A listing that wrongly comes back empty must not empty the bucket.
    const refused = sourceEntries.length === 0
      ? "source is empty"
      : plan.extra.length > targetEntries.length * MAX_DELETE_SHARE
        ? `would delete ${plan.extra.length} of ${targetEntries.length}`
        : "";
    if (refused) return { ...result, deleteRefused: refused };
    for (const key of plan.extra) {
      await target.remove(key);
      result.deleted += 1;
    }
  }
  return result;
}

// Checks what is on S3 against Netlify: missing records, records changed on
// Netlify since they were copied, and byte equality (all records, or a sample).
export async function verifyStore({ source, target, compareAll = false, sample = 20 }) {
  const copiedEtags = new Map((await target.list()).map((entry) => [entry.key, entry.etag]));
  let missing = 0;
  let changedSinceCopy = 0;
  const comparable = [];
  for (const { key, etag } of await source.list()) {
    if (!copiedEtags.has(key)) missing += 1;
    else if (copiedEtags.get(key) !== etag) changedSinceCopy += 1;
    else comparable.push(key);
  }
  const keys = compareAll ? comparable : [...comparable].sort(() => Math.random() - 0.5).slice(0, sample);
  let same = 0;
  await pool(keys, 8, async (key) => {
    const [record, copy] = [await source.read(key), await target.read(key)];
    if (record && copy && sha256(record.bytes) === sha256(copy)) same += 1;
  });
  return { checked: keys.length, same, mismatched: keys.length - same, changedSinceCopy, missing };
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
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

async function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const verifyOnly = args.includes("--verify");
  const apply = args.includes("--apply") && !verifyOnly;
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

  const mode = verifyOnly ? "VERIFY" : apply ? "APPLY" : "DRY RUN";
  console.log(`${mode} → s3://${bucket}${deleteExtra && apply ? " (delete extra)" : ""}`);
  let problems = 0;
  for (const job of jobs) {
    if (!allStores.includes(job.name)) continue;
    const source = netlifySource(blobs, job.name);
    const target = s3Target(s3, client, bucket, job.prefix);
    const label = job.archive ? `${ARCHIVE_PREFIX}/${job.name}` : job.name;
    let summary = "";
    if (!verifyOnly) {
      const result = await migrateStore({
        source, target, apply, deleteExtra: deleteExtra && !job.archive, log: (line) => console.log(line),
      });
      if (!apply) {
        console.log(`${label}: ${result.toCopy} to copy, ${result.unchanged} unchanged, ${result.extra} extra on S3`);
        continue;
      }
      if (result.failed || result.deleteRefused) problems += 1;
      summary = `copied ${result.copied}, unchanged ${result.unchanged}, failed ${result.failed}, deleted ${result.deleted}`
        + `${result.deleteRefused ? ` (delete refused: ${result.deleteRefused})` : ""} | `;
    }
    // Every JSON record is cheap to compare; images are sampled.
    const check = await verifyStore({ source, target, compareAll: job.name !== "makeable-build-images" });
    if (check.missing || check.mismatched) problems += 1;
    console.log(`${label}: ${summary}verify: bytes equal ${check.same}/${check.checked}, missing ${check.missing}, `
      + `changed on Netlify since copy ${check.changedSinceCopy}`);
  }
  if (problems) {
    console.log(`${problems} store(s) need attention; rerun to retry failed or changed records`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
