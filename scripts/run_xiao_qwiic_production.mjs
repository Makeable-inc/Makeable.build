#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

import {
  XIAO_QWIIC_BUILD_ID,
  XIAO_QWIIC_ASSETS,
  XIAO_QWIIC_CABLE,
  XIAO_QWIIC_CONNECTIONS,
  XIAO_QWIIC_PARTS,
  XIAO_QWIIC_POLICY,
  XIAO_QWIIC_PRODUCT_DESIGN,
  XIAO_QWIIC_STEPS,
  assertXiaoQwiicContract,
} from "../lib/xiao-qwiic-air-monitor-contract.mjs";
import {
  assertRouteAvoidsKeepouts,
  assertRouteHasNoLoops,
  assertRouteInsideBounds,
  buildNormalAlignedHarnessRoute,
} from "../lib/assembly-route-geometry.mjs";
import { validateControllerFamilyAssembly } from "../lib/controller-family-assembly-policy.mjs";
import { loadProductionPromptPackage } from "../lib/production-prompt-package.mjs";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "artifacts/xiao-qwiic-co2/2026-08-28-api-only-v3");
const HERO_DIR = path.join(OUT, "hero");
const ENCLOSURE_DIR = path.join(OUT, "enclosure");
const FIRMWARE_DIR = path.join(OUT, "firmware");
const VIEWER_DIR = path.join(OUT, "viewer");
const env = { ...readEnv(path.join(ROOT, ".env")), ...process.env };
const config = Object.freeze({
  buildModel: "gpt-5.6-terra",
  wiringModel: "gpt-5.6-sol",
  heroDirectorModel: "gpt-5.6-sol",
  imageModel: "gpt-image-2",
  imageQuality: "high",
  imageSize: "1536x1024",
});

if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required; API-only mode has no fallback.");
assertXiaoQwiicContract();
await Promise.all([HERO_DIR, ENCLOSURE_DIR, FIRMWARE_DIR, VIEWER_DIR].map((directory) => mkdir(directory, { recursive: true })));
const promptPackage = await loadProductionPromptPackage(ROOT);
const partsPlanStage = promptPackage.stage("parts_plan");
const assemblyRoutingStage = promptPackage.stage("assembly_routing");
const heroArtDirectionStage = promptPackage.stage("hero_art_direction");

const started = performance.now();
const startedAt = new Date();
const timeline = [];
function event(name, details = {}) {
  const elapsedMs = round(performance.now() - started);
  timeline.push({ sequence: timeline.length + 1, name, elapsedMs, at: new Date(startedAt.getTime() + elapsedMs).toISOString(), ...details });
}

event("request_received", { buildId: XIAO_QWIIC_BUILD_ID, mode: "api_only" });
event("production_prompt_package_loaded", {
  packageVersion: promptPackage.packageVersion,
  manifestPath: path.relative(ROOT, promptPackage.manifestPath),
  manifestSha256: promptPackage.manifestSha256,
  stages: [partsPlanStage, assemblyRoutingStage, heroArtDirectionStage].map((stage) => ({
    id: stage.id,
    promptPath: path.relative(ROOT, stage.resolvedPromptPath),
    promptSha256: stage.promptSha256,
    bytes: Buffer.byteLength(stage.prompt),
  })),
});
event("connector_policy_locked", { connectorFamily: XIAO_QWIIC_CABLE.connectorFamily, breadboardAllowed: false, groveAllowedAsQwiic: false, visualPasses: 0 });
const familyGate = validateControllerFamilyAssembly({
  controller: { asin: XIAO_QWIIC_PARTS[0].asin },
  sensorCount: 1,
  connections: [{
    controllerTermination: "individual_factory_housed_female_socket",
    controllerConnectorFamily: "2.54mm_male_header",
  }],
});
if (familyGate.state !== "ready") throw new Error(`Controller family gate blocked: ${familyGate.reason}`);
event("controller_family_policy_locked", familyGate);

event("terra_planning_started", { model: config.buildModel });
const plan = await responsesJson({
  model: config.buildModel,
  effort: "high",
  stageId: partsPlanStage.id,
  name: "xiao_qwiic_co2_plan",
  schema: {
    type: "object", additionalProperties: false,
    required: ["title", "summary", "behavior", "selectedCatalogIds", "safetyGates", "enclosureSpec"],
    properties: {
      title: { type: "string" }, summary: { type: "string" }, behavior: { type: "string" },
      selectedCatalogIds: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
      safetyGates: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
      enclosureSpec: {
        type: "object", additionalProperties: false,
        required: ["widthMm", "depthMm", "heightMm", "wallMm", "airflowOpening", "usbOpening"],
        properties: {
          widthMm: { type: "number", const: XIAO_QWIIC_PRODUCT_DESIGN.outerEnvelopeMm[0] },
          depthMm: { type: "number", const: XIAO_QWIIC_PRODUCT_DESIGN.outerEnvelopeMm[1] },
          heightMm: { type: "number", const: XIAO_QWIIC_PRODUCT_DESIGN.outerEnvelopeMm[2] },
          wallMm: { type: "number", const: XIAO_QWIIC_PRODUCT_DESIGN.wallMm },
          airflowOpening: { type: "string" }, usbOpening: { type: "string" },
        },
      },
    },
  },
  developer: partsPlanStage.prompt,
  user: JSON.stringify({
    request: "Create the new Pocket CO2 Climate Beacon using only the immutable XIAO, SCD-41, and exact Qwiic cable identity lock.",
    exactParts: XIAO_QWIIC_PARTS,
    exactCable: XIAO_QWIIC_CABLE,
    exactConnections: XIAO_QWIIC_CONNECTIONS,
    policy: XIAO_QWIIC_POLICY,
  }),
});
assertPlan(plan);
event("terra_planning_completed", { model: config.buildModel, selectedCatalogIds: plan.selectedCatalogIds });

