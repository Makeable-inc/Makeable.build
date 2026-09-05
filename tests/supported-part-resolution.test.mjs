import assert from "node:assert/strict";
import test from "node:test";

import {
  applyApprovedSubstitutions,
  buildSupportedPartResolution,
  createSupportedPartsCatalog,
  normalizeNegotiationInput,
  replacementCategoryAllowed,
  unresolvedPartFailures,
} from "../lib/supported-part-resolution.mjs";

const supportedParts = [
  { id: "screen-ready", name: "Ready 2.8 inch touchscreen", category: "display", subtype: "Touch display", requestAliases: ["touchscreen"], assemblyAssetIds: ["screen-asset"] },
  { id: "oled-ready", name: "Ready OLED display", category: "display", subtype: "OLED screen", requestAliases: ["oled"], assemblyAssetIds: ["oled-asset"] },
  { id: "sensor-ready", name: "Ready motion sensor", category: "sensor", subtype: "Presence sensor", requestAliases: ["room presence"], assemblyAssetIds: ["sensor-asset"] },
];

test("supported catalog is derived from the exact active parts and AWS release", () => {
  const catalog = createSupportedPartsCatalog(supportedParts, {
    revision: "release-7",
    assets: [{ partId: "screen-asset", url: "https://example.com/screen.glb", sha256: "a".repeat(64) }],
  });
  assert.equal(catalog.productionRevision, "release-7");
  assert.equal(catalog.count, 3);
  assert.equal(catalog.parts[0].status, "one-shot-ready");
  assert.deepEqual(catalog.parts[0].aws, { url: "https://example.com/screen.glb", sha256: "a".repeat(64) });
  assert.deepEqual(catalog.parts[0].awsAssets, [{ partId: "screen-asset", url: "https://example.com/screen.glb", sha256: "a".repeat(64) }]);
});

test("unsupported exact parts get plain-language alternatives without automatic substitution", () => {
  const resolution = buildSupportedPartResolution({
    idea: "Use the retired touchscreen in a room alert",
    attempt: 1,
    failures: [{ catalogId: "screen-retired", name: "Retired touchscreen", category: "display", reason: "connector_endpoint_geometry_missing:pin:4" }],
    supportedParts,
    code: "exact_requested_part_not_one_shot",
  });
  assert.equal(resolution.status, "needs-user-choice");
  assert.equal(resolution.attempt, 1);
  assert.equal(resolution.unsupported[0].alternatives.length, 2);
  assert.ok(resolution.unsupported[0].alternatives.every((part) => part.category === "display"));
  assert.match(resolution.unsupported[0].reason, /pin or connector layout/i);
  assert.doesNotMatch(JSON.stringify(resolution), /pin:4/);
});

test("only explicit valid choices become approved replacement instructions", () => {
  const negotiation = normalizeNegotiationInput({
    negotiationAttempt: 2,
    clarification: "Keep it touch enabled",
    substitutions: [{ unsupportedCatalogId: "screen-retired", replacementCatalogId: "screen-ready" }],
  }, supportedParts);
  const effectiveIdea = applyApprovedSubstitutions("Use screen-retired", negotiation);
  assert.match(effectiveIdea, /USER-APPROVED PART REPLACEMENTS/);
  assert.match(effectiveIdea, /screen-retired/);
  assert.match(effectiveIdea, /screen-ready/);
  assert.match(effectiveIdea, /Keep it touch enabled/);
  assert.deepEqual(unresolvedPartFailures([
    { catalogId: "screen-retired" },
    { catalogId: "another-retired" },
  ], negotiation), [{ catalogId: "another-retired" }]);
});

test("unknown replacement IDs are ignored and the third rejection is final", () => {
  const negotiation = normalizeNegotiationInput({
    negotiationAttempt: 99,
    substitutions: [{ unsupportedCatalogId: "screen-retired", replacementCatalogId: "made-up" }],
  }, supportedParts);
  assert.equal(negotiation.attempt, 1);
  assert.deepEqual(negotiation.substitutions, []);

  const finalResolution = buildSupportedPartResolution({
    idea: "Use screen-retired",
    attempt: 3,
    failures: [{ catalogId: "screen-retired", name: "Retired screen", category: "display" }],
    supportedParts,
  });
  assert.equal(finalResolution.status, "unable-after-three-attempts");
  assert.equal(finalResolution.allowClarification, false);
  assert.deepEqual(finalResolution.unsupported[0].alternatives, []);
});

test("an unavailable expansion board offers only controllers with verified carrier paths", () => {
  const resolution = buildSupportedPartResolution({
    idea: "Use the old C3 expansion board",
    failures: [{ catalogId: "old-carrier", name: "Old C3 expansion carrier", category: "accessory", reason: "unfinished remediation" }],
    supportedParts: [
      ...supportedParts,
      { id: "controller-ready", name: "Ready ESP32-S3", category: "controller", subtype: "ESP32 controller", controllerCarrierAssetId: "carrier-ready" },
    ],
  });
  assert.ok(resolution.unsupported[0].alternatives.length > 0);
  assert.ok(resolution.unsupported[0].alternatives.every((part) => part.category === "controller"));
  assert.equal(replacementCategoryAllowed(
    { name: "Old C3 expansion carrier", category: "accessory" },
    { name: "Ready ESP32-S3", category: "controller" },
  ), true);
});
