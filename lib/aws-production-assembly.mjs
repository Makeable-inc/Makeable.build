import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { assertDirectWiring, BREADBOARD_POLICY } from "./assembly-policy.mjs";

export const APPROVED_ASSET_ORIGIN = "https://dvy6bet209exg.cloudfront.net";
export const APPROVED_REGISTRY_POINTER = `${APPROVED_ASSET_ORIGIN}/v1/approved-visual-catalog-v1/current.json`;

const PROFILE_BUILD_ID = "plant-companion-v1";
const PROFILE_ASSET_IDS = new Set([
  "thing-plus-esp32",
  "adafruit-scd41-co2-breakout-5190",
  "adafruit-tsl2591-hdr-light-breakout-1980",
  "diyables-capacitive-soil-moisture-tlc555i",
]);

const DEFAULT_WIRING_ASSEMBLY_MODEL = "gpt-5.6-sol";

export async function createAwsProductionArtifacts(options = {}) {
  const fetchFn = options.fetchFn || fetch;
  const onEvent = options.onEvent;
  const env = options.env || process.env;
  const assemblyApiOrigin = normalizeAssemblyApiOrigin(
    options.assemblyApiOrigin || process.env.MAKEABLE_ASSEMBLY_API_ORIGIN || "http://127.0.0.1:8787",
  );

  await onEvent?.("aws_registry_request_started", { url: APPROVED_REGISTRY_POINTER });
  const [pointerResult, contractResult] = await Promise.all([
    fetchBytes(APPROVED_REGISTRY_POINTER, fetchFn),
    fetchJson(`${assemblyApiOrigin}/api/builds/${PROFILE_BUILD_ID}/assembly`, fetchFn),
  ]);
  const pointer = parseJson(pointerResult.bytes, "AWS registry pointer");
  assertHttpsCloudFrontUrl(pointer.manifestUrl, "registry manifest");
  assertSha256(pointer.manifestSha256, "registry manifest");

  const manifestResult = await fetchBytes(pointer.manifestUrl, fetchFn);
  const manifestHash = sha256(manifestResult.bytes);
  if (manifestHash !== pointer.manifestSha256) {
    throw new Error(`AWS registry manifest hash mismatch: expected ${pointer.manifestSha256}, got ${manifestHash}`);
  }
  const manifest = parseJson(manifestResult.bytes, "AWS registry manifest");
  const activeAssets = new Map(
    (Array.isArray(manifest.assets) ? manifest.assets : []).map((asset) => [asset.partId, asset]),
  );
  await onEvent?.("aws_registry_resolved", {
    revision: manifest.revision || pointer.revision || "",
    assetCount: activeAssets.size,
    registryMs: roundMs(pointerResult.elapsedMs + manifestResult.elapsedMs),
  });

  const contract = normalizeContract(contractResult.value);
  const selectedAssetIds = new Set(
    (Array.isArray(options.parts) ? options.parts : [])
      .flatMap((part) => Array.isArray(part?.assemblyAssets) ? part.assemblyAssets : [])
      .filter((asset) => asset?.ready)
      .map((asset) => asset.partId),
  );
  const requiredAssets = contract.requiredAssets.map((asset) => {
    const active = activeAssets.get(asset.id);
    if (!active || !PROFILE_ASSET_IDS.has(asset.id)) return normalizeRequiredAsset(asset);
    return normalizeRequiredAsset({
      ...asset,
      url: active.url,
      sha256: active.sha256,
      revision: active.revision,
      eligibility: "ready",
      registryRevision: manifest.revision,
    });
  });
  const requiredById = new Map(requiredAssets.map((asset) => [asset.id, asset]));
  const parts = contract.parts.map((part) => {
    const required = requiredById.get(part.assetId);
    if (!required) return part;
    return {
      ...part,
      assetUrl: `${required.url}?v=${required.sha256.slice(0, 16)}`,
      assetRevision: required.revision,
    };
  });
  const verifiedContract = {
    ...contract,
    contractRevision: `${contract.contractRevision || PROFILE_BUILD_ID}-aws-only-simulation-v1`,
    requiredAssets,
    requiredAssetRevisions: Object.fromEntries(
      requiredAssets.map((asset) => [asset.id, asset.revision]),
    ),
    parts,
    state: "ready",
    missingEvidence: [],
    blockedReasons: [],
    assetOrigin: APPROVED_ASSET_ORIGIN,
  };
  const seated = validateDirectConnectedParts(assertDirectWiring(verifiedContract));
  const presentationPromise = planWiringAndAssemblyPresentation({
    contract: seated.contract,
    env,
    fetchFn,
    onEvent,
  });
  await onEvent?.("aws_models_fetch_started", { assetCount: requiredAssets.length });
  const modelFetchesPromise = Promise.all(requiredAssets.map(async (asset) => {
    assertHttpsCloudFrontUrl(asset.url, `asset ${asset.id}`);
    assertSha256(asset.sha256, `asset ${asset.id}`);
    const result = await fetchBytes(asset.url, fetchFn, {
      headers: { Origin: "http://127.0.0.1:3001" },
    });
    const actualHash = sha256(result.bytes);
    const contentType = result.response.headers.get("content-type") || "";
    if (actualHash !== asset.sha256) {
      throw new Error(`AWS GLB hash mismatch for ${asset.id}: expected ${asset.sha256}, got ${actualHash}`);
    }
    if (!contentType.toLowerCase().includes("model/gltf-binary")) {
      throw new Error(`AWS object for ${asset.id} is not a GLB (${contentType || "missing content type"})`);
    }
    const glb = parseGlbJson(result.bytes, asset.id);
    const anchorNodeCount = (glb.nodes || []).filter((node) => /^(?:anchor:|interface:)/.test(node?.name || "")).length;
    const metric = {
      assetId: asset.id,
      url: asset.url,
      sha256: actualHash,
      bytes: result.bytes.length,
      elapsedMs: roundMs(result.elapsedMs),
      contentType,
      cors: result.response.headers.get("access-control-allow-origin") || "",
      anchorNodeCount,
    };
    await onEvent?.("aws_model_verified", metric);
    return metric;
  }));
  const reportedModelFetches = modelFetchesPromise.then(async (modelFetches) => {
    const totalBytes = modelFetches.reduce((sum, entry) => sum + entry.bytes, 0);
    const slowestModelMs = Math.max(0, ...modelFetches.map((entry) => entry.elapsedMs));
    await onEvent?.("aws_models_fetch_completed", {
      assetCount: modelFetches.length,
      totalBytes,
      slowestModelMs,
    });
    return modelFetches;
  });
  const [presentation, modelFetches] = await Promise.all([presentationPromise, reportedModelFetches]);
  const remoteContract = applyWiringPresentation(seated.contract, presentation);
  const totalBytes = modelFetches.reduce((sum, entry) => sum + entry.bytes, 0);

  await onEvent?.("assembly_contract_generated", {
    partCount: remoteContract.parts.length,
    stepCount: remoteContract.steps.length,
  });
  const wiring = {
    standard: "color-coded-realistic-jumper-bow-routing-v3",
    model: presentation.model,
    routingStyle: "direct-pins-and-keyed-cables-smooth-bows",
    wires: remoteContract.wires,
    wireCount: remoteContract.wires.length,
    colors: {
      "3V3": "red",
      GND: "black",
      SDA: "blue",
      SCL: "yellow",
      AOUT: "green",
    },
    safety: [
      "Disconnect USB before making or changing any connection.",
      "Use the keyed 3.3 V Qwiic bus for the SCD-41 and TSL2591, and 3.3 V for the soil sensor.",
      "Verify polarity and pin labels before reconnecting USB power.",
    ],
  };
  await onEvent?.("wiring_generated", { wireCount: wiring.wireCount });
  const firmware = createPlantFirmware();
  await onEvent?.("firmware_generated", {
    language: firmware.language,
    sourceBytes: Buffer.byteLength(firmware.source, "utf8"),
  });

  return {
    schemaVersion: "MakeableAwsProductionArtifactsV1",
    generatedAt: new Date().toISOString(),
    registry: {
      pointerUrl: APPROVED_REGISTRY_POINTER,
      revision: manifest.revision || pointer.revision || "",
      manifestUrl: pointer.manifestUrl,
      manifestSha256: manifestHash,
      activeAssetCount: activeAssets.size,
    },
    selection: {
      plannerAssetIds: [...selectedAssetIds].sort(),
      profileAssetIds: [...PROFILE_ASSET_IDS].sort(),
      plannerMatchedProfileCount: [...PROFILE_ASSET_IDS].filter((id) => selectedAssetIds.has(id)).length,
      breadboardPolicy: BREADBOARD_POLICY,
      mandatoryBreadboardIncluded: false,
    },
    assembly: {
      ...remoteContract,
      mounting: seated.mounting,
    },
    wiring,
    firmware,
    delivery: {
      mode: "remote-memory-stream",
      modelOrigin: APPROVED_ASSET_ORIGIN,
      modelFetches,
      totalModelBytes: totalBytes,
      localModelRequests: 0,
      localModelBytes: 0,
      generatedModelCount: 0,
      visualReviewCount: 0,
    },
  };
}

