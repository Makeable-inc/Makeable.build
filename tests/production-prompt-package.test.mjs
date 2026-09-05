import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadProductionPromptPackage } from "../lib/production-prompt-package.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const promptPackage = await loadProductionPromptPackage(repositoryRoot);
const runnerSource = await readFile(path.join(repositoryRoot, "scripts/production-aws-simulation-server.mjs"), "utf8");
const buildSource = await readFile(path.join(repositoryRoot, "lib/makeable-builds.mjs"), "utf8");
const assemblySource = await readFile(path.join(repositoryRoot, "lib/prompt2circuit-production.mjs"), "utf8");
const assemblyWorkflow = await readFile(path.join(repositoryRoot, "assembly.md"), "utf8");

test("production prompt package maps the complete workflow", () => {
  assert.equal(promptPackage.schemaVersion, "makeable-production-prompt-package/v1");
  assert.deepEqual([...promptPackage.stages.keys()], [
    "brief_clarification",
    "parts_plan",
    "asset_resolution",
    "resource_partitioning",
    "connector_geometry_audit",
    "assembly_routing",
    "route_geometry",
    "browser_delivery",
  ]);
  assert.match(promptPackage.manifestSha256, /^[a-f0-9]{64}$/);
});

test("only Responses API stages receive developer prompts", () => {
  const prompted = [...promptPackage.stages.values()].filter((stage) => stage.prompt);
  assert.deepEqual(prompted.map((stage) => stage.id), ["brief_clarification", "parts_plan", "assembly_routing"]);
  for (const stage of prompted) {
    assert.equal(stage.executor, "openai_responses");
    assert.match(stage.promptSha256, /^[a-f0-9]{64}$/);
    assert.ok(stage.prompt.length > 250, `${stage.id} prompt must contain its complete production contract`);
  }
  for (const stage of promptPackage.stages.values()) {
    if (stage.executor !== "openai_responses") assert.equal(stage.prompt, null, `${stage.id} must remain deterministic`);
  }
});

test("assembly and wiring are pinned to Sol xhigh on the priority tier", () => {
  const clarification = promptPackage.stage("brief_clarification");
  const planning = promptPackage.stage("parts_plan");
  const routing = promptPackage.stage("assembly_routing");
  assert.equal(clarification.owner, "gpt-5.6-sol");
  assert.equal(clarification.reasoningEffort, "high");
  assert.equal(clarification.serviceTier, "priority");
  assert.equal(planning.owner, "gpt-5.6-sol");
  assert.equal(planning.reasoningEffort, "xhigh");
  assert.equal(planning.serviceTier, "priority");
  assert.equal(routing.owner, "gpt-5.6-sol");
  assert.equal(routing.reasoningEffort, "xhigh");
  assert.equal(routing.serviceTier, "priority");
  assert.match(assemblySource, /const model = "gpt-5\.6-sol"/);
  assert.match(assemblySource, /reasoning: \{ effort: "xhigh" \}/);
  assert.match(assemblySource, /service_tier: "priority"/);
  assert.match(runnerSource, /partsPlannerModel: partsPlanStage\.owner/);
  assert.match(runnerSource, /partsPlannerReasoningEffort: partsPlanStage\.reasoningEffort/);
  assert.match(runnerSource, /partsPlannerServiceTier: partsPlanStage\.serviceTier/);
  assert.match(runnerSource, /loadProductionBuildPipeline/);
  assert.match(runnerSource, /finalizeSelectedParts\(enforceOneShotPlannerParts\(parts, context\), context\)/);
  assert.match(buildSource, /reasoning: \{ effort: reasoningEffort \}/);
  assert.match(buildSource, /service_tier: serviceTier/);
  assert.match(assemblyWorkflow, /current red-light inventory/i);
});

