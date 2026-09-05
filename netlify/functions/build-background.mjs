import { getStore } from "@netlify/blobs";
import { createBuild } from "../../lib/makeable-builds.mjs";
import { loadProductionBuildPipeline } from "../../lib/production-build-pipeline.mjs";
import {
  BUILD_JOB_STATES,
  buildJobStateForPipelinePhase,
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

export async function runBackgroundBuildJob({ jobId, env, stateStore, imageStore }) {
  let ownsExecution = false;
  try {
    // A duplicate dispatch from a newer deployment must not fail a job already
    // owned by another worker, even if the newer deployment is disabled.
    if (!await claimBuildJobExecution(stateStore, jobId)) return;
    ownsExecution = true;
    const disabled = builderDisabled(env, "worker");
    if (disabled) throw new Error(disabled);
    const planning = await markBuildJobState(stateStore, jobId, BUILD_JOB_STATES.planning);
    if (!planning || planning.state === BUILD_JOB_STATES.cancelled) return;

    const captureStore = {
      saved: null,
      async save(build) {
        this.saved = build;
        return build;
      },
    };
    const pipeline = await loadProductionBuildPipeline();
    const event = (name, details = {}) => {
      console.info(JSON.stringify({
        type: "makeable_build_event",
        name,
        jobId,
        requestId: planning.identity?.requestId || "",
        buildId: planning.identity?.buildId || "",
        requestFingerprint: planning.identity?.requestFingerprint || "",
        catalogRevision: planning.identity?.catalogRevision || "",
        promptPackageRevision: planning.identity?.promptPackageRevision || "",
        ...details,
      }));
    };
    const result = await createBuild(
      { idea: planning.idea },
      {
        ...pipeline.createOptions({
          env,
          buildIdentity: planning.identity,
          fetchFn: fetch,
          onPhase: (phase) => markBuildJobState(
            stateStore,
            jobId,
            buildJobStateForPipelinePhase(phase),
          ),
          onEvent: event,
        }),
        store: captureStore,
      },
    );
    if (result.status !== 201) throw buildFailureFromResult(result);
    const latest = await getBuildJob(stateStore, jobId);
    if (!latest || latest.state === BUILD_JOB_STATES.cancelled) return;
    await completeBuildJob({
      stateStore,
      imageStore,
      jobId,
      build: captureStore.saved || result.body,
    });
  } catch (error) {
    console.error(JSON.stringify({
      type: "makeable_build_error",
      jobId,
      name: String(error?.name || "Error"),
      message: String(error?.message || error),
      code: String(error?.code || error?.cause?.code || ""),
      cause: String(error?.cause?.message || ""),
    }));
    if (ownsExecution) await failBuildJob(stateStore, jobId, error);
  }
}

export function buildFailureFromResult(result = {}) {
  const body = result?.body && typeof result.body === "object" ? result.body : {};
  const error = new Error(body.error || "Build generation failed.");
  if (typeof body.code === "string") error.code = body.code;
  if (body.details && typeof body.details === "object" && !Array.isArray(body.details)) {
    error.details = body.details;
  } else if (body.semanticFulfillment && typeof body.semanticFulfillment === "object") {
    const validation = body.semanticFulfillment;
    error.details = {
      reason: validation.reason || body.code || "",
      requestedCapabilities: validation.requestedCapabilities || [],
      providedCapabilities: validation.providedCapabilities || [],
      missingCapabilities: validation.missingCapabilities || [],
      planUnrequestedCapabilities: validation.planUnrequestedCapabilities || [],
      unrelatedPartIds: Array.isArray(validation.unrelatedParts)
        ? validation.unrelatedParts.map((part) => part?.id || "").filter(Boolean)
        : [],
    };
  }
  return error;
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
    "OPENAI_IMAGE_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
    "OPENAI_BUILD_MODEL",
    "OPENAI_BUILD_SERVICE_TIER",
    "OPENAI_IMAGE_BASE_URL",
    "OPENAI_IMAGE_TOOL_MODEL",
    "OPENAI_IMAGE_TOOL_TIMEOUT_MS",
    "OPENAI_IMAGE_MODEL",
    "OPENAI_IMAGE_SIZE",
    "OPENAI_IMAGE_QUALITY",
    "OPENAI_IMAGE_TIMEOUT_MS",
    "GEMINI_API_KEY",
    "GOOGLE_GEMINI_BASE_URL",
    "GEMINI_IMAGE_MODEL",
    "GEMINI_IMAGE_TIMEOUT_MS",
    "MAKEABLE_FORCE_BUILD_FALLBACK",
    "MAKEABLE_SKIP_IMAGE_GENERATION",
    "MAKEABLE_DRAFT_COOKIE_SECRET",
    "MAKEABLE_BACKGROUND_SECRET",
    "MAKEABLE_BUILD_GENERATION_ENABLED",
    "MAKEABLE_ATOMIC_BUILD_GENERATION_ENABLED",
    "MAKEABLE_ANONYMOUS_GENERATION_ENABLED",
    "DASHBOARD_SESSION_SECRET",
    "NODE_ENV",
    "NETLIFY",
    "CONTEXT",
  ];
  const values = Object.fromEntries(keys.map((key) => [key, envValue(key)]));
  if (process.env.MAKEABLE_LOCAL_DEV_AUTH === "true") {
    values.OPENAI_API_KEY = process.env.MAKEABLE_LOCAL_OPENAI_API_KEY || values.OPENAI_API_KEY;
    values.OPENAI_BASE_URL = process.env.MAKEABLE_LOCAL_OPENAI_BASE_URL || values.OPENAI_BASE_URL;
    values.OPENAI_IMAGE_API_KEY = process.env.MAKEABLE_LOCAL_OPENAI_IMAGE_API_KEY || values.OPENAI_IMAGE_API_KEY;
    values.OPENAI_IMAGE_BASE_URL = process.env.MAKEABLE_LOCAL_OPENAI_IMAGE_BASE_URL || values.OPENAI_IMAGE_BASE_URL;
    values.GEMINI_API_KEY = process.env.MAKEABLE_LOCAL_GEMINI_API_KEY || values.GEMINI_API_KEY;
    values.GOOGLE_GEMINI_BASE_URL = process.env.MAKEABLE_LOCAL_GEMINI_BASE_URL || values.GOOGLE_GEMINI_BASE_URL;
  }
  return values;
}

function envValue(key) {
  return process.env[key] || globalThis.Netlify?.env?.get(key) || "";
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
