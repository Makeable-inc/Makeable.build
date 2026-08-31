import assert from "node:assert/strict";
import test from "node:test";

import { advanceBuildProgress, estimateBuildProgress } from "../apps/landing/app/generation-progress.ts";

test("generation progress advances in small increments without exceeding the live stage ceiling", () => {
  const stageStartedAt = "2026-08-30T12:00:00.000Z";

  const initial = estimateBuildProgress({ state: "rendering", updatedAt: stageStartedAt }, Date.parse(stageStartedAt));
  const midStage = estimateBuildProgress({ state: "rendering", updatedAt: stageStartedAt }, Date.parse("2026-08-30T12:00:15.000Z"));
  const stalled = estimateBuildProgress({ state: "rendering", updatedAt: stageStartedAt }, Date.parse("2026-08-30T12:02:00.000Z"));

  assert.equal(initial, 74);
  assert.ok(midStage > initial);
  assert.ok(midStage < 94);
  assert.equal(stalled, 94);
});

test("a real backend checkpoint is always allowed to advance the visible progress", () => {
  const startedAt = "2026-08-30T12:00:00.000Z";

  const queued = estimateBuildProgress({ state: "queued", updatedAt: startedAt }, Date.parse("2026-08-30T12:00:30.000Z"));
  const planning = estimateBuildProgress({ state: "planning", updatedAt: "2026-08-30T12:00:30.000Z" }, Date.parse("2026-08-30T12:00:30.000Z"));

  assert.ok(planning > queued);
  assert.equal(estimateBuildProgress({ state: "ready", updatedAt: startedAt }, Date.parse(startedAt)), 96);
});

test("a delayed backend poll cannot move visible generation progress backward", () => {
  const startedAt = "2026-08-30T12:00:00.000Z";

  assert.equal(
    advanceBuildProgress(11, { state: "queued", updatedAt: startedAt }, Date.parse(startedAt)),
    11,
  );
  assert.equal(
    advanceBuildProgress(50, { state: "fitting_parts", updatedAt: startedAt }, Date.parse(startedAt)),
    50,
  );
});
