#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const REVISION = "approved-visual-catalog-20260828-family-safe-connectors-v5";
const EXPECTED_PARENT = "approved-visual-catalog-20260828-family-safe-connectors-v4";
const CDN_ROOT = "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1";
const BUCKET = "makeable-build-storage-738247188344-us-east-1";
const PREFIX = "makeable-v1/assembly-assets/v1/approved-visual-catalog-v1";
const OUTPUT = path.resolve(process.argv[2] || `artifacts/aws-assembly-release/${REVISION}`);
const POINTER_URL = `${CDN_ROOT}/current.json`;
const CABLE_ROOT = path.join(ROOT, "artifacts/high-fidelity-glb/2026-08-28/adafruit-4397-qwiic-to-female-sockets");

const pointerBytes = await fetchBytes(`${POINTER_URL}?cb=${Date.now()}`);
const pointer = parseJson(pointerBytes, "active pointer");
if (pointer.revision !== EXPECTED_PARENT || pointer.assetCount !== 91) {
  throw new Error(`Refusing to branch unexpected active registry ${pointer.revision}/${pointer.assetCount}`);
}
const [manifestBytes, reviewBytes] = await Promise.all([
  fetchBytes(`${pointer.manifestUrl}?cb=${Date.now()}`),
  fetchBytes(`${pointer.reviewUrl}?cb=${Date.now()}`),
]);
assertHash(manifestBytes, pointer.manifestSha256, "active manifest");
assertHash(reviewBytes, pointer.reviewSha256, "active review");
const parentManifest = parseJson(manifestBytes, "active manifest");
const parentReview = parseJson(reviewBytes, "active review");

const assetsById = new Map(parentManifest.assets.map((asset) => [asset.partId, asset]));
const xiao = requiredAsset(assetsById, "seeed-xiao-esp32c3");
const scd41 = requiredAsset(assetsById, "adafruit-scd41-co2-breakout-5190");
const interfaceReports = new Map();
interfaceReports.set(xiao.partId, await qualifyXiao(xiao));
interfaceReports.set(scd41.partId, await qualifyScd41(scd41));

const cableManifestPath = path.join(CABLE_ROOT, "manifest.json");
const cableReviewPath = path.join(CABLE_ROOT, "reports", "visual-review.json");
const cableManifest = parseJson(await readFile(cableManifestPath), "cable manifest");
const cableReview = parseJson(await readFile(cableReviewPath), "cable review");
if ([cableManifest.visualEligibility, cableManifest.interfaceEligibility, cableManifest.selectionStatus].some((state) => state !== "ready")) {
  throw new Error("Cable asset is not fully ready.");
}
const cableGlbPath = path.join(CABLE_ROOT, cableManifest.glb.path);
const cableRenderPath = path.join(CABLE_ROOT, cableReview.render.path);
const [cableGlb, cableRender] = await Promise.all([readFile(cableGlbPath), readFile(cableRenderPath)]);
assertHash(cableGlb, cableManifest.glb.sha256, "cable GLB");
assertHash(cableRender, cableReview.render.sha256, "cable review render");
const cableJson = parseGlb(cableGlb, "cable GLB");
assertUniqueNodes(cableJson, cableManifest.requiredNodes);