async function planWiringAndAssemblyPresentation({ contract, env, fetchFn, onEvent }) {
  const model = String(env.OPENAI_WIRING_MODEL || env.MAKEABLE_WIRING_MODEL || DEFAULT_WIRING_ASSEMBLY_MODEL).trim();
  const sourceWires = contract.wires.map((wire) => ({
    id: wire.id,
    signal: wire.signal || wire.label,
    from: { label: wire.from?.label, position: wire.from?.position },
    to: { label: wire.to?.label, position: wire.to?.position },
  }));
  const mountedPartIds = Array.isArray(contract?.parts)
    ? [...new Set(contract.parts.map((part) => part.id))].sort()
    : [];
  const deterministic = deterministicPresentationPlan(sourceWires, mountedPartIds);
  if (!env.OPENAI_API_KEY) {
    await onEvent?.("wiring_assembly_model_skipped", {
      reason: "missing_openai_api_key",
      model: "deterministic-surface-router",
    });
    return deterministic;
  }

  await onEvent?.("wiring_assembly_model_started", { model, wireCount: sourceWires.length });
  const response = await fetchFn(openAIEndpoint(env, "/v1/responses"), {
    method: "POST",
    headers: openAIHeaders(env),
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model,
      reasoning: { effort: "high" },
      input: [
        {
          role: "developer",
          content: [
            "You are the presentation-routing specialist for Makeable's beginner electronics assembly guide.",
            "You may improve only the visual route plan. You may not add, remove, relabel, reverse, or electrically reinterpret any wire or move a part.",
            "Every listed endpoint is locked. The coordinate system is in metres and +Z is above the assembly support plane.",
            "Choose compact physical-looking flexible jumper leads: smooth, shallow, single-bow arcs between the locked pin endpoints. They must look like silicone jumper wire, never square plumbing, rigid 90-degree conduit, high loops, decorative sweeps, or floating cable bundles.",
            "Use only a small lateral lane offset to separate overlapping signals. Keep the four conductors of each keyed Qwiic cable adjacent. Target a 4–7 mm bow height: enough to look like flexible cable or factory probe wire, never taut or theatrical. Each route must descend naturally into its locked connector contact or labeled board pin.",
            "Review the listed mounted parts and explicitly acknowledge the verified direct-connection placement. Do not move them or propose a new coordinate; the renderer will preserve the verified endpoints, established camera views, and placement exactly. Breadboards, hidden rails, and invented junctions are prohibited.",
            "Return only the requested JSON schema. Do not include endpoint coordinates.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            parts: contract.parts.map((part) => ({
              id: part.id,
              label: part.label,
              assembledPosition: part.assembledPosition,
            })),
            wires: sourceWires,
            verifiedDirectConnections: contract.mounting?.contacts || [],
            steps: contract.steps.map((step) => ({
              id: step.id,
              title: step.title,
              activeWires: step.activeWires,
            })),
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "makeable_wiring_assembly_presentation",
          strict: true,
          schema: wiringAssemblyPresentationSchema(),
        },
      },
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Sol wiring and assembly request failed.");
  const raw = outputText(payload);
  let proposed;
  try {
    proposed = JSON.parse(raw);
  } catch {
    throw new Error("Sol wiring and assembly response was not valid JSON.");
  }
  const validated = validatePresentationPlan(proposed, sourceWires, model, mountedPartIds);
  await onEvent?.("wiring_assembly_model_completed", {
    model,
    wireCount: validated.wires.length,
    accepted: true,
    routingStyle: "direct-pins-and-keyed-cables-smooth-bows",
    seatingReviewed: validated.seatingReview.preserveVerifiedSeating,
  });
  return validated;
}

