import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanupSmokeBuild } from "../scripts/aws-smoke-build.mjs";
import { createMemoryStore } from "../lib/storage/memory-store.mjs";

const OURS = "job_ourSmokeJob00000000001";
const THEIRS = "job_someRealUserJob0000001";

test("cleanup deletes only the smoke test's records, never another user's", async () => {
  const sessions = createMemoryStore();
  const jobs = createMemoryStore();
  const images = createMemoryStore();
  await sessions.setJSON("builder-session-aaa", { user: { sub: "aws-smoke-test-123" } });
  await sessions.setJSON("builder-session-bbb", { user: { sub: "google-real-user" } });
  await jobs.setJSON(`jobs/${OURS}.json`, { id: OURS });
  await jobs.setJSON(`executions/${OURS}.json`, { jobId: OURS });
  await jobs.setJSON(`starts/account/hash1/${OURS}.json`, { jobId: OURS });
  await jobs.setJSON("active/request/req-ours.json", { jobId: OURS });
  await jobs.setJSON(`jobs/${THEIRS}.json`, { id: THEIRS });
  await jobs.setJSON("active/request/req-theirs.json", { jobId: THEIRS });
  await images.set(`job-images/${OURS}`, new Blob([new Uint8Array([1])]));
  await images.set(`job-images/${THEIRS}`, new Blob([new Uint8Array([2])]));

  const deleted = await cleanupSmokeBuild({ sessions, jobs, images }, { jobId: OURS, sub: "aws-smoke-test-123" });

  assert.equal(deleted, 6);
  assert.deepEqual((await sessions.list()).blobs.map((b) => b.key), ["builder-session-bbb"]);
  assert.deepEqual((await jobs.list()).blobs.map((b) => b.key), [
    "active/request/req-theirs.json",
    `jobs/${THEIRS}.json`,
  ]);
  assert.deepEqual((await images.list()).blobs.map((b) => b.key), [`job-images/${THEIRS}`]);
});
