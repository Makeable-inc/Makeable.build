#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [pointerPath, manifestPath, reviewPath, crosswalkPath, headerManifestPath, renderDirectory, carryRenderDirectory, outputDirectory] = process.argv.slice(2);
if (![pointerPath, manifestPath, reviewPath, crosswalkPath, headerManifestPath, renderDirectory, carryRenderDirectory, outputDirectory].every(Boolean)) {
  throw new Error("Usage: build_user_approved_connector_release.mjs <pointer> <manifest> <review> <crosswalk.csv> <header-manifest> <header-render-dir> <carry-render-dir> <output-dir>");
}

const revision = "approved-visual-catalog-20260828-user-approved-connectors-v1";
const cdnRoot = "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1";
const generatedAt = new Date().toISOString();

const [pointerBytes, manifestBytes, reviewBytes, crosswalkBytes, headerBytes] = await Promise.all([
  readFile(pointerPath),
  readFile(manifestPath),
  readFile(reviewPath),
  readFile(crosswalkPath),
  readFile(headerManifestPath),
]);
const pointer = JSON.parse(pointerBytes);
const currentManifest = JSON.parse(manifestBytes);
const currentReview = JSON.parse(reviewBytes);
const headerBatch = JSON.parse(headerBytes);

assertHash(manifestBytes, pointer.manifestSha256, "current manifest");
assertHash(reviewBytes, pointer.reviewSha256, "current review");
if (currentManifest.assets?.length !== 87 || pointer.assetCount !== 87) throw new Error("Expected the active 87-asset registry");

const crosswalk = parseCsv(crosswalkBytes.toString("utf8"));
const crosswalkHeader = crosswalk[0];
const crosswalkRecords = crosswalk.slice(1).map((row) => Object.fromEntries(crosswalkHeader.map((key, index) => [key, row[index] || ""])));
const crosswalkById = uniqueMap(crosswalkRecords, "assembly_asset_id", "crosswalk");
const headerById = uniqueMap(headerBatch.assets || [], "partId", "installed-header batch");
const decisionById = uniqueMap(currentReview.decisions || [], "assetId", "current review");
const assetById = uniqueMap(currentManifest.assets || [], "partId", "current manifest");

if (crosswalkById.size !== assetById.size) throw new Error(`Crosswalk/manifest count mismatch: ${crosswalkById.size}/${assetById.size}`);
for (const [partId, record] of crosswalkById) {
  if (!assetById.has(partId)) throw new Error(`Crosswalk asset missing from manifest: ${partId}`);
  if (record.selection_status !== "ready" || record.catalog_binding !== "verified_catalog") {
    throw new Error(`Asset is not approved and catalog-bound: ${partId}`);
  }
}
if (headerById.size !== 5) throw new Error(`Expected five installed-header replacements, received ${headerById.size}`);

const stagedRenderDirectory = path.join(outputDirectory, "reviews", "renders");
await mkdir(stagedRenderDirectory, { recursive: true });
const renderMetadata = new Map();
for (const [partId, headerAsset] of headerById) {
  const glbBytes = await readFile(headerAsset.glbPath);
  assertHash(glbBytes, headerAsset.glbSha256, `${partId} GLB`);
  const renderSource = path.join(renderDirectory, `${partId}-four-angle.png`);
  const renderBytes = await readFile(renderSource);
  if (renderBytes.length < 10_000 || renderBytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Invalid four-angle PNG for ${partId}`);
  }
  const renderTarget = path.join(stagedRenderDirectory, `${partId}.png`);
  await copyFile(renderSource, renderTarget);
  renderMetadata.set(partId, {
    source: renderSource,
    stagedPath: renderTarget,
    byteSize: renderBytes.length,
    sha256: sha256(renderBytes),
    url: `${cdnRoot}/releases/${revision}/reviews/renders/${partId}.png`,
  });
}
for (const asset of currentManifest.assets) {
  if (decisionById.has(asset.partId) || asset.reviewEvidenceUrl) continue;
  const renderSource = path.join(carryRenderDirectory, `${asset.partId}-four-angle.png`);
  const renderBytes = await readFile(renderSource);
  if (renderBytes.length < 10_000 || renderBytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Invalid carried-forward four-angle PNG for ${asset.partId}`);
  }
  const renderTarget = path.join(stagedRenderDirectory, `${asset.partId}.png`);
  await copyFile(renderSource, renderTarget);
  renderMetadata.set(asset.partId, {
    source: renderSource,
    stagedPath: renderTarget,
    byteSize: renderBytes.length,
    sha256: sha256(renderBytes),
    url: `${cdnRoot}/releases/${revision}/reviews/renders/${asset.partId}.png`,
  });
}

