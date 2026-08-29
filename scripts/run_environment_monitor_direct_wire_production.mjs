#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  DIRECT_WIRE_BUILD_ID,
  DIRECT_WIRE_CONNECTIONS,
  DIRECT_WIRE_PARTS,
  DIRECT_WIRE_POLICY,
  DIRECT_WIRE_STEPS,
  assertDirectWireContract,
} from "../lib/environment-monitor-direct-wire-contract.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "artifacts/environment-monitor-c3/2026-08-28-direct-wire-v2");
const HERO_DIR = path.join(OUT, "hero");
const env = { ...readEnv(path.join(ROOT, ".env")), ...process.env };
const config = Object.freeze({
  buildModel: "gpt-5.6-terra",
  wiringModel: "gpt-5.6-sol",
  heroDirectorModel: "gpt-5.6-sol",
  imageModel: "gpt-image-2",
  imageQuality: "high",
  imageSize: "1536x1024",
});

if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for the production simulation.");
assertDirectWireContract();
await mkdir(HERO_DIR, { recursive: true });

const started = performance.now();
const startedAt = new Date();
const timeline = [];
const event = (name, details = {}) => {
  const elapsedMs = round(performance.now() - started);
  timeline.push({ sequence: timeline.length + 1, name, elapsedMs, at: new Date(startedAt.getTime() + elapsedMs).toISOString(), ...details });
};

event("request_received", { buildId: DIRECT_WIRE_BUILD_ID });
event("connector_policy_locked", {
  breadboardAllowed: false,
  quickConnectorsAllowed: false,
  termination: "individual_1p_female_dupont_at_both_ends",
  wireCount: DIRECT_WIRE_CONNECTIONS.length,
});

event("terra_planning_started", { model: config.buildModel });
const plan = await responsesJson({
  model: config.buildModel,
  effort: "high",
  name: "direct_wire_environment_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "summary", "behavior", "safetyGates"],
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      behavior: { type: "string" },
      safetyGates: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
    },
  },
  developer: "You are Makeable's production build planner. The BOM, connector type, pins, and wire inventory are immutable. Describe the useful build and its safety gates; never substitute parts or invent a connector.",
  user: JSON.stringify({
    request: "Build a compact indoor environment monitor using the exact locked AWS kit.",
    exactParts: DIRECT_WIRE_PARTS.map(({ assetId, label, connectionType, selectionStatus }) => ({ assetId, label, connectionType, selectionStatus })),
    exactConnections: DIRECT_WIRE_CONNECTIONS,
    policy: DIRECT_WIRE_POLICY,
  }),
});
event("terra_planning_completed", { model: config.buildModel });

event("parallel_asset_and_sol_branches_started");
const glbPromise = verifyAwsAssets();
const routingPromise = createRoutingPlan();
const heroPromptPromise = createHeroPrompt(plan);
const [delivery, routing, heroPrompt] = await Promise.all([glbPromise, routingPromise, heroPromptPromise]);
event("parallel_asset_and_sol_branches_completed", {
  remoteGlbCount: delivery.length,
  routedWireCount: routing.length,
  heroPromptSha256: sha256(Buffer.from(heroPrompt)),
});

validateRouting(routing);
validateHeroPrompt(heroPrompt);
await writeFile(path.join(HERO_DIR, "hero-prompt.txt"), `${heroPrompt}\n`, "utf8");

event("image_generation_started", { model: config.imageModel, quality: config.imageQuality, size: config.imageSize, attempt: 1 });
const image = await imageGeneration(heroPrompt);
const heroPath = path.join(HERO_DIR, "environment-monitor-direct-wire-hero-v2.png");
await writeFile(heroPath, image.bytes);
const heroSha256 = sha256(image.bytes);
event("image_generation_completed", {
  model: config.imageModel,
  attempts: 1,
  humanVisualPasses: 0,
  heroSha256,
  bytes: image.bytes.length,
});

const build = {
  schemaVersion: "MakeableDirectWireProductionSimulationV2",
  buildId: DIRECT_WIRE_BUILD_ID,
  generatedAt: new Date().toISOString(),
  models: config,
  plan,
  parts: DIRECT_WIRE_PARTS,
  connections: DIRECT_WIRE_CONNECTIONS,
  routing,
  steps: DIRECT_WIRE_STEPS,
  policy: DIRECT_WIRE_POLICY,
  delivery,
  hero: {
    path: path.relative(ROOT, heroPath),
    sha256: heroSha256,
    bytes: image.bytes.length,
    promptPath: path.relative(ROOT, path.join(HERO_DIR, "hero-prompt.txt")),
    promptSha256: sha256(Buffer.from(heroPrompt)),
    generationAttempts: 1,
    humanVisualPasses: 0,
  },
};