test("stage prompts are generic, outcome-focused, and project-context free", () => {
  const clarification = promptPackage.prompt("brief_clarification");
  const parts = promptPackage.prompt("parts_plan");
  const routing = promptPackage.prompt("assembly_routing");

  assert.match(clarification, /broad theme by itself is not ready/i);
  assert.match(clarification, /exactly three materially different/i);
  assert.match(clarification, /Do not choose on the user's behalf/i);
  assert.match(parts, /approved catalog candidates/i);
  assert.match(parts, /Never fabricate, fuzzy-match, or substitute/i);
  assert.match(parts, /request fingerprint/i);
  assert.match(parts, /cross-request contamination/i);
  assert.match(parts, /Customer-facing project copy contract/i);
  assert.match(parts, /Two-Wheel ESP32 Rover with Dual Drive/i);
  assert.match(parts, /one or two complete customer-facing sentences of 10–45 words/i);
  assert.match(parts, /conventional technical capitalization exactly/i);
  assert.match(parts, /required capability/i);
  assert.match(parts, /Preserve blocked plans instead of rewriting them/i);
  assert.match(parts, /100% coverage/i);
  assert.match(parts, /deterministic connector-geometry audit/i);
  assert.match(parts, /measured `servoLoad` contract/i);
  assert.match(parts, /summed startup\/stall peak-current capacity/i);
  assert.match(parts, /`poweredLogicLoad`/i);
  assert.match(parts, /DEVICE_POWER, DEVICE_GROUND, DEVICE_SIGNAL_HIGH/i);
  assert.match(parts, /Grove is forbidden on every other carrier/i);
  assert.match(parts, /Grove modules terminate only on the exact Seeed XIAO Expansion Base/i);
  assert.match(parts, /LCD1602 keypad shields are permanently retired/i);
  assert.match(parts, /HC-SR04P-style profile/i);
  assert.match(parts, /ordinary individually addressable 2\.54 mm header contacts/i);
  assert.match(parts, /peripheral-to-peripheral acquisition paths/i);
  assert.match(parts, /does not require.*cable GLB.*cable BOM entry/i);
  assert.match(parts, /yellow-bodied mirrored `5V` row contact is not a general 5 V source/i);
  assert.match(parts, /ordinary yellow GPIO/i);
  assert.match(routing, /immutable wires/i);
  assert.match(routing, /Failure hygiene matters here too/i);
  assert.match(routing, /No visual inspection, human review, or prompt-only waiver/i);
  assert.match(routing, /selected BOM hash/i);
  assert.match(routing, /UI may never substitute a different project/i);
  assert.match(routing, /Never request a service loop, coil, circle/i);
  assert.match(routing, /Never request a giant U, C, S, rectangle, square, Manhattan path, perimeter trace/i);
  assert.match(parts, /current red-light inventory/i);
  assert.match(parts, /Deterministic multi-controller and ESP-NOW topology/i);
  assert.match(parts, /select a XIAO controller and its expansion base only when/i);
  assert.match(parts, /one-on-each-desk/i);
  assert.match(parts, /two complete controller devices/i);
  assert.match(parts, /Paired Mood Messenger/i);
  assert.match(parts, /at most seven encrypted peers/i);
  assert.match(parts, /Grove peripherals are assigned only to Seeed XIAO ESP32 nodes/i);
  assert.match(routing, /current red-light inventory/i);
  assert.match(routing, /Immutable ESP-NOW presentation rule/i);
  assert.match(routing, /not a wire/i);
  assert.match(routing, /short connector-normal lead-out, one broad free-span arch/i);
  assert.match(routing, /deterministic connector-geometry registry gate/i);
  assert.match(routing, /wiring guide, not a cable-product render/i);
  assert.match(routing, /exactly one visible guide line from the external component's exact functional contact/i);
  assert.match(routing, /none of that accessory geometry is drawn/i);
  assert.match(routing, /must not pass through, clip, graze, or hide inside any PCB/i);
  assert.match(routing, /STL generation is forbidden/i);
  assert.match(routing, /Neural4D and every other text-to-3D/i);
  assert.match(routing, /padded world-space bounds for every resolved GLB as hard solids/i);
  assert.match(routing, /black for GND, red for positive power, and yellow for signal or I\/O/i);
  assert.match(routing, /wire color follows electrical role, not connector plastic/i);
  assert.match(routing, /powerSourceClass=mirrored_controller_power_contact/i);
  assert.match(routing, /mirroredPowerAuthorization/i);
  assert.match(routing, /maximumConnections=1/i);
  assert.match(routing, /physicalContactReuse=forbidden/i);
  assert.match(parts, /peripheral ID\/SHA, carrier ID\/SHA, contact node/i);
  assert.match(parts, /never infer or inherit this authorization/i);
  assert.match(routing, /ordinary yellow GPIO contact can never satisfy a power request/i);
  assert.match(routing, /`deformable-servo-harness`/i);
  assert.match(routing, /exactly one compiler-supplied common-ground bond/i);
  assert.match(routing, /`deformable-powered-logic-harness`/i);
  assert.match(routing, /High-side and low-side signal endpoints are not interchangeable/i);
  assert.match(routing, /Do not output vertices, Bézier control points, meshes, transforms, endpoints/i);
  assert.match(routing, /ordinary 2\.54 mm male-pin-to-male-pin `routed-conductor`/i);
  assert.match(routing, /no separate jumper-wire GLB appears in the BOM/i);
  assert.match(routing, /never use that electrical edge to bypass a keyed connector/i);
  for (const prompt of [parts, routing]) {
    assert.doesNotMatch(prompt, /SCD-41|plant companion|Pocket CO2|B0DRNSV5CS|benchmark duration/i);
    assert.doesNotMatch(prompt, /Return only JSON in this shape|"type":\s*"object"/i);
  }
});

test("runner sends isolated instructions and keeps Structured Output schemas in code", () => {
  assert.match(runnerSource, /loadProductionPromptPackage\(ROOT\)/);
  assert.match(runnerSource, /partsPlannerPrompt: experimentMode === "compact" \? compactPartsPlannerPrompt : partsPlanStage\.prompt/);
  assert.match(runnerSource, /loadPrompt2CircuitGeometryAudit\(ROOT\)/);
  assert.match(runnerSource, /productionPlannerCatalog\(publicCatalog, interfaceProfiles, connectorGeometryAudit,/);
  assert.match(runnerSource, /requireControllerCarrier: true/);
  assert.match(runnerSource, /connectorGeometryAudit,/);
  assert.match(buildSource, /String\(partsPlannerPrompt \|\| buildPlannerInstructions\(\)\)/);
  assert.match(buildSource, /Copy requestIdentity\.buildId and requestIdentity\.requestFingerprint exactly/);
  assert.match(buildSource, /type: "json_schema"/);
  assert.match(buildSource, /COPY QUALITY RETRY/);
  assert.match(buildSource, /planner_copy_repair_selection_drift/);
  assert.match(buildSource, /enforceProjectCopyQuality/);
  assert.match(runnerSource, /prompt: assemblyRoutingStage\.prompt/);
  assert.match(assemblySource, /content: String\(prompt \|\|/);
  assert.match(assemblySource, /type: "json_schema"/);
  assert.doesNotMatch(runnerSource, /heroArtDirectionStage|refineImagePrompt|OPENAI_IMAGE_MODEL|OPENAI_HERO_ART_DIRECTOR_MODEL/);
});

test("canonical production runner is structurally circuit-only", () => {
  assert.match(runnerSource, /circuitOnly: true/);
  assert.match(runnerSource, /heroArtDirection: false/);
  assert.match(runnerSource, /imageGeneration: false/);
  assert.match(runnerSource, /stlGeneration: false/);
  assert.match(runnerSource, /housingGeneration: false/);
  assert.match(runnerSource, /enclosureGeneration: false/);
  assert.match(runnerSource, /meshGeneration: false/);
  assert.match(buildSource, /const circuitOnly = options\?\.circuitOnly === true/);
  assert.match(buildSource, /const imagePromise = circuitOnly\s*\n\s*\? Promise\.resolve\(null\)/);
  assert.match(buildSource, /\.\.\.\(!circuitOnly \? \{ imagePrompt, image: boundImage \} : \{\}\)/);
  assert.doesNotMatch(runnerSource, /skipImageGeneration|image_generation_skipped/);
  assert.doesNotMatch(runnerSource, /image_generation_started|hero_art_direction_started|\/v1\/images\/generations/);
});

test("assembly workflow points production at the manifest instead of sending the full document", () => {
  assert.match(assemblyWorkflow, /runtime source of truth is the versioned prompt package/i);
  assert.match(assemblyWorkflow, /This document explains the larger system; it is never sent wholesale to a model/i);
  assert.match(assemblyWorkflow, /JSON Schemas remain code-owned Structured Output configuration/i);
});