const stagedRenderDirectory = path.join(OUTPUT, "reviews", "renders");
await mkdir(stagedRenderDirectory, { recursive: true });
const stagedCableRender = path.join(stagedRenderDirectory, `${cableManifest.partId}.png`);
await copyFile(cableRenderPath, stagedCableRender);
const cableReviewUrl = `${CDN_ROOT}/releases/${REVISION}/reviews/renders/${cableManifest.partId}.png`;
const cableAsset = {
  partId: cableManifest.partId,
  name: cableManifest.name,
  revision: cableManifest.revision,
  url: `${CDN_ROOT}/objects/sha256/${cableManifest.glb.sha256}.glb`,
  sha256: cableManifest.glb.sha256,
  reviewedSha256: cableManifest.glb.sha256,
  byteSize: cableGlb.length,
  triangleCount: null,
  boundsMm: cableManifest.glb.boundsMm,
  anchorCount: cableManifest.requiredNodes.length,
  visualEligibility: "ready",
  interfaceEligibility: "ready",
  selectionStatus: "ready",
  approvalSource: cableManifest.approvalSource,
  reviewEvidenceUrl: cableReviewUrl,
  sourceManifest: "adafruit-4397-qwiic-to-female-sockets/manifest.json",
  catalogBinding: "verified_catalog",
  catalogKey: cableManifest.catalogKey,
  connectorReadiness: "factory_qwiic_to_four_individual_female_sockets",
  connectionRequirement: "Use the keyed JST-SH plug at the sensor and the four individual female sockets on verified 2.54 mm male pins; retain the 150 mm cable service loop.",
  requiredAccessory: "",
  approvalBasis: "verified_exact_connection",
  soldFormGeometry: "official-150mm-factory-cable-deterministic-interface-v1",
  electricalNote: "Qwiic order is black GND, red 3V3, blue SDA, yellow SCL; verify the destination pin map before power.",
  marketplaceUrl: "https://www.amazon.com/dp/B09WLRBKWT",
  manufacturerUrl: cableManifest.manufacturerUrl,
  cableProfile: {
    nominalLengthMm: 150,
    connectorFamily: cableManifest.connectorFamily,
    controllerTermination: cableManifest.controllerTermination,
    flexGeometryMode: cableManifest.flexGeometryMode,
    requiredNodes: cableManifest.requiredNodes,
  },
};

let cableReplaced = false;
const assets = parentManifest.assets.map((asset) => {
  if (asset.partId === cableAsset.partId) {
    cableReplaced = true;
    return cableAsset;
  }
  const report = interfaceReports.get(asset.partId);
  if (!report) return asset;
  return {
    ...asset,
    interfaceEligibility: "ready",
    interfaceProfile: report,
    approvalSource: `${asset.approvalSource || "prior-approved-visual"}+deterministic-interface-contract-2026-08-28`,
  };
});
if (!cableReplaced) assets.push(cableAsset);
if (new Set(assets.map((asset) => asset.partId)).size !== 91) throw new Error("Release asset set is not exactly 91 unique IDs.");

const priorDecisions = new Map((parentReview.decisions || []).map((decision) => [decision.assetId, decision]));
const decisions = parentManifest.assets.filter((asset) => asset.partId !== cableAsset.partId).map((asset) => {
  const prior = priorDecisions.get(asset.partId);
  if (!prior || prior.reviewedSha256 !== asset.sha256) throw new Error(`Missing hash-bound prior review for ${asset.partId}`);
  const report = interfaceReports.get(asset.partId);
  return report ? { ...prior, interfaceEligibility: "ready", interfaceQualification: report } : prior;
});
decisions.push({
  assetId: cableAsset.partId,
  displayName: cableAsset.name,
  state: "visual_ready",
  reason: "official Adafruit #4397 identity, 150 mm length, connector family, color order, unique named interface nodes, and offline four-angle catalog render are hash-bound",
  reviewedSha256: cableAsset.sha256,
  sourceManifest: cableAsset.sourceManifest,
  sourceRevision: cableAsset.revision,
  byteSize: cableAsset.byteSize,
  freshWebglRender: { byteSize: cableRender.length, sha256: sha256(cableRender), url: cableReviewUrl },
  validator: { clean: true, errors: 0, warnings: 0, method: "GLB2 container and unique required-node contract" },
  interfaceEligibility: "ready",
  interfaceQualification: cableAsset.cableProfile,
  offlineCatalogVisualPasses: 1,
  productionRuntimeVisualPasses: 0,
});

const generatedAt = new Date().toISOString();
const manifestUrl = `${CDN_ROOT}/releases/${REVISION}/manifest.json`;
const reviewUrl = `${CDN_ROOT}/releases/${REVISION}/review.json`;
const manifest = {
  ...parentManifest,
  revision: REVISION,
  generatedAt,
  assetCount: assets.length,
  reviewManifestUrl: reviewUrl,
  selectionPolicy: {
    ...parentManifest.selectionPolicy,
    catalogSelectionReadyCount: assets.filter((asset) => asset.selectionStatus === "ready").length,
    candidateReviewCount: assets.filter((asset) => asset.selectionStatus !== "ready").length,
    controllerFamilyPolicy: "xiao-c3supermini-s3devkit44-v1",
    productionRequiresInterfaceEligibilityReady: true,
    productionRequiresImmutableAwsConnectorAsset: true,
    superMiniCandidateRemainsBlocked: true,
    s3Devkit44CandidateRemainsBlocked: true,
    productionRuntimeVisualPasses: 0,
  },
  assets,
};
const review = {
  ...parentReview,
  revision: `${REVISION}-review`,
  generatedAt,
  sourceCandidateInventory: {
    activePointerRevision: pointer.revision,
    activeManifestSha256: pointer.manifestSha256,
    activeReviewSha256: pointer.reviewSha256,
    candidateCount: assets.length,
  },
  summary: {
    reviewed: decisions.length,
    visualReady: decisions.filter((decision) => decision.state === "visual_ready").length,
    blocked: decisions.filter((decision) => decision.state !== "visual_ready").length,
    interfaceReadyPromotions: 0,
    interfaceReadyRequalifications: 3,
    familyCandidatesRetainedBlocked: 2,
    productionRuntimeVisualPasses: 0,
  },
  decisions,
};

