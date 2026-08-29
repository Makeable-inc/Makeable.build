#!/usr/bin/env node

import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { createAwsProductionArtifacts } from "../lib/aws-production-assembly.mjs";
import { createBuild, verifiedPartsCatalog } from "../lib/makeable-builds.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...readEnv(path.join(ROOT, ".env")), ...process.env };
const productionEnv = {
  ...env,
  // The local benchmark deliberately pins the two reasoning roles requested
  // by the user. The API key remains server-only and is never sent to the UI.
  OPENAI_BUILD_MODEL: "gpt-5.6-terra",
  OPENAI_WIRING_MODEL: "gpt-5.6-sol",
  OPENAI_HERO_ART_DIRECTOR_MODEL: "gpt-5.6-sol",
  OPENAI_IMAGE_MODEL: "gpt-image-2",
  OPENAI_IMAGE_QUALITY: "high",
};
const port = Math.max(1, Number(env.MAKEABLE_SIMULATION_PORT || 8790));
const builds = new Map();
let latestBuildId = "";
let activeRequest = null;

const PLANT_PILOT_PART_IDS = Object.freeze([
  "b0bc29d9qg-11",
  "b0dyvcttcd-83",
  "b00xw2ofww-106",
  "b0dydn9rg4-87",
]);
const plantPilotParts = (() => {
  const byId = new Map(verifiedPartsCatalog().map((part) => [part.id, part]));
  const parts = PLANT_PILOT_PART_IDS.map((id) => byId.get(id));
  if (parts.some((part) => !part)) throw new Error("Plant pilot BOM is missing a verified catalog part.");
  return Object.freeze(parts);
})();

const server = createServer(async (request, response) => {
  applyCors(response);
  if (request.method === "OPTIONS") return sendJson(response, {}, 204);
  const url = new URL(request.url || "/", `http://${request.headers.host || `127.0.0.1:${port}`}`);
  try {
    if (url.pathname === "/api/health" && request.method === "GET") {
      return sendJson(response, {
        ok: true,
        hasOpenAIKey: Boolean(env.OPENAI_API_KEY),
        modelOrigin: "https://dvy6bet209exg.cloudfront.net",
        localModelStorage: false,
        active: Boolean(activeRequest),
      });
    }
    if (url.pathname === "/api/production-simulations" && request.method === "POST") {
      if (activeRequest) return sendJson(response, { error: "A benchmark request is already running." }, 409);
      const body = await readJson(request);
      activeRequest = runSimulation(body?.idea || "");
      const result = await activeRequest;
      activeRequest = null;
      return sendJson(response, result.body, result.status);
    }
    if (url.pathname === "/api/production-simulations/latest" && request.method === "GET") {
      const build = latestBuildId ? builds.get(latestBuildId) : null;
      return build
        ? sendJson(response, { build })
        : sendJson(response, { error: "No production simulation has completed yet." }, 404);
    }
    const match = url.pathname.match(/^\/api\/production-simulations\/([a-z0-9-]+)$/i);
    if (match && request.method === "GET") {
      const build = builds.get(match[1]);
      return build
        ? sendJson(response, { build })
        : sendJson(response, { error: "Production simulation not found." }, 404);
    }
    return sendJson(response, { error: "Not found" }, 404);
  } catch (error) {
    activeRequest = null;
    console.error(error);
    return sendJson(response, { error: String(error?.message || error) }, 500);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`AWS-only Makeable simulation API listening at http://127.0.0.1:${port}`);
});

async function runSimulation(idea) {
  const startedAt = performance.now();
  const startedWallClock = Date.now();
  const timeline = [];
  const event = async (name, details = {}) => {
    const elapsedMs = roundMs(performance.now() - startedAt);
    timeline.push({
      ...details,
      sequence: timeline.length + 1,
      name,
      at: new Date(startedWallClock + elapsedMs).toISOString(),
      elapsedMs,
      branch: branchFor(name),
    });
  };

  await event("request_received", { method: "POST", path: "/api/production-simulations" });
  if (typeof idea !== "string" || idea.trim().length < 12 || idea.trim().length > 2_000) {
    await event("request_rejected", { reason: "invalid_idea" });
    return { status: 400, body: { error: "Provide a project idea between 12 and 2,000 characters.", timeline } };
  }
  await event("request_body_validated", { ideaLength: idea.trim().length });
  await event("auth_context_resolved", { mode: "anonymous-production-simulation" });

  let capturedBuild = null;
  const store = {
    async save(build) {
      await event("persistence_write_started", { backend: "in-memory-simulation-store" });
      capturedBuild = build;
      await event("persistence_write_completed", { backend: "in-memory-simulation-store" });
      return build;
    },
  };
  const result = await createBuild(
    { idea: idea.trim() },
    {
      env: productionEnv,
      store,
      fetchFn: fetch,
      allowAnonymous: true,
      finalizeSelectedParts: exactPlantPilotParts,
      refineImagePrompt: createAssemblyAwareHeroPrompt,
      onPhase: async (phase) => event(`phase_${phase}`),
      onEvent: event,
      generateArtifacts: async ({ parts, fetchFn, onEvent }) => createAwsProductionArtifacts({
        parts,
        env: productionEnv,
        fetchFn,
        onEvent,
        assemblyApiOrigin: env.MAKEABLE_ASSEMBLY_API_ORIGIN || "http://127.0.0.1:8787",
      }),
    },
  );
  if (result.status !== 201 || !capturedBuild) {
    await event("build_failed", { status: result.status });
    return { status: result.status, body: { ...result.body, timeline } };
  }
  await event("response_ready", { buildId: result.body.id });
  const metrics = summarizeTimeline(timeline, result.body);
  const finalBuild = {
    ...result.body,
    artifacts: {
      ...result.body.artifacts,
      pipeline: {
        schemaVersion: "MakeableProductionTimelineV1",
        requestIdea: idea.trim(),
        timeline,
        metrics,
      },
    },
  };
  builds.set(finalBuild.id, finalBuild);
  latestBuildId = finalBuild.id;
  console.log(JSON.stringify({
    buildId: finalBuild.id,
    title: finalBuild.title,
    metrics,
    selectedParts: finalBuild.parts.map((part) => ({ id: part.id, name: part.name })),
    delivery: finalBuild.artifacts.delivery,
  }, null, 2));
  return { status: 201, body: { build: finalBuild } };
}