function applyWiringPresentation(contract, presentation) {
  const routeById = new Map(presentation.wires.map((wire) => [wire.wireId, wire]));
  const boardPlaneZ = calculateAssemblyPlane(contract.wires);
  const wires = contract.wires.map((wire, index) => {
    const route = routeById.get(wire.id) || deterministicPresentationPlan([wire]).wires[0];
    return {
      ...wire,
      points: createLowProfileRoute(wire, route, boardPlaneZ, index),
      presentation: {
        source: presentation.source,
        model: presentation.model,
        bowDirection: route.bowDirection,
        lane: route.lane,
        bowHeightMm: route.bowHeightMm,
      },
    };
  });
  return {
    ...contract,
    wires,
    presentation: {
      ...presentation,
      boardPlaneZ,
    },
  };
}

function validateDirectConnectedParts(contract) {
  const contacts = contract.wires.flatMap((wire) => [
    { wireId: wire.id, side: "from", partId: wire.from.partId, kind: wire.from.kind, label: wire.from.label },
    { wireId: wire.id, side: "to", partId: wire.to.partId, kind: wire.to.kind, label: wire.to.label },
  ]);
  const mounting = {
    mode: "verified-direct-pin-and-keyed-connector",
    contacts,
    qualification: "Every rendered conductor terminates at a locked reviewed-GLB pin or keyed connector contact. This proves endpoint identity and visual routing, not contact force or electrical continuity.",
  };
  return { contract: { ...contract, mounting }, mounting };
}

