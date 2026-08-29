#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const REVISION = "approved-visual-catalog-20260829-breakout-restricted-power-v6";
const EXPECTED_PARENT = "approved-visual-catalog-20260828-family-safe-connectors-v5";
const CDN_ROOT = "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1";
const POINTER_URL = `${CDN_ROOT}/current.json`;
const OUTPUT_DIRECTORY = path.resolve(process.argv[2] || `artifacts/aws-assembly-release/${REVISION}`);

const CANDIDATES = [
  candidate({
    directory: "aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1",
    displayName: "AITRIP ESP32-C3 SuperMini Expansion Board (2-pack)",
    catalogKey: "B0FBGFWFB1",
    connectorReadiness: "factory_socket_terminal_and_male_breakout_pins",
    selectionStatus: "ready",
    selectionBlocker: "",
    connectionRequirement: "Seat the exact 16-pin ESP32-C3 SuperMini in both 1x8 sockets with USB-C toward the power block; connect sensor leads only to named carrier breakout pins.",
    soldFormGeometry: "source-backed-photo-calibrated-factory-connectors-v1",
    electricalNote: "Controller USB-C power and factory-default 3.3V peripheral rails only; no external carrier power, battery connection, rail modification, or GPIO-sourced sensor load.",
    mountContract: { socketRows: 2, pinsPerRow: 8, orientation: "usb_c_toward_power_block" },
    powerContract: { controllerPowerSource: "controller_usb_c", peripheralVoltage: "3.3V", externalCarrierPowerConnected: false, batteryConnected: false, railModified: false },
  }),
  candidate({
    directory: "aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx",
    displayName: "AITRIP ESP32-S3 44-pin GPIO 1-to-2 Expansion Board V2775",
    catalogKey: "B0H336QRXX",
    connectorReadiness: "factory_dual_socket_and_male_breakout_pins",
    selectionStatus: "ready",
    selectionBlocker: "",
    connectionRequirement: "Seat the exact 44-pin ESP32-S3 DevKitC footprint in both 1x22 sockets with USB-C aligned to the carrier arrow; connect sensor leads only to named carrier breakout pins.",
    soldFormGeometry: "source-backed-photo-calibrated-factory-connectors-v1",
    electricalNote: "Controller USB-C power and 3.3V peripheral rows only; no external carrier power, DC barrel input, 5V peripheral rail, or family substitution.",
    mountContract: { socketRows: 2, pinsPerRow: 22, orientation: "usb_c_aligned_with_carrier_arrow" },
    powerContract: { controllerPowerSource: "controller_usb_c", peripheralVoltage: "3.3V", externalCarrierPowerConnected: false, dcBarrelConnected: false, fiveVoltPeripheralRailUsed: false },
  }),
  candidate({
    directory: "seeed-xiao-expansion-base-103030356",
    displayName: "Seeed Studio Expansion Board Base for XIAO 103030356",
    catalogKey: "B08P4GPR6M",
    connectorReadiness: "factory_xiao_socket_grove_and_header",
    selectionStatus: "ready",
    selectionBlocker: "",
    connectionRequirement: "Seat a supported XIAO board in the factory XIAO sockets and use the factory Grove/header interfaces; validate the selected XIAO family pin map.",
    soldFormGeometry: "manufacturer-ecad-derived-post-pcn-factory-connectors-v1",
    electricalNote: "The XIAO interface geometry is assembly-ready, but validate the selected XIAO family pin functions, 3.3V logic, battery polarity, and peripheral current before power.",
  }),
];

const generatedAt = new Date().toISOString();
const pointerResult = await fetchBytes(`${POINTER_URL}?cb=${Date.now()}`);
const pointer = parseJson(pointerResult.bytes, "active pointer");
if (pointer.revision !== EXPECTED_PARENT || pointer.assetCount !== 91) {
  throw new Error(`Refusing to branch unexpected active registry ${pointer.revision}/${pointer.assetCount}`);
}
const [manifestResult, reviewResult] = await Promise.all([
  fetchBytes(`${pointer.manifestUrl}?cb=${Date.now()}`),
  fetchBytes(`${pointer.reviewUrl}?cb=${Date.now()}`),
]);
assertHash(manifestResult.bytes, pointer.manifestSha256, "active manifest");
assertHash(reviewResult.bytes, pointer.reviewSha256, "active review");
const currentManifest = parseJson(manifestResult.bytes, "active manifest");
const currentReview = parseJson(reviewResult.bytes, "active review");

