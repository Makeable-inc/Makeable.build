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
  getAccountGalleryBuild,
  getDraftJobImage,
  getGalleryImage,
  getBuildJob,
  getPublicGalleryBuild,
  hidePublicGalleryBuild,
  listPublicGalleryBuilds,
  listAccountGalleryBuilds,
  markBuildJobState,
  moderateBuildForPublicGallery,
  BUILD_JOB_STATES,
  verifyBackgroundBuildSignature,
} from "../lib/build-jobs.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  MAKEABLE_DRAFT_COOKIE_SECRET: "draft-cookie-secret-with-at-least-32-chars",
  MAKEABLE_BACKGROUND_SECRET: "background-secret-with-at-least-32-chars",
  NODE_ENV: "test",
};
const BUILD_FIXTURE_NOW = new Date("2026-08-21T19:05:00.000Z");

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
      now: new Date(`2026-08-21T18:0${5 + index}:00.000Z`),
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
});

test("signed-in accounts use the ten-start account window instead of the anonymous IP limit", async () => {
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

  const blocked = await createAnonymousBuildJob({
    request: requestWithIp(
      "https://makeable.build/api/build-jobs",
      "203.0.113.13",
      cookie,
    ),
    stateStore,
    env,
    user,
    idea: "one signed-in start too many",
    now: new Date("2026-08-23T12:11:00.000Z"),
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
  });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.status, 403);

  const image = await getDraftJobImage({
    request: requestWithCookie(cookie),
    stateStore,
    imageStore,
    env,
    jobId,
    now: BUILD_FIXTURE_NOW,
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
    now: BUILD_FIXTURE_NOW,
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
        now: BUILD_FIXTURE_NOW,
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
    now: BUILD_FIXTURE_NOW,
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
    now: BUILD_FIXTURE_NOW,
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
      now: BUILD_FIXTURE_NOW,
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
    now: BUILD_FIXTURE_NOW,
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
    now: BUILD_FIXTURE_NOW,
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
  assert.doesNotMatch(apiSource, /fetch\(new URL\("\/\.netlify\/functions\/build-background"/);
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