event("parallel_asset_and_sol_branches_started");
const [delivery, routing, heroPrompt] = await Promise.all([
  verifyAwsRegistryAndAssets(),
  createRoutingPlan(),
  createHeroPrompt(plan),
]);
event("parallel_asset_and_sol_branches_completed", { remoteGlbCount: delivery.assets.length, wireCount: routing.length, heroPromptSha256: sha256(Buffer.from(heroPrompt)) });
validateRouting(routing);
validateHeroPrompt(heroPrompt);
const resolvedConnections = resolveConnectionsFromDelivery(delivery);
const routeGeometry = createRouteGeometry(resolvedConnections, routing, delivery);
await writeFile(path.join(HERO_DIR, "hero-prompt.md"), `${heroPrompt}\n`, "utf8");

event("image_generation_started", { model: config.imageModel, attempt: 1, quality: config.imageQuality, size: config.imageSize });
const image = await imageGeneration(heroPrompt);
const heroPath = path.join(HERO_DIR, "xiao-qwiic-co2-hero.png");
await writeFile(heroPath, image.bytes);
const heroSha256 = sha256(image.bytes);
assertPng(image.bytes);
event("image_generation_completed", { model: config.imageModel, attempts: 1, humanVisualPasses: 0, modelVisualPasses: 0, bytes: image.bytes.length, sha256: heroSha256 });

event("post_hero_housing_started", { heroSha256, visualInputUsed: false });
const housing = await generateHousingDeterministically();
event("post_hero_housing_completed", { state: housing.state, determinism: housing.determinism, humanVisualPasses: 0 });

const firmwarePath = path.join(FIRMWARE_DIR, "xiao_qwiic_co2_beacon.ino");
await writeFile(firmwarePath, firmwareSource(), "utf8");
const firmwareCompile = await compileFirmware(firmwarePath);
event("firmware_generated_and_compiled", { path: path.relative(ROOT, firmwarePath), bytes: Buffer.byteLength(firmwareSource()), fqbn: firmwareCompile.fqbn, compiled: true });

const build = {
  schemaVersion: "MakeableApiOnlyProductionSimulationV1",
  buildId: XIAO_QWIIC_BUILD_ID,
  generatedAt: new Date().toISOString(),
  state: "ready",
  stateReasons: ["immutable_aws_assets_and_interfaces_ready", "housing_passed_deterministic_geometry_and_repeatability_gates", "runtime_visual_passes_zero"],
  prompt: {
    kind: "production_prompt_package_manifest",
    path: path.relative(ROOT, promptPackage.manifestPath),
    sha256: promptPackage.manifestSha256,
  },
  promptPackage: {
    schemaVersion: promptPackage.schemaVersion,
    packageVersion: promptPackage.packageVersion,
    manifest: { path: path.relative(ROOT, promptPackage.manifestPath), sha256: promptPackage.manifestSha256 },
    stages: Object.fromEntries([partsPlanStage, assemblyRoutingStage, heroArtDirectionStage].map((stage) => [stage.id, {
      owner: stage.owner,
      executor: stage.executor,
      promptPath: path.relative(ROOT, stage.resolvedPromptPath),
      promptSha256: stage.promptSha256,
    }])),
  },
  models: config,
  plan,
  parts: XIAO_QWIIC_PARTS,
  cable: XIAO_QWIIC_CABLE,
  connections: resolvedConnections,
  routing,
  routeGeometry,
  steps: XIAO_QWIIC_STEPS,
  policy: XIAO_QWIIC_POLICY,
  delivery,
  hero: {
    path: path.relative(ROOT, heroPath), sha256: heroSha256, bytes: image.bytes.length,
    promptPath: path.relative(ROOT, path.join(HERO_DIR, "hero-prompt.md")),
    promptSha256: sha256(Buffer.from(heroPrompt)), generationAttempts: 1,
    humanVisualPasses: 0, modelVisualPasses: 0,
  },
  housing,
  firmware: { path: path.relative(ROOT, firmwarePath), sha256: sha256(Buffer.from(firmwareSource())), bytes: Buffer.byteLength(firmwareSource()), compile: firmwareCompile },
  publication: { awsWriteAttempted: false, state: "not_requested" },
};