event("build_contract_written");
await writeFile(path.join(OUT, "production-build.json"), `${JSON.stringify(build, null, 2)}\n`, "utf8");
event("response_ready", { totalMs: round(performance.now() - started) });
await writeFile(path.join(OUT, "production-trace.json"), `${JSON.stringify({ ...build, timeline }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  buildId: build.buildId,
  hero: build.hero,
  remoteGlbCount: delivery.length,
  routedWireCount: routing.length,
  models: config,
  totalMs: timeline.at(-1).totalMs,
  timeline,
}, null, 2));

async function createRoutingPlan() {
  event("sol_wiring_started", { model: config.wiringModel, immutableEndpoints: true });
  const response = await responsesJson({
    model: config.wiringModel,
    effort: "high",
    name: "direct_wire_routing",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["wires"],
      properties: {
        wires: {
          type: "array",
          minItems: 11,
          maxItems: 11,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "lane", "bowDirection", "bowHeightMm"],
            properties: {
              id: { type: "string" },
              lane: { type: "integer", minimum: -5, maximum: 5 },
              bowDirection: { type: "string", enum: ["left", "right"] },
              bowHeightMm: { type: "number", minimum: 4, maximum: 7 },
            },
          },
        },
      },
    },
    developer: "You are Makeable's visual wire-routing planner. Endpoints, electrical meaning, connector type, and wire inventory are immutable. Return one shallow natural bow per wire with readable separation. You may choose only lane, left/right bow direction, and 4-7 mm bow height.",
    user: JSON.stringify({
      assembly: "ESP32-C3 Super Mini seated in its exact AITRIP carrier; BME280 left, BH1750 center, microphone right",
      rules: [
        "Every endpoint is one individual male pin covered by one individual 1P female Dupont housing.",
        "No Qwiic, Grove, STEMMA, JST, grouped connector, breadboard, hidden junction, or shared physical plug.",
        "Keep all eleven wires individually traceable with shallow realistic arches and no crossings.",
      ],
      wires: DIRECT_WIRE_CONNECTIONS,
    }),
  });
  event("sol_wiring_completed", { model: config.wiringModel, returnedWireCount: response.wires.length });
  return response.wires;
}

async function createHeroPrompt(plan) {
  event("sol_hero_direction_started", { model: config.heroDirectorModel });
  const currentMakeablePrompt = [
    "Create one physically credible project-documentation photograph of a beginner-buildable Makeable electronics project. It must look like a real, carefully assembled prototype photographed in a product studio, not an AI concept render.",
    "Show one complete finished prototype only. Never show an exploded view, cutaway, assembly diagram, infographic, floating part, open shell, detached lid, duplicated product, or text label.",
    "Use a natural eye-level three-quarter documentation angle that reveals the primary sensor face and a non-connector side while the rear USB-C service opening remains unseen.",
    "The enclosure is a compact purpose-built indoor environmental monitor with disciplined radii, one honest snap-fit seam, subtle FDM layer texture at correct scale, and no screws or visible fasteners.",
    "The exterior has exactly three functional apertures: a horizontal slotted airflow vent for BME280, a small flush circular light window for BH1750, and a perforated circular acoustic grille for the microphone. No display, button, camera, decorative port, logo, or readable text.",
    "Use a mature industrial-design studio setting: restrained warm-gray to charcoal seamless architectural cyclorama, a large diffused key, controlled rim light, neutral color balance, precise natural contact shadow, clean negative space, and no workshop or lifestyle clutter.",
    "Use matte warm-gray structural plastic, a dark graphite service seam/base, and one restrained muted coral detail tied to the acoustic grille. Avoid candy colors, toy styling, synthetic CGI gloss, neon sci-fi lighting, fake words, warped geometry, or generic consumer-electronics branding.",
    "The exact internal AWS kit is ESP32-C3 Super Mini seated in its AITRIP carrier, GY-BME280, GY-302/BH1750, and microphone/sound detector. Keep the housing opaque so the image model cannot invent visible connectors or wiring. Internal wiring is documented by the separate GLB assembly guide, not the hero.",
    "The product envelope is approximately 78 mm wide by 105 mm tall by 30 mm deep, driven by the exact component layout and sensor keepouts.",
  ].join("\n");
  const response = await responsesJson({
    model: config.heroDirectorModel,
    effort: "high",
    name: "direct_wire_hero_prompt",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["imagePrompt"],
      properties: { imagePrompt: { type: "string", minLength: 500, maxLength: 3000 } },
    },
    developer: "You are Makeable's production hero art director. Rewrite the supplied locked direction into one dense prompt for gpt-image-2. Preserve every constraint. Return only the schema. Do not propose variants or a correction pass.",
    user: JSON.stringify({ plan, lockedDirection: currentMakeablePrompt, policy: DIRECT_WIRE_POLICY }),
  });
  const finalPrompt = `${response.imagePrompt}\n\nNON-NEGOTIABLE PRODUCTION OVERRIDE:\n${currentMakeablePrompt}`;
  event("sol_hero_direction_completed", { model: config.heroDirectorModel, promptChars: finalPrompt.length });
  return finalPrompt;
}

async function verifyAwsAssets() {
  event("aws_glb_verification_started", { assetCount: DIRECT_WIRE_PARTS.length });
  const rows = await Promise.all(DIRECT_WIRE_PARTS.map(async (part) => {
    const fetchStarted = performance.now();
    const response = await fetch(part.assetUrl, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`${part.assetId} returned HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actualHash = sha256(bytes);
    if (actualHash !== part.sha256) throw new Error(`${part.assetId} SHA-256 mismatch`);
    return {
      assetId: part.assetId,
      url: part.assetUrl,
      sha256: actualHash,
      bytes: bytes.length,
      contentType: response.headers.get("content-type"),
      fetchMs: round(performance.now() - fetchStarted),
      source: "aws_cloudfront_memory_only",
    };
  }));
  event("aws_glb_verification_completed", { assetCount: rows.length, totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0) });
  return rows;
}

