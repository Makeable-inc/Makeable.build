import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadProductionPromptPackage } from "../lib/production-prompt-package.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const promptPackage = await loadProductionPromptPackage(repositoryRoot);
const runnerSource = await readFile(path.join(repositoryRoot, "scripts/run_xiao_qwiic_production.mjs"), "utf8");
const assemblyWorkflow = await readFile(path.join(repositoryRoot, "assembly.md"), "utf8");

test("production prompt package maps the complete workflow", () => {
  assert.equal(promptPackage.schemaVersion, "makeable-production-prompt-package/v1");
  assert.deepEqual([...promptPackage.stages.keys()], [
    "parts_plan",
    "asset_resolution",
    "assembly_routing",
    "route_geometry",
    "hero_art_direction",
    "hero_image",
    "housing_generation",
    "firmware_generation",
    "browser_delivery",
  ]);
  assert.match(promptPackage.manifestSha256, /^[a-f0-9]{64}$/);
});

test("only Responses API stages receive developer prompts", () => {
  const prompted = [...promptPackage.stages.values()].filter((stage) => stage.prompt);
  assert.deepEqual(prompted.map((stage) => stage.id), ["parts_plan", "assembly_routing", "hero_art_direction"]);
  for (const stage of prompted) {
    assert.equal(stage.executor, "openai_responses");
    assert.match(stage.promptSha256, /^[a-f0-9]{64}$/);
    assert.ok(stage.prompt.length > 250 && stage.prompt.length < 2_500, `${stage.id} prompt should remain focused`);
  }
  for (const stage of promptPackage.stages.values()) {
    if (stage.executor !== "openai_responses") assert.equal(stage.prompt, null, `${stage.id} must remain deterministic`);
  }
});

test("stage prompts are generic, outcome-focused, and project-context free", () => {
  const parts = promptPackage.prompt("parts_plan");
  const routing = promptPackage.prompt("assembly_routing");
  const hero = promptPackage.prompt("hero_art_direction");

  assert.match(parts, /approved catalog candidates/i);
  assert.match(parts, /Never fabricate, fuzzy-match, or substitute/i);
  assert.match(routing, /immutable wires/i);
  assert.match(routing, /Never request a service loop, coil, circle/i);
  assert.match(hero, /one complete, closed, non-exploded product/i);
  assert.match(hero, /one generation attempt/i);

  for (const prompt of [parts, routing, hero]) {
    assert.doesNotMatch(prompt, /XIAO|SCD-41|plant companion|Pocket CO2|B0DRNSV5CS|benchmark duration/i);
    assert.doesNotMatch(prompt, /Return only JSON in this shape|"type":\s*"object"/i);
  }
});

test("runner sends isolated instructions and keeps Structured Output schemas in code", () => {
  assert.match(runnerSource, /loadProductionPromptPackage\(ROOT\)/);
  assert.match(runnerSource, /developer: partsPlanStage\.prompt/);
  assert.match(runnerSource, /developer: assemblyRoutingStage\.prompt/);
  assert.match(runnerSource, /developer: heroArtDirectionStage\.prompt/);
  assert.match(runnerSource, /instructions: developerPrompt/);
  assert.match(runnerSource, /input: \[\{ role: "user", content: user \}\]/);
  assert.match(runnerSource, /type: "json_schema", name, strict: true, schema/);
  assert.match(runnerSource, /prompt_cache_key:/);
  assert.doesNotMatch(runnerSource, /PROMPT_PATH|productionPrompt|prompts\/xiao-qwiic-production\.md/);
});

test("assembly workflow points production at the manifest instead of sending the full document", () => {
  assert.match(assemblyWorkflow, /runtime source of truth is the versioned prompt package/i);
  assert.match(assemblyWorkflow, /This document explains the larger system; it is never sent wholesale to a model/i);
  assert.match(assemblyWorkflow, /JSON Schemas remain code-owned Structured Output configuration/i);
});
