import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const BUILD_DRAFT_COOKIE = "__Host-makeable_draft";
export const BUILD_JOB_LIMITS = Object.freeze({
  startsPerWindow: 3,
  startWindowMs: 24 * 60 * 60 * 1000,
  successfulClaimsPerAccount: 10,
  activeTtlMs: 20 * 60 * 1000,
  draftCookieMaxAgeSeconds: 7 * 24 * 60 * 60,
});

export const BUILD_JOB_STATES = Object.freeze({
  queued: "queued",
  planning: "planning",
  fittingParts: "fitting_parts",
  rendering: "rendering",
  ready: "ready",
  failed: "failed",
  cancelled: "cancelled",
});

const TERMINAL_STATES = new Set([
  BUILD_JOB_STATES.ready,
  BUILD_JOB_STATES.failed,
  BUILD_JOB_STATES.cancelled,
]);
const JOB_ID_PATTERN = /^job_[A-Za-z0-9_-]{22}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{3,140}$/;
const COOKIE_VALUE_PATTERN = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const BACKGROUND_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

export function buildJobStateStoreName(context) {
  return context && context !== "production"
    ? "makeable-build-jobs-preview"
    : "makeable-build-jobs";
}

export function buildJobStateStoreNameForFunctionContext(context) {
  const deployContext =
    typeof context?.deploy?.context === "string" ? context.deploy.context : "";
  return buildJobStateStoreName(deployContext);
}

export function buildJobQuotaStoreName(context) {
  return context && context !== "production"
    ? "makeable-build-quota-ledger-preview"
    : "makeable-build-quota-ledger";
}

export function buildJobQuotaStoreNameForFunctionContext(context) {
  const deployContext =
    typeof context?.deploy?.context === "string" ? context.deploy.context : "";
  return buildJobQuotaStoreName(deployContext);
}

export function buildCommunityStoreName(context) {
  return context && context !== "production"
    ? "community-builds-preview"
    : "community-builds";
}

export function buildCommunityStoreNameForFunctionContext(context) {
  const deployContext =
    typeof context?.deploy?.context === "string" ? context.deploy.context : "";
  return buildCommunityStoreName(deployContext);
}

export function buildJobImageStoreName(context) {
  return context && context !== "production"
    ? "makeable-build-images-preview"
    : "makeable-build-images";
}

export function buildJobImageStoreNameForFunctionContext(context) {
  const deployContext =
    typeof context?.deploy?.context === "string" ? context.deploy.context : "";
  return buildJobImageStoreName(deployContext);
}