const stagedRenderDirectory = path.join(OUTPUT_DIRECTORY, "reviews", "renders");
await mkdir(stagedRenderDirectory, { recursive: true });
const additions = [];
const decisions = [];
const uploadGlbs = [];
const uploadRenders = [];

for (const definition of CANDIDATES) {
  const base = path.join(ROOT, "artifacts", "high-fidelity-glb", "2026-08-28", definition.directory);
  const [sourceManifestBytes, visualReviewBytes, validatorBytes, deliveryBytes] = await Promise.all([
    readFile(path.join(base, "manifest.json")),
    readFile(path.join(base, "reports", "visual-review.json")),
    readFile(path.join(base, "reports", "khronos-gltf-validator.json")),
    readFile(path.join(base, "reports", "delivery-validation.json")),
  ]);
  const source = parseJson(sourceManifestBytes, `${definition.directory} manifest`);
  const visualReview = parseJson(visualReviewBytes, `${definition.directory} visual review`);
  const validator = parseJson(validatorBytes, `${definition.directory} validator`);
  const delivery = parseJson(deliveryBytes, `${definition.directory} delivery report`);
  const glbPath = path.join(base, source.glb.path);
  const renderPath = path.join(base, "renders", `${definition.directory}-four-angle.png`);
  const [glbBytes, renderBytes] = await Promise.all([readFile(glbPath), readFile(renderPath)]);
  assertHash(glbBytes, source.glb.sha256, `${definition.directory} GLB`);
  if (visualReview.glbSha256 !== source.glb.sha256) throw new Error(`Visual review hash mismatch for ${source.partId}`);
  if (validator.issues?.numErrors !== 0 || validator.issues?.numWarnings !== 0) throw new Error(`Validator is not clean for ${source.partId}`);
  if (delivery.valid !== true || delivery.errors?.length || delivery.warnings?.length) throw new Error(`Delivery report is not clean for ${source.partId}`);
  if (visualReview.criteria?.pins !== "pass" || visualReview.criteria?.connectors !== "pass" || visualReview.criteria?.scale !== "pass") {
    throw new Error(`Pin/connector/scale review did not pass for ${source.partId}`);
  }
  if (visualReview.criteria?.markings !== "pass" || source.visualEligibility?.state !== "ready") {
    throw new Error(`Silkscreen/visual review did not pass for ${source.partId}`);
  }

  const stagedRenderPath = path.join(stagedRenderDirectory, `${source.partId}.png`);
  await writeFile(stagedRenderPath, renderBytes);
  const glbUrl = `${CDN_ROOT}/objects/sha256/${source.glb.sha256}.glb`;
  const renderUrl = `${CDN_ROOT}/releases/${REVISION}/reviews/renders/${source.partId}.png`;
  const asset = {
    partId: source.partId,
    name: definition.displayName,
    revision: source.revision,
    url: glbUrl,
    sha256: source.glb.sha256,
    reviewedSha256: source.glb.sha256,
    byteSize: glbBytes.length,
    triangleCount: source.glb.triangleCount,
    boundsMm: source.geometry.sourceBoundsMm,
    anchorCount: source.anchors.length,
    connectorProfile: definition.connectorReadiness,
    geometryQualification: source.geometry.strategy,
    visualEligibility: source.visualEligibility.state,
    interfaceEligibility: definition.selectionStatus === "ready" ? "ready" : source.interfaceEligibility.state,
    assemblyEligibility: definition.selectionStatus === "ready" ? "ready" : source.assemblyEligibility.state,
    approvalSource: "source-backed-visual-review+deterministic-restricted-power-contract-2026-08-29",
    reviewEvidenceUrl: renderUrl,
    sourceManifest: `high-fidelity-glb/2026-08-28/${definition.directory}/manifest.json`,
    catalogBinding: "verified_catalog",
    catalogKey: definition.catalogKey,
    connectorReadiness: definition.connectorReadiness,
    selectionStatus: definition.selectionStatus,
    selectionBlocker: definition.selectionBlocker,
    connectionRequirement: definition.connectionRequirement,
    requiredAccessory: "",
    approvalBasis: "user_requested_publication_2026-08-28",
    soldFormGeometry: definition.soldFormGeometry,
    electricalNote: definition.electricalNote,
    ...(definition.mountContract ? { mountContract: definition.mountContract } : {}),
    ...(definition.powerContract ? { powerContract: definition.powerContract } : {}),
    marketplaceUrl: source.identity.marketplaceIds[0].url,
  };
  additions.push(asset);
  decisions.push({
    assetId: source.partId,
    displayName: definition.displayName,
    state: definition.selectionStatus === "ready" ? "visual_ready" : "candidate_review",
    reason: definition.selectionBlocker
      ? `${definition.selectionBlocker}; markings, pins, connectors, outline, and scale passed source-to-render review`
      : "markings, pins, connectors, outline, scale, populated assembly, exact mount, and restricted-power gates passed",
    reviewedSha256: source.glb.sha256,
    sourceManifest: asset.sourceManifest,
    sourceRevision: source.revision,
    byteSize: glbBytes.length,
    triangleCount: source.glb.triangleCount,
    freshWebglRender: { byteSize: renderBytes.length, sha256: sha256(renderBytes), url: renderUrl },
    validator: { clean: true, errors: 0, warnings: 0, infos: validator.issues?.numInfos || 0, hints: validator.issues?.numHints || 0 },
    visualCriteria: visualReview.criteria,
    interfaceEligibility: definition.selectionStatus === "ready" ? "ready" : source.interfaceEligibility.state,
    assemblyEligibility: definition.selectionStatus === "ready" ? "ready" : source.assemblyEligibility.state,
    ...(definition.mountContract ? { mountContract: definition.mountContract } : {}),
    ...(definition.powerContract ? { powerContract: definition.powerContract } : {}),
    anchorCount: source.anchors.length,
  });
  uploadGlbs.push({ partId: source.partId, path: glbPath, sha256: source.glb.sha256, byteSize: glbBytes.length });
  uploadRenders.push({ partId: source.partId, path: stagedRenderPath, sha256: sha256(renderBytes), byteSize: renderBytes.length });
}