await mkdir(OUTPUT, { recursive: true });
const manifestPath = path.join(OUTPUT, "manifest.json");
const reviewPath = path.join(OUTPUT, "review.json");
await writeJson(manifestPath, manifest);
await writeJson(reviewPath, review);
const finalManifest = await readFile(manifestPath);
const finalReview = await readFile(reviewPath);
const newPointer = {
  schemaVersion: "MakeableApprovedVisualCatalogPointerV1",
  revision: REVISION,
  manifestUrl,
  manifestSha256: sha256(finalManifest),
  reviewUrl,
  reviewSha256: sha256(finalReview),
  assetCount: assets.length,
};
const pointerPath = path.join(OUTPUT, "current.json");
await writeJson(pointerPath, newPointer);
const uploadPlan = {
  revision: REVISION,
  bucket: BUCKET,
  prefix: PREFIX,
  glbs: [{ partId: cableAsset.partId, path: cableGlbPath, sha256: cableAsset.sha256, byteSize: cableGlb.length }],
  renders: [{ partId: cableAsset.partId, path: stagedCableRender, sha256: sha256(cableRender), byteSize: cableRender.length }],
  manifest: { path: manifestPath, sha256: newPointer.manifestSha256, byteSize: finalManifest.length },
  review: { path: reviewPath, sha256: newPointer.reviewSha256, byteSize: finalReview.length },
  pointer: { path: pointerPath, sha256: sha256(await readFile(pointerPath)), byteSize: (await stat(pointerPath)).size },
};
await writeJson(path.join(OUTPUT, "upload-plan.json"), uploadPlan);
console.log(JSON.stringify({ revision: REVISION, parent: pointer.revision, assets: assets.length, promotedInterfaces: [...interfaceReports.keys(), cableAsset.partId], retainedCandidates: ["aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1", "aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx"], hashes: newPointer }, null, 2));

async function qualifyXiao(asset) {
  const bytes = await fetchBytes(asset.url);
  assertHash(bytes, asset.sha256, asset.partId);
  const gltf = parseGlb(bytes, asset.partId);
  const pins = [
    "interface:seeed-xiao-esp32c3:right:02:gnd",
    "interface:seeed-xiao-esp32c3:right:03:3v3",
    "interface:seeed-xiao-esp32c3:left:05:d4",
    "interface:seeed-xiao-esp32c3:left:06:d5",
  ];
  assertUniqueNodes(gltf, [...pins, "usb-c:shield-shell", "pcb:center"]);
  const pcbNodes = (gltf.nodes || []).map((node) => node.name).filter((name) => /^pcb:/.test(name || ""));
  const pcb = unionBounds(pcbNodes.map((name) => nodeBounds(gltf, name)));
  const usb = nodeBounds(gltf, "usb-c:shield-shell");
  const endpoints = pins.map((name) => {
    const bounds = nodeBounds(gltf, name);
    const undersideExposureMm = (pcb.min[2] - bounds.min[2]) * 1000;
    const topExposureMm = (bounds.max[2] - pcb.max[2]) * 1000;
    if (undersideExposureMm < 1.5 || undersideExposureMm - Math.max(0, topExposureMm) < 1) throw new Error(`${name} does not have a deterministic underside shank.`);
    const tip = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, bounds.min[2]];
    if (inside(usb, tip, 0.002)) throw new Error(`${name} enters the USB-C keepout.`);
    return { nodeName: name, tip, normal: [0, 0, -1], matingSide: "underside", undersideExposureMm: round(undersideExposureMm) };
  });
  return { version: "xiao-esp32c3-interface-v1", connectorFamily: "2.54mm_male_header", endpoints, pcbBounds: pcb, usbKeepoutNode: "usb-c:shield-shell", usbKeepoutBounds: usb, nodeNamesUnique: true };
}

