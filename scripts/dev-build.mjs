#!/usr/bin/env node
// Runs one real build against a running app and prints what happened, so an
// agent can check the pipeline without reading the screen.
//
//   node scripts/dev-build.mjs "a plant watering reminder" [--base http://localhost:3001]
//        [--timeout 300] [--out build.json]
//
// Signs in through /__local-login (scripts/dev-local.mjs), starts the build the
// way the site does, polls until it is ready or failed, then prints the parts
// and artifact states. Exit code: 0 ready, 1 failed or timed out, 2 the app
// asked a clarifying question.
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const base = (argValue("--base") || process.env.MAKEABLE_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const timeoutMs = Number(argValue("--timeout") || 300) * 1000;
const outFile = argValue("--out");
const idea = args.find((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
if (!idea) {
  console.error('usage: node scripts/dev-build.mjs "<idea>" [--base URL] [--timeout seconds] [--out file]');
  process.exit(1);
}

const cookies = new Map();
const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

const login = await call("/__local-login");
if (!login.ok) fail(`login failed (HTTP ${login.status}). Is scripts/dev-local.mjs running at ${base}?`);

const start = await call("/api/build-jobs", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: base },
  body: JSON.stringify({ idea }),
});
const startBody = await start.json().catch(() => ({}));
if (startBody.clarification) {
  console.log(`[${elapsed()}] clarification needed:`);
  console.log(JSON.stringify(startBody.clarification, null, 2));
  process.exit(2);
}
const jobId = startBody.job?.id;
if (!start.ok || !jobId) fail(`start failed (HTTP ${start.status}): ${JSON.stringify(startBody)}`);
console.log(`[${elapsed()}] started ${jobId}`);

let state = "";
let job;
while (Date.now() - started < timeoutMs) {
  const status = await call(`/api/build-jobs/${jobId}`);
  const body = await status.json().catch(() => ({}));
  job = body.job || body;
  if (job.state !== state) {
    state = job.state;
    console.log(`[${elapsed()}] ${state}`);
  }
  if (["ready", "failed", "cancelled"].includes(state)) break;
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

if (outFile) writeFileSync(outFile, JSON.stringify(job, null, 2));
if (state === "ready") {
  // The site claims a ready build into the account; without it /app can't open it.
  const claim = await call(`/api/build-jobs/${jobId}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ galleryName: "Local Test" }),
  });
  if (!claim.ok) fail(`claim failed (HTTP ${claim.status}): ${await claim.text()}`);
  console.log(`[${elapsed()}] claimed`);
  const result = job.result || {};
  console.log(`title: ${result.title}`);
  console.log(`parts (${result.parts?.length || 0}):`);
  for (const part of result.parts || []) console.log(`  - ${part.name || part.id}${part.quantity > 1 ? ` x${part.quantity}` : ""}`);
  console.log(`image: ${result.image ? "yes" : "no"}`);
  if (result.artifactStates) console.log(`artifacts: ${JSON.stringify(result.artifactStates)}`);
  if (result.warnings?.length) console.log(`warnings: ${result.warnings.join(" | ")}`);
  console.log(`open: ${base}/app?build=${encodeURIComponent(result.id || job.buildId)}`);
  process.exit(0);
}
if (state === "failed") fail(`build failed: ${job.error}${job.failure ? `\n${JSON.stringify(job.failure, null, 2)}` : ""}`);
fail(`gave up after ${timeoutMs / 1000}s in state "${state}"`);

async function call(pathname, init = {}) {
  const headers = new Headers(init.headers);
  if (cookies.size) headers.set("Cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
  const response = await fetch(`${base}${pathname}`, { ...init, headers, redirect: "manual" });
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const index = pair.indexOf("=");
    cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  return response;
}

function fail(message) {
  console.error(`[${elapsed()}] ${message}`);
  process.exit(1);
}

function argValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? "" : args[index + 1];
}
