import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BUILD_DRAFT_COOKIE,
  accountBuildQuota,
  buildCommunityStoreName,
  buildDraftCookieState,
  buildJobQuotaStoreName,
  buildJobStateForPipelinePhase,
  buildJobStateStoreName,
  cancelBuildJob,
  claimBuildJobExecution,
  claimSuccessfulBuildJob,
  cleanupAbandonedBuildJobs,
  completeBuildJob,
  createAnonymousBuildJob,
  createBackgroundBuildDispatch,
  createBackgroundBuildSignature,
  createMemoryBlobStore,
  createRoutedBuildStateStore,
  failBuildJob,
  getAccountGalleryBuild,
  getActiveBuildJobForRequest,
  getDraftJobImage,
  getGalleryImage,
  getBuildJob,
  getPublicGalleryBuild,
  hidePublicGalleryBuild,
  listPublicGalleryBuilds,
  listAccountGalleryBuilds,
  markBuildJobState,
  moderateBuildForPublicGallery,
  publicGalleryBuild,
  publicBuildJob,
  refundKnownUnusableBuildCredit,
  BUILD_JOB_STATES,
  verifyBackgroundBuildSignature,
} from "../lib/build-jobs.mjs";
import { invokeBackgroundBuildJob } from "../netlify/functions/api.mjs";
import { buildFailureFromResult } from "../netlify/functions/build-background.mjs";

test("generator phases map into the stable four-stage build UI contract", () => {
  assert.equal(buildJobStateForPipelinePhase("planning"), BUILD_JOB_STATES.planning);
  assert.equal(buildJobStateForPipelinePhase("fitting_parts"), BUILD_JOB_STATES.fittingParts);
  assert.equal(buildJobStateForPipelinePhase("assembling"), BUILD_JOB_STATES.fittingParts);
  assert.equal(buildJobStateForPipelinePhase("rendering"), BUILD_JOB_STATES.rendering);
  assert.throws(
    () => buildJobStateForPipelinePhase("unknown_future_phase"),
    /Invalid build pipeline phase/,
  );
});

test("background planner failures preserve a safe structured diagnostic on the job", async () => {
  const stateStore = createMemoryBlobStore();
  const jobId = "job_F90Cnl1Z0P4EgjFfWmhKvQ";
  await stateStore.setJSON(`jobs/${jobId}.json`, {
    schemaVersion: 1,
    id: jobId,
    state: BUILD_JOB_STATES.planning,
    idea: "Build a desktop transcription device",
    createdAt: "2026-09-04T20:00:00.000Z",
    updatedAt: "2026-09-04T20:00:01.000Z",
    result: null,
    error: "",
    failure: null,
  });
  const failure = buildFailureFromResult({
    status: 422,
    body: {
      error: "The planner returned a blocked build and it was not accepted for persistence.",
      code: "planner_output_blocked",
      details: {
        reason: "planner_warning_blocked: speech input is not supported",
        plannerTitle: "Blocked transcription device",
        plannerWarnings: ["Speech input needs a released audio-capture part."],
        ignoredSecret: "must not be published",
      },
    },
  });

  await failBuildJob(stateStore, jobId, failure, new Date("2026-09-04T20:01:00.000Z"));
  const stored = await getBuildJob(stateStore, jobId);
  const visible = publicBuildJob(stored);

  assert.equal(visible.error, "The planner returned a blocked build and it was not accepted for persistence.");
  assert.equal(visible.failure.code, "planner_output_blocked");
  assert.equal(visible.failure.details.reason, "planner_warning_blocked: speech input is not supported");
  assert.deepEqual(visible.failure.details.plannerWarnings, ["Speech input needs a released audio-capture part."]);
  assert.equal(Object.hasOwn(visible.failure.details, "ignoredSecret"), false);
});