export function createMemoryBlobStore(initial = []) {
  const values = new Map(initial);
  return {
    values,
    async set(key, value, options = {}) {
      const entry = await memoryBlobEntry(value, options);
      if (options.onlyIfNew && values.has(key)) return { modified: false };
      values.set(key, entry);
      return { modified: true };
    },
    async setJSON(key, value, options = {}) {
      return this.set(
        key,
        new Blob([JSON.stringify(value)], { type: "application/json" }),
        options,
      );
    },
    async get(key, options = {}) {
      const entry = values.get(key);
      if (!entry) return null;
      if (options.type === "json") return JSON.parse(entry.bytes.toString("utf8"));
      if (options.type === "arrayBuffer") return bufferToArrayBuffer(entry.bytes);
      if (options.type === "blob") {
        return new Blob([entry.bytes], { type: entry.contentType || "" });
      }
      return entry.bytes.toString("utf8");
    },
    async delete(key) {
      values.delete(key);
    },
    async list(options = {}) {
      const prefix = String(options.prefix || "");
      const blobs = [...values.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((key) => ({ key, metadata: values.get(key)?.metadata || {} }));
      return { blobs, directories: [] };
    },
  };
}

export function createRoutedBuildStateStore({ jobStore, quotaStore, communityStore } = {}) {
  if (!jobStore || !quotaStore || !communityStore) {
    throw new Error("Build state routing requires job, quota, and community stores");
  }
  const routedStore = {
    async set(key, value, options = {}) {
      return routedBlobStoreForKey(key, { jobStore, quotaStore, communityStore })
        .set(key, value, options);
    },
    async setJSON(key, value, options = {}) {
      const store = routedBlobStoreForKey(key, { jobStore, quotaStore, communityStore });
      if (typeof store.setJSON === "function") return store.setJSON(key, value, options);
      return store.set(
        key,
        new Blob([JSON.stringify(value)], { type: "application/json" }),
        options,
      );
    },
    async get(key, options = {}) {
      return routedBlobStoreForKey(key, { jobStore, quotaStore, communityStore })
        .get(key, options);
    },
    async delete(key) {
      return routedBlobStoreForKey(key, { jobStore, quotaStore, communityStore })
        .delete(key);
    },
    async list(options = {}) {
      const prefix = String(options.prefix || "");
      const target = routedBlobStoreForPrefix(prefix, { jobStore, quotaStore, communityStore });
      if (target) return target.list(options);
      const pages = await Promise.all(
        [jobStore, quotaStore, communityStore].map((store) => store.list(options)),
      );
      const blobs = pages
        .flatMap((page) => page.blobs || [])
        .filter((blob) => blob?.key)
        .sort((a, b) => String(a.key).localeCompare(String(b.key)));
      return { blobs, directories: [] };
    },
    routes: {
      jobs: jobStore,
      quota: quotaStore,
      community: communityStore,
    },
  };
  return routedStore;
}

function routedBlobStoreForKey(key, stores) {
  const normalizedKey = String(key || "");
  if (normalizedKey.startsWith("quota/")) return stores.quotaStore;
  if (normalizedKey.startsWith("gallery/") || normalizedKey.startsWith("builds/")) {
    return stores.communityStore;
  }
  return stores.jobStore;
}

function routedBlobStoreForPrefix(prefix, stores) {
  const normalizedPrefix = String(prefix || "");
  if (normalizedPrefix.startsWith("quota/")) return stores.quotaStore;
  if (normalizedPrefix.startsWith("gallery/") || normalizedPrefix.startsWith("builds/")) {
    return stores.communityStore;
  }
  if (
    normalizedPrefix.startsWith("jobs/") ||
    normalizedPrefix.startsWith("active/") ||
    normalizedPrefix.startsWith("starts/") ||
    normalizedPrefix.startsWith("claims/")
  ) {
    return stores.jobStore;
  }
  return null;
}

export function normalizeBuildIdea(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

export function builderDisabled(env, operation) {
  if (!enabledEnv(env.MAKEABLE_BUILD_GENERATION_ENABLED)) {
    return "Makeable build generation is temporarily unavailable.";
  }
  if (operation === "start" && !enabledEnv(env.MAKEABLE_ANONYMOUS_GENERATION_ENABLED)) {
    return "Anonymous build generation is temporarily unavailable.";
  }
  return "";
}

export function draftCookieSecret(env = {}) {
  const configured = String(
    env.MAKEABLE_DRAFT_COOKIE_SECRET || env.DASHBOARD_SESSION_SECRET || "",
  );
  if (configured.length >= 32) return configured;
  if (env.NODE_ENV && env.NODE_ENV !== "production") {
    return "makeable-local-draft-cookie-secret-not-for-production";
  }
  if (!env.NETLIFY && !env.CONTEXT) {
    return "makeable-local-draft-cookie-secret-not-for-production";
  }
  return "";
}

export function backgroundBuildSecret(env = {}) {
  const configured = String(env.MAKEABLE_BACKGROUND_SECRET || "");
  if (configured.length >= 32) return configured;
  return draftCookieSecret(env);
}

export function createBackgroundBuildSignature(env, jobId, timestamp) {
  const secret = backgroundBuildSecret(env);
  if (!secret) throw new Error("Background build signing is not configured");
  return hmac(secret, `${jobId}.${timestamp}`);
}

export function verifyBackgroundBuildSignature(env, jobId, timestamp, signature, now = new Date()) {
  if (!JOB_ID_PATTERN.test(String(jobId || ""))) return false;
  const time = validTimestamp(timestamp);
  if (Number.isNaN(time.getTime())) return false;
  if (Math.abs(validDate(now).getTime() - time.getTime()) > BACKGROUND_SIGNATURE_TOLERANCE_MS) {
    return false;
  }
  let expected;
  try {
    expected = createBackgroundBuildSignature(env, jobId, timestamp);
  } catch {
    return false;
  }
  return constantTimeEqual(signature, expected);
}

export function createBackgroundBuildDispatch(env, jobId, now = new Date()) {
  const timestamp = validDate(now).toISOString();
  return {
    path: "/.netlify/functions/build-background",
    timestamp,
    signature: createBackgroundBuildSignature(env, jobId, timestamp),
  };
}

export async function claimBuildJobExecution(stateStore, jobId, now = new Date()) {
  const job = await getBuildJob(stateStore, jobId);
  if (!job || TERMINAL_STATES.has(job.state)) return false;
  const write = await setJsonBlob(stateStore, executionKey(jobId), {
    jobId,
    claimedAt: validDate(now).toISOString(),
  }, { onlyIfNew: true });
  return write?.modified !== false;
}

export async function createAnonymousBuildJob({
  request,
  stateStore,
  env = {},
  idea,
  user = null,
  now = new Date(),
  randomBytesImpl = randomBytes,
} = {}) {
  const authenticatedSub = typeof user?.sub === "string" ? user.sub.trim() : "";
  const disabled = builderDisabled(env, authenticatedSub ? "authenticated-start" : "start");
  if (disabled) return failure(disabled, 503);

  const secret = draftCookieSecret(env);
  if (!secret) {
    return failure("Build draft signing is not configured.", 503);
  }
  const normalizedIdea = normalizeBuildIdea(idea);
  if (!normalizedIdea) return failure("Describe what you want to build.", 400);

  const timestamp = validDate(now);
  const cookie = buildDraftCookieState(request, env, { now: timestamp });
  const browserId = cookie.state === "valid"
    ? cookie.payload.browserId
    : randomToken(randomBytesImpl, 18);
  const browserHash = scopedHash(secret, `browser:${browserId}`);
  const ipHash = scopedHash(secret, `ip:${clientIpFromRequest(request) || "unknown"}`);
  const accountHash = authenticatedSub
    ? scopedHash(secret, `account:${authenticatedSub}`)
    : "";

  const activeIndexes = [
    { kind: "browser", hash: browserHash },
    { kind: "ip", hash: ipHash },
    ...(accountHash ? [{ kind: "account", hash: accountHash }] : []),
  ];
  const active = await activeBuildForIndexes(stateStore, activeIndexes, timestamp);
  if (active) {
    return {
      ok: false,
      status: 429,
      error: "This browser or network already has an active build.",
      activeJob: publicBuildJob(active),
      headers: { "Retry-After": "10" },
    };
  }

  const startsPerWindow = authenticatedSub
    ? BUILD_JOB_LIMITS.successfulClaimsPerAccount
    : BUILD_JOB_LIMITS.startsPerWindow;
  const startCounts = authenticatedSub
    ? [await recentStartCount(stateStore, "account", accountHash, timestamp)]
    : await Promise.all([
      recentStartCount(stateStore, "browser", browserHash, timestamp),
      recentStartCount(stateStore, "ip", ipHash, timestamp),
    ]);
  if (startCounts.some((count) => count >= startsPerWindow)) {
    return {
      ok: false,
      status: 429,
      error: authenticatedSub
        ? `This account has reached the ${startsPerWindow}-build daily safety limit.`
        : `This browser or network has reached the ${startsPerWindow}-build daily limit.`,
      headers: { "Retry-After": "3600" },
    };
  }

  const jobId = `job_${randomToken(randomBytesImpl, 16)}`;
  const nonce = randomToken(randomBytesImpl, 18);
  const nowIso = timestamp.toISOString();
  const activeExpiresAt = new Date(timestamp.getTime() + BUILD_JOB_LIMITS.activeTtlMs)
    .toISOString();
  const job = {
    schemaVersion: 1,
    id: jobId,
    state: BUILD_JOB_STATES.queued,
    idea: normalizedIdea,
    createdAt: nowIso,
    updatedAt: nowIso,
    activeExpiresAt,
    browserHash,
    ipHash,
    accountHash,
    draftNonceHash: scopedHash(secret, `nonce:${nonce}`),
    result: null,
    error: "",
  };

  const write = await setJsonBlob(stateStore, jobKey(jobId), job, { onlyIfNew: true });
  if (write?.modified === false) {
    return failure("Build job could not be created. Please try again.", 503);
  }
  const indexWrites = [
    setJsonBlob(stateStore, activeKey("browser", browserHash), {
      jobId,
      createdAt: nowIso,
      expiresAt: activeExpiresAt,
    }),
    setJsonBlob(stateStore, activeKey("ip", ipHash), {
      jobId,
      createdAt: nowIso,
      expiresAt: activeExpiresAt,
    }),
    setJsonBlob(stateStore, startEventKey("browser", browserHash, jobId), {
      jobId,
      createdAt: nowIso,
    }, { onlyIfNew: true }),
    setJsonBlob(stateStore, startEventKey("ip", ipHash, jobId), {
      jobId,
      createdAt: nowIso,
    }, { onlyIfNew: true }),
  ];
  if (accountHash) {
    indexWrites.push(
      setJsonBlob(stateStore, activeKey("account", accountHash), {
        jobId,
        createdAt: nowIso,
        expiresAt: activeExpiresAt,
      }),
      setJsonBlob(stateStore, startEventKey("account", accountHash, jobId), {
        jobId,
        createdAt: nowIso,
      }, { onlyIfNew: true }),
    );
  }
  await Promise.all(indexWrites);

  const cookieValue = createBuildDraftCookie({
    browserId,
    jobId,
    nonce,
    issuedAt: nowIso,
    expiresAt: new Date(
      timestamp.getTime() + BUILD_JOB_LIMITS.draftCookieMaxAgeSeconds * 1000,
    ).toISOString(),
  }, env);
  return { ok: true, job, cookie: cookieValue, clearCookie: cookie.state === "invalid" };
}

export async function markBuildJobState(stateStore, jobId, state, now = new Date()) {
  if (!Object.values(BUILD_JOB_STATES).includes(state)) {
    throw new Error("Invalid build job state");
  }
  const job = await getBuildJob(stateStore, jobId);
  if (!job || TERMINAL_STATES.has(job.state)) return job;
  const updated = {
    ...job,
    state,
    updatedAt: validDate(now).toISOString(),
  };
  await setJsonBlob(stateStore, jobKey(jobId), updated);
  return updated;
}

export async function completeBuildJob({
  stateStore,
  imageStore,
  jobId,
  build,
  now = new Date(),
} = {}) {
  const job = await getBuildJob(stateStore, jobId);
  if (!job || TERMINAL_STATES.has(job.state)) return job;
  const timestamp = validDate(now).toISOString();
  const { metadata, imageBytes } = splitBuildImage(build, `/api/build-jobs/${jobId}/image`);
  if (imageBytes) {
    await setBinaryBlob(imageStore, jobImageKey(jobId), imageBytes.bytes, {
      metadata: { contentType: imageBytes.contentType },
    });
  }
  const updated = {
    ...job,
    state: BUILD_JOB_STATES.ready,
    updatedAt: timestamp,
    completedAt: timestamp,
    result: metadata,
    error: "",
  };
  await setJsonBlob(stateStore, jobKey(jobId), updated);
  await clearActiveIndexes(stateStore, job);
  return updated;
}

export async function failBuildJob(stateStore, jobId, error, now = new Date()) {
  const job = await getBuildJob(stateStore, jobId);
  if (!job || TERMINAL_STATES.has(job.state)) return job;
  const updated = {
    ...job,
    state: BUILD_JOB_STATES.failed,
    updatedAt: validDate(now).toISOString(),
    error: cleanError(error),
  };
  await setJsonBlob(stateStore, jobKey(jobId), updated);
  await clearActiveIndexes(stateStore, job);
  return updated;
}

export async function cancelBuildJob({
  request,
  stateStore,
  env = {},
  jobId,
  user = null,
  now = new Date(),
} = {}) {
  const access = await resolveBuildJobAccess({ request, stateStore, env, jobId, user, now });
  if (!access.ok) return access;
  const job = access.job;
  if (job.ownerSub && job.buildId) {
    return failure("Claimed builds cannot be cancelled.", 409);
  }
  if (TERMINAL_STATES.has(job.state)) {
    return { ok: true, job: publicBuildJob(job) };
  }
  const updated = {
    ...job,
    state: BUILD_JOB_STATES.cancelled,
    updatedAt: validDate(now).toISOString(),
  };
  await setJsonBlob(stateStore, jobKey(jobId), updated);
  await clearActiveIndexes(stateStore, job);
  return { ok: true, job: publicBuildJob(updated) };
}

export async function claimSuccessfulBuildJob({
  request,
  stateStore,
  imageStore,
  env = {},
  jobId,
  user,
  galleryName,
  now = new Date(),
} = {}) {
  const disabled = builderDisabled(env, "claim");
  if (disabled) return failure(disabled, 503);
  const normalizedUser = normalizeAccountUser(user);
  if (!normalizedUser) return failure("Sign in with Google to claim this build.", 401);

  const access = await resolveBuildJobAccess({
    request,
    stateStore,
    env,
    jobId,
    user: normalizedUser,
    now,
    requireDraft: true,
  });
  if (!access.ok) return access;

  const job = access.job;
  if (job.ownerSub && job.ownerSub !== normalizedUser.sub) {
    return failure("This build belongs to another Google account.", 403);
  }
  if (job.ownerSub === normalizedUser.sub && job.buildId) {
    const build = await getAccountGalleryBuild(stateStore, job.buildId, normalizedUser.sub);
    return {
      ok: true,
      job: publicBuildJob(job),
      build,
      quota: await accountBuildQuota(stateStore, normalizedUser.sub),
    };
  }
  if (job.publishState === "rejected") {
    return {
      ok: false,
      status: 422,
      error: job.moderationReason || "This concept cannot be published to the public gallery.",
      job: publicBuildJob(job),
      quota: await accountBuildQuota(stateStore, normalizedUser.sub),
    };
  }
  if (job.state !== BUILD_JOB_STATES.ready || !job.result) {
    return failure("Only ready builds can be claimed.", 409);
  }

  const timestamp = validDate(now).toISOString();
  const moderation = moderateBuildForPublicGallery(job);
  if (!moderation.allowed) {
    const rejected = {
      ...job,
      updatedAt: timestamp,
      publishState: "rejected",
      unpublishedAt: timestamp,
      moderationReason: moderation.reason,
    };
    await setJsonBlob(stateStore, jobKey(jobId), rejected);
    await clearActiveIndexes(stateStore, job);
    return {
      ok: false,
      status: 422,
      error: moderation.reason,
      job: publicBuildJob(rejected),
      quota: await accountBuildQuota(stateStore, normalizedUser.sub),
    };
  }

  const markerWrite = await setJsonBlob(
    stateStore,
    claimMarkerKey(jobId),
    { jobId, sub: normalizedUser.sub, createdAt: timestamp },
    { onlyIfNew: true },
  );
  if (markerWrite?.modified === false) {
    const latest = await getBuildJob(stateStore, jobId);
    if (latest?.ownerSub === normalizedUser.sub && latest.buildId) {
      const build = await getAccountGalleryBuild(stateStore, latest.buildId, normalizedUser.sub);
      return {
        ok: true,
        job: publicBuildJob(latest),
        build,
        quota: await accountBuildQuota(stateStore, normalizedUser.sub),
      };
    }
    return failure("This build is already being claimed.", 409);
  }

  let quota;
  let publishedBuildId = "";
  try {
    quota = await reserveAccountQuotaSlot(stateStore, normalizedUser.sub, jobId, timestamp);
    if (!quota.ok) {
      await deleteQuietly(stateStore, claimMarkerKey(jobId));
      return quota;
    }

    const buildId = String(job.result.id || "").trim();
    if (!SAFE_ID_PATTERN.test(buildId)) {
      throw new Error("Successful build is missing a valid public id");
    }
    publishedBuildId = buildId;
    const makerName = normalizeGalleryName(galleryName || normalizedUser.name || "Maker");
    const jobImage = await getStoredImage(imageStore, jobImageKey(jobId));
    const { metadata: galleryBuild } = withGalleryImage(
      job.result,
      jobImage ? `/api/builds/${buildId}/image` : job.result.image?.url || "",
    );
    if (jobImage) {
      await setBinaryBlob(imageStore, galleryImageKey(buildId), jobImage.bytes, {
        metadata: { contentType: jobImage.contentType },
      });
    }
    const galleryRecord = {
      ...galleryBuild,
      ownerSub: normalizedUser.sub,
      makerName,
      claimedAt: timestamp,
      sourceJobId: jobId,
      publishState: "public",
    };
    const galleryWrite = await setJsonBlob(
      stateStore,
      galleryKey(buildId),
      galleryRecord,
      { onlyIfNew: true },
    );
    if (galleryWrite?.modified === false) {
      throw new Error("Public build id collision");
    }
    await commitAccountQuotaSlot(stateStore, quota.slotKey, normalizedUser.sub, jobId, timestamp);

    const updated = {
      ...job,
      updatedAt: timestamp,
      claimedAt: timestamp,
      buildId,
      ownerSub: normalizedUser.sub,
      makerName,
      publishState: "public",
      result: accountGalleryBuild(galleryRecord),
    };
    await setJsonBlob(stateStore, jobKey(jobId), updated);
    await clearActiveIndexes(stateStore, job);
    return {
      ok: true,
      job: publicBuildJob(updated),
      build: accountGalleryBuild(galleryRecord),
      quota: await accountBuildQuota(stateStore, normalizedUser.sub),
    };
  } catch (error) {
    if (quota?.slotKey) await deleteQuietly(stateStore, quota.slotKey);
    if (publishedBuildId) {
      await Promise.all([
        deleteQuietly(stateStore, galleryKey(publishedBuildId)),
        deleteQuietly(imageStore, galleryImageKey(publishedBuildId)),
      ]);
    }
    await deleteQuietly(stateStore, claimMarkerKey(jobId));
    throw error;
  }
}

export async function hidePublicGalleryBuild({
  stateStore,
  buildId,
  user,
  now = new Date(),
} = {}) {
  const normalizedUser = normalizeAccountUser(user);
  if (!normalizedUser) return failure("Log in with Google to manage builds.", 401);
  if (!SAFE_ID_PATTERN.test(String(buildId || ""))) return failure("Build not found.", 404);

  const record = await getJsonBlob(stateStore, galleryKey(buildId));
  if (!record || typeof record !== "object" || !SAFE_ID_PATTERN.test(String(record.id || ""))) {
    return failure("Build not found.", 404);
  }
  if (record.ownerSub !== normalizedUser.sub) {
    return failure("You can only unpublish your own builds.", 403);
  }

  let updated = record;
  if (!isHiddenGalleryRecord(record)) {
    const timestamp = validDate(now).toISOString();
    updated = {
      ...record,
      publishState: "hidden",
      hiddenAt: timestamp,
      hiddenBySub: normalizedUser.sub,
      updatedAt: timestamp,
    };
    await setJsonBlob(stateStore, galleryKey(buildId), updated);
  }
  return { ok: true, build: accountGalleryBuild(updated) };
}

export async function resolveBuildJobAccess({
  request,
  stateStore,
  env = {},
  jobId,
  user = null,
  now = new Date(),
  requireDraft = false,
} = {}) {
  const job = await getBuildJob(stateStore, jobId);
  if (!job) return failure("Build job not found.", 404);
  const normalizedUser = normalizeAccountUser(user);
  if (!requireDraft && normalizedUser?.sub && job.ownerSub === normalizedUser.sub) {
    return { ok: true, job, via: "owner" };
  }

  const cookie = buildDraftCookieState(request, env, { now });
  if (cookie.state === "valid" && draftCookieMatchesJob(cookie.payload, job, env)) {
    return { ok: true, job, via: "draft" };
  }
  return {
    ok: false,
    status: 403,
    error: "This browser cannot access that draft build.",
    headers: cookie.state === "invalid"
      ? { "Set-Cookie": clearBuildDraftCookie() }
      : {},
  };
}

export async function getBuildJob(stateStore, jobId) {
  if (!JOB_ID_PATTERN.test(String(jobId || ""))) return null;
  const job = await getJsonBlob(stateStore, jobKey(jobId));
  return validBuildJob(job) ? job : null;
}

export async function listPublicGalleryBuilds(stateStore) {
  const [records, legacyRecords] = await Promise.all([
    listJsonBlobs(stateStore, "gallery/"),
    listJsonBlobs(stateStore, "builds/"),
  ]);
  return uniquePublicBuilds([...records, ...legacyRecords]
    .map(publicGalleryBuild)
    .filter(Boolean))
    .sort((a, b) => String(b.claimedAt || b.createdAt).localeCompare(String(a.claimedAt || a.createdAt)));
}

export async function listAccountGalleryBuilds(stateStore, sub) {
  if (!sub) return [];
  const records = await listJsonBlobs(stateStore, "gallery/");
  return records
    .filter((record) => record?.ownerSub === sub)
    .map(accountGalleryBuild)
    .filter(Boolean)
    .sort((a, b) => String(b.claimedAt || b.createdAt).localeCompare(String(a.claimedAt || a.createdAt)));
}

export async function getPublicGalleryBuild(stateStore, buildId) {
  if (!SAFE_ID_PATTERN.test(String(buildId || ""))) return null;
  return publicGalleryBuild(await getJsonBlob(stateStore, galleryKey(buildId)))
    || publicGalleryBuild(await getJsonBlob(stateStore, legacyGalleryKey(buildId)));
}

export async function getAccountGalleryBuild(stateStore, buildId, sub) {
  if (!SAFE_ID_PATTERN.test(String(buildId || "")) || !sub) return null;
  const record = await getJsonBlob(stateStore, galleryKey(buildId));
  return record?.ownerSub === sub ? accountGalleryBuild(record) : null;
}

export async function getGalleryImage(imageStore, buildId) {
  if (!SAFE_ID_PATTERN.test(String(buildId || ""))) return null;
  return getStoredImage(imageStore, galleryImageKey(buildId));
}

export async function getDraftJobImage({ request, stateStore, imageStore, env = {}, jobId, user = null, now } = {}) {
  const access = await resolveBuildJobAccess({ request, stateStore, env, jobId, user, now });
  if (!access.ok) return access;
  const image = await getStoredImage(imageStore, jobImageKey(jobId));
  if (!image) return failure("Build image not found.", 404);
  return { ok: true, image };
}

export async function accountBuildQuota(stateStore, sub) {
  if (!sub) {
    return {
      limit: BUILD_JOB_LIMITS.successfulClaimsPerAccount,
      used: 0,
      reserved: 0,
      remaining: BUILD_JOB_LIMITS.successfulClaimsPerAccount,
    };
  }
  const slots = await listJsonBlobs(stateStore, `${quotaPrefix(sub)}/`);
  const used = slots.filter((slot) => slot?.sub === sub && slot?.status === "used").length;
  const reserved = slots.filter((slot) => slot?.sub === sub && slot?.status === "reserved").length;
  return {
    limit: BUILD_JOB_LIMITS.successfulClaimsPerAccount,
    used,
    reserved,
    remaining: Math.max(0, BUILD_JOB_LIMITS.successfulClaimsPerAccount - used - reserved),
  };
}

export async function cleanupAbandonedBuildJobs({
  stateStore,
  imageStore,
  now = new Date(),
  maxAgeMs = 60 * 60 * 1000,
} = {}) {
  const cutoff = validDate(now).getTime() - maxAgeMs;
  const counts = {
    jobsDeleted: 0,
    jobsFailed: 0,
    imagesDeleted: 0,
    reservationsReleased: 0,
  };

  for (const { key, value: job } of await listJsonBlobEntries(stateStore, "jobs/")) {
    if (!validBuildJob(job)) continue;
    const ageTime = validTimestamp(job.completedAt || job.updatedAt || job.createdAt).getTime();
    if (!Number.isFinite(ageTime) || ageTime > cutoff) continue;

    if (!TERMINAL_STATES.has(job.state)) {
      const failed = {
        ...job,
        state: BUILD_JOB_STATES.failed,
        updatedAt: validDate(now).toISOString(),
        error: "Build expired before completion.",
      };
      await setJsonBlob(stateStore, key, failed);
      await clearActiveIndexes(stateStore, job);
      counts.jobsFailed += 1;
      continue;
    }

    if (job.state === BUILD_JOB_STATES.ready && job.ownerSub && job.buildId) {
      if (await deleteImageIfPresent(imageStore, jobImageKey(job.id))) counts.imagesDeleted += 1;
      continue;
    }

    if (
      job.state === BUILD_JOB_STATES.ready ||
      job.state === BUILD_JOB_STATES.failed ||
      job.state === BUILD_JOB_STATES.cancelled
    ) {
      if (await deleteImageIfPresent(imageStore, jobImageKey(job.id))) counts.imagesDeleted += 1;
      await deleteQuietly(stateStore, key);
      await clearActiveIndexes(stateStore, job);
      counts.jobsDeleted += 1;
    }
  }

  for (const { key, value: slot } of await listJsonBlobEntries(stateStore, "quota/")) {
    if (slot?.status !== "reserved") continue;
    const createdAt = validTimestamp(slot.createdAt).getTime();
    if (Number.isFinite(createdAt) && createdAt > cutoff) continue;
    await deleteQuietly(stateStore, key);
    counts.reservationsReleased += 1;
  }

  return counts;
}

export function publicBuildJob(job) {
  if (!validBuildJob(job)) return null;
  return {
    id: job.id,
    state: job.state,
    idea: job.idea,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt || "",
    claimedAt: job.claimedAt || "",
    buildId: job.buildId || "",
    makerName: job.makerName || "",
    publishState: job.publishState || "",
    moderationReason: job.publishState === "rejected" ? job.moderationReason || "" : "",
    error: job.state === BUILD_JOB_STATES.failed ? job.error || "Build failed." : "",
    result: job.result && job.state === BUILD_JOB_STATES.ready && job.publishState !== "rejected"
      ? shapeGalleryBuild(job.result, { makerName: job.makerName, claimedAt: job.claimedAt })
      : null,
  };
}

export function publicGalleryBuild(record) {
  if (isHiddenGalleryRecord(record)) return null;
  return shapeGalleryBuild(record);
}

export function accountGalleryBuild(record) {
  const shaped = shapeGalleryBuild(record);
  if (!shaped) return null;
  return {
    ...shaped,
    publishState: isHiddenGalleryRecord(record) ? "hidden" : "public",
    hiddenAt: record.hiddenAt || "",
  };
}

export function moderateBuildForPublicGallery(input) {
  const text = moderationText(input);
  if (!text) return { allowed: true, reason: "" };
  for (const rule of MODERATION_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return {
        allowed: false,
        reason: rule.reason,
      };
    }
  }
  return { allowed: true, reason: "" };
}

function shapeGalleryBuild(record, overrides = {}) {
  if (!record || typeof record !== "object" || !SAFE_ID_PATTERN.test(String(record.id || ""))) {
    return null;
  }
  return {
    id: record.id,
    createdAt: record.createdAt,
    claimedAt: overrides.claimedAt || record.claimedAt || "",
    makerName: normalizeGalleryName(overrides.makerName || record.makerName || "Maker"),
    title: record.title,
    summary: record.summary,
    behavior: record.behavior,
    visibleHardwareCues: Array.isArray(record.visibleHardwareCues)
      ? record.visibleHardwareCues
      : [],
    image: publicImage(record.image),
    parts: Array.isArray(record.parts) ? record.parts.map(publicPart).filter(Boolean) : [],
    warnings: Array.isArray(record.warnings) ? record.warnings : [],
    cost: record.cost || null,
    status: record.status || "Concept",
  };
}

const MODERATION_RULES = Object.freeze([
  {
    reason: "This concept cannot be published to the public gallery because it appears to describe a weapon or harmful device.",
    patterns: [
      /\b(pipe\s*bomb|bomb|explosive|detonator|grenade|landmine|molotov|incendiary)\b/i,
      /\b(firearm|pistol|rifle|shotgun|silencer|ammunition|ammo|taser)\b/i,
    ],
  },
  {
    reason: "This concept cannot be published to the public gallery because it appears to describe cyber abuse.",
    patterns: [
      /\b(malware|ransomware|keylogger|phishing|credential\s*theft|steal\s+passwords?)\b/i,
    ],
  },
  {
    reason: "This concept cannot be published to the public gallery because it appears to describe covert surveillance or stalking.",
    patterns: [
      /\b(hidden|covert|spy)\s+(camera|microphone|recorder)\b/i,
      /\b(stalk|stalking|track\s+someone|gps\s+tracker\s+for\s+someone)\b/i,
    ],
  },
  {
    reason: "This concept cannot be published to the public gallery because it appears to describe self-harm.",
    patterns: [
      /\b(suicide|self[-\s]?harm|kill\s+myself|overdose)\b/i,
    ],
  },
]);

function moderationText(input) {
  const build = input?.result && typeof input.result === "object"
    ? { ...input.result, idea: input.result.idea || input.idea }
    : input;
  if (!build || typeof build !== "object") return "";
  return [
    input?.idea,
    build.idea,
    build.title,
    build.summary,
    build.behavior,
    ...(Array.isArray(build.visibleHardwareCues) ? build.visibleHardwareCues : []),
    ...(Array.isArray(build.warnings) ? build.warnings : []),
    ...(Array.isArray(build.parts) ? build.parts.flatMap((part) => [
      part?.name,
      part?.category,
      part?.subtype,
      part?.why,
      part?.notes,
    ]) : []),
  ]
    .filter((value) => typeof value === "string")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isHiddenGalleryRecord(record) {
  return Boolean(
    record?.hiddenAt ||
      record?.publishState === "hidden" ||
      record?.publishState === "rejected",
  );
}

function publicImage(image) {
  if (!image || typeof image !== "object") return null;
  const safe = {};
  if (typeof image.url === "string") safe.url = image.url;
  if (typeof image.contentType === "string") safe.contentType = image.contentType;
  if (typeof image.status === "string") safe.status = image.status;
  return Object.keys(safe).length ? safe : null;
}

function publicPart(part) {
  if (!part || typeof part !== "object") return null;
  const allowed = [
    "id",
    "name",
    "category",
    "subtype",
    "price",
    "unitPriceUsd",
    "priceSource",
    "priceLabel",
    "packQty",
    "asin",
    "url",
    "voltage",
    "notes",
    "why",
    "checkedDate",
    "presoldered",
  ];
  const safe = {};
  for (const key of allowed) {
    if (part[key] != null) safe[key] = part[key];
  }
  return Object.keys(safe).length ? safe : null;
}

function uniquePublicBuilds(builds) {
  const seen = new Set();
  const unique = [];
  for (const build of builds) {
    if (!build?.id || seen.has(build.id)) continue;
    seen.add(build.id);
    unique.push(build);
  }
  return unique;
}

export function clearBuildDraftCookie() {
  return [
    `${BUILD_DRAFT_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

export function buildDraftCookieState(request, env = {}, options = {}) {
  const raw = cookieValue(request?.headers?.get?.("cookie"), BUILD_DRAFT_COOKIE);
  if (!raw) return { state: "missing", payload: null };
  if (!COOKIE_VALUE_PATTERN.test(raw)) return { state: "invalid", payload: null };

  const secret = draftCookieSecret(env);
  if (!secret) return { state: "invalid", payload: null };
  const [, encoded, signature] = raw.split(".");
  const expected = hmac(secret, encoded);
  if (!constantTimeEqual(signature, expected)) return { state: "invalid", payload: null };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { state: "invalid", payload: null };
  }
  const now = validDate(options.now ?? new Date());
  if (
    typeof payload?.browserId !== "string" ||
    typeof payload?.jobId !== "string" ||
    typeof payload?.nonce !== "string" ||
    !JOB_ID_PATTERN.test(payload.jobId) ||
    !validToken(payload.browserId) ||
    !validToken(payload.nonce) ||
    validTimestamp(payload.expiresAt) <= now
  ) {
    return { state: "invalid", payload: null };
  }
  return { state: "valid", payload };
}

export function createBuildDraftCookie(payload, env = {}) {
  const secret = draftCookieSecret(env);
  if (!secret) throw new Error("Build draft signing is not configured");
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signed = `v1.${encoded}.${hmac(secret, encoded)}`;
  return [
    `${BUILD_DRAFT_COOKIE}=${signed}`,
    "Path=/",
    `Max-Age=${BUILD_JOB_LIMITS.draftCookieMaxAgeSeconds}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

export async function setJsonBlob(store, key, value, options = {}) {
  const payload = new Blob([JSON.stringify(value)], { type: "application/json" });
  if (typeof store.set === "function") return store.set(key, payload, options);
  if (typeof store.setJSON === "function") return store.setJSON(key, value, options);
  throw new Error("Blob store does not support writes");
}

export async function getJsonBlob(store, key) {
  return store.get(key, { type: "json", consistency: "strong" });
}

export async function setBinaryBlob(store, key, bytes, options = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return store.set(key, new Blob([buffer], {
    type: options.metadata?.contentType || "application/octet-stream",
  }), options);
}

export async function getStoredImage(store, key) {
  const bytes = await store.get(key, { type: "arrayBuffer", consistency: "strong" });
  if (!bytes) return null;
  const entry = store.values?.get?.(key);
  const contentType = entry?.metadata?.contentType || entry?.contentType || "image/png";
  return {
    bytes,
    contentType,
  };
}

function splitBuildImage(build, imageUrl) {
  const source = build?.image?.url || "";
  const match = String(source).match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return withGalleryImage(build, source || imageUrl);
  return {
    metadata: {
      ...build,
      image: {
        ...build.image,
        url: imageUrl,
        contentType: match[1],
      },
    },
    imageBytes: {
      bytes: Buffer.from(match[2], "base64"),
      contentType: match[1],
    },
  };
}

function withGalleryImage(build, imageUrl) {
  return {
    metadata: {
      ...build,
      image: {
        ...(build?.image || {}),
        url: imageUrl,
      },
    },
  };
}

async function reserveAccountQuotaSlot(stateStore, sub, jobId, createdAt) {
  const existingSlots = await listJsonBlobs(stateStore, `${quotaPrefix(sub)}/`);
  for (const slot of existingSlots) {
    if (slot?.sub === sub && slot?.jobId === jobId) {
      return { ok: true, slot: slot.slot, slotKey: quotaSlotKey(sub, slot.slot) };
    }
  }
  for (let slot = 0; slot < BUILD_JOB_LIMITS.successfulClaimsPerAccount; slot += 1) {
    const key = quotaSlotKey(sub, slot);
    const existing = await getJsonBlob(stateStore, key);
    if (existing) continue;
    const write = await setJsonBlob(stateStore, key, {
      sub,
      slot,
      jobId,
      status: "reserved",
      createdAt,
    }, { onlyIfNew: true });
    if (write?.modified !== false) return { ok: true, slot, slotKey: key };
  }
  return {
    ok: false,
    status: 429,
    error: `This Google account has used its ${BUILD_JOB_LIMITS.successfulClaimsPerAccount} successful builds.`,
  };
}

async function commitAccountQuotaSlot(stateStore, key, sub, jobId, updatedAt) {
  const slot = await getJsonBlob(stateStore, key);
  if (!slot || slot.sub !== sub || slot.jobId !== jobId || slot.status !== "reserved") {
    throw new Error("Build quota reservation could not be committed");
  }
  await setJsonBlob(stateStore, key, {
    ...slot,
    status: "used",
    usedAt: updatedAt,
    updatedAt,
  });
}

async function activeBuildForIndexes(stateStore, indexes, now) {
  for (const { kind, hash } of indexes) {
    const active = await activeBuildForIndex(stateStore, kind, hash, now);
    if (active) return active;
  }
  return null;
}

async function activeBuildForIndex(stateStore, kind, hash, now) {
  const active = await getJsonBlob(stateStore, activeKey(kind, hash));
  if (!active?.jobId) return null;
  const job = await getBuildJob(stateStore, active.jobId);
  const expired = validTimestamp(active.expiresAt) <= now;
  if (!job || expired || TERMINAL_STATES.has(job.state)) {
    await deleteQuietly(stateStore, activeKey(kind, hash));
    return null;
  }
  return job;
}

async function clearActiveIndexes(stateStore, job) {
  const keys = [
    deleteQuietly(stateStore, activeKey("browser", job.browserHash)),
    deleteQuietly(stateStore, activeKey("ip", job.ipHash)),
  ];
  if (job.accountHash) {
    keys.push(deleteQuietly(stateStore, activeKey("account", job.accountHash)));
  }
  await Promise.all(keys);
}

async function recentStartCount(stateStore, kind, hash, now) {
  const events = await listJsonBlobs(stateStore, `starts/${kind}/${hash}/`);
  const minTime = now.getTime() - BUILD_JOB_LIMITS.startWindowMs;
  return events.filter((event) => validTimestamp(event?.createdAt).getTime() >= minTime).length;
}

async function listJsonBlobs(store, prefix) {
  return (await listJsonBlobEntries(store, prefix)).map((entry) => entry.value).filter(Boolean);
}

async function listJsonBlobEntries(store, prefix) {
  const keys = await listBlobKeys(store, prefix);
  const values = await Promise.all(keys.map(async (key) => ({
    key,
    value: await getJsonBlob(store, key),
  })));
  return values.filter((entry) => entry.value);
}

async function listBlobKeys(store, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await store.list({ prefix, cursor });
    keys.push(...(page.blobs || []).map((blob) => blob.key).filter(Boolean));
    cursor = page.cursor || page.nextCursor || "";
  } while (cursor);
  return keys;
}

function draftCookieMatchesJob(payload, job, env) {
  const secret = draftCookieSecret(env);
  return (
    payload?.jobId === job.id &&
    scopedHash(secret, `nonce:${payload.nonce}`) === job.draftNonceHash
  );
}

function normalizeAccountUser(user) {
  const sub = typeof user?.sub === "string" ? user.sub.trim().slice(0, 255) : "";
  if (!sub) return null;
  return {
    sub,
    email: typeof user.email === "string" ? user.email : "",
    name: normalizeGalleryName(user.name || "Maker"),
    picture: typeof user.picture === "string" ? user.picture : "",
  };
}

function normalizeGalleryName(value) {
  if (typeof value !== "string") return "Maker";
  const name = value.replace(/\s+/g, " ").trim().slice(0, 80);
  return name || "Maker";
}

function validBuildJob(job) {
  return (
    job &&
    typeof job === "object" &&
    !Array.isArray(job) &&
    job.schemaVersion === 1 &&
    JOB_ID_PATTERN.test(String(job.id || "")) &&
    Object.values(BUILD_JOB_STATES).includes(job.state) &&
    typeof job.idea === "string" &&
    typeof job.createdAt === "string" &&
    typeof job.updatedAt === "string"
  );
}

function clientIpFromRequest(request) {
  const headers = request?.headers;
  const direct =
    headers?.get?.("x-nf-client-connection-ip") ||
    headers?.get?.("cf-connecting-ip") ||
    headers?.get?.("x-real-ip") ||
    "";
  if (direct) return direct.trim().slice(0, 128);
  const forwarded = headers?.get?.("x-forwarded-for") || "";
  return forwarded.split(",")[0].trim().slice(0, 128);
}

function jobKey(jobId) {
  return `jobs/${jobId}.json`;
}

function jobImageKey(jobId) {
  return `job-images/${jobId}`;
}

function galleryKey(buildId) {
  return `gallery/${buildId}.json`;
}

function legacyGalleryKey(buildId) {
  return `builds/${buildId}.json`;
}

function galleryImageKey(buildId) {
  return `gallery-images/${buildId}`;
}

function activeKey(kind, hash) {
  return `active/${kind}/${hash}.json`;
}

function startEventKey(kind, hash, jobId) {
  return `starts/${kind}/${hash}/${jobId}.json`;
}

function claimMarkerKey(jobId) {
  return `claims/${jobId}.json`;
}

function executionKey(jobId) {
  return `executions/${jobId}.json`;
}

function quotaPrefix(sub) {
  return `quota/${createHash("sha256").update(sub).digest("hex")}`;
}

function quotaSlotKey(sub, slot) {
  return `${quotaPrefix(sub)}/${slot}.json`;
}

function randomToken(randomBytesImpl, length) {
  return randomBytesImpl(length).toString("base64url");
}

function validToken(value) {
  return /^[A-Za-z0-9_-]{20,80}$/.test(String(value || ""));
}

function scopedHash(secret, value) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function hmac(secret, value) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(header, name) {
  if (typeof header !== "string" || !header) return "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return "";
}

function validTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date(Number.NaN);
  return date;
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("A valid timestamp is required");
  return date;
}

function cleanError(error) {
  return String(error?.message || error || "Build failed.").replace(/\s+/g, " ").trim().slice(0, 240);
}

function failure(error, status) {
  return { ok: false, status, error };
}

function enabledEnv(value) {
  if (value == null || value === "") return true;
  return ["1", "true", "yes", "on", "enabled"].includes(String(value).toLowerCase());
}

async function deleteQuietly(store, key) {
  try {
    await store.delete(key);
  } catch {
    // The record is no longer authoritative once the state is terminal.
  }
}

async function deleteImageIfPresent(store, key) {
  const image = await getStoredImage(store, key);
  if (!image) return false;
  await deleteQuietly(store, key);
  return true;
}

async function memoryBlobEntry(value, options) {
  let bytes;
  let contentType = "";
  if (value instanceof Blob) {
    bytes = Buffer.from(await value.arrayBuffer());
    contentType = value.type;
  } else if (Buffer.isBuffer(value)) {
    bytes = value;
  } else if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    bytes = Buffer.from(value);
  } else {
    bytes = Buffer.from(String(value), "utf8");
  }
  return {
    bytes,
    contentType,
    metadata: options.metadata || {},
  };
}

function bufferToArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
