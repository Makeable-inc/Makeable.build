export const generationProgressStates = [
  "queued",
  "planning",
  "fitting_parts",
  "rendering",
  "ready",
  "failed",
  "cancelled",
] as const;

export type GenerationProgressState = typeof generationProgressStates[number];

type BuildProgressJob = Readonly<{
  state: GenerationProgressState;
  createdAt?: string;
  updatedAt?: string;
}>;

type ProgressProfile = Readonly<{
  floor: number;
  ceiling: number;
  durationMs: number;
}>;

const progressProfiles = {
  queued: { floor: 8, ceiling: 20, durationMs: 6_000 },
  planning: { floor: 24, ceiling: 45, durationMs: 10_000 },
  fitting_parts: { floor: 48, ceiling: 69, durationMs: 12_000 },
  rendering: { floor: 74, ceiling: 94, durationMs: 32_000 },
  ready: { floor: 96, ceiling: 96, durationMs: 0 },
  failed: { floor: 0, ceiling: 0, durationMs: 0 },
  cancelled: { floor: 0, ceiling: 0, durationMs: 0 },
} as const satisfies Record<GenerationProgressState, ProgressProfile>;

function timestampMs(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

export function estimateBuildProgress(job: BuildProgressJob, nowMs = Date.now()): number {
  const profile = progressProfiles[job.state];
  if (profile.floor === profile.ceiling) return profile.floor;

  const startedAt = timestampMs(job.updatedAt || job.createdAt, nowMs);
  const elapsed = Math.max(0, nowMs - startedAt);
  const completion = Math.min(1, elapsed / profile.durationMs);
  const easedCompletion = 1 - (1 - completion) ** 2;
  return Math.round(profile.floor + ((profile.ceiling - profile.floor) * easedCompletion));
}

export function advanceBuildProgress(visibleProgress: number, job: BuildProgressJob, nowMs = Date.now()): number {
  return Math.max(visibleProgress, estimateBuildProgress(job, nowMs));
}
