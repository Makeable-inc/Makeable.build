import { openStore } from "../../lib/storage/index.mjs";
import {
  buildCommunityStoreNameForFunctionContext,
  buildJobImageStoreNameForFunctionContext,
  buildJobQuotaStoreNameForFunctionContext,
  buildJobStateStoreNameForFunctionContext,
  cleanupAbandonedBuildJobs,
  createRoutedBuildStateStore,
} from "../../lib/build-jobs.mjs";

export const config = {
  schedule: "@daily",
};

export default async function handler(_req, context = {}) {
  try {
    const result = await cleanupAbandonedBuildJobs({
      stateStore: buildStateStore(context),
      imageStore: buildImageStore(context),
    });
    return jsonResponse({ ok: true, cleanup: result });
  } catch (error) {
    console.error("Build cleanup failed", error);
    return jsonResponse(
      { error: "The Makeable build cleanup job could not complete." },
      500,
    );
  }
}

function buildStateStore(context) {
  return createRoutedBuildStateStore({
    jobStore: openStore({
      name: buildJobStateStoreNameForFunctionContext(context),
      consistency: "strong",
    }),
    quotaStore: openStore({
      name: buildJobQuotaStoreNameForFunctionContext(context),
      consistency: "strong",
    }),
    communityStore: openStore({
      name: buildCommunityStoreNameForFunctionContext(context),
      consistency: "strong",
    }),
  });
}

function buildImageStore(context) {
  return openStore({
    name: buildJobImageStoreNameForFunctionContext(context),
    consistency: "strong",
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
