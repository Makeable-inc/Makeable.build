import { createHash } from "node:crypto";

const ID_PATTERN = /^[A-Za-z0-9_-]{3,140}$/;
const SHA_PATTERN = /^[a-f0-9]{64}$/;

export function normalizeBuildPrompt(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 2_000);
}

export function createBuildRequestIdentity({
  requestId,
  jobId,
  buildId,
  prompt,
  accountHash = "",
  catalogRevision = "unversioned-catalog",
  promptPackageRevision = "unversioned-prompts",
} = {}) {
  const normalizedPrompt = normalizeBuildPrompt(prompt);
  const identity = {
    schemaVersion: "MakeableBuildIdentityV1",
    requestId: String(requestId || ""),
    jobId: String(jobId || ""),
    buildId: String(buildId || ""),
    normalizedPrompt,
    accountHash: String(accountHash || ""),
    catalogRevision: String(catalogRevision || ""),
    promptPackageRevision: String(promptPackageRevision || ""),
  };
  assertBuildIdentity(identity);
  return {
    ...identity,
    requestFingerprint: sha256(canonicalJson(identity)),
  };
}

export function assertBuildIdentity(identity, expected = null) {
  if (!identity || identity.schemaVersion !== "MakeableBuildIdentityV1") {
    throw new Error("build_identity_schema_invalid");
  }
  for (const field of ["requestId", "jobId", "buildId"]) {
    if (!ID_PATTERN.test(String(identity[field] || ""))) {
      throw new Error(`build_identity_${field}_invalid`);
    }
  }
  if (!normalizeBuildPrompt(identity.normalizedPrompt)) {
    throw new Error("build_identity_prompt_missing");
  }
  for (const field of ["catalogRevision", "promptPackageRevision"]) {
    if (!String(identity[field] || "").trim()) throw new Error(`build_identity_${field}_missing`);
  }
  if (identity.requestFingerprint) {
    const unsigned = { ...identity };
    delete unsigned.requestFingerprint;
    const calculated = sha256(canonicalJson(unsigned));
    if (!SHA_PATTERN.test(identity.requestFingerprint) || identity.requestFingerprint !== calculated) {
      throw new Error("build_identity_fingerprint_mismatch");
    }
  }
  if (expected) {
    for (const field of [
      "requestId",
      "jobId",
      "buildId",
      "normalizedPrompt",
      "accountHash",
      "catalogRevision",
      "promptPackageRevision",
      "requestFingerprint",
    ]) {
      if (String(identity[field] || "") !== String(expected[field] || "")) {
        throw new Error(`build_identity_${field}_mismatch`);
      }
    }
  }
  return true;
}

