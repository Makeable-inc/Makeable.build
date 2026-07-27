import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAcaciaStageUrl,
  buildAcaciaProposalRequest,
  buildProgramHashUrl,
  cleanOAuthCallbackUrl,
  compareAcaciaRequestFingerprints,
  createAcaciaRequestFingerprint,
  groupAcaciaRequiredParts,
  hasApiKeyField,
  normalizeAcaciaProposalResponse,
  parseAcaciaProgram,
  validateAcaciaProposalResponse,
} from "../pilot/lib/acacia-program.mjs";
import { routeAcaciaIdea } from "../lib/programs/acacia/router.mjs";
import { getAcaciaHardware } from "../lib/programs/acacia/registry.mjs";

test("Acacia program parsing accepts only the public aliases", () => {
  assert.equal(parseAcaciaProgram("?program=acacia"), "nus-acacia");
  assert.equal(parseAcaciaProgram("https://makeable.test/pilot?program=NUS-ACACIA#capture"), "nus-acacia");
  assert.equal(parseAcaciaProgram(new URLSearchParams({ program: " acacia " })), "nus-acacia");
  assert.equal(parseAcaciaProgram("nus-acacia"), "nus-acacia");
  assert.equal(parseAcaciaProgram("?program=other"), null);
  assert.equal(parseAcaciaProgram("?program=acacia-preview"), null);
});

test("stage and OAuth URLs preserve only valid program context", () => {
  const callback = {
    pathname: "/pilot",
    search: "?program=acacia&code=secret-code&state=oauth-state&error=none",
    hash: "#capture",
  };
  assert.equal(buildProgramHashUrl(callback, "#plan"), "/pilot?program=acacia#plan");
  assert.equal(cleanOAuthCallbackUrl(callback), "/pilot?program=acacia#capture");
  assert.equal(
    buildProgramHashUrl("/pilot?program=nus-acacia&apiKey=never#capture", "flash"),
    "/pilot?program=nus-acacia#flash",
  );
  assert.equal(
    buildProgramHashUrl("/pilot?program=unknown&code=one-time#capture", "#plan"),
    "/pilot#plan",
  );
  assert.equal(
    buildAcaciaStageUrl(
      "/pilot?program=nus-acacia#capture",
      "",
      "#plan",
    ),
    "/pilot?program=nus-acacia#plan",
  );
  assert.equal(
    buildAcaciaStageUrl(
      "/pilot?code=one-time&state=oauth-state",
      "/pilot?program=nus-acacia#plan",
      "#flash",
    ),
    "/pilot?program=nus-acacia#flash",
  );
  assert.equal(
    buildAcaciaStageUrl("/pilot?code=one-time", "", "#capture"),
    "/pilot?program=acacia#capture",
  );
});

test("recommended difficulty remains a backend recommendation", () => {
  assert.deepEqual(
    buildAcaciaProposalRequest({
      idea: "  Help residents notice when a shared room gets too warm. ",
      difficulty: "recommended",
      apiKey: "must-not-leak",
    }),
    { idea: "Help residents notice when a shared room gets too warm." },
  );
  assert.deepEqual(
    buildAcaciaProposalRequest({
      idea: "Classify three gestures",
      selectedDifficulty: "ADVANCED",
      hardwareIds: [" MPU6050-IMU ", "mpu6050-imu", ""],
    }),
    {
      idea: "Classify three gestures",
      difficulty: "advanced",
    },
  );
  assert.equal(hasApiKeyField(buildAcaciaProposalRequest({ idea: "A light", apiKey: "secret" })), false);
  assert.throws(
    () => buildAcaciaProposalRequest({ idea: "A light", difficulty: "expert" }),
    /Difficulty must be/,
  );
});

