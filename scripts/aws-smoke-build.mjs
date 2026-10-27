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
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

const DEFAULT_IDEA = "A desk thermometer that shows room temperature and humidity on a small OLED screen";

// Deletes only records that name this test's job id or test user.
export async function cleanupSmokeBuild({ sessions, jobs, images }, { jobId, sub }) {
  let deleted = 0;
  const remove = async (store, key) => {
    await store.delete(key);
    deleted += 1;
  };
  for (const { key } of (await sessions.list()).blobs) {
    if (JSON.stringify(await sessions.get(key, { type: "json" })).includes(`"${sub}"`)) await remove(sessions, key);
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
  const { buildJobStateStoreNameForFunctionContext, buildJobImageStoreNameForFunctionContext } = await import("../lib/build-jobs.mjs");
  const stores = {
    sessions: openStore({ name: builderSessionStoreNameForFunctionContext(context) }),
    jobs: openStore({ name: buildJobStateStoreNameForFunctionContext(context) }),
    images: openStore({ name: buildJobImageStoreNameForFunctionContext(context) }),
  };

  const sub = `aws-smoke-test-${randomBytes(6).toString("hex")}`;
  const session = await createBuilderSession(stores.sessions, { sub, email: `${sub}@example.com`, name: "AWS Smoke Test" });
  const cookie = session.cookie.split(";")[0];
  const started = Date.now();
  const log = (message) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`);
  console.log(`stack ${stackName}: ${api}`);

  let jobId = "";
  let state = "";
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
      if (state === "ready") {
        const parts = (job.result?.parts || []).map((part) => part.name || part.id);
        console.log(`title: ${job.result?.title}\nparts: ${parts.join(" | ")}\nimage: ${job.result?.image ? "yes" : "no"}`);
      }
      if (["ready", "failed", "cancelled"].includes(state)) break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  } finally {
    console.log(`cleanup: deleted ${await cleanupSmokeBuild(stores, { jobId: jobId || "no-job", sub })} test records`);
  }
  process.exit(state === "ready" ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
