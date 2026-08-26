import { getStore } from "@netlify/blobs";
import { createBuild } from "../../lib/makeable-builds.mjs";
import {
  BUILD_JOB_STATES,
  buildCommunityStoreNameForFunctionContext,
  buildJobImageStoreNameForFunctionContext,
  buildJobQuotaStoreNameForFunctionContext,
  buildJobStateStoreNameForFunctionContext,
  builderDisabled,
  claimBuildJobExecution,
  completeBuildJob,
  createRoutedBuildStateStore,
  failBuildJob,
  getBuildJob,
  markBuildJobState,
  verifyBackgroundBuildSignature,
} from "../../lib/build-jobs.mjs";

export const config = {
  background: true,
};

export default async function handler(req, context = {}) {
  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, { Allow: "POST" });
    }
    const env = getEnv();
    const body = await readLimitedJsonRequest(req, 4 * 1024);
    const jobId = typeof body?.jobId === "string" ? body.jobId : "";
    const timestamp = req.headers.get("x-makeable-background-timestamp") || "";
    const signature = req.headers.get("x-makeable-background-signature") || "";
    if (!verifyBackgroundBuildSignature(env, jobId, timestamp, signature)) {
      return jsonResponse({ error: "Background build request is not authorized." }, 401);
    }

    await runBackgroundBuildJob({
      jobId,
      env,
      stateStore: buildStateStore(context),
      imageStore: buildImageStore(context),
    });
    return jsonResponse({ ok: true });
  } catch (error) {
    const status =
      Number.isInteger(error?.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 500;
    if (status === 500) console.error(error);
    return jsonResponse(
      {
        error:
          status === 500
            ? "The Makeable background worker could not complete the request."
            : String(error.message || error),
      },
      status,
    );
  }
}

async function runBackgroundBuildJob({ jobId, env, stateStore, imageStore }) {
  try {
    const disabled = builderDisabled(env, "worker");
    if (disabled) throw new Error(disabled);
    if (!await claimBuildJobExecution(stateStore, jobId)) return;
    const planning = await markBuildJobState(stateStore, jobId, BUILD_JOB_STATES.planning);
    if (!planning || planning.state === BUILD_JOB_STATES.cancelled) return;

    const captureStore = {
      saved: null,
      async save(build) {
        this.saved = build;
        return build;
      },
    };
    const result = await createBuild(
      { idea: planning.idea },
      {
        env,
        store: captureStore,
        fetchFn: fetch,
        allowAnonymous: true,
        onPhase: (state) => markBuildJobState(stateStore, jobId, state),
      },
    );
    if (result.status !== 201) {
      throw new Error(result.body?.error || "Build generation failed.");
    }
    const latest = await getBuildJob(stateStore, jobId);
    if (!latest || latest.state === BUILD_JOB_STATES.cancelled) return;
    await completeBuildJob({
      stateStore,
      imageStore,
      jobId,
      build: captureStore.saved || result.body,
    });
  } catch (error) {
    await failBuildJob(stateStore, jobId, error);
  }
}

function buildStateStore(context) {
  return createRoutedBuildStateStore({
    jobStore: getStore({
      name: buildJobStateStoreNameForFunctionContext(context),
      consistency: "strong",
    }),
    quotaStore: getStore({
      name: buildJobQuotaStoreNameForFunctionContext(context),
      consistency: "strong",
    }),
    communityStore: getStore({
      name: buildCommunityStoreNameForFunctionContext(context),
      consistency: "strong",
    }),
  });
}

function buildImageStore(context) {
  return getStore({
    name: buildJobImageStoreNameForFunctionContext(context),
    consistency: "strong",
  });
}

function getEnv() {
  const keys = [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
    "OPENAI_BUILD_MODEL",
    "OPENAI_BUILD_SERVICE_TIER",
    "OPENAI_IMAGE_MODEL",
    "OPENAI_IMAGE_SIZE",
    "OPENAI_IMAGE_QUALITY",
    "OPENAI_IMAGE_TIMEOUT_MS",
    "MAKEABLE_FORCE_BUILD_FALLBACK",
    "MAKEABLE_SKIP_IMAGE_GENERATION",
    "MAKEABLE_DRAFT_COOKIE_SECRET",
    "MAKEABLE_BACKGROUND_SECRET",
    "MAKEABLE_BUILD_GENERATION_ENABLED",
    "MAKEABLE_ANONYMOUS_GENERATION_ENABLED",
    "DASHBOARD_SESSION_SECRET",
    "NODE_ENV",
    "NETLIFY",
    "CONTEXT",
  ];
  return Object.fromEntries(keys.map((key) => [key, envValue(key)]));
}

function envValue(key) {
  return globalThis.Netlify?.env?.get(key) || process.env[key] || "";
}

async function readLimitedJsonRequest(req, maxBytes) {
  const advertisedLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(advertisedLength) && advertisedLength > maxBytes) {
    throw requestError("Request body is too large.", 413);
  }
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw requestError("Request body is too large.", 413);
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw requestError("Request body must be valid JSON.", 400);
  }
}

function requestError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}