async function qualifyScd41(asset) {
  const bytes = await fetchBytes(asset.url);
  assertHash(bytes, asset.sha256, asset.partId);
  const gltf = parseGlb(bytes, asset.partId);
  const contacts = [0, 1, 2, 3].map((index) => `component:CONN4:contact-tip:${index}`);
  assertUniqueNodes(gltf, ["anchor:CONN4_STEMMA_QT", "component:CONN4:mouth-cavity", ...contacts]);
  const mouth = nodeBounds(gltf, "component:CONN4:mouth-cavity");
  const endpoints = contacts.map((name) => {
    const bounds = nodeBounds(gltf, name);
    const center = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2);
    if (center[1] < mouth.min[1] - 0.001 || center[1] > mouth.max[1] + 0.001 || center[2] < mouth.min[2] - 0.001 || center[2] > mouth.max[2] + 0.001) {
      throw new Error(`${name} is outside the CONN4 mouth bounds.`);
    }
    return { nodeName: name, position: center, normal: [-1, 0, 0], matingSide: "side_entry_keyed" };
  });
  for (let index = 1; index < endpoints.length; index += 1) if (!(endpoints[index - 1].position[1] > endpoints[index].position[1])) throw new Error("CONN4 contact order is not deterministic.");
  return { version: "adafruit-scd41-conn4-interface-v1", connectorFamily: "jst_sh_1.0mm_4p_qwiic", connectorNode: "anchor:CONN4_STEMMA_QT", mouthNode: "component:CONN4:mouth-cavity", mouthBounds: mouth, endpoints, nodeNamesUnique: true };
}

function requiredAsset(map, id) { const asset = map.get(id); if (!asset) throw new Error(`Missing parent asset ${id}`); return asset; }
function parseGlb(bytes, label) { if (bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`${label} is not GLB 2.0`); const length = bytes.readUInt32LE(12); return JSON.parse(bytes.subarray(20, 20 + length).toString("utf8")); }
function assertUniqueNodes(gltf, required) { const counts = new Map(); for (const node of gltf.nodes || []) if (node.name) counts.set(node.name, (counts.get(node.name) || 0) + 1); for (const name of required) if (counts.get(name) !== 1) throw new Error(`Required node missing or duplicated: ${name}`); }
function nodeBounds(gltf, name) { const node = (gltf.nodes || []).find((item) => item.name === name); if (!node || node.mesh == null || node.matrix || node.translation || node.rotation || node.scale) throw new Error(`Node ${name} lacks direct immutable mesh bounds.`); const primitiveBounds = gltf.meshes[node.mesh].primitives.map((primitive) => gltf.accessors[primitive.attributes.POSITION]).map((accessor) => ({ min: accessor.min, max: accessor.max })); return unionBounds(primitiveBounds); }
function unionBounds(bounds) { return { min: [0, 1, 2].map((axis) => Math.min(...bounds.map((item) => item.min[axis]))), max: [0, 1, 2].map((axis) => Math.max(...bounds.map((item) => item.max[axis]))) }; }
function inside(bounds, point, padding = 0) { return point.every((value, axis) => value >= bounds.min[axis] - padding && value <= bounds.max[axis] + padding); }
async function fetchBytes(url) { const response = await fetch(url, { headers: { Accept: "application/json,model/gltf-binary,*/*", "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(60_000) }); if (!response.ok) throw new Error(`${url} returned ${response.status}`); return Buffer.from(await response.arrayBuffer()); }
function parseJson(bytes, label) { try { return JSON.parse(Buffer.from(bytes).toString("utf8")); } catch (error) { throw new Error(`${label} is invalid JSON: ${error.message}`); } }
function assertHash(bytes, expected, label) { const actual = sha256(bytes); if (actual !== expected) throw new Error(`${label} SHA-256 mismatch: ${actual}`); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function round(value) { return Math.round(value * 1000) / 1000; }
async function writeJson(file, value) { await writeFile(file, `${JSON.stringify(value, null, 2)}\n`); }
