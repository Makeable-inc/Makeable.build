import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { cleanupSmokeBuild } from "../scripts/aws-smoke-build.mjs";
import { createMemoryStore } from "../lib/storage/memory-store.mjs";

const OURS = "job_ourSmokeJob00000000001";
const THEIRS = "job_someRealUserJob0000001";

test("cleanup deletes only the smoke test's records, never another user's", async () => {
  const sessions = createMemoryStore();
  const jobs = createMemoryStore();
  const images = createMemoryStore();
  const community = createMemoryStore();
  const quota = createMemoryStore();
  const sub = "aws-smoke-test-123";
  const ownerHash = createHash("sha256").update(sub).digest("hex");
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
  await community.setJSON("gallery/build-smoke.json", { id: "build-smoke", ownerSub: sub, sourceJobId: OURS });
  await community.setJSON("gallery/build-real.json", { id: "build-real", ownerSub: "google-real-user", sourceJobId: THEIRS });
  // Neither an unrelated user's record mentioning our id nor a different job is ours.
  await community.setJSON("gallery/build-foreign.json", { id: "build-foreign", ownerSub: "google-real-user", sourceJobId: OURS });
  await community.setJSON("gallery/build-other-job.json", { id: "build-other-job", ownerSub: sub, sourceJobId: THEIRS });
  await community.setJSON(`owners/${ownerHash}/build-smoke.json`, { buildId: "build-smoke" });
  await community.setJSON(`owners/${ownerHash}/_index-complete.json`, { indexedAt: "2026-10-29" });
  await community.setJSON("owners/real-user/build-real.json", { buildId: "build-real" });
  await quota.setJSON(`quota/${ownerHash}/1.json`, { sub, jobId: OURS, status: "used" });
  await quota.setJSON(`quota/${ownerHash}/2.json`, { sub, jobId: THEIRS, status: "used" });
  await quota.setJSON("quota/real-user/1.json", { sub: "google-real-user", jobId: THEIRS });
  await images.set("gallery-images/build-smoke", new Blob([new Uint8Array([3])]));
  await images.set("gallery-images/build-real", new Blob([new Uint8Array([4])]));

  const deleted = await cleanupSmokeBuild({ sessions, jobs, images, community, quota }, { jobId: OURS, sub });

  assert.equal(deleted, 11);
  assert.deepEqual((await sessions.list()).blobs.map((b) => b.key), ["builder-session-bbb"]);
  assert.deepEqual((await jobs.list()).blobs.map((b) => b.key), [
    "active/request/req-theirs.json",
    `jobs/${THEIRS}.json`,
  ]);
  assert.deepEqual((await images.list()).blobs.map((b) => b.key), ["gallery-images/build-real", `job-images/${THEIRS}`]);
  assert.deepEqual((await community.list()).blobs.map((b) => b.key), [
    "gallery/build-foreign.json", "gallery/build-other-job.json", "gallery/build-real.json", "owners/real-user/build-real.json",
  ]);
  assert.deepEqual((await quota.list()).blobs.map((b) => b.key), [`quota/${ownerHash}/2.json`, "quota/real-user/1.json"]);
});

test("cleanup refuses a real account identity before deleting anything", async () => {
  await assert.rejects(cleanupSmokeBuild({}, { jobId: OURS, sub: "google-real-user" }), /smoke-test identity/);
});