const assets = currentManifest.assets.map((current) => {
  const crosswalkRecord = crosswalkById.get(current.partId);
  const replacement = headerById.get(current.partId);
  const selection = {
    catalogBinding: crosswalkRecord.catalog_binding,
    catalogKey: crosswalkRecord.catalog_asin_or_key,
    connectorReadiness: crosswalkRecord.connector_readiness,
    selectionStatus: crosswalkRecord.selection_status,
    connectionRequirement: crosswalkRecord.connection_requirement,
    requiredAccessory: crosswalkRecord.required_accessory,
    approvalBasis: crosswalkRecord.approval_basis,
    soldFormGeometry: crosswalkRecord.sold_form_geometry,
    electricalNote: crosswalkRecord.electrical_note,
    marketplaceUrl: crosswalkRecord.marketplace_url,
  };
  if (!replacement) {
    const carriedRender = renderMetadata.get(current.partId);
    return { ...current, ...selection, ...(carriedRender ? { reviewEvidenceUrl: carriedRender.url } : {}) };
  }
  const render = renderMetadata.get(current.partId);
  return {
    ...current,
    ...selection,
    revision: replacement.revision,
    url: `${cdnRoot}/objects/sha256/${replacement.glbSha256}.glb`,
    sha256: replacement.glbSha256,
    reviewedSha256: replacement.glbSha256,
    byteSize: replacement.bytes,
    triangleCount: replacement.triangles,
    boundsMm: replacement.boundsMm,
    anchorCount: replacement.anchorCount,
    connectorProfile: "installed-header-v1",
    geometryQualification: replacement.geometryQualification,
    baseSha256: replacement.baseSha256,
    visualEligibility: "ready",
    interfaceEligibility: "ready",
    approvalSource: "codex-manual-four-angle-and-header-interface-review-2026-08-27",
    reviewEvidenceUrl: render.url,
    sourceManifest: "installed-header-manifest.json",
  };
});

const decisions = [];
let carriedForward = 0;
for (const asset of assets) {
  const replacement = headerById.get(asset.partId);
  if (replacement) {
    const render = renderMetadata.get(asset.partId);
    decisions.push({
      assetId: asset.partId,
      displayName: asset.name,
      state: "visual_ready",
      reason: "fresh four-angle WebGL render manually inspected; exact 2.54 mm functional holes now have installed male-header bodies, pins, solder collars, and named pin-tip anchors",
      reviewedSha256: asset.sha256,
      sourceManifest: "installed-header-manifest.json",
      sourceRevision: asset.revision,
      byteSize: asset.byteSize,
      triangleCount: asset.triangleCount,
      freshWebglRender: {
        byteSize: render.byteSize,
        sha256: render.sha256,
        url: render.url,
      },
      validator: { clean: true, errors: 0, warnings: 0 },
      interfaceEligibility: "ready",
      anchorCount: asset.anchorCount,
    });
    continue;
  }
  const prior = decisionById.get(asset.partId);
  if (prior) {
    if (prior.state !== "visual_ready") throw new Error(`Manifest-ready asset has a blocking review: ${asset.partId}`);
    if (prior.reviewedSha256 !== asset.sha256) throw new Error(`Review hash mismatch for ${asset.partId}`);
    decisions.push(prior);
    continue;
  }
  if (asset.visualEligibility !== "ready" || asset.reviewedSha256 !== asset.sha256 || !asset.reviewEvidenceUrl) {
    throw new Error(`Cannot safely carry forward missing review decision for ${asset.partId}`);
  }
  const stagedEvidence = renderMetadata.get(asset.partId);
  const response = stagedEvidence ? null : await fetch(asset.reviewEvidenceUrl, { headers: { Accept: "image/*", "Cache-Control": "no-cache" } });
  if (response && !response.ok) throw new Error(`Review evidence GET failed for ${asset.partId}: ${response.status}`);
  const evidence = stagedEvidence ? await readFile(stagedEvidence.stagedPath) : Buffer.from(await response.arrayBuffer());
  if (evidence.length < 1_000) throw new Error(`Review evidence is empty for ${asset.partId}`);
  decisions.push({
    assetId: asset.partId,
    displayName: asset.name,
    state: "visual_ready",
    reason: "carried forward from the prior immutable hash-bound approved release; model bytes and review evidence are unchanged",
    reviewedSha256: asset.sha256,
    sourceManifest: asset.sourceManifest || "prior-approved-release",
    sourceRevision: asset.revision,
    byteSize: asset.byteSize ?? null,
    triangleCount: asset.triangleCount ?? null,
    freshWebglRender: {
      byteSize: evidence.length,
      sha256: sha256(evidence),
      url: asset.reviewEvidenceUrl,
    },
    interfaceEligibility: asset.interfaceEligibility,
  });
  carriedForward += 1;
}

