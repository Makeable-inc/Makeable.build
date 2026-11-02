#!/usr/bin/env node
// Starts and follows an enclosure job through the same API the site will use.
//
//   node scripts/enclosure-job.mjs start --design s3-screen-button [--wait]
//   node scripts/enclosure-job.mjs status <job id>
//   node scripts/enclosure-job.mjs wait <job id>
//   node scripts/enclosure-job.mjs cancel <job id>
//   node scripts/enclosure-job.mjs download <job id> [--out folder]
//
// --base picks the server (default http://localhost:3001, started by npm run dev:local).
// Locally it signs in as the test user. Elsewhere, set MAKEABLE_SESSION_COOKIE to a signed-in session cookie.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const command = args[0];
const option = (name, fallback = "") => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const base = option("--base", "http://localhost:3001").replace(/\/$/, "");

async function cookie() {
  if (process.env.MAKEABLE_SESSION_COOKIE) return process.env.MAKEABLE_SESSION_COOKIE;
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error("Set MAKEABLE_SESSION_COOKIE to sign in to a server that is not local.");
  const response = await fetch(`${base}/__local-login?next=/`, { redirect: "manual" });
  const set = response.headers.getSetCookie?.() || [response.headers.get("set-cookie")].filter(Boolean);
  if (!set.length) throw new Error(`Local sign-in failed (HTTP ${response.status}). Is npm run dev:local running?`);
  return set.map((line) => line.split(";")[0]).join("; ");
}

async function call(method, route, body, session) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { Cookie: session, Origin: base, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { status: response.status, data };
}

function show(job) {
  const progress = job.progress ? ` | ${job.progress.stage}${job.progress.attempt_try ? ` try ${job.progress.attempt_try}` : ""}${job.progress.failed?.length ? `, last failed: ${job.progress.failed.join(", ")}` : ""}` : "";
  console.log(`${job.id}  ${job.state}${progress}`);
  if (job.message) console.log(`  ${job.message}`);
  if (job.tokens) console.log(`  ${job.tokens} tokens, ${Math.round(job.seconds / 60)} min`);
  for (const file of job.files || []) console.log(`  ${base}${file}`);
}

const FINAL = new Set(["PASS", "PASS WITH WARNINGS", "FAIL", "CANCELLED"]);

async function waitFor(id, session) {
  let last = "";
  for (;;) {
    const { status, data } = await call("GET", `/api/enclosure-jobs/${id}`, null, session);
    if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`);
    const line = JSON.stringify([data.job.state, data.job.progress?.stage, data.job.progress?.attempt_try]);
    if (line !== last) {
      show(data.job);
      last = line;
    }
    if (FINAL.has(data.job.state)) return data.job;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

async function main() {
  const session = await cookie();
  const id = args[1];
  if (command === "start") {
    const design = option("--design");
    if (!design) throw new Error("start needs --design <base design name>");
    const { status, data } = await call("POST", "/api/enclosure-jobs", { design, requestId: randomBytes(9).toString("base64url") }, session);
    if (status >= 300) throw new Error(`Not started (HTTP ${status}): ${data.error || JSON.stringify(data)}${data.job ? `\n  your running job: ${data.job.id}` : ""}`);
    show(data.job);
    if (args.includes("--wait")) await waitFor(data.job.id, session);
  } else if (command === "status") {
    const { status, data } = await call("GET", `/api/enclosure-jobs/${id}`, null, session);
    if (!data.job) throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`);
    show(data.job);
  } else if (command === "wait") {
    await waitFor(id, session);
  } else if (command === "cancel") {
    const { data } = await call("DELETE", `/api/enclosure-jobs/${id}`, null, session);
    show(data.job || data);
  } else if (command === "download") {
    const { data } = await call("GET", `/api/enclosure-jobs/${id}`, null, session);
    const out = option("--out", path.join("enclosure", "runs", "downloads", id));
    mkdirSync(out, { recursive: true });
    for (const route of data.job?.files || []) {
      const response = await fetch(`${base}${route}`, { headers: { Cookie: session } });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${route}`);
      const file = path.join(out, route.split("/").pop());
      writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      console.log(`saved ${file}`);
    }
  } else {
    console.log("Commands: start --design <name> [--wait] | status <id> | wait <id> | cancel <id> | download <id> [--out folder]");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  // exitCode, not exit(): exiting with fetch sockets open crashes Node on Windows.
  process.exitCode = 1;
});