await writeFile(path.join(OUT, "production-build.json"), `${JSON.stringify(build, null, 2)}\n`, "utf8");
await writeFile(path.join(OUT, "PRODUCTION_WORKFLOW.md"), workflowMarkdown(build), "utf8");
await writeFile(path.join(VIEWER_DIR, "index.html"), viewerHtml(), "utf8");
event("build_contract_written", { path: path.relative(ROOT, path.join(OUT, "production-build.json")) });
event("response_ready", { totalMs: round(performance.now() - started) });
await writeFile(path.join(OUT, "production-trace.json"), `${JSON.stringify({ ...build, timeline }, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  buildId: build.buildId,
  state: build.state,
  models: config,
  prompt: build.prompt,
  hero: build.hero,
  housing: { state: housing.state, determinism: housing.determinism },
  remoteGlbCount: delivery.assets.length,
  wireCount: routing.length,
  totalMs: timeline.at(-1).totalMs,
  timeline,
}, null, 2));

async function createRoutingPlan() {
  event("sol_wiring_started", { model: config.wiringModel, immutableEndpoints: true });
  const response = await responsesJson({
    model: config.wiringModel,
    effort: "high",
    stageId: assemblyRoutingStage.id,
    name: "xiao_qwiic_routing",
    schema: {
      type: "object", additionalProperties: false, required: ["wires"],
      properties: { wires: { type: "array", minItems: 4, maxItems: 4, items: {
        type: "object", additionalProperties: false, required: ["wireId", "lane", "bowDirection", "bowHeightMm"],
        properties: {
          wireId: { type: "string" }, lane: { type: "integer", minimum: -1, maximum: 1 },
          bowDirection: { type: "string", enum: ["left", "right"] }, bowHeightMm: { type: "number", minimum: 4.5, maximum: 5.5 },
        },
      } } },
    },
    developer: assemblyRoutingStage.prompt,
    user: JSON.stringify({ task: "Return only legal visual routing metadata for the immutable cable conductors.", wires: XIAO_QWIIC_CONNECTIONS }),
  });
  event("sol_wiring_completed", { model: config.wiringModel, returnedWireCount: response.wires.length });
  return response.wires;
}

async function createHeroPrompt(plan) {
  event("sol_hero_direction_started", { model: config.heroDirectorModel });
  const response = await responsesJson({
    model: config.heroDirectorModel,
    effort: "high",
    stageId: heroArtDirectionStage.id,
    name: "xiao_qwiic_hero_prompt",
    schema: { type: "object", additionalProperties: false, required: ["imagePrompt"], properties: { imagePrompt: { type: "string", minLength: 500, maxLength: 3000 } } },
    developer: heroArtDirectionStage.prompt,
    user: JSON.stringify({ task: "Write the one-shot non-exploded product hero prompt. No variants, inspection, correction, or retry.", plan, exactParts: XIAO_QWIIC_PARTS, cable: XIAO_QWIIC_CABLE }),
  });
  const locked = [
    "Show exactly one complete closed Pocket CO2 Climate Beacon, never an exploded view, cutaway, assembly diagram, open shell, floating electronics, or second product.",
    "Use a restrained industrial-design studio cyclorama, natural three-quarter product view, matte opaque warm-gray FDM shell, graphite snap seam, crisp contact shadow, and clean negative space.",
    "The only exterior features are an honest SCD-41 airflow grille and an unseen rear or underside USB-C service opening. No display, button, logo, readable text, screws, battery, transparent shell, or decorative connector.",
    "The exact internal kit is the pre-soldered Seeed Studio XIAO ESP32C3 plus Adafruit SCD-41 #5190 joined by Adafruit #4397: four separate female sockets on XIAO 3V3, GND, D4/SDA and D5/SCL, with one keyed JST-SH 1.0 mm 4-pin Qwiic/STEMMA QT plug at SCD-41 CONN4.",
    "The closed opaque shell must conceal the internal cable so the image cannot be used as electrical evidence. The assembly guide is the source of truth.",
    `Housing envelope: ${XIAO_QWIIC_PRODUCT_DESIGN.outerEnvelopeMm.join(" by ")} mm, ${XIAO_QWIIC_PRODUCT_DESIGN.wallMm} mm walls, functional ${XIAO_QWIIC_PRODUCT_DESIGN.airflowOpening.regionMm.join(" by ")} mm airflow region, ${XIAO_QWIIC_PRODUCT_DESIGN.usbServiceOpening.sizeMm.join(" by ")} mm rear USB-C service opening.`,
  ].join("\n");
  const finalPrompt = `${response.imagePrompt}\n\nNON-NEGOTIABLE PRODUCTION OVERRIDE:\n${locked}`;
  event("sol_hero_direction_completed", { model: config.heroDirectorModel, promptChars: finalPrompt.length });
  return finalPrompt;
}

async function verifyAwsRegistryAndAssets() {
  event("aws_registry_started", { pointer: "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/current.json" });
  const pointerResponse = await fetch("https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/current.json", { signal: AbortSignal.timeout(60_000) });
  if (!pointerResponse.ok) throw new Error(`AWS registry pointer returned HTTP ${pointerResponse.status}`);
  const pointer = await pointerResponse.json();
  if (!/^https:\/\/dvy6bet209exg\.cloudfront\.net\//.test(pointer.manifestUrl || "")) throw new Error("Registry manifest is outside the approved origin.");
  const manifestResponse = await fetch(pointer.manifestUrl, { signal: AbortSignal.timeout(60_000) });
  if (!manifestResponse.ok) throw new Error(`AWS registry manifest returned HTTP ${manifestResponse.status}`);
  const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
  const manifestSha256 = sha256(manifestBytes);
  if (manifestSha256 !== pointer.manifestSha256) throw new Error("AWS registry manifest SHA-256 mismatch.");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const active = new Map((manifest.assets || []).map((asset) => [asset.partId, asset]));
  const rows = await Promise.all(XIAO_QWIIC_ASSETS.map(async (part) => {
    const registryAsset = active.get(part.assetId);
    if (!registryAsset || registryAsset.sha256 !== part.sha256) throw new Error(`Registry binding failed for ${part.assetId}`);
    if (registryAsset.url !== part.assetUrl) throw new Error(`Registry URL binding failed for ${part.assetId}`);
    if (registryAsset.reviewedSha256 !== part.sha256) throw new Error(`Reviewed hash binding failed for ${part.assetId}`);
    for (const field of ["visualEligibility", "interfaceEligibility", "selectionStatus"]) {
      if (registryAsset[field] !== "ready") throw new Error(`${part.assetId} ${field} is ${registryAsset[field] || "missing"}`);
    }
    const fetchStarted = performance.now();
    const response = await fetch(part.assetUrl, { headers: { Origin: "http://127.0.0.1:8913" }, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`${part.assetId} returned HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actualHash = sha256(bytes);
    if (actualHash !== part.sha256) throw new Error(`${part.assetId} SHA-256 mismatch`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("model/gltf-binary")) throw new Error(`${part.assetId} has invalid content type ${contentType}`);
    const gltf = parseGlb(bytes, part.assetId);
    validateNamedNodes(part.id, gltf);
    return {
      assetId: part.assetId, url: part.assetUrl, sha256: actualHash, bytes: bytes.length,
      contentType, cors: response.headers.get("access-control-allow-origin") || "", nodeCount: gltf.nodes.length,
      interfaceProfile: registryAsset.interfaceProfile || registryAsset.cableProfile || null,
      fetchMs: round(performance.now() - fetchStarted), source: "aws_cloudfront_memory_only",
    };
  }));
  event("aws_registry_and_glb_verification_completed", { revision: manifest.revision, assetCount: rows.length, totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0) });
  return { pointerUrl: "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/current.json", manifestUrl: pointer.manifestUrl, manifestSha256, revision: manifest.revision, assets: rows, localGlbRequests: 0 };
}