export function bindAtomicBuildManifest(build, expectedIdentity) {
  assertBuildIdentity(expectedIdentity);
  if (!build || build.id !== expectedIdentity.buildId) throw new Error("build_manifest_route_identity_mismatch");
  if (normalizeBuildPrompt(build.idea) !== expectedIdentity.normalizedPrompt) {
    throw new Error("build_manifest_prompt_lineage_mismatch");
  }

  const semantic = build.semanticFulfillment;
  const assembly = build.artifacts?.assembly;
  if (build.image?.buildId !== expectedIdentity.buildId
    || build.image?.requestFingerprint !== expectedIdentity.requestFingerprint
    || build.artifacts?.lineage?.buildId !== expectedIdentity.buildId
    || build.artifacts?.lineage?.requestFingerprint !== expectedIdentity.requestFingerprint) {
    throw new Error("build_manifest_artifact_lineage_mismatch");
  }
  const guideSteps = Array.isArray(assembly?.guideSteps) ? assembly.guideSteps : [];
  const wires = Array.isArray(assembly?.wires) ? assembly.wires : [];
  const requiredAssets = Array.isArray(assembly?.requiredAssets) ? assembly.requiredAssets : [];
  const image = build.image || null;
  const imageContentSha256 = imageContentFingerprint(image);
  const artifactStates = {
    overview: {
      state: build.title && build.summary && image?.url ? "ready" : "blocked_with_reason",
      reason: build.title && build.summary && image?.url ? "" : "Title, summary, or hero is missing.",
    },
    parts: {
      state: Array.isArray(build.parts) && build.parts.length ? "ready" : "blocked_with_reason",
      reason: Array.isArray(build.parts) && build.parts.length ? "" : "The exact parts list is missing.",
    },
    wiring: {
      state: assembly?.state === "ready" && guideSteps.length ? "ready" : "blocked_with_reason",
      reason: assembly?.state === "ready" && guideSteps.length ? "" : "The exact wiring guide is not ready.",
    },
    enclosure: {
      state: "not_generated",
      reason: "Not generated for this circuit-only build.",
    },
    code: {
      state: "not_generated",
      reason: "Not generated for this circuit-only build.",
    },
  };

  const manifestPayload = {
    schemaVersion: "MakeableAtomicBuildManifestV1",
    identity: expectedIdentity,
    project: {
      title: String(build.title || ""),
      summary: String(build.summary || ""),
      behavior: String(build.behavior || ""),
      status: "Ready",
    },
    semanticFulfillment: {
      requestedCapabilities: semantic?.requestedCapabilities || [],
      providedCapabilities: semantic?.providedCapabilities || [],
      missingCapabilities: semantic?.missingCapabilities || [],
      unrelatedParts: semantic?.unrelatedParts || [],
      planUnrequestedCapabilities: semantic?.planUnrequestedCapabilities || [],
      coveragePercent: Number(semantic?.coveragePercent || 0),
      ok: semantic?.ok === true,
    },
    hero: {
      source: String(image?.source || ""),
      model: String(image?.model || ""),
      contentSha256: imageContentSha256,
    },
    bom: (build.parts || []).map((part) => ({
      id: String(part.id || part.asin || part.name || ""),
      name: String(part.name || ""),
      purpose: String(part.why || ""),
      quantity: Math.max(1, Number(part.quantity || 1)),
      packQty: Math.max(1, Number(part.packQty || 1)),
      assetIds: (part.assemblyAssets || []).map((asset) => String(asset.partId || "")),
    })),
    circuit: {
      assemblySchemaVersion: String(assembly?.schemaVersion || ""),
      contractFingerprint: String(assembly?.contractFingerprint || ""),
      requiredAssets: requiredAssets.map((asset) => ({
        id: String(asset.id || ""),
        sha256: String(asset.sha256 || ""),
      })),
      wireIds: wires.map((wire) => String(wire.id || "")),
      guideStepIds: guideSteps.map((step) => String(step.id || "")),
    },
    artifactStates,
  };
  const manifest = {
    ...manifestPayload,
    manifestSha256: sha256(canonicalJson(manifestPayload)),
  };
  const completedBuild = {
    ...build,
    identity: expectedIdentity,
    artifactStates,
    manifest,
    status: "Ready",
  };
  assertAtomicBuildManifest(completedBuild, expectedIdentity);
  return completedBuild;
}