export function createLowProfileRoute(wire, route, boardPlaneZ, wireIndex = 0) {
  const from = endpointPosition(wire?.from, "from", wire?.id);
  const to = endpointPosition(wire?.to, "to", wire?.id);
  const lane = Math.max(-8, Math.min(8, Math.trunc(Number(route?.lane || 0))));
  const bowHeight = Math.max(0.004, Math.min(0.007, Number(route?.bowHeightMm || 5) / 1_000));
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const planarLength = Math.hypot(dx, dy);
  const normal = planarLength > 0.000001 ? [-dy / planarLength, dx / planarLength] : [1, 0];
  const laneOffset = lane * 0.0009;
  const direction = route?.bowDirection === "right" ? -1 : 1;
  const lateral = direction * laneOffset;
  const peakZ = Math.max(boardPlaneZ + 0.001, from[2], to[2]) + bowHeight + (wireIndex % 3) * 0.00035;
  const controlA = [
    from[0] + dx * 0.28 + normal[0] * lateral,
    from[1] + dy * 0.28 + normal[1] * lateral,
    peakZ,
  ];
  const controlB = [
    from[0] + dx * 0.72 + normal[0] * lateral,
    from[1] + dy * 0.72 + normal[1] * lateral,
    peakZ,
  ];
  return cubicBezierPoints(from, controlA, controlB, to, 12);
}

function cubicBezierPoints(start, controlA, controlB, end, segments) {
  const points = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const inverse = 1 - t;
    points.push([0, 1, 2].map((axis) => (
      inverse ** 3 * start[axis]
      + 3 * inverse ** 2 * t * controlA[axis]
      + 3 * inverse * t ** 2 * controlB[axis]
      + t ** 3 * end[axis]
    )));
  }
  return compactPoints(points);
}

function calculateAssemblyPlane(wires) {
  const anchors = (Array.isArray(wires) ? wires : [])
    .flatMap((wire) => [wire?.from, wire?.to])
    .map((endpoint) => Number(endpoint?.position?.[2]))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!anchors.length) return 0;
  return anchors[0];
}

function compactPoints(points) {
  return points.reduce((output, point) => {
    const safe = point.map((value) => Number(value));
    const previous = output.at(-1);
    if (!previous || previous.some((value, index) => Math.abs(value - safe[index]) > 0.000001)) {
      output.push(safe);
    }
    return output;
  }, []);
}

function endpointPosition(endpoint, side, wireId) {
  const position = endpoint?.position;
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) {
    throw new Error(`Wire ${wireId || "unknown"} has an invalid ${side} endpoint.`);
  }
  return [Number(position[0]), Number(position[1]), Number(position[2])];
}