function validateNamedNodes(partId, gltf) {
  const names = new Set((gltf.nodes || []).map((node) => node.name));
  const expected = partId === "controller"
    ? XIAO_QWIIC_CONNECTIONS.map((wire) => wire.from.nodeName)
    : partId === "sensor"
      ? ["anchor:CONN4_STEMMA_QT", "component:CONN4:mouth-cavity", ...XIAO_QWIIC_CONNECTIONS.map((wire) => wire.to.nodeName)]
      : XIAO_QWIIC_CABLE.requiredNodes;
  for (const name of expected) if (!names.has(name)) throw new Error(`${partId} GLB is missing required node ${name}`);
}

function resolveConnectionsFromDelivery(delivery) {
  const profiles = new Map(delivery.assets.map((asset) => [asset.assetId, asset.interfaceProfile]));
  const controllerProfile = profiles.get(XIAO_QWIIC_PARTS[0].assetId);
  const sensorProfile = profiles.get(XIAO_QWIIC_PARTS[1].assetId);
  const cableProfile = profiles.get(XIAO_QWIIC_CABLE.assetId);
  if (!controllerProfile?.endpoints?.length || !sensorProfile?.endpoints?.length || cableProfile?.nominalLengthMm !== 150) {
    throw new Error("Registry is missing one or more ready interface profiles.");
  }
  const controllerEndpoints = new Map(controllerProfile.endpoints.map((endpoint) => [endpoint.nodeName, endpoint]));
  const sensorEndpoints = new Map(sensorProfile.endpoints.map((endpoint) => [endpoint.nodeName, endpoint]));
  return XIAO_QWIIC_CONNECTIONS.map((wire) => {
    const from = controllerEndpoints.get(wire.from.nodeName);
    const to = sensorEndpoints.get(wire.to.nodeName);
    if (!from || !to) throw new Error(`Registry interface profile cannot resolve ${wire.id}`);
    return {
      ...wire,
      from: { ...wire.from, position: world(XIAO_QWIIC_PARTS[0].assembledPosition, from.tip), localPosition: from.tip, normal: from.normal, matingSide: from.matingSide, interfaceProfileVersion: controllerProfile.version },
      to: { ...wire.to, position: world(XIAO_QWIIC_PARTS[1].assembledPosition, to.position), localPosition: to.position, normal: to.normal, matingSide: to.matingSide, interfaceProfileVersion: sensorProfile.version },
    };
  });
}

function createRouteGeometry(connections, routing, delivery) {
  const routeById = new Map(routing.map((route) => [route.wireId, route]));
  const controllerDelivery = delivery.assets.find((asset) => asset.assetId === XIAO_QWIIC_PARTS[0].assetId);
  const localKeepout = controllerDelivery.interfaceProfile.usbKeepoutBounds;
  const offset = XIAO_QWIIC_PARTS[0].assembledPosition;
  const usbKeepout = {
    id: "xiao-usb-c",
    paddingM: 0.0008,
    bounds: { min: world(offset, localKeepout.min), max: world(offset, localKeepout.max) },
  };
  const [widthMm, depthMm] = XIAO_QWIIC_PRODUCT_DESIGN.outerEnvelopeMm;
  const wallM = XIAO_QWIIC_PRODUCT_DESIGN.wallMm / 1000;
  const enclosureInterior = {
    min: [-widthMm / 2000 + wallM, -depthMm / 2000 + wallM, XIAO_QWIIC_PRODUCT_DESIGN.floorMm / 1000],
    max: [widthMm / 2000 - wallM, depthMm / 2000 - wallM, XIAO_QWIIC_PRODUCT_DESIGN.baseHeightMm / 1000],
  };
  return connections.map((wire) => {
    const route = routeById.get(wire.id);
    const geometry = buildNormalAlignedHarnessRoute({
      source: wire.from,
      target: wire.to,
      ...route,
      cableLengthMm: XIAO_QWIIC_CABLE.nominalLengthMm,
      sourceSleeveLengthMm: 12,
      sourceInsertionMm: 1,
    });
    assertRouteHasNoLoops(geometry);
    assertRouteAvoidsKeepouts(geometry, [usbKeepout]);
    assertRouteInsideBounds(geometry, enclosureInterior, { paddingM: 0.0006 });
    return { wireId: wire.id, ...geometry };
  });
}

