import { randomUUID } from "node:crypto";

import { createBuild } from "./makeable-builds.mjs";

const LOCAL_BUILDER = {
  email: "local-maker@makeable.build",
  name: "Local Maker",
};

const LOCAL_BUILD_LIMIT = 10;

export function createLocalBuildWorkshop({
  now = Date.now,
  durationMs = 42_000,
  createBuild: createBuildFn = createBuild,
} = {}) {
  const jobs = new Map();
  const builds = [];

  const quota = () => ({
    limit: LOCAL_BUILD_LIMIT,
    used: builds.length,
    reserved: 0,
    remaining: Math.max(0, LOCAL_BUILD_LIMIT - builds.length),
  });

  const stageFor = (job) => {
    if (job.cancelled) return "cancelled";
    if (job.failure) return "failed";
    const elapsed = Math.max(0, now() - job.startedAt);
    if (elapsed < durationMs * 0.2) return "queued";
    if (elapsed < durationMs * 0.45) return "planning";
    if (elapsed < durationMs * 0.7) return "fitting_parts";
    if (!job.result || elapsed < durationMs) return "rendering";
    return "ready";
  };

  const publicJob = (job) => ({
    id: job.id,
    idea: job.idea,
    state: stageFor(job),
    createdAt: new Date(job.startedAt).toISOString(),
    updatedAt: new Date(now()).toISOString(),
    buildId: job.result?.id,
    error: job.failure || "",
    result: stageFor(job) === "ready" ? job.result : null,
  });

  const waitForBuild = async (job) => {
    if (job.result || job.failure) return;
    try {
      const result = await job.generation;
      if (result.status !== 201) {
        job.failure = result.body?.error || "Makeable could not prepare this local build.";
        return;
      }
      job.result = { ...result.body, makerName: LOCAL_BUILDER.name, makerHandle: "@localmaker" };
    } catch (error) {
      job.failure = error instanceof Error ? error.message : "Makeable could not prepare this local build.";
    }
  };

  const getJob = async (jobId) => {
    const job = jobs.get(jobId);
    if (!job) return { status: 404, body: { error: "Build job not found." } };
    if (now() - job.startedAt >= durationMs) await waitForBuild(job);
    return { status: 200, body: { job: publicJob(job) } };
  };

  const start = async (idea) => {
    const normalizedIdea = String(idea || "").trim();
    if (!normalizedIdea) return { status: 400, body: { error: "Describe what you want to build." } };
    if (quota().remaining <= 0) return { status: 429, body: { error: "Your local workshop has used its 10 preview builds." } };

    const job = {
      id: `local_${randomUUID().replaceAll("-", "")}`,
      idea: normalizedIdea,
      startedAt: now(),
      result: null,
      failure: "",
      cancelled: false,
      generation: null,
    };
    job.generation = createBuildFn(
      { idea: normalizedIdea },
      {
        allowAnonymous: true,
        env: {
          MAKEABLE_FORCE_BUILD_FALLBACK: "1",
          MAKEABLE_SKIP_IMAGE_GENERATION: "1",
        },
        store: { save: async (build) => build },
      },
    );
    jobs.set(job.id, job);
    return {
      status: 202,
      body: {
        job: publicJob(job),
        limits: { startsPerWindow: LOCAL_BUILD_LIMIT, windowHours: 24 },
      },
    };
  };

  const claim = async (jobId) => {
    const job = jobs.get(jobId);
    if (!job) return { status: 404, body: { error: "Build job not found." } };
    if (now() - job.startedAt < durationMs) return { status: 409, body: { error: "Only ready builds can be claimed." } };
    await waitForBuild(job);
    if (job.failure) return { status: 500, body: { error: job.failure } };
    if (!job.result) return { status: 409, body: { error: "The local build is still rendering." } };
    if (!builds.some((build) => build.id === job.result.id)) builds.unshift(job.result);
    return { status: 200, body: { job: publicJob(job), build: job.result, quota: quota() } };
  };

  const cancel = async (jobId) => {
    const job = jobs.get(jobId);
    if (!job) return { status: 404, body: { error: "Build job not found." } };
    job.cancelled = true;
    return { status: 200, body: { job: publicJob(job) } };
  };

  const handle = async ({ method, path, body }) => {
    if (path === "/api/build-jobs" && method === "POST") return start(body?.idea);
    if (path === "/api/builds" && method === "GET") return { status: 200, body: { builds } };
    if (path === "/api/account/builds" && method === "GET") {
      return { status: 200, body: { user: LOCAL_BUILDER, builds, quota: quota() } };
    }

    const match = path.match(/^\/api\/build-jobs\/([^/]+)(?:\/(claim))?$/);
    if (!match) return null;
    if (match[2] === "claim" && method === "POST") return claim(match[1]);
    if (!match[2] && method === "GET") return getJob(match[1]);
    if (!match[2] && method === "DELETE") return cancel(match[1]);
    return { status: 405, body: { error: "Method not allowed." } };
  };

  return {
    builder: LOCAL_BUILDER,
    start,
    job: getJob,
    claim,
    cancel,
    handle,
  };
}
