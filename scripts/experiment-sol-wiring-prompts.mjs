#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...readEnv(path.join(ROOT, ".env")), ...process.env };
const model = "gpt-5.6-sol";
const contractUrl = `${String(env.MAKEABLE_ASSEMBLY_API_ORIGIN || "http://127.0.0.1:8787").replace(/\/$/, "")}/api/builds/plant-companion-v1/assembly`;

if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for Sol prompt experiments.");

const contractResponse = await fetch(contractUrl, { headers: { Accept: "application/json" } });
if (!contractResponse.ok) throw new Error(`Assembly contract request failed (${contractResponse.status}).`);
const contract = await contractResponse.json();
const wires = contract.wires.map((wire) => ({
  wireId: wire.id,
  signal: wire.signal || wire.label,
  from: { label: wire.from?.label, position: wire.from?.position },
  to: { label: wire.to?.label, position: wire.to?.position },
}));
const mountedPartIds = ["controller", "bme280", "bh1750"].sort();

const variants = [
  {
    id: "compact-bow",
    hypothesis: "Minimum arc height may reduce obstruction but risks looking taut rather than like a real jumper.",
    instruction: "Use 3–5 mm arcs only. Prioritize compactness over expressive curvature.",
  },
  {
    id: "bench-realistic-bow",
    hypothesis: "A 4–7 mm single bow with subtle lane offsets should read like real flexible silicone jumper wire.",
    instruction: "Use 4–7 mm single bows, with modest lateral separation. Each wire must have one clean, gravity-plausible arch and a natural descent into a socket.",
  },
  {
    id: "display-clear-bow",
    hypothesis: "Prioritizing the display and sensor windows may reduce visual clutter but can make longer runs look over-styled.",
    instruction: "Use 5–8 mm single bows only where needed to keep the display, BME280 vent, BH1750 light window, and soil cable exit visually readable. Otherwise keep the bow shallow.",
  },
];

const results = await Promise.all(variants.map((variant) => runVariant(variant)));
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  model,
  source: "real-openai-responses-api",
  contractUrl,
  resultCount: results.length,
  results,
}, null, 2));

async function runVariant(variant) {
  const startedAt = performance.now();
  const response = await fetch(`${String(env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, "")}/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model,
      reasoning: { effort: "high" },
      input: [
        {
          role: "developer",
          content: [
            "You are evaluating visual routing presentation for a real beginner electronics build.",
            "The direct electrical endpoints and part placements are immutable. Choose only bow direction, a small lateral lane, and bow height for each listed wire.",
            "The output will deterministically render a smooth cubic bow. Never choose a plumbing-like 90-degree route, an extreme loop, or a decorative cable sweep.",
            variant.instruction,
            "Acknowledge that every part must retain its verified direct pin or keyed-connector placement. Breadboards and invented junctions are prohibited. Return only schema-conforming JSON.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            variant: variant.id,
            wires,
            verifiedBreadboardSeating: mountedPartIds,
          }),
        },
      ],
      text: { format: { type: "json_schema", name: "sol_wiring_prompt_experiment", strict: true, schema: responseSchema() } },
    }),
  });
  const payload = await response.json();
  const elapsedMs = Math.round((performance.now() - startedAt) * 10) / 10;
  if (!response.ok) {
    return { id: variant.id, hypothesis: variant.hypothesis, elapsedMs, accepted: false, error: payload?.error?.message || `HTTP ${response.status}` };
  }
  const plan = JSON.parse(outputText(payload));
  const evaluation = evaluate(plan);
  return {
    id: variant.id,
    hypothesis: variant.hypothesis,
    elapsedMs,
    accepted: evaluation.accepted,
    ...evaluation,
    seatingReview: plan.seatingReview,
  };
}

function responseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["wires", "seatingReview"],
    properties: {
      wires: {
        type: "array",
        minItems: wires.length,
        maxItems: wires.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["wireId", "bowDirection", "lane", "bowHeightMm"],
          properties: {
            wireId: { type: "string", minLength: 1 },
            bowDirection: { type: "string", enum: ["left", "right"] },
            lane: { type: "integer", minimum: -8, maximum: 8 },
            bowHeightMm: { type: "number", minimum: 3, maximum: 10 },
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

function evaluate(plan) {
  const expected = new Set(wires.map((wire) => wire.wireId));
  const actual = Array.isArray(plan?.wires) ? plan.wires : [];
  const IDs = new Set(actual.map((wire) => wire?.wireId));
  const heights = actual.map((wire) => Number(wire?.bowHeightMm)).filter(Number.isFinite);
  const seating = [...new Set((plan?.seatingReview?.mountedPartIds || []).map(String))].sort();
  const seated = plan?.seatingReview?.preserveVerifiedSeating === true
    && JSON.stringify(seating) === JSON.stringify(mountedPartIds);
  const inventoryMatch = actual.length === expected.size && IDs.size === expected.size && [...expected].every((id) => IDs.has(id));
  const bounded = heights.length === expected.size && heights.every((height) => height >= 3 && height <= 10);
  return {
    accepted: inventoryMatch && bounded && seated,
    inventoryMatch,
    seatingAcknowledged: seated,
    meanBowHeightMm: heights.length ? Math.round((heights.reduce((sum, height) => sum + height, 0) / heights.length) * 100) / 100 : null,
    minBowHeightMm: heights.length ? Math.min(...heights) : null,
    maxBowHeightMm: heights.length ? Math.max(...heights) : null,
    distinctLanes: new Set(actual.map((wire) => wire?.lane)).size,
    wirePlan: actual,
  };
}

function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content?.text === "string") return content.text;
    }
  }
  throw new Error("OpenAI response had no output text.");
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    output[key] = value;
  }
  return output;
}
