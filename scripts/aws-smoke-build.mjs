#!/usr/bin/env node
// Checks a deployed AWS stack end to end: signs in a throwaway test user,
// runs one real build through the API URL, prints each stage, then deletes
// every record the test made. Needs AWS credentials that can write the bucket
// (e.g. `aws sso login`), so it does nothing for anyone without them.
//
//   AWS_PROFILE=makeable node scripts/aws-smoke-build.mjs [--stack makeable-prod] [--idea "..."]
//        [--base https://main.<id>.amplifyapp.com]   (go through the site instead of the API URL)
//
// Exit code: 0 ready, 1 anything else. Each build calls OpenAI (~60 s, a few cents).
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

const DEFAULT_IDEA = "A desk thermometer that shows room temperature and humidity on a small OLED screen";

// Deletes only records that name this test's job id or test user.
export async function cleanupSmokeBuild({ sessions, jobs, images, community, quota }, { jobId, sub, buildId = "" }) {
  if (!/^aws-smoke-test-[a-f0-9]+$/.test(sub || "")) throw new Error("Expected a smoke-test identity");
  let deleted = 0;
  const remove = async (store, key) => {
    await store.delete(key);
    deleted += 1;
  };
  const ownerHash = createHash("sha256").update(sub).digest("hex");
  // Remove the public card first, before slower session/job cleanup. On a
  // successful run its exact id is known; scan only after a partial failure.
  const galleryEntries = buildId ? [{ key: `gallery/${buildId}.json` }]
    : (await community.list({ prefix: "gallery/" })).blobs;
  for (const { key } of galleryEntries) {
    const record = await community.get(key, { type: "json" });
    if (record?.ownerSub !== sub || record.sourceJobId !== jobId || key !== `gallery/${record.id}.json`) continue;
    await remove(images, `gallery-images/${record.id}`);
    await remove(community, `owners/${ownerHash}/${record.id}.json`);
    await remove(community, key);
  }
  const marker = `owners/${ownerHash}/_index-complete.json`;
  if (await community.get(marker, { type: "json" })) await remove(community, marker);
  for (const { key } of (await quota.list({ prefix: `quota/${ownerHash}/` })).blobs) {
    const record = await quota.get(key, { type: "json" });
    if (record?.sub === sub && record.jobId === jobId) await remove(quota, key);
  }
  for (const { key } of (await sessions.list()).blobs) {
    if ((await sessions.get(key, { type: "json" }))?.user?.sub === sub) await remove(sessions, key);
  }
  for (const { key } of (await jobs.list()).blobs) {
    if (key.includes(jobId)) await remove(jobs, key);
    else if (key.startsWith("active/") && JSON.stringify(await jobs.get(key, { type: "json" })).includes(jobId)) {
      await remove(jobs, key);
    }
  }
  for (const { key } of (await images.list()).blobs) {
    if (key.includes(jobId)) await remove(images, key);
  }
  return deleted;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const stackName = arg("--stack", "makeable-prod");
  const idea = arg("--idea", DEFAULT_IDEA);
  const region = process.env.AWS_REGION || "us-east-1";

  const { CloudFormationClient, DescribeStacksCommand } = await import("@aws-sdk/client-cloudformation");
  const stack = (await new CloudFormationClient({ region }).send(new DescribeStacksCommand({ StackName: stackName }))).Stacks[0];
  const output = (key) => stack.Outputs.find((o) => o.OutputKey === key)?.OutputValue;
  const param = (key) => stack.Parameters.find((p) => p.ParameterKey === key)?.ParameterValue;
  const base = arg("--base", "");
  const api = (base || output("ApiUrl")).replace(/\/$/, "");
  const publicOrigin = base ? new URL(base).origin : param("PublicOrigin");
  const context = { deploy: { context: param("DeployContext") } };

  process.env.AWS_REGION = region;
  process.env.MAKEABLE_STORAGE_BACKEND = "s3";
  process.env.MAKEABLE_STORAGE_BUCKET = output("DataBucketName");
  const { openStore } = await import("../lib/storage/index.mjs");
  const { builderSessionStoreNameForFunctionContext, createBuilderSession } = await import("../lib/builder-session.mjs");
  const { buildJobStateStoreNameForFunctionContext, buildJobImageStoreNameForFunctionContext,
    buildCommunityStoreNameForFunctionContext, buildJobQuotaStoreNameForFunctionContext } = await import("../lib/build-jobs.mjs");
  const stores = {
    sessions: openStore({ name: builderSessionStoreNameForFunctionContext(context) }),
    jobs: openStore({ name: buildJobStateStoreNameForFunctionContext(context) }),
    images: openStore({ name: buildJobImageStoreNameForFunctionContext(context) }),
    community: openStore({ name: buildCommunityStoreNameForFunctionContext(context) }),
    quota: openStore({ name: buildJobQuotaStoreNameForFunctionContext(context) }),
  };

  const sub = `aws-smoke-test-${randomBytes(6).toString("hex")}`;
  const session = await createBuilderSession(stores.sessions, { sub, email: `${sub}@example.com`, name: "AWS Smoke Test" });
  const cookie = session.cookie.split(";")[0];
  const started = Date.now();
  const log = (message) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`);
  console.log(`stack ${stackName}: ${api}`);

  let jobId = "";
  let state = "";
  let savedBuildId = "";
  try {
    const start = await fetch(`${api}/api/build-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: publicOrigin, Cookie: cookie },
      body: JSON.stringify({ idea }),
    });
    const body = await start.json().catch(() => ({}));
    jobId = body.job?.id || "";
    log(`start HTTP ${start.status}${jobId ? ` ${jobId}` : ` ${JSON.stringify(body).slice(0, 300)}`}`);
    while (jobId && Date.now() - started < 300_000) {
      const job = (await (await fetch(`${api}/api/build-jobs/${jobId}`, { headers: { Cookie: cookie } })).json()).job || {};
      if (job.state !== state) {
        state = job.state;
        log(`${state}${job.error ? ` ${job.error}` : ""}`);
      }
      // The pipeline marks ready before its account save finishes. Wait for
      // that durable save before cleanup, or it can recreate records afterward.
      if (state === "ready" && job.buildId) {
        savedBuildId = job.buildId;
        const parts = (job.result?.parts || []).map((part) => part.name || part.id);
        console.log(`title: ${job.result?.title}\nparts: ${parts.join(" | ")}\nimage: ${job.result?.image ? "yes" : "no"}`);
        break;
      }
      if (["failed", "cancelled"].includes(state)) break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  } finally {
    console.log(`cleanup: deleted ${await cleanupSmokeBuild(stores, { jobId: jobId || "no-job", sub, buildId: savedBuildId })} test records`);
  }
  process.exit(state === "ready" && savedBuildId ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