export function assertAtomicBuildManifest(build, expectedIdentity) {
  if (!build?.manifest || build.manifest.schemaVersion !== "MakeableAtomicBuildManifestV1") {
    throw new Error("atomic_build_manifest_missing");
  }
  assertBuildIdentity(build.identity, expectedIdentity);
  assertBuildIdentity(build.manifest.identity, expectedIdentity);
  if (build.id !== expectedIdentity.buildId || build.manifest.identity.buildId !== build.id) {
    throw new Error("atomic_build_manifest_build_id_mismatch");
  }
  if (normalizeBuildPrompt(build.idea) !== expectedIdentity.normalizedPrompt) {
    throw new Error("atomic_build_manifest_prompt_mismatch");
  }
  if (build.manifest.project.title !== String(build.title || "")
    || build.manifest.project.summary !== String(build.summary || "")
    || build.manifest.project.behavior !== String(build.behavior || "")) {
    throw new Error("atomic_build_manifest_project_mismatch");
  }
  const unsigned = { ...build.manifest };
  delete unsigned.manifestSha256;
  if (!SHA_PATTERN.test(build.manifest.manifestSha256)
    || sha256(canonicalJson(unsigned)) !== build.manifest.manifestSha256) {
    throw new Error("atomic_build_manifest_hash_mismatch");
  }
  if (build.manifest.semanticFulfillment.ok !== true
    || build.manifest.semanticFulfillment.coveragePercent !== 100
    || build.manifest.semanticFulfillment.missingCapabilities.length
    || build.manifest.semanticFulfillment.unrelatedParts.length
    || build.manifest.semanticFulfillment.planUnrequestedCapabilities.length) {
    throw new Error("atomic_build_manifest_semantic_gate_failed");
  }
  const currentSemantic = {
    requestedCapabilities: build.semanticFulfillment?.requestedCapabilities || [],
    providedCapabilities: build.semanticFulfillment?.providedCapabilities || [],
    missingCapabilities: build.semanticFulfillment?.missingCapabilities || [],
    unrelatedParts: build.semanticFulfillment?.unrelatedParts || [],
    planUnrequestedCapabilities: build.semanticFulfillment?.planUnrequestedCapabilities || [],
    coveragePercent: Number(build.semanticFulfillment?.coveragePercent || 0),
    ok: build.semanticFulfillment?.ok === true,
  };
  if (canonicalJson(currentSemantic) !== canonicalJson(build.manifest.semanticFulfillment)) {
    throw new Error("atomic_build_manifest_semantic_mismatch");
  }
  if (canonicalJson(build.artifactStates) !== canonicalJson(build.manifest.artifactStates)) {
    throw new Error("atomic_build_manifest_artifact_state_mismatch");
  }
  for (const surface of ["overview", "parts", "wiring"]) {
    if (build.artifactStates?.[surface]?.state !== "ready") {
      throw new Error(`atomic_build_manifest_${surface}_not_ready`);
    }
  }
  if (!build.manifest.hero.contentSha256) throw new Error("atomic_build_manifest_hero_missing");
  if (build.manifest.hero.contentSha256 !== imageContentFingerprint(build.image)) {
    throw new Error("atomic_build_manifest_hero_mismatch");
  }
  if (!build.manifest.bom.length) throw new Error("atomic_build_manifest_bom_missing");
  const currentBom = (build.parts || []).map((part) => ({
    id: String(part.id || part.asin || part.name || ""),
    name: String(part.name || ""),
    purpose: String(part.why || ""),
    quantity: Math.max(1, Number(part.quantity || 1)),
    packQty: Math.max(1, Number(part.packQty || 1)),
    assetIds: (part.assemblyAssets || []).map((asset) => String(asset.partId || "")),
  }));
  if (canonicalJson(currentBom) !== canonicalJson(build.manifest.bom)) {
    throw new Error("atomic_build_manifest_bom_mismatch");
  }
  const assembly = build.artifacts?.assembly;
  const bomAssetIds = new Set(currentBom.flatMap((part) => part.assetIds));
  const missingBomAssets = (assembly?.parts || [])
    .map((part) => String(part.assetId || ""))
    .filter((assetId) => assetId && !bomAssetIds.has(assetId));
  if (missingBomAssets.length) {
    throw new Error(`atomic_build_manifest_bom_missing_assembly_assets:${[...new Set(missingBomAssets)].join(",")}`);
  }
  const currentCircuit = {
    assemblySchemaVersion: String(assembly?.schemaVersion || ""),
    contractFingerprint: String(assembly?.contractFingerprint || ""),
    requiredAssets: (assembly?.requiredAssets || []).map((asset) => ({
      id: String(asset.id || ""),
      sha256: String(asset.sha256 || ""),
    })),
    wireIds: (assembly?.wires || []).map((wire) => String(wire.id || "")),
    guideStepIds: (assembly?.guideSteps || []).map((step) => String(step.id || "")),
  };
  if (canonicalJson(currentCircuit) !== canonicalJson(build.manifest.circuit)) {
    throw new Error("atomic_build_manifest_circuit_mismatch");
  }
  if (!build.manifest.circuit.contractFingerprint
    || !build.manifest.circuit.requiredAssets.length
    || !build.manifest.circuit.guideStepIds.length) {
    throw new Error("atomic_build_manifest_circuit_missing");
  }
  return true;
}

export function publicBuildIdentity(identity) {
  if (!identity) return null;
  return {
    schemaVersion: identity.schemaVersion,
    requestId: identity.requestId,
    jobId: identity.jobId,
    buildId: identity.buildId,
    requestFingerprint: identity.requestFingerprint,
    catalogRevision: identity.catalogRevision,
    promptPackageRevision: identity.promptPackageRevision,
  };
}

function imageContentFingerprint(image) {
  const source = String(image?.url || "");
  const match = source.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (match) return sha256(Buffer.from(match[2], "base64"));
  if (SHA_PATTERN.test(String(image?.contentSha256 || ""))) return image.contentSha256;
  return source ? sha256(source) : "";
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