function exactPlantPilotParts(_parts, context) {
  const text = String(context?.idea || "").toLowerCase();
  if (!/plant|soil|moisture|scd-?41|tsl2591/.test(text)) return _parts;
  // This benchmark represents one real, locked four-part kit. Terra chooses
  // project intent; it does not get to replace an exact catalog-bound GLB with
  // a generic same-function alternative after the kit has been requested.
  if (context?.plan) {
    context.plan.title = "Direct-Wired Plant Companion";
    context.plan.summary = "A breadboard-free ESP32 plant monitor using a SparkFun Thing Plus, an external capacitive soil probe, and keyed Qwiic SCD-41 and TSL2591 sensors.";
    context.plan.behavior = "Read soil moisture on GPIO26/A0 and read CO2, temperature, humidity, and ambient light over the native GPIO21/GPIO22 Qwiic bus. Report the readings over Wi-Fi while keeping every electrical connection on a verified pin or keyed connector contact.";
    context.plan.visibleHardwareCues = [
      "external DIYables TLC555I soil-sensing blade and its three-wire factory lead",
      "SparkFun Thing Plus ESP32 WROOM with native Qwiic connector",
      "Adafruit SCD-41 and TSL2591 boards joined by keyed Qwiic/STEMMA QT cables",
      "no breadboard, hidden power rail, or invented electrical junction",
    ];
  }
  return plantPilotParts.map((part) => structuredClone(part));
}