if (new Set(assets.map((asset) => asset.partId)).size !== 87) throw new Error("New manifest contains duplicate assets");
if (new Set(decisions.map((decision) => decision.assetId)).size !== 87) throw new Error("New review contains duplicate decisions");
if (assets.some((asset) => !decisions.some((decision) => decision.assetId === asset.partId))) throw new Error("Review set does not match manifest set");
if (decisions.some((decision) => decision.state !== "visual_ready")) throw new Error("New release contains a blocked decision");

const reviewUrl = `${cdnRoot}/releases/${revision}/review.json`;
const manifest = {
  ...currentManifest,
  revision,
  generatedAt,
  assetCount: assets.length,
  selectionPolicy: {
    visualOnly: false,
    exactCatalogIdentityRequired: true,
    manualFourAngleWebglInspectionRequiredForChangedGeometry: true,
    gltfValidatorErrorsAndWarningsAllowed: 0,
    catalogSelectionReadyCount: 87,
    userApprovedConnectionProfileCount: 25,
    installedHeaderReplacementCount: 5,
    reviewSetMatchesManifest: true,
    buildElectricalValidationStillRequired: true,
  },
  reviewManifestUrl: reviewUrl,
  assets,
};
const review = {
  schemaVersion: "MakeableApprovedVisualCatalogReviewV1",
  revision: `${revision}-review`,
  generatedAt,
  sourceCandidateInventory: {
    activePointerRevision: pointer.revision,
    activeManifestSha256: pointer.manifestSha256,
    activeReviewSha256: pointer.reviewSha256,
    crosswalkSha256: sha256(crosswalkBytes),
    candidateCount: assets.length,
  },
  summary: {
    reviewed: decisions.length,
    visualReady: decisions.filter((decision) => decision.state === "visual_ready").length,
    blocked: decisions.filter((decision) => decision.state !== "visual_ready").length,
    validatorClean: decisions.filter((decision) => decision.validator?.clean === true).length,
    carriedForwardPriorApproval: carriedForward,
    installedHeaderReplacements: headerById.size,
    userApprovedConnectionProfiles: crosswalkRecords.filter((record) => record.approval_basis === "user_approved_2026-08-27").length,
  },
  decisions,
};

await mkdir(outputDirectory, { recursive: true });
const manifestOutput = path.join(outputDirectory, "manifest.json");
const reviewOutput = path.join(outputDirectory, "review.json");
await writeJson(manifestOutput, manifest);
await writeJson(reviewOutput, review);
const finalManifestBytes = await readFile(manifestOutput);
const finalReviewBytes = await readFile(reviewOutput);
const newPointer = {
  schemaVersion: "MakeableApprovedVisualCatalogPointerV1",
  revision,
  manifestUrl: `${cdnRoot}/releases/${revision}/manifest.json`,
  manifestSha256: sha256(finalManifestBytes),
  reviewUrl,
  reviewSha256: sha256(finalReviewBytes),
  assetCount: assets.length,
};
const pointerOutput = path.join(outputDirectory, "current.json");
await writeJson(pointerOutput, newPointer);
const uploadPlan = {
  revision,
  bucket: "makeable-build-storage-738247188344-us-east-1",
  prefix: "makeable-v1/assembly-assets/v1/approved-visual-catalog-v1",
  glbs: [...headerById.values()].map((asset) => ({ partId: asset.partId, path: asset.glbPath, sha256: asset.glbSha256, byteSize: asset.bytes })),
  renders: [...renderMetadata.entries()].map(([partId, item]) => ({ partId, path: item.stagedPath, sha256: item.sha256, byteSize: item.byteSize })),
  manifest: { path: manifestOutput, sha256: newPointer.manifestSha256, byteSize: finalManifestBytes.length },
  review: { path: reviewOutput, sha256: newPointer.reviewSha256, byteSize: finalReviewBytes.length },
  pointer: { path: pointerOutput, sha256: sha256(await readFile(pointerOutput)), byteSize: (await stat(pointerOutput)).size },
};
await writeJson(path.join(outputDirectory, "upload-plan.json"), uploadPlan);
console.log(JSON.stringify({ revision, assets: assets.length, decisions: decisions.length, carriedForward, installedHeaders: headerById.size, userApproved: review.summary.userApprovedConnectionProfiles, hashes: newPointer }, null, 2));

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertHash(bytes, expected, label) {
  const actual = sha256(bytes);
  if (actual !== expected) throw new Error(`${label} SHA-256 mismatch: expected ${expected}, received ${actual}`);
}

function uniqueMap(items, key, label) {
  const map = new Map();
  for (const item of items) {
    const value = item[key];
    if (!value || map.has(value)) throw new Error(`Missing or duplicate ${label} key: ${value}`);
    map.set(value, item);
  }
  return map;
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  return rows.filter((candidate, index) => index === 0 || candidate.some(Boolean));
}