test("normalizes the routeAcaciaIdea result and public part records", () => {
  const response = proposalResponse({
    idea: "Use an NFC tag for a consent-based residence check-in",
    preferredFamily: "connected",
  });
  const normalized = normalizeAcaciaProposalResponse(response);

  assert.equal(normalized.ok, true);
  assert.equal(normalized.proposal.programId, "nus-acacia");
  assert.equal(normalized.proposal.originalIdea, "Use an NFC tag for a consent-based residence check-in");
  assert.equal(normalized.proposal.capabilityId, "contactless-check-in");
  assert.equal("ai" in normalized.proposal, false);
  assert.equal(hasApiKeyField(normalized), false);
  assert.deepEqual(
    normalized.parts.required.map(({ id }) => id),
    normalized.proposal.hardware.requiredIds,
  );
  assert.ok(normalized.requiredPartsByPool.core.length > 0);
  assert.deepEqual(normalized.requiredPartsByPool.shared, []);
  assert.ok(
    normalized.parts.required.some(({ id }) => id === "momentary-buttons"),
  );
  assert.equal(
    [...normalized.parts.required, ...normalized.parts.optional].some(({ id }) =>
      /nfc|pn532/.test(id),
    ),
    false,
  );
  assert.match(normalized.proposal.preservation.change, /button input/i);
  assert.equal(Object.isFrozen(normalized), true);
});

test("accepts the direct routeAcaciaIdea value envelope and a flat public part list", () => {
  const canonical = proposalResponse({ idea: "Make a room temperature status light" });
  const flatParts = [...canonical.parts.required, ...canonical.parts.optional];
  const direct = {
    ok: true,
    value: canonical.proposal,
    parts: flatParts,
  };

  const normalized = normalizeAcaciaProposalResponse(direct);
  const grouped = groupAcaciaRequiredParts(normalized);
  assert.equal(normalized.proposal.projectTitle, canonical.proposal.projectTitle);
  assert.deepEqual(
    [...grouped.core, ...grouped.shared].map(({ id }) => id),
    normalized.parts.required.map(({ id }) => id),
  );
});

test("rejects incomplete, mismatched, or secret-bearing public envelopes", () => {
  const missingPart = proposalResponse({ idea: "Classify hand gestures" });
  missingPart.parts.required.pop();
  assert.ok(
    validateAcaciaProposalResponse(missingPart).some(({ code }) => code === "missing-public-part"),
  );

  const wrongPool = proposalResponse({
    idea: "Notice a nearby visitor with a distance alert",
    difficulty: "advanced",
  });
  wrongPool.parts.required = wrongPool.parts.required.map((part) =>
    part.id === "hc-sr501-pir" ? { ...part, pool: "core" } : part,
  );
  assert.ok(
    validateAcaciaProposalResponse(wrongPool).some(
      ({ code }) => code === "shared-pool-requirement-mismatch",
    ),
  );

  const keyLeak = proposalResponse({ idea: "Build a plant monitor" });
  keyLeak.debug = { openaiApiKey: "secret" };
  assert.throws(
    () => normalizeAcaciaProposalResponse(keyLeak),
    (error) =>
      error.name === "AcaciaProposalResponseError" &&
      error.issues.some(({ code }) => code === "api-key-field-present"),
  );
});

test("request fingerprints remain ordered even when request content repeats", () => {
  const request = { idea: "Show a status light", difficulty: "recommended" };
  const first = createAcaciaRequestFingerprint(request);
  const second = createAcaciaRequestFingerprint(request);
  const third = createAcaciaRequestFingerprint({ idea: "Classify gestures" });

  assert.equal(first.signature, second.signature);
  assert.notEqual(second.signature, third.signature);
  assert.equal(compareAcaciaRequestFingerprints(first, second), -1);
  assert.equal(compareAcaciaRequestFingerprints(second, second), 0);
  assert.equal(compareAcaciaRequestFingerprints(third, second), 1);
});

function proposalResponse(request) {
  const result = routeAcaciaIdea(request);
  assert.equal(result.ok, true, JSON.stringify(result.issues || []));
  return {
    ok: true,
    proposal: { ...result.value, planId: `plan-${result.value.capabilityId}` },
    parts: {
      required: result.value.hardware.requiredIds.map(publicPart),
      optional: result.value.hardware.optionalIds.map(publicPart),
    },
  };
}

function publicPart(id) {
  const part = getAcaciaHardware(id);
  assert.ok(part, `Missing registry part ${id}`);
  return {
    id: part.id,
    label: part.label,
    pool: part.pool,
    kind: part.kind,
    interface: part.interface,
    power: part.power,
    signals: part.signals,
    quantity: 1,
    availability: part.pool === "core" ? "included" : "checkout_required",
  };
}