async function generateHousingDeterministically() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "makeable-xiao-qwiic-"));
  const first = path.join(tempRoot, "first");
  const second = path.join(tempRoot, "second");
  const generator = path.join(ROOT, "scripts/cad/generate_xiao_qwiic_co2_enclosure.py");
  try {
    await execFileAsync("python3", [generator, first], { maxBuffer: 2_000_000 });
    await execFileAsync("python3", [generator, second], { maxBuffer: 2_000_000 });
    const firstManifest = JSON.parse(await readFile(path.join(first, "manifest.json"), "utf8"));
    const secondManifest = JSON.parse(await readFile(path.join(second, "manifest.json"), "utf8"));
    for (const key of Object.keys(firstManifest.printable)) {
      if (firstManifest.printable[key].sha256 !== secondManifest.printable[key].sha256) throw new Error(`Housing determinism failed for ${key}`);
    }
    if (firstManifest.assemblyGlb.sha256 !== secondManifest.assemblyGlb.sha256) throw new Error("Housing GLB determinism failed");
    await rm(ENCLOSURE_DIR, { recursive: true, force: true });
    await cp(first, ENCLOSURE_DIR, { recursive: true });
    const manifest = JSON.parse(await readFile(path.join(ENCLOSURE_DIR, "manifest.json"), "utf8"));
    return { ...manifest, state: "ready", path: path.relative(ROOT, ENCLOSURE_DIR), heroSha256, determinism: "byte_identical_two_clean_runs" };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function compileFirmware(firmwarePath) {
  const cli = env.ARDUINO_CLI_PATH || "/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli";
  const fqbn = "esp32:esp32:XIAO_ESP32C3";
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "makeable-xiao-qwiic-compile-"));
  const sketchRoot = path.join(tempRoot, "xiao_qwiic_co2_beacon");
  await mkdir(sketchRoot, { recursive: true });
  await cp(firmwarePath, path.join(sketchRoot, "xiao_qwiic_co2_beacon.ino"));
  const result = await execFileAsync(cli, ["compile", "--fqbn", fqbn, sketchRoot], { maxBuffer: 4_000_000 });
  return { fqbn, status: "pass", output: String(result.stdout || "").trim() };
}