async function createAssemblyAwareHeroPrompt({ idea, parts, imagePrompt, env: requestEnv, fetchFn, onEvent }) {
  const model = String(requestEnv.OPENAI_HERO_ART_DIRECTOR_MODEL || "gpt-5.6-sol").trim();
  const deterministicPrompt = `${imagePrompt}\n\nNon-negotiable exact physical kit, all visible in the final product image: ${parts.map((part) => part.name).join("; ")}. Show the DIYables capacitive soil-moisture sensor's component head and long sensing blade outside the enclosure, with its factory three-wire cable entering a strain-relieved side port and landing directly on the Thing Plus 3V3, GND, and A0 pins. Inside the compact enclosure, visibly include the SparkFun Thing Plus ESP32 WROOM, Adafruit SCD-41, and Adafruit TSL2591. Daisy-chain the two sensor boards with keyed four-conductor Qwiic/STEMMA QT cables. Use distinct red (3V3), black (GND), blue (SDA), yellow (SCL), and green (soil analog) conductors. Breadboards, hidden power rails, invented junctions, and generic substitute boards are prohibited.`;
  if (!requestEnv.OPENAI_API_KEY) return deterministicPrompt;

  await onEvent?.("hero_art_direction_started", { model, reasoning: "high", partCount: parts.length });
  try {
    const response = await fetchFn(openAIEndpoint(requestEnv, "/v1/responses"), {
      method: "POST",
      headers: openAIHeaders(requestEnv),
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model,
        reasoning: { effort: "high" },
        input: [
          {
            role: "developer",
            content: [
              "You are the visual art director for an electronics assembly product photograph.",
              "Write one concise but dense prompt for gpt-image-2. It must show every exact supplied part, including the external soil blade and cable, without inventing alternate boards or wiring.",
              "Favor an honest, photorealistic 3/4 product shot with the enclosure partly open enough to show the keyed Qwiic plugs and the three direct soil-probe pin connections. The conductors must look like realistic thin factory cable or silicone jumper wire with shallow natural bends, not plumbing pipes or decorative loops.",
              "Do not make a collage, technical diagram, brand-logo imitation, text-heavy poster, or exploded view. Preserve port, display, cable exit, and sensor-window placement plausibly.",
              "Return only JSON matching the provided schema.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              idea,
              currentPrompt: imagePrompt,
              exactParts: parts.map((part) => ({ id: part.id, name: part.name, connection: part.connectionType })),
              mandatoryVisualDetails: [
                "DIYables TLC555I component head plus long external soil-sensing blade",
                "three-wire soil cable through strain-relieved enclosure port",
                "SparkFun Thing Plus ESP32 WROOM controller with native Qwiic socket",
                "no breadboard; only direct labeled pins and keyed Qwiic/STEMMA QT connectors",
                "Adafruit SCD-41 and TSL2591 boards daisy-chained by two keyed cables",
                "red, black, blue, and yellow Qwiic conductors plus the green soil analog lead",
              ],
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "makeable_assembly_hero_brief",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["imagePrompt"],
              properties: {
                imagePrompt: { type: "string", minLength: 160, maxLength: 3000 },
              },
            },
          },
        },
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || "Hero art-direction request failed.");
    const generated = JSON.parse(openAIOutputText(payload)).imagePrompt;
    if (typeof generated !== "string" || generated.length < 120) throw new Error("Hero art director returned an incomplete prompt.");
    await onEvent?.("hero_art_direction_completed", { model, accepted: true, promptChars: generated.length });
    // Prepend the non-negotiable kit context after the model's art direction so
    // the image endpoint always receives the exact physical requirements.
    return `${generated}\n\n${deterministicPrompt}`;
  } catch (error) {
    await onEvent?.("hero_art_direction_fallback", { model, reason: String(error?.message || error).slice(0, 180) });
    return deterministicPrompt;
  }
}

function openAIEndpoint(requestEnv, pathname) {
  const base = String(requestEnv.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, "");
  return `${base}${pathname}`;
}

function openAIHeaders(requestEnv) {
  return {
    Authorization: `Bearer ${requestEnv.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function openAIOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content?.text === "string") return content.text;
    }
  }
  throw new Error("OpenAI response had no output text.");
}

function summarizeTimeline(timeline, build) {
  const at = (name) => timeline.find((entry) => entry.name === name)?.elapsedMs;
  const duration = (start, end) => {
    const from = at(start);
    const to = at(end);
    return Number.isFinite(from) && Number.isFinite(to) ? roundMs(to - from) : null;
  };
  const imageStart = at("image_generation_started");
  const imageEnd = at("image_generation_completed");
  const artifactStart = at("artifact_generation_started");
  const artifactEnd = at("artifact_generation_completed");
  const overlapMs = [imageStart, imageEnd, artifactStart, artifactEnd].every(Number.isFinite)
    ? roundMs(Math.max(0, Math.min(imageEnd, artifactEnd) - Math.max(imageStart, artifactStart)))
    : null;
  const totalMs = at("response_ready") || timeline.at(-1)?.elapsedMs || 0;
  return {
    totalMs,
    requestValidationMs: duration("request_received", "auth_context_resolved"),
    planningMs: duration("planning_started", "planning_completed"),
    partFittingMs: duration("phase_fitting_parts", "parts_fitted"),
    imageGenerationMs: duration("image_generation_started", "image_generation_completed"),
    awsAssemblyBranchMs: duration("artifact_generation_started", "artifact_generation_completed"),
    modelFetchWindowMs: duration("aws_models_fetch_started", "aws_models_fetch_completed"),
    persistenceMs: duration("persistence_write_started", "persistence_write_completed"),
    parallelOverlapMs: overlapMs,
    criticalParallelBranch: Number(imageEnd - imageStart) >= Number(artifactEnd - artifactStart)
      ? "hero_image"
      : "aws_assembly",
    selectedPartCount: Array.isArray(build.parts) ? build.parts.length : 0,
    remoteGlbCount: build.artifacts?.delivery?.modelFetches?.length || 0,
    remoteGlbBytes: build.artifacts?.delivery?.totalModelBytes || 0,
    generatedGlbCount: build.artifacts?.delivery?.generatedModelCount ?? null,
    localGlbRequests: build.artifacts?.delivery?.localModelRequests ?? null,
    localGlbBytes: build.artifacts?.delivery?.localModelBytes ?? null,
    wiringCount: build.artifacts?.wiring?.wireCount || 0,
    assemblyStepCount: build.artifacts?.assembly?.steps?.length || 0,
    firmwareSourceBytes: Buffer.byteLength(build.artifacts?.firmware?.source || "", "utf8"),
  };
}

function branchFor(name) {
  if (name.startsWith("image_")) return "hero_image";
  if (name.startsWith("aws_") || name.startsWith("assembly_")
    || name.startsWith("wiring_") || name.startsWith("firmware_")
    || name.startsWith("artifact_")) return "aws_assembly";
  if (name.startsWith("planning") || name.startsWith("parts_") || name.startsWith("phase_")) return "planning";
  if (name.startsWith("persistence_")) return "persistence";
  return "request";
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 16 * 1024) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function readEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const output = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    output[key] = value;
  }
  return output;
}

function applyCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:3001");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response, value, status = 200) {
  const body = status === 204 ? "" : JSON.stringify(value);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function roundMs(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}