const replacements = new Map(additions.map((asset) => [asset.partId, asset]));
const decisionReplacements = new Map(decisions.map((decision) => [decision.assetId, decision]));
for (const partId of replacements.keys()) {
  if (!currentManifest.assets.some((asset) => asset.partId === partId)) throw new Error(`Active registry is missing ${partId}`);
}
const assets = currentManifest.assets.map((asset) => replacements.get(asset.partId) || asset);
const allDecisions = currentReview.decisions.map((decision) => decisionReplacements.get(decision.assetId) || decision);
if (assets.length !== 91 || allDecisions.length !== 91 || new Set(allDecisions.map((item) => item.assetId)).size !== 91) {
  throw new Error("Expected a unique 91-asset manifest/review set");
}

const reviewUrl = `${CDN_ROOT}/releases/${REVISION}/review.json`;
const manifest = {
  ...currentManifest,
  revision: REVISION,
  parentRevision: currentManifest.revision,
  generatedAt,
  assetCount: assets.length,
  selectionPolicy: {
    ...currentManifest.selectionPolicy,
    catalogSelectionReadyCount: assets.filter((asset) => asset.selectionStatus === "ready").length,
    candidateReviewCount: assets.filter((asset) => asset.selectionStatus === "candidate_review").length,
    publishedCandidateAssetsAreNotAutoSelectable: false,
    controllerFamilyPolicy: "xiao-c3supermini-s3devkit44-v2-restricted-power",
    productionRequiresExactMountContract: true,
    productionRequiresRestrictedPowerContract: true,
    superMiniCandidateRemainsBlocked: false,
    s3Devkit44CandidateRemainsBlocked: false,
    superMiniRestrictedReady: true,
    s3Devkit44RestrictedReady: true,
    productionRuntimeVisualPasses: 0,
    reviewSetMatchesManifest: true,
  },
  reviewManifestUrl: reviewUrl,
  assets,
};
const review = {
  ...currentReview,
  revision: `${REVISION}-review`,
  parentRevision: currentReview.revision,
  generatedAt,
  sourceCandidateInventory: {
    activePointerRevision: pointer.revision,
    activeManifestSha256: pointer.manifestSha256,
    activeReviewSha256: pointer.reviewSha256,
    priorAssetCount: pointer.assetCount,
    replacedAssetCount: additions.length,
  },
  summary: {
    reviewed: allDecisions.length,
    visualReady: allDecisions.filter((item) => item.state === "visual_ready").length,
    candidateReview: allDecisions.filter((item) => item.state === "candidate_review").length,
    blocked: allDecisions.filter((item) => !["visual_ready", "candidate_review"].includes(item.state)).length,
    validatorClean: allDecisions.filter((item) => item.validator?.clean === true).length,
    carriedForwardPriorApproval: currentReview.decisions.length - additions.length,
    refreshedEsp32BreakoutAssets: additions.length,
  },
  decisions: allDecisions,
};

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const manifestPath = path.join(OUTPUT_DIRECTORY, "manifest.json");
const reviewPath = path.join(OUTPUT_DIRECTORY, "review.json");
await writeJson(manifestPath, manifest);
await writeJson(reviewPath, review);
const [manifestBytes, reviewBytes] = await Promise.all([readFile(manifestPath), readFile(reviewPath)]);
const nextPointer = {
  schemaVersion: "MakeableApprovedVisualCatalogPointerV1",
  revision: REVISION,
  manifestUrl: `${CDN_ROOT}/releases/${REVISION}/manifest.json`,
  manifestSha256: sha256(manifestBytes),
  reviewUrl,
  reviewSha256: sha256(reviewBytes),
  assetCount: assets.length,
  catalogSelectionReadyCount: assets.filter((asset) => asset.selectionStatus === "ready").length,
  candidateReviewCount: assets.filter((asset) => asset.selectionStatus === "candidate_review").length,
};
const pointerPath = path.join(OUTPUT_DIRECTORY, "current.json");
await writeJson(pointerPath, nextPointer);
const pointerBytes = await readFile(pointerPath);
await writeJson(path.join(OUTPUT_DIRECTORY, "upload-plan.json"), {
  revision: REVISION,
  bucket: "makeable-build-storage-738247188344-us-east-1",
  prefix: "makeable-v1/assembly-assets/v1/approved-visual-catalog-v1",
  glbs: uploadGlbs,
  renders: uploadRenders,
  manifest: { path: manifestPath, sha256: sha256(manifestBytes), byteSize: manifestBytes.length },
  review: { path: reviewPath, sha256: sha256(reviewBytes), byteSize: reviewBytes.length },
  pointer: { path: pointerPath, sha256: sha256(pointerBytes), byteSize: pointerBytes.length },
});
console.log(JSON.stringify({
  revision: REVISION,
  assets: assets.length,
  selectable: nextPointer.catalogSelectionReadyCount,
  candidateReview: nextPointer.candidateReviewCount,
  refreshedAssets: additions.length,
  pointer: nextPointer,
}, null, 2));

function candidate(value) {
  return Object.freeze(value);
}

async function fetchBytes(url) {
  const response = await fetch(url, { headers: { Accept: "application/json", "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
  return { bytes: Buffer.from(await response.arrayBuffer()) };
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
}

function assertHash(bytes, expected, label) {
  const actual = sha256(bytes);
  if (actual !== expected) throw new Error(`${label} SHA-256 mismatch: expected ${expected}, received ${actual}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