async function responsesJson({ model, effort, stageId, name, schema, developer, user }) {
  if (!stageId || !developer?.trim()) throw new Error("Responses stage requires an isolated developer prompt.");
  const developerPrompt = developer.trim();
  const developerPromptSha256 = sha256(Buffer.from(developerPrompt));
  const response = await fetch(openAIUrl("/v1/responses"), {
    method: "POST", headers: openAIHeaders(), signal: AbortSignal.timeout(240_000),
    body: JSON.stringify({
      model,
      instructions: developerPrompt,
      input: [{ role: "user", content: user }],
      reasoning: { effort },
      service_tier: "priority",
      store: false,
      prompt_cache_key: `makeable:${stageId}:${developerPromptSha256.slice(0, 16)}`,
      metadata: {
        stage_id: stageId,
        prompt_sha256: developerPromptSha256,
        prompt_package_version: promptPackage.packageVersion,
      },
      text: { verbosity: "low", format: { type: "json_schema", name, strict: true, schema } },
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `${model} response failed`);
  return JSON.parse(outputText(payload));
}

async function imageGeneration(prompt) {
  const response = await fetch(openAIUrl("/v1/images/generations"), {
    method: "POST", headers: openAIHeaders(), signal: AbortSignal.timeout(420_000),
    body: JSON.stringify({ model: config.imageModel, prompt, n: 1, size: config.imageSize, quality: config.imageQuality }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Image generation failed");
  if (!payload?.data?.[0]?.b64_json) throw new Error("Image API returned no base64 image");
  return { bytes: Buffer.from(payload.data[0].b64_json, "base64") };
}

function assertPlan(plan) {
  const expected = new Set([XIAO_QWIIC_PARTS[0].catalogId, XIAO_QWIIC_PARTS[1].catalogId, XIAO_QWIIC_CABLE.catalogId]);
  for (const id of plan.selectedCatalogIds) if (!expected.delete(id)) throw new Error(`Terra selected an unknown or duplicate catalog id ${id}`);
  if (expected.size) throw new Error(`Terra omitted ${[...expected].join(", ")}`);
}

function validateRouting(routing) {
  const expected = new Set(XIAO_QWIIC_CONNECTIONS.map((wire) => wire.id));
  if (routing.length !== expected.size) throw new Error("Sol returned the wrong wire count.");
  for (const row of routing) {
    if (!expected.delete(row.wireId)) throw new Error(`Sol returned unknown or duplicate wire ${row.wireId}`);
    if (!Number.isInteger(row.lane) || row.lane < -1 || row.lane > 1) throw new Error(`Invalid lane for ${row.wireId}`);
    if (!Number.isFinite(row.bowHeightMm) || row.bowHeightMm < 4.5 || row.bowHeightMm > 5.5) throw new Error(`Invalid bow for ${row.wireId}`);
  }
  if (expected.size) throw new Error(`Sol omitted ${[...expected].join(", ")}`);
}

function validateHeroPrompt(prompt) {
  for (const term of ["one complete closed", "never an exploded view", "XIAO ESP32C3", "SCD-41", "JST-SH 1.0 mm 4-pin", "opaque"]) {
    if (!prompt.toLowerCase().includes(term.toLowerCase())) throw new Error(`Hero prompt missing locked term: ${term}`);
  }
}

function parseGlb(bytes, label) {
  if (bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`${label} is not a valid GLB 2.0 file`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${label} has no JSON chunk`);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
}

function assertPng(bytes) {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Hero response is not a valid PNG.");
}

function firmwareSource() {
  return `#include <Arduino.h>\n#include <Wire.h>\n\nconstexpr uint8_t SCD41_ADDRESS = 0x62;\n\nuint8_t crc8(const uint8_t *data, size_t length) {\n  uint8_t crc = 0xFF;\n  for (size_t i = 0; i < length; ++i) {\n    crc ^= data[i];\n    for (uint8_t bit = 0; bit < 8; ++bit) crc = (crc & 0x80) ? uint8_t((crc << 1) ^ 0x31) : uint8_t(crc << 1);\n  }\n  return crc;\n}\n\nbool sendCommand(uint16_t command) {\n  Wire.beginTransmission(SCD41_ADDRESS);\n  Wire.write(uint8_t(command >> 8));\n  Wire.write(uint8_t(command));\n  return Wire.endTransmission() == 0;\n}\n\nbool readCommand(uint16_t command, uint8_t *bytes, uint8_t length, uint16_t waitMs) {\n  if (!sendCommand(command)) return false;\n  delay(waitMs);\n  if (Wire.requestFrom(SCD41_ADDRESS, length) != length) return false;\n  for (uint8_t i = 0; i < length; ++i) bytes[i] = Wire.read();\n  for (uint8_t i = 0; i < length; i += 3) if (crc8(bytes + i, 2) != bytes[i + 2]) return false;\n  return true;\n}\n\nvoid setup() {\n  Serial.begin(115200);\n  Wire.begin(D4, D5);\n  Wire.setClock(100000);\n  sendCommand(0x3F86); // stop_periodic_measurement\n  delay(500);\n  sendCommand(0x3646); // reinit\n  delay(30);\n  if (!sendCommand(0x21B1)) {\n    Serial.println("SCD41_NOT_FOUND");\n    while (true) delay(1000);\n  }\n  Serial.println("XIAO_QWIIC_CO2_READY");\n}\n\nvoid loop() {\n  uint8_t ready[3];\n  if (!readCommand(0xE4B8, ready, sizeof(ready), 2)) { delay(1000); return; }\n  const uint16_t status = (uint16_t(ready[0]) << 8) | ready[1];\n  if ((status & 0x07FF) == 0) { delay(1000); return; }\n  uint8_t sample[9];\n  if (!readCommand(0xEC05, sample, sizeof(sample), 2)) { Serial.println("SCD41_READ_ERROR"); delay(1000); return; }\n  const uint16_t co2 = (uint16_t(sample[0]) << 8) | sample[1];\n  const uint16_t rawT = (uint16_t(sample[3]) << 8) | sample[4];\n  const uint16_t rawRh = (uint16_t(sample[6]) << 8) | sample[7];\n  const float temperature = -45.0f + 175.0f * float(rawT) / 65535.0f;\n  const float humidity = 100.0f * float(rawRh) / 65535.0f;\n  Serial.printf("CO2=%u,T=%.2f,RH=%.2f\\n", co2, temperature, humidity);\n  delay(1000);\n}\n`;
}

function workflowMarkdown(build) {
  const stages = timeline.map((entry) => `| ${entry.sequence} | ${entry.name} | ${(entry.elapsedMs / 1000).toFixed(2)} s |`).join("\n");
  return `# Pocket CO2 Climate Beacon production workflow\n\nBuild ID: \`${build.buildId}\`\n\nState: **${build.state}**. The electronics, cable interfaces, routed endpoints, and housing passed machine-verifiable production gates. The run used zero visual correction passes.\n\n## Exact kit\n\n- Seeed Studio XIAO ESP32C3 pre-soldered, \`B0DRNSV5CS\`.\n- Adafruit SCD-41 #5190, \`B0DYVCTTCD\`.\n- Adafruit #4397 cable, \`B09WLRBKWT\`: four premium female sockets to one keyed \`jst_sh_1.0mm_4p_qwiic\` plug.\n- No breadboard, expansion board, Grove substitution, soldering, or USB-C sensor endpoint.\n\n## API and function order\n\n1. Load and hash the versioned prompt manifest \`${build.promptPackage.manifest.path}\` and its isolated stage prompts.\n2. Call \`${config.buildModel}\` through \`POST /v1/responses\` with only the \`parts_plan\` instructions and dynamic locked-kit input.\n3. In parallel: resolve and hash-check the AWS registry/GLBs; call \`${config.wiringModel}\` with only \`assembly_routing\` instructions; call \`${config.heroDirectorModel}\` with only \`hero_art_direction\` instructions.\n4. Resolve every endpoint and normal from the approved AWS interface profiles, then deterministically construct a single open-bow route and reject every closed coil, self-intersection, or USB-C keepout intersection.\n5. Call \`POST /v1/images/generations\` once with \`${config.imageModel}\`, \`${config.imageQuality}\`, \`${config.imageSize}\`.\n6. Record the hero SHA-256. No inspection, comparison, correction, or retry occurs.\n7. Generate the housing twice from \`config/xiao-qwiic-product-design.json\`; require watertight, winding-consistent, finite, single-body printable STLs and byte-identical repeat outputs. This happens after the hero response and never interprets hero pixels.\n8. Compile firmware and write the assembly contract, browser viewer, and trace, including the manifest and per-stage prompt hashes.\n\n## Timeline\n\n| # | Stage | Elapsed |\n| ---: | --- | ---: |\n${stages}\n\n## Eligibility\n\n- Prompt isolation: each Responses call received only its declared stage instructions; Structured Output schemas remained code-owned.\n- AWS electronics visual/interface/assembly: ready from the active immutable catalog release.\n- Cable path: exact no-solder factory assembly; connector-normal, zero-loop, zero-self-intersection, and USB keepout gates enforced.\n- Housing: ready by deterministic geometry and two-run byte-equality gates.\n- Runtime visual passes: 0.\n- Runtime AWS writes: 0; catalog maintenance publication occurred separately before this run.\n`;
}

function viewerHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pocket CO2 Climate Beacon</title><style>
  :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:#080b0e;color:#f5f7f3}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block}.top{position:fixed;z-index:3;top:0;left:0;right:0;padding:22px 25px;display:flex;justify-content:space-between;background:linear-gradient(#080b0ef5,#080b0e00);pointer-events:none}.eyebrow{font:700 10px ui-monospace;color:#9ff5ce;letter-spacing:.16em}.top h1{font-size:25px;margin:6px 0}.sub{font-size:12px;color:#a9b1b8}.pills{display:flex;gap:7px}.pill{border:1px solid #34414a;border-radius:999px;padding:7px 9px;font:700 9px ui-monospace;background:#10161b}.good{color:#9ff5ce;border-color:#285f49}.warn{color:#ffd280;border-color:#765c27}.side{position:fixed;z-index:3;right:22px;top:95px;bottom:22px;width:330px;display:flex;flex-direction:column;gap:10px}.card{background:#0c1116eF;border:1px solid #29333b;border-radius:16px;padding:13px;box-shadow:0 20px 60px #0008}.hero{height:170px;border-radius:11px;background:#171b1e url('/build/hero/xiao-qwiic-co2-hero.png') center/cover no-repeat}.label{font:700 9px ui-monospace;color:#89949c;letter-spacing:.12em;margin-top:10px}.net{display:grid;grid-template-columns:9px 42px 1fr;gap:8px;align-items:center;padding-top:8px;font:600 9px ui-monospace}.dot{width:8px;height:8px;border-radius:50%}.copy{font-size:10px;line-height:1.5;color:#abb4bb}.links{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.links a{color:#c7d0d6;text-decoration:none;border:1px solid #303a42;border-radius:8px;padding:6px;font:700 8px ui-monospace}.steps{position:fixed;z-index:3;left:24px;bottom:22px;width:min(760px,calc(100vw - 400px));background:#0c1116eF;border:1px solid #29333b;border-radius:17px;padding:14px}.buttons{display:flex;gap:6px;flex-wrap:wrap}button{border:1px solid #34414a;background:#141b21;color:#bac4cb;border-radius:8px;padding:7px 9px;font:700 9px ui-monospace;cursor:pointer}button.active{background:#9ff5ce;color:#07110c}.stepTitle{font-size:13px;font-weight:750;margin-top:11px}.stepDesc{font-size:11px;line-height:1.45;color:#a7b0b7;margin-top:4px}.loading{position:fixed;inset:0;z-index:10;display:grid;place-items:center;background:#080b0e;font:700 11px ui-monospace;color:#9ff5ce}.loading.done{display:none}@media(max-width:920px){.side{display:none}.steps{width:calc(100vw - 40px);left:20px}}
  </style><script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script></head><body><div id="loading" class="loading">HASH-VERIFYING AWS GLBS…</div><div class="top"><div><div class="eyebrow">API-ONLY PRODUCTION SIMULATION</div><h1>Pocket CO₂ Climate Beacon</h1><div class="sub">XIAO ESP32C3 · SCD-41 · exact JST-SH Qwiic path</div></div><div class="pills"><div class="pill good">AWS GLBS</div><div class="pill good">NO BREADBOARD</div><div class="pill good">QWIIC EXACT</div><div class="pill warn">0 VISUAL PASSES</div></div></div><div class="side"><div class="card"><div class="hero"></div><div class="label">LOCKED NETS</div><div id="nets"></div></div><div class="card copy">The controller end uses four individual housed female sockets on real underside male pins. The sensor end is one keyed JST-SH 1.0 mm 4-pin Qwiic/STEMMA QT plug. Grove and USB-C are not wire endpoints.<div class="links"><a href="/build/PRODUCTION_WORKFLOW.md">WORKFLOW</a><a href="/build/production-trace.json">TRACE</a><a href="/build/firmware/xiao_qwiic_co2_beacon.ino">FIRMWARE</a><a href="/build/enclosure/stl/xiao-qwiic-co2-base.stl">BASE STL</a><a href="/build/enclosure/stl/xiao-qwiic-co2-lid.stl">LID STL</a><a href="/build/enclosure/stl/xiao-qwiic-co2-tray.stl">TRAY STL</a></div></div></div><div class="steps"><div id="buttons" class="buttons"></div><div id="stepTitle" class="stepTitle"></div><div id="stepDesc" class="stepDesc"></div></div><script type="module">
  import * as THREE from 'three';import{GLTFLoader}from'/vendor/GLTFLoader.js';import{OrbitControls}from'/vendor/OrbitControls.js';window.__GLTFLoader=GLTFLoader;
  const build=await(await fetch('/build/production-build.json')).json();const scene=new THREE.Scene();scene.background=new THREE.Color(0x080b0e);const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.001,10);camera.position.set(.11,.09,.12);const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;document.body.prepend(renderer.domElement);const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,.012);controls.enableDamping=true;scene.add(new THREE.HemisphereLight(0xffffff,0x28313a,2.4));const key=new THREE.DirectionalLight(0xffffff,4);key.position.set(.15,.12,.2);scene.add(key);const ground=new THREE.Mesh(new THREE.PlaneGeometry(.28,.2),new THREE.MeshStandardMaterial({color:0x10161b,roughness:.92}));ground.position.z=-.001;scene.add(ground);const loader=new GLTFLoader();let loaded=0;async function loadAsset(asset,addToScene=false){const response=await fetch(asset.assetUrl);if(!response.ok)throw new Error(asset.assetId+' HTTP '+response.status);const bytes=await response.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');if(hash!==asset.sha256)throw new Error(asset.assetId+' hash mismatch');const gltf=await new Promise((resolve,reject)=>loader.parse(bytes,'',resolve,reject));if(addToScene){gltf.scene.position.fromArray(asset.assembledPosition);gltf.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});scene.add(gltf.scene)}loaded++;return gltf}for(const part of build.parts)await loadAsset(part,true);const cableGltf=await loadAsset(build.cable,false);const cableNames=[];cableGltf.scene.traverse(object=>{if(object.name)cableNames.push(object.name)});document.body.dataset.cableNames=JSON.stringify(cableNames);
  function cableNode(name){const safeName=[...name].filter(character=>!['[',']','.',':','/'].includes(character)).join('');return cableGltf.scene.getObjectByName(name)||cableGltf.scene.getObjectByName(safeName)}function socketAssembly(signal){const body=cableNode('connector:socket:'+signal+':housing');const metal=cableNode('connector:socket:'+signal+':metal-sleeve');if(!body||!metal)throw new Error('Cable socket node missing for '+signal);const group=new THREE.Group();const origin=body.position.clone();for(const source of [body,metal]){const clone=source.clone();clone.position.sub(origin);group.add(clone)}return group}function plugAssembly(){const body=cableNode('connector:qwiic-jst-sh-1.0mm-4p:plug-body');const boot=cableNode('connector:qwiic-jst-sh-1.0mm-4p:rear-boot');if(!body||!boot)throw new Error('Cable Qwiic plug nodes missing');const group=new THREE.Group();const origin=body.position.clone();for(const source of [body,boot]){const clone=source.clone();clone.position.sub(origin);group.add(clone)}return group}
  const wireGroup=new THREE.Group();scene.add(wireGroup);const geometryById=new Map(build.routeGeometry.map(route=>[route.wireId,route]));const signalKey={'GND':'gnd','3V3':'3v3','SDA':'sda','SCL':'scl'};for(const wire of build.connections){const geometry=geometryById.get(wire.id);if(geometry.loopCount!==0||geometry.selfIntersectionCount!==0)throw new Error('Forbidden loop geometry for '+wire.id);const assembly=new THREE.Group();assembly.userData.wireId=wire.id;const path=new THREE.CurvePath();for(const segment of geometry.curves)path.add(new THREE.CubicBezierCurve3(new THREE.Vector3(...segment.p0),new THREE.Vector3(...segment.p1),new THREE.Vector3(...segment.p2),new THREE.Vector3(...segment.p3)));const tube=new THREE.Mesh(new THREE.TubeGeometry(path,Math.max(72,geometry.curves.length*24),.00055,8,false),new THREE.MeshStandardMaterial({color:wire.color,roughness:.72}));assembly.add(tube);const socket=socketAssembly(signalKey[wire.signal]);socket.position.fromArray(geometry.sourceSleeveCenter);socket.quaternion.setFromUnitVectors(new THREE.Vector3(-1,0,0),new THREE.Vector3(...wire.from.normal));assembly.add(socket);wireGroup.add(assembly)}const firstGeometry=build.routeGeometry[0];const plug=plugAssembly();plug.position.fromArray(firstGeometry.targetPlugCenter);plug.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),new THREE.Vector3(...build.connections[0].to.normal));scene.add(plug);const nets=document.querySelector('#nets');for(const wire of build.connections){const row=document.createElement('div');row.className='net';row.innerHTML='<i class="dot" style="background:'+wire.color+'"></i><b>'+wire.signal+'</b><span>'+wire.from.physicalPinLabel+' → CONN4 · open no-loop bend</span>';nets.append(row)}
  const buttons=document.querySelector('#buttons');let active=build.steps.length-1;function show(index){active=index;[...buttons.children].forEach((b,i)=>b.classList.toggle('active',i===index));document.querySelector('#stepTitle').textContent=build.steps[index].title;document.querySelector('#stepDesc').textContent=build.steps[index].description;const ids=new Set(build.steps[index].activeWires);wireGroup.children.forEach(group=>{const opacity=ids.size&&ids.has(group.userData.wireId)?1:.22;group.traverse(o=>{if(o.material){o.material=o.material.clone();o.material.opacity=opacity;o.material.transparent=true}})})}build.steps.forEach((step,i)=>{const b=document.createElement('button');b.textContent=(i+1)+' '+step.title;b.onclick=()=>show(i);buttons.append(b)});show(active);document.querySelector('#loading').classList.add('done');const reviewState={ready:true,buildId:build.buildId,loadedAssetCount:loaded,wireCount:build.connections.length,breadboardCount:0,visualPasses:0,cableAssetId:build.cable.assetId};document.body.dataset.reviewState=JSON.stringify(reviewState);window.__xiaoQwiicReview={...reviewState,getState:()=>({active,loadedAssetCount:loaded,wireCount:build.connections.length,cableAssetId:build.cable.assetId})};function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera)}animate();addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
  </script></body></html>`;
}

function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) for (const content of item?.content || []) if (content?.type === "output_text") return content.text;
  throw new Error("Responses API returned no output text");
}
function openAIUrl(pathname) { return `${String(env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, "")}${pathname}`; }
function openAIHeaders() { return { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" }; }
function readEnv(file) {
  const result = {};
  try { for (const raw of globalThis.process.getBuiltinModule("fs").readFileSync(file, "utf8").split(/\r?\n/)) { const line = raw.trim(); if (!line || line.startsWith("#")) continue; const split = line.indexOf("="); if (split < 1) continue; result[line.slice(0, split).trim()] = line.slice(split + 1).trim().replace(/^(['"])(.*)\1$/, "$2"); } } catch {}
  return result;
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function world(offset, local) { return local.map((value, index) => Number((value + offset[index]).toFixed(7))); }
function round(value) { return Math.round(value * 10) / 10; }
