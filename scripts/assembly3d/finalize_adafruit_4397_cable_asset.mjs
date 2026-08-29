#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] || "artifacts/high-fidelity-glb/2026-08-28/adafruit-4397-qwiic-to-female-sockets");
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const glbPath = path.join(root, manifest.glb.path);
const renderPath = path.join(root, "renders", `${manifest.partId}-four-angle.png`);
const [glb, render] = await Promise.all([readFile(glbPath), readFile(renderPath)]);

if (sha256(glb) !== manifest.glb.sha256) throw new Error("Cable GLB hash mismatch.");
if (glb.toString("ascii", 0, 4) !== "glTF" || glb.readUInt32LE(4) !== 2 || glb.readUInt32LE(8) !== glb.length) {
  throw new Error("Cable is not a valid GLB 2.0 container.");
}
if (render.length < 10_000 || render.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
  throw new Error("Cable four-angle review image is invalid.");
}
const jsonLength = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8"));
const nodeCounts = new Map();
for (const node of gltf.nodes || []) if (node.name) nodeCounts.set(node.name, (nodeCounts.get(node.name) || 0) + 1);
for (const required of manifest.requiredNodes || []) {
  if (nodeCounts.get(required) !== 1) throw new Error(`Required cable node is missing or duplicated: ${required}`);
}
const duplicates = [...nodeCounts].filter(([, count]) => count > 1).map(([name]) => name);
if (duplicates.length) throw new Error(`Cable GLB contains duplicate named nodes: ${duplicates.join(", ")}`);
const sceneRoots = gltf.scenes?.[gltf.scene || 0]?.nodes || [];
const reachable = new Set();
const visit = (index) => {
  if (reachable.has(index)) return;
  reachable.add(index);
  for (const child of gltf.nodes?.[index]?.children || []) visit(child);
};
for (const index of sceneRoots) visit(index);
for (const required of manifest.requiredNodes || []) {
  const index = (gltf.nodes || []).findIndex((node) => node.name === required);
  if (!reachable.has(index)) throw new Error(`Required cable node is unreachable from the active scene: ${required}`);
}

const review = {
  schemaVersion: "MakeableCableInterfaceReviewV1",
  partId: manifest.partId,
  revision: manifest.revision,
  reviewedSha256: manifest.glb.sha256,
  state: "visual_ready",
  interfaceEligibility: "ready",
  visualEligibility: "ready",
  selectionStatus: "ready",
  officialEvidence: {
    manufacturerUrl: "https://www.adafruit.com/product/4397",
    productId: "4397",
    nominalLengthMm: 150,
    connector: "JST-SH 1.0 mm four-pin to four premium female sockets",
    colorOrder: ["gnd", "3v3", "sda", "scl"],
  },
  deterministicChecks: {
    glb2Container: true,
    uniqueRequiredNodes: true,
    allRequiredNodesReachableFromActiveScene: true,
    requiredNodeCount: manifest.requiredNodes.length,
    nominalLengthLocked: manifest.nominalLengthMm === 150,
  },
  offlineCatalogVisualPasses: 1,
  productionRuntimeVisualPasses: 0,
  render: { path: path.relative(root, renderPath), sha256: sha256(render), bytes: render.length },
};
await writeFile(path.join(root, "reports", "visual-review.json"), `${JSON.stringify(review, null, 2)}\n`);
await writeFile(manifestPath, `${JSON.stringify({
  ...manifest,
  visualEligibility: "ready",
  interfaceEligibility: "ready",
  selectionStatus: "ready",
  approvalSource: "official-spec-plus-deterministic-interface-and-offline-four-angle-review-2026-08-28",
  reviewEvidence: review.render,
}, null, 2)}\n`);
console.log(JSON.stringify(review, null, 2));

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