async function responsesJson({ model, effort, name, schema, developer, user }) {
  const response = await fetch(openAIUrl("/v1/responses"), {
    method: "POST",
    headers: openAIHeaders(),
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model,
      reasoning: { effort },
      service_tier: "priority",
      input: [{ role: "developer", content: developer }, { role: "user", content: user }],
      text: { format: { type: "json_schema", name, strict: true, schema } },
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `${model} response failed`);
  return JSON.parse(outputText(payload));
}

async function imageGeneration(prompt) {
  const response = await fetch(openAIUrl("/v1/images/generations"), {
    method: "POST",
    headers: openAIHeaders(),
    signal: AbortSignal.timeout(360_000),
    body: JSON.stringify({ model: config.imageModel, prompt, n: 1, size: config.imageSize, quality: config.imageQuality }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Image generation failed");
  if (!payload?.data?.[0]?.b64_json) throw new Error("Image API returned no base64 image");
  return { bytes: Buffer.from(payload.data[0].b64_json, "base64") };
}

function validateRouting(routing) {
  const expected = new Set(DIRECT_WIRE_CONNECTIONS.map((wire) => wire.id));
  if (routing.length !== expected.size) throw new Error("Sol routing returned the wrong wire count");
  for (const row of routing) {
    if (!expected.delete(row.id)) throw new Error(`Sol routing returned unknown or duplicate wire ${row.id}`);
    if (!Number.isFinite(row.bowHeightMm) || row.bowHeightMm < 4 || row.bowHeightMm > 7) throw new Error(`Invalid bow for ${row.id}`);
  }
  if (expected.size) throw new Error(`Sol routing omitted ${[...expected].join(", ")}`);
}

function validateHeroPrompt(prompt) {
  const required = ["complete", "prototype", "Never show an exploded view", "BME280", "BH1750", "microphone", "opaque"];
  for (const term of required) if (!prompt.includes(term)) throw new Error(`Hero prompt missing locked term: ${term}`);
}

function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) for (const content of item?.content || []) if (content?.type === "output_text") return content.text;
  throw new Error("Responses API returned no output text");
}

function openAIUrl(pathname) {
  return `${String(env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, "")}${pathname}`;
}

function openAIHeaders() {
  return { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" };
}

function readEnv(file) {
  const result = {};
  try {
    const source = requireText(file);
    for (const raw of source.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const split = line.indexOf("=");
      if (split < 1) continue;
      result[line.slice(0, split).trim()] = line.slice(split + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch {}
  return result;
}

function requireText(file) {
  return globalThis.process.getBuiltinModule("fs").readFileSync(file, "utf8");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function round(value) {
  return Math.round(value * 10) / 10;
}