function deterministicPresentationPlan(wires, mountedPartIds = []) {
  const signalLanes = new Map([
    ["3V3", -4],
    ["GND", 4],
    ["SDA", -1],
    ["SCL", 1],
    ["AOUT", 6],
  ]);
  return {
    source: "deterministic-surface-router",
    model: "deterministic-surface-router",
    wires: wires.map((wire, index) => ({
      wireId: wire.id,
      bowDirection: index % 2 ? "left" : "right",
      lane: (signalLanes.get(wire.signal || wire.label) || 0) + (index % 3) - 1,
      bowHeightMm: 4 + (index % 3),
    })),
    seatingReview: {
      preserveVerifiedSeating: true,
      mountedPartIds: [...mountedPartIds].sort(),
    },
  };
}

function validatePresentationPlan(value, sourceWires, model, mountedPartIds = []) {
  if (!value || typeof value !== "object" || !Array.isArray(value.wires)) {
    throw new Error("Sol wiring and assembly response omitted wire routes.");
  }
  const expectedIds = new Set(sourceWires.map((wire) => wire.id));
  const seen = new Set();
  const wires = value.wires.map((entry) => {
    const wireId = String(entry?.wireId || "");
    if (!expectedIds.has(wireId) || seen.has(wireId)) {
      throw new Error("Sol wiring and assembly response changed the verified wire inventory.");
    }
    seen.add(wireId);
    const bowDirection = entry?.bowDirection === "left" || entry?.bowDirection === "right" ? entry.bowDirection : null;
    const lane = Number(entry?.lane);
    const bowHeightMm = Number(entry?.bowHeightMm);
    if (!bowDirection || !Number.isInteger(lane) || lane < -8 || lane > 8
      || !Number.isFinite(bowHeightMm) || bowHeightMm < 4 || bowHeightMm > 7) {
      throw new Error(`Sol returned an unsafe visual route for ${wireId}.`);
    }
    return { wireId, bowDirection, lane, bowHeightMm };
  });
  if (seen.size !== expectedIds.size) {
    throw new Error("Sol wiring and assembly response did not route every verified wire.");
  }
  const seatingReview = value.seatingReview;
  const reviewedIds = Array.isArray(seatingReview?.mountedPartIds)
    ? [...new Set(seatingReview.mountedPartIds.map((id) => String(id)))].sort()
    : [];
  const expectedMountedIds = [...mountedPartIds].sort();
  if (seatingReview?.preserveVerifiedSeating !== true
    || reviewedIds.length !== expectedMountedIds.length
    || reviewedIds.some((id, index) => id !== expectedMountedIds[index])) {
    throw new Error(`Sol wiring and assembly response did not acknowledge the verified direct-connection placement (expected ${expectedMountedIds.join(",")}; received ${reviewedIds.join(",")}; preserve=${String(seatingReview?.preserveVerifiedSeating)}).`);
  }
  return {
    source: "openai-responses",
    model,
    wires,
    seatingReview: {
      preserveVerifiedSeating: true,
      mountedPartIds: reviewedIds,
    },
  };
}

function wiringAssemblyPresentationSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["wires", "seatingReview"],
    properties: {
      wires: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["wireId", "bowDirection", "lane", "bowHeightMm"],
          properties: {
            wireId: { type: "string", minLength: 1 },
            bowDirection: { type: "string", enum: ["left", "right"] },
            lane: { type: "integer", minimum: -8, maximum: 8 },
            bowHeightMm: { type: "number", minimum: 4, maximum: 7 },
          },
        },
      },
      seatingReview: {
        type: "object",
        additionalProperties: false,
        required: ["preserveVerifiedSeating", "mountedPartIds"],
        properties: {
          preserveVerifiedSeating: { type: "boolean", const: true },
          mountedPartIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  };
}

function outputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content?.text === "string") return content.text;
    }
  }
  throw new Error("OpenAI response contained no text output.");
}

function openAIEndpoint(env, pathname) {
  const raw = String(env.OPENAI_BASE_URL || "https://api.openai.com").trim().replace(/\/+$/, "");
  return `${raw}${pathname}`;
}