test("gallery shaping restores compiler-injected BOM rows and corrected door-notifier hero", () => {
  const buildId = "build_build-a-quiet-visual-door-open-notifier-using-a-magnetic_XHIYhukFprNH5A";
  const shaped = publicGalleryBuild({
    id: buildId,
    title: "Door-Open Notifier",
    summary: "Shows the door state.",
    image: { url: "/api/builds/old/image" },
    parts: [
      { id: "camera", asin: "B09ZJTVPNW", name: "AITRIP ESP32-WROVER camera development board" },
      { id: "reed", asin: "B0FR4CNLPX", name: "2Pcs Reed Sensor Module Reed Switch Magnetic Switch for Arduino" },
      { id: "oled", asin: "B0DG8JZ2TT", name: "XIITIA 0.91-inch SSD1306 OLED display (6-pack)" },
    ],
    artifacts: {
      assembly: {
        parts: [
          { id: "controller-1-esp32-camera-board", assetId: "esp32-camera-board", role: "controller" },
          { id: "sensor-2-reed-switch-magnet", assetId: "reed-switch-magnetic-sensor", role: "sensor" },
          { id: "carrier-node-2", assetId: "aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx", role: "carrier" },
          { id: "controller-node-2-esp32-s3-devkitc-1-n8r2", assetId: "esp32-s3-devkitc-1-n8r2", role: "controller" },
          { id: "display-3-ssd1306-096-oled-b", assetId: "ssd1306-096-oled-blue", role: "display" },
        ],
      },
    },
  });
  assert.equal(shaped.image.url, "/concepts/build-corrections/quiet-door-open-notifier-two-node-v2.png");
  assert.equal(shaped.parts.length, 5);
  assert.deepEqual(shaped.parts.map((part) => part.quantity), [1, 1, 1, 1, 1]);
  assert.equal(shaped.parts[0].includedComponents[0], "camera module");
  assert.equal(shaped.parts[4].packageQuantity, 6);
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  MAKEABLE_DRAFT_COOKIE_SECRET: "draft-cookie-secret-with-at-least-32-chars",
  MAKEABLE_BACKGROUND_SECRET: "background-secret-with-at-least-32-chars",
  NODE_ENV: "test",
};
const draftAccessNow = new Date("2026-08-21T19:10:00.000Z");

test("anonymous build starts use a signed draft cookie and enforce active/daily limits", async () => {
  const stateStore = createMemoryBlobStore();
  const request = requestWithIp("https://makeable.build/api/builds", "203.0.113.10");
  const first = await createAnonymousBuildJob({
    request,
    stateStore,
    env,
    idea: "a desk light that glows when my build passes",
    now: new Date("2026-08-21T18:00:00.000Z"),
  });

  assert.equal(first.ok, true);
  assert.match(first.cookie, new RegExp(`^${BUILD_DRAFT_COOKIE}=`));
  assert.match(first.cookie, /; HttpOnly/);
  assert.match(first.cookie, /; Secure/);
  assert.match(first.cookie, /; SameSite=Strict/);
  assert.equal(
    buildDraftCookieState(requestWithCookie(first.cookie), env, {
      now: new Date("2026-08-21T18:01:00.000Z"),
    }).state,
    "valid",
  );

  const activeBlocked = await createAnonymousBuildJob({
    request: requestWithIp("https://makeable.build/api/builds", "203.0.113.10", first.cookie),
    stateStore,
    env,
    idea: "another desk light",
    now: new Date("2026-08-21T18:02:00.000Z"),
  });
  assert.equal(activeBlocked.ok, false);
  assert.equal(activeBlocked.status, 429);
  assert.equal(activeBlocked.activeJob.id, first.job.id);

  await cancelBuildJob({
    request: requestWithCookie(first.cookie),
    stateStore,
    env,
    jobId: first.job.id,
    now: new Date("2026-08-21T18:03:00.000Z"),
  });

  let lastCookie = first.cookie;
  for (let index = 0; index < 2; index += 1) {
    const next = await createAnonymousBuildJob({
      request: requestWithIp("https://makeable.build/api/builds", "203.0.113.10", lastCookie),
      stateStore,
      env,
      idea: `daily build ${index}`,
      now: new Date(`2026-08-21T18:0${4 + index}:00.000Z`),
    });
    assert.equal(next.ok, true);
    lastCookie = next.cookie;
    await cancelBuildJob({
      request: requestWithCookie(lastCookie),
      stateStore,
      env,
      jobId: next.job.id,
      now: new Date(`2026-08-21T18:0${5 + index}:30.000Z`),
    });
  }

  const fourth = await createAnonymousBuildJob({
    request: requestWithIp("https://makeable.build/api/builds", "203.0.113.10", lastCookie),
    stateStore,
    env,
    idea: "one too many",
    now: new Date("2026-08-21T18:08:00.000Z"),
  });
  assert.equal(fourth.ok, false);
  assert.equal(fourth.status, 429);
  assert.match(fourth.error, /3-build daily limit/);
});

test("a lost start response can recover the active job for the signed-in account", async () => {
  const stateStore = createMemoryBlobStore();
  const user = { sub: "google-subject-start-recovery" };
  const requestId = "req_start_recovery_00000001";
  const started = await createAnonymousBuildJob({
    request: requestWithIp("https://makeable.build/api/build-jobs", "203.0.113.14"),
    stateStore,
    env,
    requestId,
    user,
    idea: "a desk display that shows room comfort",
    now: new Date("2026-08-21T18:10:00.000Z"),
  });
  assert.equal(started.ok, true);

  const recovered = await getActiveBuildJobForRequest({
    request: requestWithIp("https://makeable.build/api/build-jobs/active", "198.51.100.99"),
    stateStore,
    env,
    requestId,
    user,
    now: new Date("2026-08-21T18:10:01.000Z"),
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.job.id, started.job.id);
  assert.equal(recovered.job.state, BUILD_JOB_STATES.queued);
  assert.equal("ownerSub" in recovered.job, false);
  assert.equal("accountHash" in recovered.job, false);
});

test("signed-in builds are isolated by account even on the same browser and IP", async () => {
  const stateStore = createMemoryBlobStore();
  const sharedIp = "203.0.113.77";
  const alice = { sub: "google-subject-alice" };
  const raymond = { sub: "google-subject-raymond" };
  const aliceIdea = "Build a Wi-Fi-connected crypto portfolio dashboard.";
  const raymondIdea = "Build a pumpkin-shaped Halloween mood light.";
  const aliceRequestId = "req_alice_crypto_000000001";
  const raymondRequestId = "req_raymond_halloween_0001";

  const aliceStarted = await createAnonymousBuildJob({
    request: requestWithIp("https://makeable.build/api/build-jobs", sharedIp),
    stateStore,
    env,
    requestId: aliceRequestId,
    user: alice,
    idea: aliceIdea,
    now: new Date("2026-09-03T22:00:00.000Z"),
  });
  assert.equal(aliceStarted.ok, true);
  assert.equal(aliceStarted.job.ownerSub, alice.sub);

  const raymondStarted = await createAnonymousBuildJob({
    request: requestWithIp(
      "https://makeable.build/api/build-jobs",
      sharedIp,
      aliceStarted.cookie,
    ),
    stateStore,
    env,
    requestId: raymondRequestId,
    user: raymond,
    idea: raymondIdea,
    now: new Date("2026-09-03T22:00:01.000Z"),
  });
  assert.equal(raymondStarted.ok, true);
  assert.notEqual(raymondStarted.job.id, aliceStarted.job.id);
  assert.equal(raymondStarted.job.idea, raymondIdea);
  assert.equal(raymondStarted.job.ownerSub, raymond.sub);

  const aliceRecovered = await getActiveBuildJobForRequest({
    request: requestWithIp("https://makeable.build/api/build-jobs/active", sharedIp),
    stateStore,
    env,
    requestId: aliceRequestId,
    user: alice,
    now: new Date("2026-09-03T22:00:02.000Z"),
  });
  const raymondRecovered = await getActiveBuildJobForRequest({
    request: requestWithIp("https://makeable.build/api/build-jobs/active", sharedIp),
    stateStore,
    env,
    requestId: raymondRequestId,
    user: raymond,
    now: new Date("2026-09-03T22:00:02.000Z"),
  });
  assert.equal(aliceRecovered.ok, true);
  assert.equal(aliceRecovered.job.id, aliceStarted.job.id);
  assert.equal(aliceRecovered.job.idea, aliceIdea);
  assert.equal(raymondRecovered.ok, true);
  assert.equal(raymondRecovered.job.id, raymondStarted.job.id);
  assert.equal(raymondRecovered.job.idea, raymondIdea);

  const crossAccountCancel = await cancelBuildJob({
    request: requestWithIp(
      `https://makeable.build/api/build-jobs/${aliceStarted.job.id}`,
      sharedIp,
      aliceStarted.cookie,
    ),
    stateStore,
    env,
    user: raymond,
    jobId: aliceStarted.job.id,
    now: new Date("2026-09-03T22:00:03.000Z"),
  });
  assert.equal(crossAccountCancel.ok, false);
  assert.equal(crossAccountCancel.status, 403);
  assert.match(crossAccountCancel.error, /another Google account/);
});

test("parallel tabs get distinct jobs while a retry recovers only its exact request", async () => {
  const stateStore = createMemoryBlobStore();
  const user = { sub: "google-subject-parallel-tabs" };
  const sharedRequest = {
    request: requestWithIp("https://makeable.build/api/build-jobs", "203.0.113.88"),
    stateStore,
    env,
    user,
  };
  const first = await createAnonymousBuildJob({
    ...sharedRequest,
    requestId: "req_parallel_halloween_0001",
    idea: "Build a pumpkin-shaped Halloween mood light.",
    now: new Date("2026-09-03T22:10:00.000Z"),
  });
  const second = await createAnonymousBuildJob({
    ...sharedRequest,
    requestId: "req_parallel_crypto_00000001",
    idea: "Build a Wi-Fi-connected crypto portfolio dashboard.",
    now: new Date("2026-09-03T22:10:01.000Z"),
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.job.id, second.job.id);

  const retried = await createAnonymousBuildJob({
    ...sharedRequest,
    requestId: "req_parallel_halloween_0001",
    idea: "Build a pumpkin-shaped Halloween mood light.",
    now: new Date("2026-09-03T22:10:02.000Z"),
  });
  assert.equal(retried.ok, false);
  assert.equal(retried.status, 409);
  assert.equal(retried.activeJob.id, first.job.id);
  assert.equal(retried.activeJob.idea, first.job.idea);
});

test("simultaneous transport retries converge on one idempotent job", async () => {
  const stateStore = createMemoryBlobStore();
  const request = requestWithIp("https://makeable.build/api/build-jobs", "203.0.113.89");
  const start = () => createAnonymousBuildJob({
    request,
    stateStore,
    env,
    requestId: "req_simultaneous_retry_0001",
    user: { sub: "google-subject-simultaneous-retry" },
    idea: "Build a spooky motion display for Halloween.",
    now: new Date("2026-09-03T22:11:00.000Z"),
  });

  const attempts = await Promise.all([start(), start()]);
  const created = attempts.find((attempt) => attempt.ok);
  const duplicate = attempts.find((attempt) => !attempt.ok);
  assert.ok(created);
  assert.equal(duplicate?.status, 409);
  assert.equal(duplicate?.activeJob?.id, created.job.id);
  assert.equal((await stateStore.list({ prefix: "jobs/" })).blobs.length, 1);
});

test("generation kill switches use the planned environment names", async () => {
  const stateStore = createMemoryBlobStore();
  const globalDisabled = await createAnonymousBuildJob({
    request: requestWithIp("https://makeable.build/api/builds", "203.0.113.11"),
    stateStore,
    env: { ...env, MAKEABLE_BUILD_GENERATION_ENABLED: "0" },
    idea: "a disabled build",
  });
  assert.equal(globalDisabled.ok, false);
  assert.match(globalDisabled.error, /build generation/i);

  const anonymousDisabled = await createAnonymousBuildJob({
    request: requestWithIp("https://makeable.build/api/builds", "203.0.113.12"),
    stateStore,
    env: { ...env, MAKEABLE_ANONYMOUS_GENERATION_ENABLED: "false" },
    idea: "a disabled anonymous build",
  });
  assert.equal(anonymousDisabled.ok, false);
  assert.match(anonymousDisabled.error, /anonymous build generation/i);

  const currentAtomicEpoch = await createAnonymousBuildJob({
    request: requestWithIp("https://makeable.build/api/builds", "203.0.113.13"),
    stateStore,
    env: {
      ...env,
      MAKEABLE_BUILD_GENERATION_ENABLED: "0",
      MAKEABLE_ATOMIC_BUILD_GENERATION_ENABLED: "1",
    },
    idea: "an atomic build from the current deployment",
    revisionContext: { requireAtomicManifest: true },
  });
  assert.equal(currentAtomicEpoch.ok, true);
});

test("the documented unusable production build receives one idempotent credit refund", async () => {
  const stateStore = createMemoryBlobStore();
  const sub = "google-subject-live-remediation";
  const buildId = "build-a-desktop-indoor-comfort-station-tha-4017c5a0";
  const jobId = "job_1234567890123456789012";
  const quotaPrefix = `quota/${createHash("sha256").update(sub).digest("hex")}`;
  await stateStore.setJSON(`gallery/${buildId}.json`, {
    ...fakeBuild(buildId),
    ownerSub: sub,
    sourceJobId: jobId,
    publishState: "public",
  });
  await stateStore.setJSON(`${quotaPrefix}/9.json`, { sub, jobId, slot: 9, status: "used" });

  assert.equal((await accountBuildQuota(stateStore, sub)).remaining, 9);
  assert.deepEqual(await refundKnownUnusableBuildCredit(stateStore, sub), {
    refunded: true,
    buildIds: [buildId],
  });
  assert.equal((await accountBuildQuota(stateStore, sub)).remaining, 10);
  assert.deepEqual(await listAccountGalleryBuilds(stateStore, sub), []);
  assert.equal((await refundKnownUnusableBuildCredit(stateStore, sub)).refunded, false);
  assert.equal((await accountBuildQuota(stateStore, sub)).remaining, 10);
});

test("a post-cutover legacy Concept build is hidden and refunded automatically", async () => {
  const stateStore = createMemoryBlobStore();
  const sub = "google-subject-post-cutover-remediation";
  const buildId = "i-want-to-create-a-desk-buddy-that-can-lis-fe524545";
  const jobId = "job_F90Cnl1Z0P4EgjFfWmhKvQ";
  const quotaPrefix = `quota/${createHash("sha256").update(sub).digest("hex")}`;
  await stateStore.setJSON(`gallery/${buildId}.json`, {
    ...fakeBuild(buildId),
    createdAt: "2026-09-04T03:51:28.698Z",
    claimedAt: "2026-09-04T03:51:30.495Z",
    ownerSub: sub,
    sourceJobId: jobId,
    publishState: "public",
  });
  await stateStore.setJSON(`${quotaPrefix}/9.json`, { sub, jobId, slot: 9, status: "used" });

  assert.equal((await accountBuildQuota(stateStore, sub)).remaining, 9);
  assert.deepEqual(await refundKnownUnusableBuildCredit(stateStore, sub), {
    refunded: true,
    buildIds: [buildId],
  });
  assert.equal((await accountBuildQuota(stateStore, sub)).remaining, 10);
  assert.deepEqual(await listAccountGalleryBuilds(stateStore, sub), []);
  const stored = await stateStore.get(`gallery/${buildId}.json`, { type: "json" });
  assert.equal(stored.publishState, "hidden");
  assert.equal(stored.creditDisposition.reason, "post_cutover_atomic_wiring_contract_missing");
});

test("a post-cutover worker cannot complete a legacy job without the atomic wiring contract", async () => {
  const stateStore = createMemoryBlobStore();
  const imageStore = createMemoryBlobStore();
  const started = await createAnonymousBuildJob({
    request: requestWithIp("https://makeable.build/api/build-jobs", "203.0.113.79"),
    stateStore,
    env,
    user: { sub: "google-subject-stale-worker" },
    idea: "Build a desk checklist",
    now: new Date("2026-09-04T03:50:38.611Z"),
  });
  await markBuildJobState(stateStore, started.job.id, BUILD_JOB_STATES.planning);

  await assert.rejects(
    completeBuildJob({
      stateStore,
      imageStore,
      jobId: started.job.id,
      build: fakeBuild("legacy-result-without-wiring"),
    }),
    /build_identity|build_manifest|atomic/i,
  );
  assert.equal((await getBuildJob(stateStore, started.job.id)).state, BUILD_JOB_STATES.planning);
});

test("a strict one-credit job commits only after its exact atomic manifest reloads", async () => {
  const stateStore = createMemoryBlobStore();
  const imageStore = createMemoryBlobStore();
  const user = { sub: "google-subject-atomic", email: "maker@example.com", name: "Maker" };
  const started = await createAnonymousBuildJob({
    request: requestWithIp("https://makeable.build/api/build-jobs", "203.0.113.77"),
    stateStore,
    env,
    user,
    idea: "Build a temperature and humidity comfort station",
    revisionContext: {
      catalogRevision: "ready78",
      promptPackageRevision: "2026-09-02.3",
      requireAtomicManifest: true,
    },
  });
  await markBuildJobState(stateStore, started.job.id, BUILD_JOB_STATES.planning);
  await completeBuildJob({
    stateStore,
    imageStore,
    jobId: started.job.id,
    build: fakeAtomicBuild(started.job.identity),
  });
  assert.equal((await accountBuildQuota(stateStore, user.sub)).remaining, 10);

  const claimed = await claimSuccessfulBuildJob({
    request: requestWithCookie(started.cookie),
    stateStore,
    imageStore,
    env,
    jobId: started.job.id,
    user,
    galleryName: "Maker",
  });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.build.id, started.job.identity.buildId);
  assert.equal(claimed.build.manifest.identity.requestFingerprint, started.job.identity.requestFingerprint);
  assert.equal(claimed.build.artifactStates.wiring.state, "ready");
  assert.equal((await accountBuildQuota(stateStore, user.sub)).remaining, 9);
});

test("a public atomic project keeps the minimal hydration proof required by its exact URL", async () => {
  const stateStore = createMemoryBlobStore();
  const imageStore = createMemoryBlobStore();
  const user = { sub: "must-not-leak", email: "maker@example.com", name: "Maker" };
  const started = await createAnonymousBuildJob({
    request: requestWithIp("https://makeable.build/api/build-jobs", "203.0.113.78"),
    stateStore,
    env,
    user,
    idea: "build a public atomic hydration test",
    revisionContext: {
      catalogRevision: "ready78",
      promptPackageRevision: "2026-09-02.3",
      requireAtomicManifest: true,
    },
  });
  await markBuildJobState(stateStore, started.job.id, BUILD_JOB_STATES.planning);
  await completeBuildJob({
    stateStore,
    imageStore,
    jobId: started.job.id,
    build: fakeAtomicBuild(started.job.identity),
  });
  const claimed = await claimSuccessfulBuildJob({
    request: requestWithCookie(started.cookie),
    stateStore,
    imageStore,
    env,
    jobId: started.job.id,
    user,
    galleryName: "Maker",
  });

  const publicBuild = await getPublicGalleryBuild(stateStore, claimed.build.id);
  assert.equal(publicBuild.id, started.job.identity.buildId);
  assert.equal(publicBuild.identity.buildId, started.job.identity.buildId);
  assert.equal(publicBuild.manifest.identity.buildId, started.job.identity.buildId);
  assert.equal(publicBuild.manifest.identity.requestFingerprint, started.job.identity.requestFingerprint);
  assert.match(publicBuild.manifest.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(publicBuild.artifactStates.parts.state, "ready");
  assert.equal(publicBuild.artifactStates.wiring.state, "ready");
  assert.equal(publicBuild.artifacts.assembly.state, "ready");
  assert.equal(publicBuild.artifacts.assembly.guideSteps.length, 1);
  assert.equal(publicBuild.semanticFulfillment.ok, true);
  assert.equal(publicBuild.semanticFulfillment.coveragePercent, 100);
  assert.deepEqual(publicBuild.artifacts.delivery.modelFetches, []);
  assert.equal(publicBuild.artifacts.wiring.standard, "");
  assert.equal(Object.hasOwn(publicBuild, "idea"), false);
  assert.doesNotMatch(
    JSON.stringify(publicBuild),
    /must-not-leak|sourceJobId|ownerSub|normalizedPrompt|pipeline/,
  );
});

test("signed-in retry limits ignore failed or cancelled attempts but still count ready builds", async () => {
  const stateStore = createMemoryBlobStore();
  const user = { sub: "google-subject-rate-limit" };
  let cookie = "";
  for (let index = 0; index < 10; index += 1) {
    const started = await createAnonymousBuildJob({
      request: requestWithIp(
        "https://makeable.build/api/build-jobs",
        "203.0.113.13",
        cookie,
      ),
      stateStore,
      env,
      user,
      idea: `signed-in build ${index}`,
      now: new Date(`2026-08-23T12:${String(index).padStart(2, "0")}:00.000Z`),
    });
    assert.equal(started.ok, true);
    cookie = started.cookie;
    await cancelBuildJob({
      request: requestWithCookie(cookie),
      stateStore,
      env,
      jobId: started.job.id,
      now: new Date(`2026-08-23T12:${String(index).padStart(2, "0")}:30.000Z`),
    });
  }

  const retryAfterCancellations = await createAnonymousBuildJob({
    request: requestWithIp(
      "https://makeable.build/api/build-jobs",
      "203.0.113.13",
      cookie,
    ),
    stateStore,
    env,
    user,
    idea: "retry after cancelled starts",
    now: new Date("2026-08-23T12:11:00.000Z"),
  });
  assert.equal(retryAfterCancellations.ok, true);
  await cancelBuildJob({
    request: requestWithCookie(retryAfterCancellations.cookie),
    stateStore,
    env,
    jobId: retryAfterCancellations.job.id,
    now: new Date("2026-08-23T12:11:30.000Z"),
  });

  cookie = retryAfterCancellations.cookie;
  for (let index = 0; index < 10; index += 1) {
    const started = await createAnonymousBuildJob({
      request: requestWithIp(
        "https://makeable.build/api/build-jobs",
        "203.0.113.13",
        cookie,
      ),
      stateStore,
      env,
      user,
      idea: `ready signed-in build ${index}`,
      now: new Date(`2026-08-23T13:${String(index).padStart(2, "0")}:00.000Z`),
    });
    assert.equal(started.ok, true);
    cookie = started.cookie;
    await markBuildJobState(
      stateStore,
      started.job.id,
      BUILD_JOB_STATES.ready,
      new Date(`2026-08-23T13:${String(index).padStart(2, "0")}:30.000Z`),
    );
  }

  const blocked = await createAnonymousBuildJob({
    request: requestWithIp(
      "https://makeable.build/api/build-jobs",
      "203.0.113.13",
      cookie,
    ),
    stateStore,
    env,
    user,
    idea: "one counted signed-in start too many",
    now: new Date("2026-08-23T13:11:00.000Z"),
  });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /10-build daily safety limit/);
});

test("successful draft jobs keep binary image bytes separate from metadata", async () => {
  const stateStore = createMemoryBlobStore();
  const imageStore = createMemoryBlobStore();
  const { jobId, cookie } = await startAndComplete({
    stateStore,
    imageStore,
    ip: "203.0.113.20",
    buildId: "build-image-test",
  });

  const job = await getBuildJob(stateStore, jobId);
  assert.equal(job.state, "ready");
  assert.equal(job.result.image.url, `/api/build-jobs/${jobId}/image`);
  assert.doesNotMatch(JSON.stringify(job.result), /data:image/);

  const forbidden = await getDraftJobImage({
    request: new Request(`https://makeable.build/api/build-jobs/${jobId}/image`),
    stateStore,
    imageStore,
    env,
    jobId,
    now: draftAccessNow,
  });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.status, 403);

  const image = await getDraftJobImage({
    request: requestWithCookie(cookie),
    stateStore,
    imageStore,
    env,
    jobId,
    now: draftAccessNow,
  });
  assert.equal(image.ok, true);
  assert.equal(Buffer.from(image.image.bytes).toString("utf8"), "hello");
  assert.deepEqual(await listPublicGalleryBuilds(stateStore), []);
});

test("claimed fallback-image jobs keep their static preview URL", async () => {
  const stateStore = createMemoryBlobStore();
  const imageStore = createMemoryBlobStore();
  const draft = await startAndComplete({
    stateStore,
    imageStore,
    ip: "203.0.113.21",
    buildId: "build-fallback-image-test",
    build: fakeBuild("build-fallback-image-test", {
      image: {
        url: "/concepts/homepage-v2/study-desk-companion-v2.webp",
        source: "preview_fallback",
        status: "fallback",
        model: "static-preview",
      },
    }),
  });

  const claim = await claimSuccessfulBuildJob({
    request: requestWithCookie(draft.cookie),
    stateStore,
    imageStore,
    env,
    jobId: draft.jobId,
    user: { sub: "google-subject-fallback", email: "maker@example.com", name: "Mo" },
    galleryName: "Mo",
    now: draftAccessNow,
  });

  assert.equal(claim.ok, true);
  const publicBuild = await getPublicGalleryBuild(stateStore, "build-fallback-image-test");
  assert.equal(publicBuild.image.url, "/concepts/homepage-v2/study-desk-companion-v2.webp");
  const image = await getGalleryImage(imageStore, "build-fallback-image-test");
  assert.equal(image, null);
});

test("routed build state store splits jobs, quota, and community metadata stores", async () => {
  const jobStore = createMemoryBlobStore();
  const quotaStore = createMemoryBlobStore();
  const communityStore = createMemoryBlobStore();
  const stateStore = createRoutedBuildStateStore({ jobStore, quotaStore, communityStore });

  await stateStore.setJSON("jobs/job_1234567890123456789012.json", { type: "job" });
  await stateStore.setJSON("active/browser/browser-hash.json", { type: "active" });
  await stateStore.setJSON("claims/job_1234567890123456789012.json", { type: "claim" });
  await stateStore.setJSON("quota/sub-hash/0.json", { type: "quota" });
  await stateStore.setJSON("gallery/build-routed.json", { id: "build-routed", type: "gallery" });
  await stateStore.setJSON("builds/build-legacy-routed.json", {
    id: "build-legacy-routed",
    type: "legacy",
  });

  assert.equal((await jobStore.get("jobs/job_1234567890123456789012.json", { type: "json" })).type, "job");
  assert.equal((await jobStore.get("active/browser/browser-hash.json", { type: "json" })).type, "active");
  assert.equal((await jobStore.get("claims/job_1234567890123456789012.json", { type: "json" })).type, "claim");
  assert.equal((await quotaStore.get("quota/sub-hash/0.json", { type: "json" })).type, "quota");
  assert.equal((await communityStore.get("gallery/build-routed.json", { type: "json" })).type, "gallery");
  assert.equal((await communityStore.get("builds/build-legacy-routed.json", { type: "json" })).type, "legacy");
  assert.equal(buildJobStateStoreName("production"), "makeable-build-jobs");
  assert.equal(buildJobQuotaStoreName("production"), "makeable-build-quota-ledger");
  assert.equal(buildCommunityStoreName("production"), "community-builds");
  assert.equal(buildCommunityStoreName("deploy-preview"), "community-builds-preview");
});

test("public gallery merges legacy community builds without ownership or internal leaks", async () => {
  const stateStore = createRoutedBuildStateStore({
    jobStore: createMemoryBlobStore(),
    quotaStore: createMemoryBlobStore(),
    communityStore: createMemoryBlobStore(),
  });
  await stateStore.setJSON("builds/build-legacy-public.json", {
    ...fakeBuild("build-legacy-public", {
      email: "legacy-maker@example.com",
      imagePrompt: "secret render prompt",
      models: { image: "gpt-image-2", build: "gpt-5" },
      parts: [{
        id: "verified-controller",
        name: "Pre-soldered controller",
        category: "controller",
        why: "Runs the project.",
        checkedDate: "2026-08-21",
        ownerSub: "must-not-leak",
      }],
      image: {
        url: "/concepts/community-v1/assets/legacy.webp",
        prompt: "secret render prompt",
        model: "gpt-image-2",
        source: "openai",
        status: "generated",
      },
    }),
  });

  const publicBuilds = await listPublicGalleryBuilds(stateStore);
  assert.equal(publicBuilds.length, 1);
  assert.equal(publicBuilds[0].id, "build-legacy-public");
  assert.equal((await getPublicGalleryBuild(stateStore, "build-legacy-public")).id, "build-legacy-public");
  assert.deepEqual(await listAccountGalleryBuilds(stateStore, "legacy-maker@example.com"), []);
  assert.equal(publicBuilds[0].parts[0].checkedDate, "2026-08-21");
  assert.equal(Object.hasOwn(publicBuilds[0], "idea"), false);
  assert.doesNotMatch(
    JSON.stringify(publicBuilds[0]),
    /legacy-maker@example\.com|imagePrompt|secret render prompt|gpt-image-2|models|sourceJobId|ownerSub/,
  );
});

test("eleven simultaneous successful claims reserve only ten account slots", async () => {
  const stateStore = createMemoryBlobStore();
  const imageStore = createMemoryBlobStore();
  const drafts = await Promise.all(
    Array.from({ length: 11 }, (_, index) =>
      startAndComplete({
        stateStore,
        imageStore,
        ip: `203.0.113.${30 + index}`,
        buildId: `build-claim-${index}`,
      }),
    ),
  );

  const results = await Promise.all(
    drafts.map((draft, index) =>
      claimSuccessfulBuildJob({
        request: requestWithCookie(draft.cookie),
        stateStore,
        imageStore,
        env,
        jobId: draft.jobId,
        user: { sub: "google-subject-1", email: "maker@example.com", name: "Mo" },
        galleryName: `Mo ${index}`,
        now: draftAccessNow,
      }),
    ),
  );

  assert.equal(results.filter((result) => result.ok).length, 10);
  assert.equal(results.filter((result) => !result.ok && result.status === 429).length, 1);
  assert.equal((await accountBuildQuota(stateStore, "google-subject-1")).used, 10);
  assert.equal((await accountBuildQuota(stateStore, "google-subject-1")).reserved, 0);
  assert.equal((await listPublicGalleryBuilds(stateStore)).length, 10);
});

test("background dispatch is short-lived, job-bound, and execution is claimed once", async () => {
  const stateStore = createMemoryBlobStore();
  const started = await createAnonymousBuildJob({
    request: requestWithIp("https://makeable.build/api/build-jobs", "203.0.113.99"),
    stateStore,
    env,
    idea: "a compact desk timer",
    now: new Date("2026-08-23T12:00:00.000Z"),
  });
  assert.equal(started.ok, true);

  const dispatch = createBackgroundBuildDispatch(
    env,
    started.job.id,
    new Date("2026-08-23T12:00:01.000Z"),
  );
  assert.equal(dispatch.path, "/.netlify/functions/build-background");
  assert.equal(
    verifyBackgroundBuildSignature(
      env,
      started.job.id,
      dispatch.timestamp,
      dispatch.signature,
      new Date("2026-08-23T12:00:02.000Z"),
    ),
    true,
  );
  assert.equal(await claimBuildJobExecution(
    stateStore,
    started.job.id,
    new Date("2026-08-23T12:00:03.000Z"),
  ), true);
  assert.equal(await claimBuildJobExecution(
    stateStore,
    started.job.id,
    new Date("2026-08-23T12:00:04.000Z"),
  ), false);
});

test("the API hands a queued build to Netlify before replying to the browser", async () => {
  let captured = null;
  const result = await invokeBackgroundBuildJob(
    new Request("https://makeable.build/api/build-jobs"),
    env,
    "job_1234567890123456789012",
    async (url, options) => {
      captured = { url: String(url), options };
      return new Response(null, { status: 202 });
    },
  );
  assert.deepEqual(result, { ok: true, status: 202 });
  assert.equal(captured.url, "https://makeable.build/.netlify/functions/build-background");
  assert.equal(captured.options.method, "POST");
  assert.deepEqual(JSON.parse(captured.options.body), { jobId: "job_1234567890123456789012" });
  assert.ok(captured.options.headers["X-Makeable-Background-Timestamp"]);
  assert.ok(captured.options.headers["X-Makeable-Background-Signature"]);
});

test("moderation rejects disallowed concepts before quota or public publish", async () => {
  const stateStore = createMemoryBlobStore();
  const imageStore = createMemoryBlobStore();
  const draft = await startAndComplete({
    stateStore,
    imageStore,
    ip: "203.0.113.41",
    buildId: "build-moderation-test",
    build: fakeBuild("build-moderation-test", {
      idea: "a pipe bomb detonator with a timer",
      title: "Pipe bomb detonator",
      summary: "A dangerous explosive concept.",
    }),
  });

  assert.equal(moderateBuildForPublicGallery((await getBuildJob(stateStore, draft.jobId))).allowed, false);
  const result = await claimSuccessfulBuildJob({
    request: requestWithCookie(draft.cookie),
    stateStore,
    imageStore,
    env,
    jobId: draft.jobId,
    user: { sub: "google-subject-moderation", email: "maker@example.com", name: "Mo" },
    galleryName: "Mo",
    now: draftAccessNow,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.match(result.error, /cannot be published/i);
  assert.equal((await accountBuildQuota(stateStore, "google-subject-moderation")).used, 0);
  assert.equal((await accountBuildQuota(stateStore, "google-subject-moderation")).reserved, 0);
  assert.deepEqual(await listPublicGalleryBuilds(stateStore), []);
  const job = await getBuildJob(stateStore, draft.jobId);
  assert.equal(job.state, BUILD_JOB_STATES.ready);
  assert.equal(job.publishState, "rejected");
});

test("owner unpublish hides gallery record without releasing used quota", async () => {
  const stateStore = createMemoryBlobStore();
  const imageStore = createMemoryBlobStore();
  const draft = await startAndComplete({
    stateStore,
    imageStore,
    ip: "203.0.113.42",
    buildId: "build-hide-test",
    build: fakeBuild("build-hide-test", {
      email: "maker@example.com",
      imagePrompt: "internal prompt must not leak",
      session: { token: "secret-session" },
      quota: { used: 99 },
      image: {
        url: "data:image/png;base64,aGVsbG8=",
        model: "gpt-image-2",
        prompt: "internal prompt must not leak",
        source: "openai",
        status: "generated",
      },
    }),
  });
  const user = { sub: "google-subject-hide", email: "maker@example.com", name: "Mo" };
  const claim = await claimSuccessfulBuildJob({
    request: requestWithCookie(draft.cookie),
    stateStore,
    imageStore,
    env,
    jobId: draft.jobId,
    user,
    galleryName: "Mo",
    now: draftAccessNow,
  });
  assert.equal(claim.ok, true);
  assert.equal((await accountBuildQuota(stateStore, user.sub)).used, 1);
  assert.equal((await listPublicGalleryBuilds(stateStore)).length, 1);
  assert.equal((await getGalleryImage(imageStore, "build-hide-test")).contentType, "image/png");
  assert.doesNotMatch(
    JSON.stringify((await listPublicGalleryBuilds(stateStore))[0]),
    /maker@example\.com|google-subject-hide|ownerSub|sourceJobId|internal prompt|secret-session|quota|gpt-image-2/,
  );

  const hidden = await hidePublicGalleryBuild({
    stateStore,
    buildId: "build-hide-test",
    user,
    now: new Date("2026-08-21T19:10:00.000Z"),
  });
  assert.equal(hidden.ok, true);
  assert.equal(hidden.build.publishState, "hidden");
  assert.equal((await accountBuildQuota(stateStore, user.sub)).used, 1);
  assert.equal((await accountBuildQuota(stateStore, user.sub)).reserved, 0);
  assert.deepEqual(await listPublicGalleryBuilds(stateStore), []);
  assert.equal(await getPublicGalleryBuild(stateStore, "build-hide-test"), null);
  assert.equal((await getAccountGalleryBuild(stateStore, "build-hide-test", user.sub)).publishState, "hidden");
  assert.equal((await listAccountGalleryBuilds(stateStore, user.sub))[0].publishState, "hidden");

  const wrongOwner = await hidePublicGalleryBuild({
    stateStore,
    buildId: "build-hide-test",
    user: { sub: "google-subject-other", email: "other@example.com", name: "Other" },
  });
  assert.equal(wrongOwner.ok, false);
  assert.equal(wrongOwner.status, 403);
});

test("failed publish releases claim marker and quota reservation cleanly", async () => {
  const stateStore = createMemoryBlobStore();
  const imageStore = createMemoryBlobStore();
  const draft = await startAndComplete({
    stateStore,
    imageStore,
    ip: "203.0.113.44",
    buildId: "build-release-test",
  });

  const originalSet = stateStore.set.bind(stateStore);
  let failGalleryWrite = true;
  stateStore.set = async (key, value, options) => {
    if (failGalleryWrite && key.startsWith("gallery/")) {
      throw new Error("simulated gallery write failure");
    }
    return originalSet(key, value, options);
  };

  await assert.rejects(
    claimSuccessfulBuildJob({
      request: requestWithCookie(draft.cookie),
      stateStore,
      imageStore,
      env,
      jobId: draft.jobId,
      user: { sub: "google-subject-release", email: "maker@example.com", name: "Mo" },
      galleryName: "Mo",
      now: draftAccessNow,
    }),
    /simulated gallery write failure/,
  );
  assert.equal((await accountBuildQuota(stateStore, "google-subject-release")).used, 0);
  assert.equal((await accountBuildQuota(stateStore, "google-subject-release")).reserved, 0);

  failGalleryWrite = false;
  const retry = await claimSuccessfulBuildJob({
    request: requestWithCookie(draft.cookie),
    stateStore,
    imageStore,
    env,
    jobId: draft.jobId,
    user: { sub: "google-subject-release", email: "maker@example.com", name: "Mo" },
    galleryName: "Mo",
    now: draftAccessNow,
  });
  assert.equal(retry.ok, true);
  assert.equal((await accountBuildQuota(stateStore, "google-subject-release")).used, 1);
  assert.equal((await accountBuildQuota(stateStore, "google-subject-release")).reserved, 0);
});

test("nightly cleanup removes old unclaimed outputs and stale reservations", async () => {
  const stateStore = createMemoryBlobStore();
  const imageStore = createMemoryBlobStore();
  const draft = await startAndComplete({
    stateStore,
    imageStore,
    ip: "203.0.113.55",
    buildId: "build-cleanup-test",
    completedAt: new Date("2026-08-21T19:00:02.000Z"),
  });
  const reservation = await claimSuccessfulBuildJob({
    request: requestWithCookie(draft.cookie),
    stateStore,
    imageStore,
    env,
    jobId: draft.jobId,
    user: { sub: "google-subject-cleanup", email: "maker@example.com", name: "Mo" },
    galleryName: "Mo",
    now: draftAccessNow,
  });
  assert.equal(reservation.ok, true);

  const unclaimed = await startAndComplete({
    stateStore,
    imageStore,
    ip: "203.0.113.56",
    buildId: "build-unclaimed-cleanup",
    completedAt: new Date("2026-08-21T18:00:02.000Z"),
  });
  const stale = await createAnonymousBuildJob({
    request: requestWithIp("https://makeable.build/api/builds", "203.0.113.57"),
    stateStore,
    env,
    idea: "a stale queued job",
    now: new Date("2026-08-21T18:00:00.000Z"),
  });
  assert.equal(stale.ok, true);
  const staleReservationSub = "google-subject-stale-reservation";
  await stateStore.setJSON(
    `quota/${createHash("sha256").update(staleReservationSub).digest("hex")}/0.json`,
    {
      sub: staleReservationSub,
      slot: 0,
      jobId: "job_1234567890123456789012",
      status: "reserved",
      createdAt: "2026-08-21T18:00:00.000Z",
    },
  );

  const cleanup = await cleanupAbandonedBuildJobs({
    stateStore,
    imageStore,
    now: new Date("2026-08-21T20:01:00.000Z"),
  });

  assert.equal(cleanup.jobsDeleted, 1);
  assert.equal(cleanup.jobsFailed, 1);
  assert.ok(cleanup.imagesDeleted >= 1);
  assert.equal(cleanup.reservationsReleased, 1);
  assert.equal(await getBuildJob(stateStore, unclaimed.jobId), null);
  assert.equal((await getBuildJob(stateStore, stale.job.id)).state, "failed");
  assert.equal((await accountBuildQuota(stateStore, staleReservationSub)).reserved, 0);
  assert.equal((await listPublicGalleryBuilds(stateStore)).length, 1);
});

test("Netlify background and cleanup functions are deployable entries", async () => {
  const toml = await readFile(path.join(root, "netlify.toml"), "utf8");
  const apiSource = await readFile(path.join(root, "netlify/functions/api.mjs"), "utf8");
  assert.match(toml, /\[functions\."build-background"\]/);
  assert.match(toml, /\[functions\."build-cleanup"\]/);
  assert.match(apiSource, /typeof context\?\.waitUntil === "function"/);
  assert.match(apiSource, /invokeBackgroundBuildJob\(req, env, start\.job\.id\)/);
  const background = await import("../netlify/functions/build-background.mjs");
  const cleanup = await import("../netlify/functions/build-cleanup.mjs");
  assert.equal(typeof background.default, "function");
  assert.deepEqual(background.config, { background: true });
  assert.equal(typeof cleanup.default, "function");
  assert.deepEqual(cleanup.config, { schedule: "@daily" });

  const timestamp = "2026-08-21T18:00:00.000Z";
  const signature = createBackgroundBuildSignature(env, "job_1234567890123456789012", timestamp);
  assert.equal(
    verifyBackgroundBuildSignature(
      env,
      "job_1234567890123456789012",
      timestamp,
      signature,
      new Date("2026-08-21T18:04:00.000Z"),
    ),
    true,
  );
  assert.equal(
    verifyBackgroundBuildSignature(
      env,
      "job_1234567890123456789012",
      timestamp,
      signature,
      new Date("2026-08-21T18:06:00.000Z"),
    ),
    false,
  );
});

async function startAndComplete({
  stateStore,
  imageStore,
  ip,
  buildId,
  build = fakeBuild(buildId),
  completedAt = new Date("2026-08-21T19:00:02.000Z"),
}) {
  const started = await createAnonymousBuildJob({
    request: requestWithIp("https://makeable.build/api/builds", ip),
    stateStore,
    env,
    idea: `a useful build for ${buildId}`,
    now: new Date("2026-08-21T19:00:00.000Z"),
  });
  assert.equal(started.ok, true);
  await markBuildJobState(
    stateStore,
    started.job.id,
    BUILD_JOB_STATES.planning,
    new Date("2026-08-21T19:00:01.000Z"),
  );
  await completeBuildJob({
    stateStore,
    imageStore,
    jobId: started.job.id,
    build,
    now: completedAt,
  });
  return { jobId: started.job.id, cookie: started.cookie };
}

function fakeBuild(id, overrides = {}) {
  const base = {
    id,
    createdAt: "2026-08-21T19:00:02.000Z",
    idea: "a useful build",
    title: "Useful build",
    summary: "A compact ESP32 build.",
    behavior: "It senses and responds.",
    visibleHardwareCues: ["compact enclosure"],
    image: {
      url: "data:image/png;base64,aGVsbG8=",
      source: "openai",
      status: "generated",
      model: "test-image-model",
    },
    parts: [],
    warnings: [],
    cost: { totalParts: 0, knownSubtotalUsd: 0, estimatedTotalUsd: 0 },
    status: "Concept",
  };
  return {
    ...base,
    ...overrides,
    image: {
      ...base.image,
      ...(overrides.image || {}),
    },
  };
}

function fakeAtomicBuild(identity) {
  return fakeBuild(identity.buildId, {
    idea: identity.normalizedPrompt,
    title: "Indoor Comfort Station",
    summary: "Measures temperature and humidity.",
    behavior: "Shows live comfort readings.",
    image: {
      url: "data:image/png;base64,aGVsbG8=",
      source: "openai",
      model: "test-image-model",
      buildId: identity.buildId,
      requestFingerprint: identity.requestFingerprint,
    },
    parts: [
      { id: "esp32", name: "ESP32 controller", category: "controller", why: "Runs the station.", assemblyAssets: [{ partId: "esp32-glb" }] },
      { id: "bme280", name: "BME280 sensor", category: "sensor", why: "Measures temperature and humidity.", assemblyAssets: [{ partId: "bme280-glb" }] },
    ],
    semanticFulfillment: {
      ok: true,
      coveragePercent: 100,
      requestedCapabilities: ["humidity", "temperature"],
      providedCapabilities: ["humidity", "temperature"],
      missingCapabilities: [],
      unrelatedParts: [],
      planUnrequestedCapabilities: [],
    },
    artifacts: {
      lineage: {
        buildId: identity.buildId,
        requestFingerprint: identity.requestFingerprint,
      },
      assembly: {
        schemaVersion: "MakeablePrompt2CircuitAssemblyV1",
        state: "ready",
        contractFingerprint: "atomic-test-fingerprint",
        requiredAssets: [{ id: "esp32-glb", sha256: "a".repeat(64) }],
        wires: [{ id: "wire-1" }],
        guideSteps: [{ id: "step-1" }],
      },
    },
  });
}

function requestWithIp(url, ip, cookie = "") {
  const headers = { "X-Forwarded-For": ip };
  if (cookie) headers.Cookie = cookiePair(cookie);
  return new Request(url, { headers });
}

function requestWithCookie(cookie) {
  return new Request("https://makeable.build/api/build-jobs/job_1234567890123456789012", {
    headers: { Cookie: cookiePair(cookie) },
  });
}

function cookiePair(cookie) {
  return String(cookie || "").split(";")[0];
}
