import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST_PATH = path.join(
  ROOT,
  "apps/landing/public/assembly-assets/benchmark-interface-v2/manifest.json",
);

export async function loadAssemblyInterfaceManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw);
}

export function summarizeAssemblyInterface(manifest) {
  const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
  const projects = Array.isArray(manifest?.projects) ? manifest.projects : [];
  const readyAssets = assets.filter((asset) => String(asset?.interfaceEligibility?.state) === "ready");
  const readyProjects = projects.filter((project) => String(project?.state) === "ready");
  return {
    revision: manifest?.revision || "",
    assetCount: assets.length,
    readyAssetCount: readyAssets.length,
    blockedAssetCount: Math.max(0, assets.length - readyAssets.length),
    projectCount: projects.length,
    readyProjectCount: readyProjects.length,
  };
}

export async function validateAssemblyInterfaceManifest(manifest, options = {}) {
  const baseDir = options.baseDir || DEFAULT_MANIFEST_PATH.replace(/\/manifest\.json$/, "");
  const toleranceMm = Number.isFinite(options.toleranceMm) ? options.toleranceMm : 0.15;
  const errors = [];
  const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
  const projects = Array.isArray(manifest?.projects) ? manifest.projects : [];

  for (const asset of assets) {
    const validation = await validateAssemblyAsset(asset, { baseDir, toleranceMm });
    if (!validation.ok) {
      errors.push(...validation.errors.map((error) => `${asset.assetId}: ${error}`));
    }
  }

  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  for (const project of projects) {
    const validation = validateAssemblyProject(project, assetById);
    if (!validation.ok) {
      errors.push(...validation.errors.map((error) => `${project.buildId}: ${error}`));
    }
  }

  return { ok: errors.length === 0, errors };
}

export async function validateAssemblyAsset(asset, options = {}) {
  const baseDir = options.baseDir || path.dirname(DEFAULT_MANIFEST_PATH);
  const toleranceMm = Number.isFinite(options.toleranceMm) ? options.toleranceMm : 0.15;
  const errors = [];

  if (!asset?.assetId) errors.push("missing assetId");
  if (!asset?.glb?.file) errors.push("missing glb file reference");
  if (!Array.isArray(asset?.anchors) || !asset.anchors.length) errors.push("missing anchors");
  if (String(asset?.interfaceEligibility?.state) !== "ready") {
    errors.push(`interface eligibility is ${String(asset?.interfaceEligibility?.state || "missing")}`);
  }

  if (asset?.glb?.file) {
    const filePath = path.join(baseDir, asset.glb.file);
    const raw = await readFile(filePath);
    const actualHash = sha256(raw);
    if (asset.glb.sha256 && actualHash !== asset.glb.sha256) {
      errors.push(`sha256 mismatch (expected ${asset.glb.sha256}, got ${actualHash})`);
    }
    const glb = parseGlb(raw);
    const nodeMap = new Map(
      (glb.nodes || []).map((node) => [
        node.name,
        Array.isArray(node.matrix) && node.matrix.length === 16
          ? [node.matrix[12], node.matrix[13], node.matrix[14]]
          : Array.isArray(node.translation)
            ? node.translation
            : null,
      ]),
    );

    for (const anchor of asset.anchors || []) {
      if (!nodeMap.has(anchor.name)) {
        errors.push(`missing GLB node for anchor ${anchor.name}`);
        continue;
      }
      const actual = nodeMap.get(anchor.name);
      if (!actual) {
        errors.push(`anchor ${anchor.name} has no stored transform`);
        continue;
      }
      const expected = anchor.positionMm || anchor.position || [0, 0, 0];
      const actualMm = [
        Number(actual[0] || 0) * 1000,
        Number(actual[1] || 0) * 1000,
        Number(actual[2] || 0) * 1000,
      ];
      const dx = Math.abs(actualMm[0] - Number(expected[0] || 0));
      const dy = Math.abs(actualMm[1] - Number(expected[1] || 0));
      const dz = Math.abs(actualMm[2] - Number(expected[2] || 0));
      if (dx > toleranceMm || dy > toleranceMm || dz > toleranceMm) {
        errors.push(
          `anchor ${anchor.name} moved by ${formatMm(dx)}, ${formatMm(dy)}, ${formatMm(dz)} mm`,
        );
      }
    }
  }

  const boundsMm = Array.isArray(asset?.boundsMm) && asset.boundsMm.length === 6
    ? asset.boundsMm
    : Array.isArray(asset?.glb?.boundsMm) && asset.glb.boundsMm.length === 6
      ? asset.glb.boundsMm
      : null;
  if (boundsMm) {
    const [minX, minY, minZ, maxX, maxY, maxZ] = boundsMm.map((value) => Number(value));
    if (!(maxX > minX && maxY > minY && maxZ > minZ)) {
      errors.push("invalid bounds");
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateAssemblyProject(project, assetById = new Map()) {
  const errors = [];
  if (!project?.buildId) errors.push("missing buildId");
  if (String(project?.state) !== "ready") errors.push(`state is ${String(project?.state || "missing")}`);

  const assets = Array.isArray(project?.assets) ? project.assets : [];
  const requiredAssetIds = Array.isArray(project?.requiredAssetIds) && project.requiredAssetIds.length
    ? project.requiredAssetIds
    : assets.map((asset) => (typeof asset === "string" ? asset : asset?.assetId)).filter(Boolean);

  for (const assetId of requiredAssetIds) {
    if (!assetById.has(assetId)) errors.push(`references missing asset ${assetId}`);
    else if (String(assetById.get(assetId)?.interfaceEligibility?.state) !== "ready") {
      errors.push(`asset ${assetId} is not ready`);
    }
  }

  for (const wire of Array.isArray(project?.wires) ? project.wires : []) {
    if (!resolveEndpoint(wire.from, assetById)) {
      errors.push(`wire ${wire.id || wire.signal || "unknown"} has unresolved source`);
    }
    if (!resolveEndpoint(wire.to, assetById)) {
      errors.push(`wire ${wire.id || wire.signal || "unknown"} has unresolved target`);
    }
  }

  for (const step of Array.isArray(project?.steps) ? project.steps : []) {
    if (!step?.title) errors.push("step missing title");
    if (!Array.isArray(step?.visibleAssets)) errors.push(`step ${step?.title || "unknown"} missing visibleAssets`);
  }

  return { ok: errors.length === 0, errors };
}

export function resolveEndpoint(endpoint, assetById = new Map()) {
  if (!endpoint || !endpoint.assetId || !endpoint.anchor) return null;
  const asset = assetById.get(endpoint.assetId);
  if (!asset || String(asset?.interfaceEligibility?.state) !== "ready") return null;
  const anchor = (asset.anchors || []).find((item) => item.name === endpoint.anchor);
  if (!anchor) return null;
  return { asset, anchor };
}

export function parseGlb(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length < 20) throw new Error("GLB file too small");
  const magic = bytes.toString("ascii", 0, 4);
  const version = bytes.readUInt32LE(4);
  if (magic !== "glTF" || version !== 2) throw new Error("Unsupported GLB header");

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.toString("ascii", offset + 4, offset + 8);
    offset += 8;
    const chunk = bytes.subarray(offset, offset + chunkLength);
    offset += chunkLength;
    if (chunkType === "JSON") {
      const raw = chunk.toString("utf8").replace(/\0+$/, "");
      return JSON.parse(raw);
    }
  }

  throw new Error("No JSON chunk found in GLB");
}

export async function sha256File(filePath) {
  const raw = await readFile(filePath);
  return sha256(raw);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function formatMm(value) {
  return Number(value || 0).toFixed(3);
}