function openAIHeaders(env) {
  return {
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function fetchBytes(url, fetchFn, init = {}) {
  const startedAt = performance.now();
  const response = await fetchFn(url, {
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
    ...init,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`Request failed (${response.status}) for ${url}`);
  return { response, bytes, elapsedMs: performance.now() - startedAt };
}

async function fetchJson(url, fetchFn) {
  const result = await fetchBytes(url, fetchFn, {
    headers: { Accept: "application/json" },
  });
  return { ...result, value: parseJson(result.bytes, url) };
}

function normalizeRequiredAsset(asset) {
  assertHttpsCloudFrontUrl(asset.url, `asset ${asset.id || "unknown"}`);
  assertSha256(asset.sha256, `asset ${asset.id || "unknown"}`);
  return {
    ...asset,
    url: new URL(asset.url).toString(),
    sha256: String(asset.sha256).toLowerCase(),
    eligibility: "ready",
  };
}

function normalizeContract(value) {
  if (!value || typeof value !== "object" || value.state !== "ready") {
    throw new Error("Assembly contract API did not return a ready contract");
  }
  if (!Array.isArray(value.requiredAssets) || !Array.isArray(value.parts)
    || !Array.isArray(value.wires) || !Array.isArray(value.steps)) {
    throw new Error("Assembly contract API returned an incomplete contract");
  }
  return structuredClone(value);
}

function normalizeAssemblyApiOrigin(value) {
  const parsed = new URL(value);
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error("Assembly API origin must use HTTP or HTTPS");
  }
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function assertHttpsCloudFrontUrl(value, label) {
  const parsed = new URL(String(value || ""));
  if (parsed.protocol !== "https:" || parsed.origin !== APPROVED_ASSET_ORIGIN) {
    throw new Error(`${label} must resolve to the approved CloudFront origin`);
  }
  if (parsed.username || parsed.password) throw new Error(`${label} must not contain credentials`);
}

function assertSha256(value, label) {
  if (!/^[a-f0-9]{64}$/i.test(String(value || ""))) {
    throw new Error(`${label} has an invalid SHA-256`);
  }
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function parseGlbJson(bytes, assetId) {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "glTF" || buffer.readUInt32LE(4) !== 2) {
    throw new Error(`AWS object for ${assetId} is not a valid GLB v2 file`);
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    offset += 8;
    const chunk = buffer.subarray(offset, offset + length);
    offset += length;
    if (type === "JSON") return parseJson(chunk.toString("utf8").replace(/\0+$/, ""), assetId);
  }
  throw new Error(`AWS GLB for ${assetId} has no JSON chunk`);
}

function createPlantFirmware() {
  return {
    language: "arduino-cpp",
    board: "sparkfun-thing-plus-esp32-wroom",
    fqbn: "esp32:esp32:esp32",
    source: `#include <Wire.h>
#include <SensirionI2CScd4x.h>
#include <Adafruit_TSL2591.h>

constexpr int SDA_PIN = 21;
constexpr int SCL_PIN = 22;
constexpr int SOIL_PIN = 26;

SensirionI2CScd4x scd41;
Adafruit_TSL2591 lightMeter(2591);

void setup() {
  Serial.begin(115200);
  Wire.begin(SDA_PIN, SCL_PIN);
  analogSetPinAttenuation(SOIL_PIN, ADC_11db);
  scd41.begin(Wire);
  scd41.stopPeriodicMeasurement();
  if (scd41.startPeriodicMeasurement()) {
    Serial.println("SCD41_NOT_FOUND");
  }
  if (!lightMeter.begin()) {
    Serial.println("TSL2591_NOT_FOUND");
  }
  Serial.println("PLANT_GUARDIAN_READY");
}

void loop() {
  uint16_t co2 = 0;
  float temperatureC = 0;
  float humidityPct = 0;
  bool ready = false;
  scd41.getDataReadyFlag(ready);
  if (ready) scd41.readMeasurement(co2, temperatureC, humidityPct);
  const uint32_t light = lightMeter.getFullLuminosity();
  const float lightLux = lightMeter.calculateLux(light & 0xFFFF, light >> 16);
  const int soilRaw = analogRead(SOIL_PIN);
  Serial.printf("CO2=%uppm T=%.1fC H=%.1f%% L=%.0flux SOIL=%d\\n",
    co2, temperatureC, humidityPct, lightLux, soilRaw);
  delay(2000);
}
`,
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function roundMs(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}
