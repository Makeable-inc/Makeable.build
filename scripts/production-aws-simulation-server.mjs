#!/usr/bin/env node

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { auditCircuitLabCatalog } from "../lib/circuit-lab-catalog-coverage.mjs";
import { createBuild, verifiedPartsCatalog } from "../lib/makeable-builds.mjs";
import {
  createPrompt2CircuitArtifacts,
  eligibleExactCatalogMentions,
  loadPrompt2CircuitGeometryAudit,
  loadPrompt2CircuitProfiles,
  productionPlannerCatalog,
  requestedExactCatalogQuantities,
  requestSolAssemblyPresentation,
  unavailableExactCatalogMentions,
} from "../lib/prompt2circuit-production.mjs";
import { loadProductionPromptPackage } from "../lib/production-prompt-package.mjs";
import { validateSemanticFulfillment } from "../lib/prompt2circuit-semantic-contract.mjs";
import { loadProductionBuildPipeline } from "../lib/production-build-pipeline.mjs";
import {
  applyApprovedSubstitutions,
  buildSupportedPartResolution,
  createSupportedPartsCatalog,
  normalizeNegotiationInput,
  replacementCategoryAllowed,
  unresolvedPartFailures,
} from "../lib/supported-part-resolution.mjs";
import {
  CONNECTION_MODES,
  connectionModeRequiresCarrier,
  controllerConnectionPolicy,
} from "../lib/controller-connection-mode-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...readEnv(path.join(ROOT, ".env")), ...process.env };
const productionEnv = {
  ...env,
  // Netlify's AI gateway can be benchmarked independently from the direct API.
  // The local production simulator uses an explicit non-secret override so a
  // gateway outage cannot be mistaken for a circuit compiler failure.
  OPENAI_BASE_URL: env.MAKEABLE_CIRCUIT_OPENAI_BASE_URL || env.OPENAI_BASE_URL,
  // The prompt package owns the Sol model, xhigh reasoning, and priority tier.
  // Credentials and gateway origin remain server-only and never reach the UI.
  OPENAI_BUILD_MODEL: "gpt-5.6-sol",
};
const port = Math.max(1, Number(env.MAKEABLE_SIMULATION_PORT || 8790));
const builds = new Map();
let latestBuildId = "";
let activeRequest = null;
const restoredSnapshotPath = env.MAKEABLE_CIRCUIT_SNAPSHOT_PATH || "";
if (restoredSnapshotPath && existsSync(restoredSnapshotPath)) {
  const snapshot = JSON.parse(readFileSync(restoredSnapshotPath, "utf8"));
  if (snapshot?.build?.id && snapshot?.build?.artifacts?.assembly?.state === "ready") {
    const restoredBuild = normalizeRestoredSnapshot(snapshot.build);
    builds.set(restoredBuild.id, restoredBuild);
    latestBuildId = restoredBuild.id;
  }
}
const promptPackagePromise = loadProductionPromptPackage(ROOT);
const productionPipelinePromise = loadProductionBuildPipeline();
const compactPartsPlannerPrompt = readFileSync(
  path.join(ROOT, "prompts/experiments/parts-planner-compact.md"),
  "utf8",
);
const CIRCUIT_LAB_ROOT = path.join(ROOT, "apps/circuit-lab");
const RELEASE_DIST_ROOT = path.join(ROOT, "release-dist");
// The lightweight Circuit Lab can reuse a Three.js install kept off the main
// workspace. This avoids reinstalling the landing app's full dependency tree
// after cleanup while keeping the browser runtime explicit and reproducible.
const THREE_ROOT = resolveThreeRoot(env.MAKEABLE_THREE_ROOT);
const PRODUCTION_POINTER_URL = "https://dvy6bet209exg.cloudfront.net/v1/prompt2circuit-production-v1/current.json";
const releaseManifest = await loadProductionManifest({
  pointerUrl: PRODUCTION_POINTER_URL,
  localPath: env.MAKEABLE_PRODUCTION_MANIFEST_PATH || "",
});
const releaseAssetIds = new Set(releaseManifest.assets.map((asset) => asset.partId));
const interfaceProfiles = await loadPrompt2CircuitProfiles(ROOT);
const interfaceProfileById = new Map(interfaceProfiles.map((profile) => [profile.assetId, profile]));
const connectorGeometryAudit = await loadPrompt2CircuitGeometryAudit(ROOT);
const publicCatalog = verifiedPartsCatalog();
const publicCatalogById = new Map(publicCatalog.map((part) => [part.id, part]));
const interfaceEligiblePlannerCatalog = productionPlannerCatalog(publicCatalog, interfaceProfiles, connectorGeometryAudit, {
  requireControllerCarrier: true,
  requireStrictOneShot: true,
  userSelectableOnly: true,
});
const prompt2CircuitPlannerCatalog = interfaceEligiblePlannerCatalog.filter((part) => partIsAvailableInRelease(part, releaseAssetIds));
const prompt2CircuitCompactPlannerCatalog = compactPlannerCatalog(prompt2CircuitPlannerCatalog);
const prompt2CircuitCompilerSupportCatalog = productionPlannerCatalog(publicCatalog, interfaceProfiles, connectorGeometryAudit, {
  requireControllerCarrier: true,
  requireStrictOneShot: true,
}).filter((part) => (
  partIsAvailableInRelease(part, releaseAssetIds)
  && ["accessory", "connector"].includes(part.category)
  && part.assemblyAssetIds?.every((assetId) => ["carrier", "cable"].includes(interfaceProfileById.get(assetId)?.coverage?.category))
));
const prompt2CircuitExactMentionCatalog = [...prompt2CircuitPlannerCatalog, ...prompt2CircuitCompilerSupportCatalog];
const prompt2CircuitPlannerCatalogById = new Map(prompt2CircuitPlannerCatalog.map((part) => [part.id, part]));
const supportedPartsCatalog = createSupportedPartsCatalog(prompt2CircuitPlannerCatalog, releaseManifest);
const interfaceCoverage = Object.fromEntries(Object.entries(Object.groupBy(interfaceProfiles, (profile) => profile.state))
  .map(([state, profiles]) => [state, profiles.length]));
const catalogCoverage = auditCircuitLabCatalog({
  manifest: releaseManifest,
  profiles: interfaceProfiles,
  parts: publicCatalog,
  plannerCatalog: prompt2CircuitPlannerCatalog,
  compilerSupportCatalog: prompt2CircuitCompilerSupportCatalog,
});

const server = createServer(async (request, response) => {
  applyCors(response);
  if (request.method === "OPTIONS") return sendJson(response, {}, 204);
  const url = new URL(request.url || "/", `http://${request.headers.host || `127.0.0.1:${port}`}`);
  try {
    if (url.pathname === "/api/health" && request.method === "GET") {
      const promptPackage = await promptPackagePromise;
      const partsPlanning = promptPackage.stage("parts_plan");
      const assemblyRouting = promptPackage.stage("assembly_routing");
      return sendJson(response, {
        ok: true,
        hasOpenAIKey: Boolean(env.OPENAI_API_KEY),
        openAIOrigin: new URL(productionEnv.OPENAI_BASE_URL || "https://api.openai.com").origin,
        modelOrigin: "https://dvy6bet209exg.cloudfront.net",
        localModelStorage: false,
        active: Boolean(activeRequest),
        restoredSnapshot: Boolean(latestBuildId),
        credentialBridge: env.NETLIFY || env.NETLIFY_LOCAL || env.NETLIFY_DEV
          ? "netlify-context"
          : "server-environment",
        partsPlanning: {
          model: partsPlanning.owner,
          reasoningEffort: partsPlanning.reasoningEffort,
          serviceTier: partsPlanning.serviceTier,
        },
        assemblyRouting: {
          model: assemblyRouting.owner,
          reasoningEffort: assemblyRouting.reasoningEffort,
          serviceTier: assemblyRouting.serviceTier,
        },
        prompt2circuit: {
          profiles: interfaceProfiles.length,
          coverage: interfaceCoverage,
          plannerEligibleParts: prompt2CircuitPlannerCatalog.length,
          supportedPartsCatalogRevision: supportedPartsCatalog.productionRevision,
          supportedPartsCatalogCount: supportedPartsCatalog.count,
          plannerPartsExcludedByAwsRelease: interfaceEligiblePlannerCatalog.length - prompt2CircuitPlannerCatalog.length,
          plannerEligibleControllers: prompt2CircuitPlannerCatalog.filter((part) => part.category === "controller").length,
          connectorGeometryAudit: connectorGeometryAudit.summary,
          multiControllerResourceCompiler: "ready",
          overflowTransport: "esp-now",
          defaultMaximumControllerNodes: 8,
          firmwareSourceGeneration: false,
          plannerExperimentModes: {
            standard: {
              catalogBytes: Buffer.byteLength(JSON.stringify(prompt2CircuitPlannerCatalog)),
              promptBytes: Buffer.byteLength((await promptPackagePromise).stage("parts_plan").prompt),
            },
            compact: {
              catalogBytes: Buffer.byteLength(JSON.stringify(prompt2CircuitCompactPlannerCatalog)),
              promptBytes: Buffer.byteLength(compactPartsPlannerPrompt),
            },
          },
        },
      });
    }
    if (url.pathname === "/api/catalog-coverage" && request.method === "GET") {
      return sendJson(response, catalogCoverage);
    }
    if (url.pathname === "/api/supported-parts" && request.method === "GET") {
      return sendJson(response, supportedPartsCatalog);
    }
    if (url.pathname === "/api/builds" && request.method === "GET") {
      return sendJson(response, { builds: [...builds.values()] });
    }
    const storedBuildMatch = url.pathname.match(/^\/api\/builds\/([^/]+)$/);
    if (storedBuildMatch && request.method === "GET") {
      const build = builds.get(decodeURIComponent(storedBuildMatch[1]));
      return build
        ? sendJson(response, { build })
        : sendJson(response, { error: "Build not found." }, 404);
    }
    if (request.method === "GET" && await serveCircuitLab(url.pathname, response)) return;
    if (url.pathname === "/api/production-simulations" && request.method === "POST") {
      if (activeRequest) return sendJson(response, { error: "A benchmark request is already running." }, 409);
      const body = await readJson(request);
      activeRequest = runSimulation(body || {});
      try {
        const result = await activeRequest;
        return sendJson(response, result.body, result.status);
      } finally {
        activeRequest = null;
      }
    }
    if (url.pathname === "/api/production-simulations/latest" && request.method === "GET") {
      const build = latestBuildId ? builds.get(latestBuildId) : null;
      return build
        ? sendJson(response, { build })
        : sendJson(response, { error: "No production simulation has completed yet." }, 404);
    }
    const match = url.pathname.match(/^\/api\/production-simulations\/([a-z0-9-]+)$/i);
    if (match && request.method === "GET") {
      const build = builds.get(match[1]);
      return build
        ? sendJson(response, { build })
        : sendJson(response, { error: "Production simulation not found." }, 404);
    }
    if (request.method === "GET" && await serveMakeableStatic(url.pathname, response)) return;
    return sendJson(response, { error: "Not found" }, 404);
  } catch (error) {
    activeRequest = null;
    console.error(error);
    return sendJson(response, { error: String(error?.message || error) }, 500);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`AWS-only Makeable Circuit Lab listening at http://127.0.0.1:${port}`);
  console.log(`AWS bundle: ${releaseManifest.revision} (${releaseManifest.assets.length} immutable GLBs)`);
  console.log(`Local interface gate: ${interfaceCoverage.ready || 0}/${interfaceProfiles.length} ready profiles; ${prompt2CircuitPlannerCatalog.length} planner-eligible catalog rows`);
});

function normalizeRestoredSnapshot(build) {
  const requestFingerprint = build.identity?.requestFingerprint
    || createHash("sha256").update(`${build.id}:${build.idea || ""}`).digest("hex");
  const identity = build.identity || { buildId: build.id, requestFingerprint };
  return {
    ...build,
    identity,
    manifest: build.manifest || {
      identity,
      manifestSha256: createHash("sha256").update(JSON.stringify(build.artifacts || {})).digest("hex"),
    },
    image: build.image || {
      url: "/assets/landing/gallery-v2/window-air-final-v2.webp",
      source: "restored-local-snapshot",
    },
    artifactStates: {
      ...build.artifactStates,
      wiring: { state: "ready", reason: "" },
    },
  };
}

function resolveThreeRoot(explicitRoot = "") {
  const candidates = [
    explicitRoot ? path.resolve(explicitRoot) : "",
    "/Volumes/T9_Mac_Only/prompt2circuit/runtime-deps/node_modules/three",
    path.join(ROOT, "apps/landing/node_modules/three")
  ].filter(Boolean);
  const selected = candidates.find((candidate) => (
    existsSync(path.join(candidate, "build/three.module.js"))
    && existsSync(path.join(candidate, "examples/jsm/controls/OrbitControls.js"))
    && existsSync(path.join(candidate, "examples/jsm/loaders/GLTFLoader.js"))
  ));
  if (!selected) {
    throw new Error(`three_runtime_missing:${candidates.join(",")}`);
  }
  return selected;
}

async function loadRemoteProductionManifest(pointerUrl) {
  const pointerResponse = await fetch(pointerUrl, { headers: { "Cache-Control": "no-cache" } });
  if (!pointerResponse.ok) throw new Error(`production_pointer_fetch_failed:${pointerResponse.status}`);
  const pointer = await pointerResponse.json();
  if (!pointer?.manifestUrl || !/^[a-f0-9]{64}$/.test(pointer?.manifestSha256 || "")) {
    throw new Error("production_pointer_invalid");
  }
  const manifestResponse = await fetch(pointer.manifestUrl, { headers: { "Cache-Control": "no-cache" } });
  if (!manifestResponse.ok) throw new Error(`production_manifest_fetch_failed:${manifestResponse.status}`);
  const bytes = Buffer.from(await manifestResponse.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== pointer.manifestSha256) throw new Error("production_manifest_sha256_mismatch");
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest.revision !== pointer.revision) throw new Error("production_manifest_revision_mismatch");
  if (!Array.isArray(manifest.assets) || manifest.assets.length !== pointer.readyAssetCount) {
    throw new Error("production_manifest_asset_count_mismatch");
  }
  if (!manifest.assets.every((asset) => asset.oneShotEligible === true && asset.interfaceEligibility === "ready")) {
    throw new Error("production_manifest_contains_non_ready_asset");
  }
  return manifest;
}

async function loadProductionManifest({ pointerUrl, localPath }) {
  if (!localPath) return loadRemoteProductionManifest(pointerUrl);
  const resolved = path.resolve(ROOT, localPath);
  const manifest = JSON.parse(readFileSync(resolved, "utf8"));
  if (!Array.isArray(manifest.assets) || !manifest.assets.length) {
    throw new Error("local_production_manifest_assets_missing");
  }
  if (!manifest.assets.every((asset) => (
    asset.oneShotEligible === true
    && asset.interfaceEligibility === "ready"
    && /^https:\/\/dvy6bet209exg\.cloudfront\.net\//.test(asset.url || "")
    && /^[a-f0-9]{64}$/.test(asset.sha256 || "")
  ))) {
    throw new Error("local_production_manifest_contains_non_ready_or_non_aws_asset");
  }
  return manifest;
}

async function runSimulation(input) {
  const idea = input?.idea || "";
  const normalizedNegotiation = normalizeNegotiationInput(input, prompt2CircuitPlannerCatalog);
  const negotiation = {
    ...normalizedNegotiation,
    substitutions: normalizedNegotiation.substitutions.filter(({ unsupportedCatalogId, replacement }) => {
      const unsupported = publicCatalogById.get(unsupportedCatalogId);
      return replacementCategoryAllowed(unsupported, replacement);
    }),
  };
  const effectiveIdea = applyApprovedSubstitutions(idea, negotiation);
  const experimentMode = input?.experimentMode === "compact" ? "compact" : "standard";
  const plannerCatalog = experimentMode === "compact"
    ? prompt2CircuitCompactPlannerCatalog
    : prompt2CircuitPlannerCatalog;
  const startedAt = performance.now();
  const startedWallClock = Date.now();
  const timeline = [];
  const event = async (name, details = {}) => {
    const elapsedMs = roundMs(performance.now() - startedAt);
    timeline.push({
      ...details,
      sequence: timeline.length + 1,
      name,
      at: new Date(startedWallClock + elapsedMs).toISOString(),
      elapsedMs,
      branch: branchFor(name),
    });
  };

  await event("request_received", { method: "POST", path: "/api/production-simulations" });
  await event("planner_experiment_configured", {
    experimentMode,
    plannerCatalogEntries: plannerCatalog.length,
    plannerCatalogBytes: Buffer.byteLength(JSON.stringify(plannerCatalog)),
  });
  if (typeof idea !== "string" || idea.trim().length < 12 || idea.trim().length > 2_000) {
    await event("request_rejected", { reason: "invalid_idea" });
    return { status: 400, body: { error: "Provide a project idea between 12 and 2,000 characters.", timeline } };
  }
  const eligibleControllers = prompt2CircuitPlannerCatalog.filter((part) => part.category === "controller");
  if (!eligibleControllers.length) {
    await event("request_rejected", { reason: "interface_ready_controller_unavailable" });
    return {
      status: 503,
      body: {
        error: "No controller currently has a complete interface profile in the active prompt-to-circuit registry. The API will not invent controller pins.",
        coverage: { total: interfaceProfiles.length, ...interfaceCoverage },
        timeline,
      },
    };
  }
  const unavailableExactParts = unavailableExactCatalogMentions(idea, publicCatalog, prompt2CircuitExactMentionCatalog, interfaceProfiles);
  const unresolvedExactParts = unresolvedPartFailures(unavailableExactParts, negotiation);
  if (unresolvedExactParts.length) {
    await event("request_rejected", {
      reason: "exact_requested_part_not_one_shot",
      catalogIds: unresolvedExactParts.map((part) => part.catalogId),
      assetIds: unresolvedExactParts.flatMap((part) => part.assetIds),
      negotiationAttempt: negotiation.attempt,
    });
    return {
      status: 422,
      body: {
        error: "That exact part is not ready for a reliable one-shot wiring guide yet.",
        code: "exact_requested_part_not_one_shot",
        requestedPartFailures: unresolvedExactParts,
        resolution: buildSupportedPartResolution({
          idea,
          attempt: negotiation.attempt,
          failures: unresolvedExactParts.map((failure) => ({
            ...failure,
            category: publicCatalogById.get(failure.catalogId)?.category || "",
          })),
          supportedParts: prompt2CircuitPlannerCatalog,
          code: "exact_requested_part_not_one_shot",
        }),
        timeline,
      },
    };
  }
  await event("request_body_validated", {
    ideaLength: idea.trim().length,
    negotiationAttempt: negotiation.attempt,
    approvedSubstitutions: negotiation.substitutions.map(({ unsupportedCatalogId, replacementCatalogId }) => ({ unsupportedCatalogId, replacementCatalogId })),
  });
  await event("generation_scope_locked", {
    compiler: "generic-prompt2circuit-v1",
    circuitOnly: true,
    heroArtDirection: false,
    imageGeneration: false,
    stlGeneration: false,
    housingGeneration: false,
    enclosureGeneration: false,
    meshGeneration: false,
  });
  await event("auth_context_resolved", { mode: "anonymous-production-simulation" });
  const promptPackage = await promptPackagePromise;
  const productionPipeline = await productionPipelinePromise;
  const partsPlanStage = promptPackage.stage("parts_plan");
  const assemblyRoutingStage = promptPackage.stage("assembly_routing");
  await event("prompt_package_locked", {
    packageVersion: promptPackage.packageVersion,
    manifestSha256: promptPackage.manifestSha256,
    partsPlanSha256: partsPlanStage.promptSha256,
    stageIds: [...promptPackage.stages.keys()],
  });

  let capturedBuild = null;
  const apiCalls = [];
  const meteredFetch = meteredProductionFetch(fetch, apiCalls);
  const store = {
    async save(build) {
      await event("persistence_write_started", { backend: "in-memory-simulation-store" });
      capturedBuild = build;
      await event("persistence_write_completed", { backend: "in-memory-simulation-store" });
      return build;
    },
  };
  let result;
  try {
    result = await createBuild(
      { idea: effectiveIdea },
      {
      env: productionEnv,
      store,
      fetchFn: meteredFetch,
      allowAnonymous: true,
      partsPlannerPrompt: experimentMode === "compact" ? compactPartsPlannerPrompt : partsPlanStage.prompt,
      partsPlannerModel: partsPlanStage.owner,
      partsPlannerReasoningEffort: partsPlanStage.reasoningEffort,
      partsPlannerServiceTier: partsPlanStage.serviceTier,
      plannerCatalog,
      requireLivePlanner: true,
      preservePlannerSelection: true,
      finalizeSelectedParts: (parts, context) => productionPipeline
        .createOptions({ env: productionEnv })
        .finalizeSelectedParts(enforceOneShotPlannerParts(parts, context), context),
      validateSelectedPlan: validateProductionPlan,
      // This production API is structurally circuit-only. User input cannot
      // re-enable a hero, image, enclosure, housing, STL, or mesh branch.
      circuitOnly: true,
      onPhase: async (phase) => event(`phase_${phase}`),
      onEvent: event,
      generateArtifacts: async ({ parts, fetchFn, onEvent }) => createPrompt2CircuitArtifacts({
        parts,
        profiles: interfaceProfiles,
        manifest: releaseManifest,
        fetchFn,
        onEvent,
        validateRemoteAssets: true,
        connectorGeometryAudit,
        presentationPlanner: ({ placement, graph, resolved }) => requestSolAssemblyPresentation({
          env: productionEnv,
          fetchFn,
          prompt: assemblyRoutingStage.prompt,
          placement,
          graph,
          resolved,
        }),
      }),
      },
    );
  } catch (error) {
    const code = String(error?.code || error?.message || "production_compilation_failed").split(":")[0];
    await event("build_failed", { status: 422, code });
    return {
      status: 422,
      body: {
        error: String(error?.message || error),
        code,
        details: error?.details || {},
        resolution: buildSupportedPartResolution({
          idea,
          attempt: negotiation.attempt,
          failures: [],
          supportedParts: prompt2CircuitPlannerCatalog,
          code,
        }),
        timeline,
        experiment: summarizeExperiment(experimentMode, plannerCatalog, apiCalls),
      },
    };
  }
  if (result.status !== 201 || !capturedBuild) {
    await event("build_failed", { status: result.status });
    return {
      status: result.status,
      body: {
        ...result.body,
        timeline,
        ...(result.status >= 400 ? {
          resolution: buildSupportedPartResolution({
            idea,
            attempt: negotiation.attempt,
            failures: result.body?.requestedPartFailures || [],
            supportedParts: prompt2CircuitPlannerCatalog,
            code: result.body?.code || "project_not_supported_yet",
          }),
        } : {}),
      },
    };
  }
  await event("response_ready", { buildId: result.body.id });
  const releasedBuild = releaseCompilerAcceptedBuild(result.body);
  const metrics = summarizeTimeline(timeline, releasedBuild);
  const experiment = summarizeExperiment(experimentMode, plannerCatalog, apiCalls);
  const finalBuild = {
    ...releasedBuild,
    idea: idea.trim(),
    artifacts: {
      ...releasedBuild.artifacts,
      pipeline: {
        schemaVersion: "MakeableProductionTimelineV1",
        requestIdea: idea.trim(),
        approvedSubstitutions: negotiation.substitutions.map(({ unsupportedCatalogId, replacementCatalogId }) => ({ unsupportedCatalogId, replacementCatalogId })),
        timeline,
        metrics,
        experiment,
      },
    },
  };
  builds.set(finalBuild.id, finalBuild);
  latestBuildId = finalBuild.id;
  console.log(JSON.stringify({
    buildId: finalBuild.id,
    title: finalBuild.title,
    metrics,
    experiment,
    selectedParts: finalBuild.parts.map((part) => ({ id: part.id, name: part.name })),
    delivery: finalBuild.artifacts.delivery,
  }, null, 2));
  return { status: 201, body: { build: finalBuild } };
}

function compactPlannerCatalog(parts) {
  return parts.map((part) => ({
    id: part.id,
    name: part.name,
    category: part.category,
    subtype: part.subtype,
    price: part.price,
    voltage: part.voltage,
    connectionType: part.connectionType,
    semanticCapabilities: part.semanticCapabilities,
    visualEligibility: part.visualEligibility,
    interfaceEligibility: part.interfaceEligibility,
    selectionStatus: part.selectionStatus,
    requestAliases: part.requestAliases,
    controllerConnectionMode: part.controllerConnectionMode,
    maximumExternalPeripherals: part.maximumExternalPeripherals,
    controllerCarrierAssetId: part.controllerCarrierAssetId,
    assemblyAssetIds: part.assemblyAssetIds,
    selectionInterfaces: (part.assemblyInterfaces || []).map((profile) => ({
      assetId: profile.assetId,
      category: profile.category,
      connectorIntent: profile.connectorIntent,
      requiredSignals: profile.requiredSignals,
      requiredControllerCapabilities: profile.requiredControllerCapabilities,
      acceptedInputVoltagesV: profile.acceptedInputVoltagesV,
      preferredEsp32Supply: profile.preferredEsp32Supply,
      signalDomains: profile.signalDomains,
      outputVoltageRangesV: profile.outputVoltageRangesV,
      controllerMaximumInputVoltageV: profile.controllerMaximumInputVoltageV,
      requiresCarrier: profile.requiresCarrier,
      disabledInterfaces: profile.disabledInterfaces,
      operatingMode: profile.operatingModeContract
        ? {
            modeId: profile.operatingModeContract.modeId,
            bus: profile.operatingModeContract.bus,
            requiredSignals: profile.operatingModeContract.requiredSignals,
            supplyVoltageV: profile.operatingModeContract.supplyVoltageV,
          }
        : null,
      specialSystem: profile.servoLoad
        ? "servo"
        : profile.poweredLogicLoad
          ? "powered_logic"
          : profile.exactMatingCableRequirements?.length
            ? "exact_mating"
            : profile.selectorShuntRequirements?.length
              ? "selector_shunt"
              : "none",
      compilerInjectedAccessoryAssetIds: profile.compilerInjectedAccessoryAssetIds,
    })),
  }));
}

function partIsAvailableInRelease(part, availableAssetIds) {
  const requiredAssetIds = new Set([
    ...(part.assemblyAssetIds || []),
    part.controllerCarrierAssetId,
    ...(part.assemblyInterfaces || []).flatMap((profile) => profile.compilerInjectedAccessoryAssetIds || []),
  ].filter(Boolean));
  return requiredAssetIds.size > 0
    && [...requiredAssetIds].every((assetId) => availableAssetIds.has(assetId));
}

function meteredProductionFetch(fetchFn, apiCalls) {
  return async (url, options = {}) => {
    const target = String(url);
    const isResponsesApi = /\/v1\/responses(?:\?|$)/.test(target);
    if (!isResponsesApi) return fetchFn(url, options);
    const body = typeof options.body === "string" ? options.body : "";
    let request = {};
    try { request = JSON.parse(body); } catch {}
    const schemaName = request?.text?.format?.name || "unknown";
    const stage = schemaName === "makeable_build_plan"
      ? "parts_plan"
      : schemaName === "makeable_assembly_presentation"
        ? "assembly_routing"
        : schemaName;
    const started = performance.now();
    try {
      const response = await fetchFn(url, options);
      let data = null;
      try { data = await response.clone().json(); } catch {}
      apiCalls.push({
        stage,
        ok: response.ok,
        status: response.status,
        latencyMs: roundMs(performance.now() - started),
        requestBytes: Buffer.byteLength(body),
        requestedServiceTier: request.service_tier || "auto",
        actualServiceTier: data?.service_tier || "unknown",
        usage: normalizeUsage(data?.usage),
      });
      return response;
    } catch (error) {
      apiCalls.push({
        stage,
        ok: false,
        status: 0,
        latencyMs: roundMs(performance.now() - started),
        requestBytes: Buffer.byteLength(body),
        requestedServiceTier: request.service_tier || "auto",
        actualServiceTier: "network_error",
        usage: normalizeUsage(null),
        error: String(error?.cause?.code || error?.message || error),
      });
      throw error;
    }
  };
}

function normalizeUsage(usage) {
  return {
    inputTokens: Number(usage?.input_tokens || 0),
    cachedInputTokens: Number(usage?.input_tokens_details?.cached_tokens || 0),
    outputTokens: Number(usage?.output_tokens || 0),
    reasoningTokens: Number(usage?.output_tokens_details?.reasoning_tokens || 0),
    totalTokens: Number(usage?.total_tokens || 0),
  };
}

function summarizeExperiment(mode, plannerCatalog, calls) {
  const sum = (key) => calls.reduce((total, call) => total + Number(call.usage?.[key] || 0), 0);
  return {
    mode,
    plannerCatalogEntries: plannerCatalog.length,
    plannerCatalogBytes: Buffer.byteLength(JSON.stringify(plannerCatalog)),
    apiCallCount: calls.length,
    inputTokens: sum("inputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    uncachedInputTokens: sum("inputTokens") - sum("cachedInputTokens"),
    outputTokens: sum("outputTokens"),
    reasoningTokens: sum("reasoningTokens"),
    totalTokens: sum("totalTokens"),
    apiCalls: calls,
  };
}

function validateProductionPlan({ idea, plan, parts }) {
  return validateSemanticFulfillment({ idea, parts });
}

function releaseCompilerAcceptedBuild(build) {
  const controller = (build?.parts || []).find((part) => part.category === "controller");
  const controllerAssetId = controller?.assemblyAssets?.[0]?.partId || "";
  const connectionPolicy = controllerConnectionPolicy(controllerAssetId);
  const carrierContractSatisfied = connectionModeRequiresCarrier(connectionPolicy.mode)
    ? Boolean(build?.artifacts?.assembly?.electricalGraph?.carrierPartId)
    : connectionPolicy.mode === CONNECTION_MODES.INTEGRATED_DIRECT_WIRE;
  const networkNodes = build?.artifacts?.assembly?.networkNodes || [];
  const wirelessLinks = build?.artifacts?.assembly?.wirelessLinks || [];
  const networkContractSatisfied = networkNodes.length <= 1
    ? wirelessLinks.length === 0
    : wirelessLinks.length === networkNodes.length - 1
      && build?.artifacts?.assembly?.readiness?.controllerNodesResolved === true
      && build?.artifacts?.assembly?.readiness?.espNowTopologyValidated === true
      && build?.artifacts?.assembly?.readiness?.wirelessLinksExcludedFromPhysicalWires === true
      && build?.artifacts?.firmware?.transportContract?.state === "ready";
  if (build?.semanticFulfillment?.ok !== true || build?.semanticFulfillment?.coveragePercent !== 100) {
    throw new Error("semantic_fulfillment_missing_at_release");
  }
  if (build?.artifacts?.assembly?.state !== "ready"
    || build?.artifacts?.assembly?.readiness?.electricalGraphValidated !== true
    || !carrierContractSatisfied
    || !networkContractSatisfied) {
    throw new Error("compiler_assembly_not_ready_at_release");
  }
  const plannerAdvisories = [
    /^(?:blocked\b|blocked\s*[—:-])/i.test(String(build.title || "")) ? String(build.title) : "",
    ...(build.warnings || []).filter((warning) => /^blocked(?:_|\b)/i.test(String(warning))),
  ].filter(Boolean);
  const released = {
    ...build,
    title: String(build.title || "Circuit build")
      .replace(/\bblocked\b/ig, " ")
      .replace(/[—:-]\s*$/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    warnings: (build.warnings || []).filter((warning) => !/^blocked(?:_|\b)/i.test(String(warning))),
    ...(plannerAdvisories.length ? { diagnostics: { plannerAdvisories } } : {}),
    status: "Ready",
  };
  return normalizeOwnerVerifiedFs90rPresentation(released);
}

const OWNER_FS90R_S3_GVS_RULE_ID = "owner-bench-fs90r-s3-carrier-gvs-v3";

function normalizeOwnerVerifiedFs90rPresentation(build) {
  const graph = build?.artifacts?.assembly?.electricalGraph;
  const ruleActive = (graph?.connections || []).some(
    (connection) => connection?.ownerVerifiedCarrierPowerRuleId === OWNER_FS90R_S3_GVS_RULE_ID,
  );
  if (!ruleActive) return build;

  const legacyContradiction = (value) => {
    const text = String(value || "").toLowerCase();
    return /separate regulated\s*4\.8\s*[-–]\s*6\s*v.*servo supply/.test(text)
      || /must not power.*(?:3\.3v|3\.3\s*v)/.test(text)
      || /three-pin servo plug.*(?:mating|adapter|power-distribution)/.test(text)
      || /confirm.*(?:servo mating|power-distribution).*path/.test(text);
  };
  const canonicalWarnings = [
    `This exact servo route is authorized only by ${OWNER_FS90R_S3_GVS_RULE_ID}. Preserve the owner-verified 3V3 GVS-row supply; the manufacturer nominal 4.8–6 V rating remains separate evidence rather than a conflicting assembly instruction.`,
    "Each servo consumes one complete unused carrier GVS row: black GND, red 3V3 positive supply, and yellow PWM. Power, ground, and PWM physical contacts may not be shared or reused between channels.",
    "Power the controller through USB-C only; do not use the carrier DC-barrel input.",
    "No servo mate, splitter, separate power-distribution part, cable body, or additional wiring accessory is selected or rendered for this exact logical guide.",
  ];
  const retainedWarnings = (build.warnings || []).filter((warning) => !legacyContradiction(warning));
  const warnings = [...new Set([
    ...canonicalWarnings,
    ...retainedWarnings.filter((warning) => !/owner-bench-fs90r-s3-carrier-gvs-v3|complete unused gvs row|four-channel limit|servo mate|dc-barrel/i.test(String(warning))),
  ])];
  const parts = (build.parts || []).map((part) => {
    if (!/fs90r|continuous.rotation.*servo|servo.*continuous.rotation/i.test(`${part.id || ""} ${part.name || ""} ${part.subtype || ""}`)) {
      return part;
    }
    return {
      ...part,
      notes: "Owner-bench-verified full-size S3 carrier route: use one distinct black-GND/red-3V3/yellow-PWM GVS row per servo; retain the manufacturer nominal 4.8–6 V rating as separate evidence.",
    };
  });

  return {
    ...build,
    parts,
    warnings,
  };
}

function enforceOneShotPlannerParts(parts, { idea = "" } = {}) {
  const normalized = [];
  for (const part of parts || []) {
    const plannerPart = prompt2CircuitPlannerCatalogById.get(part.id);
    if (!plannerPart) continue;
    const permittedAssetIds = new Set(plannerPart.assemblyAssetIds || []);
    const assemblyAssets = (part.assemblyAssets || []).filter((asset) => permittedAssetIds.has(asset.partId));
    if (assemblyAssets.length !== 1) throw new Error(`planner_part_exact_asset_resolution_invalid:${part.id}:${assemblyAssets.length}`);
    normalized.push({ ...part, assemblyAssets });
  }
  const fourWheelServoRequest = /\b(?:four|4)\s+(?:fs90r\s+)?(?:servo(?:\s+motor)?s?|wheels?)\b/i.test(idea)
    || /\b(?:four|4)[- ]wheel\b/i.test(idea);
  if (fourWheelServoRequest) {
    const pairedKitPlannerPart = prompt2CircuitPlannerCatalogById.get("b086zgtlzb-79");
    const pairedKitPublicPart = publicCatalogById.get("b086zgtlzb-79");
    if (!pairedKitPlannerPart || !pairedKitPublicPart) throw new Error("four_servo_wheel_kit_not_one_shot_ready");
    const permittedAssetIds = new Set(pairedKitPlannerPart.assemblyAssetIds || []);
    const assemblyAssets = (pairedKitPublicPart.assemblyAssets || []).filter((asset) => permittedAssetIds.has(asset.partId));
    if (assemblyAssets.length !== 1) throw new Error(`planner_part_exact_asset_resolution_invalid:${pairedKitPublicPart.id}:${assemblyAssets.length}`);
    for (let index = normalized.length - 1; index >= 0; index -= 1) {
      if (["b086zgtlzb-79", "7427505d74-80"].includes(normalized[index].id)) normalized.splice(index, 1);
    }
    normalized.push(
      { ...pairedKitPublicPart, assemblyAssets },
      { ...pairedKitPublicPart, assemblyAssets }
    );
  }
  for (const mention of eligibleExactCatalogMentions(idea, publicCatalog, prompt2CircuitPlannerCatalog)) {
    if (normalized.some((part) => part.id === mention.catalogId)) continue;
    const plannerPart = prompt2CircuitPlannerCatalogById.get(mention.catalogId);
    const publicPart = publicCatalogById.get(mention.catalogId);
    if (!plannerPart || !publicPart) throw new Error(`exact_requested_part_resolution_missing:${mention.catalogId}`);
    const permittedAssetIds = new Set(plannerPart.assemblyAssetIds || []);
    const assemblyAssets = (publicPart.assemblyAssets || []).filter((asset) => permittedAssetIds.has(asset.partId));
    if (assemblyAssets.length !== 1) {
      throw new Error(`exact_requested_part_asset_resolution_invalid:${mention.catalogId}:${assemblyAssets.length}`);
    }
    if (plannerPart.category === "controller") {
      for (let index = normalized.length - 1; index >= 0; index -= 1) {
        if (normalized[index].category === "controller") normalized.splice(index, 1);
      }
    }
    normalized.push({ ...publicPart, assemblyAssets });
  }
  for (const quantity of requestedExactCatalogQuantities(idea, publicCatalog, prompt2CircuitPlannerCatalog)) {
    const plannerPart = prompt2CircuitPlannerCatalogById.get(quantity.catalogId);
    if (!plannerPart || plannerPart.category === "controller") continue;
    const publicPart = publicCatalogById.get(quantity.catalogId);
    if (!publicPart) throw new Error(`exact_requested_part_resolution_missing:${quantity.catalogId}`);
    const permittedAssetIds = new Set(plannerPart.assemblyAssetIds || []);
    const assemblyAssets = (publicPart.assemblyAssets || []).filter((asset) => permittedAssetIds.has(asset.partId));
    if (assemblyAssets.length !== 1) {
      throw new Error(`exact_requested_part_asset_resolution_invalid:${quantity.catalogId}:${assemblyAssets.length}`);
    }
    for (let index = normalized.length - 1; index >= 0; index -= 1) {
      if (normalized[index].id === quantity.catalogId) normalized.splice(index, 1);
    }
    for (let index = 0; index < quantity.requestedCount; index += 1) {
      normalized.push({ ...publicPart, assemblyAssets });
    }
  }
  const controllerIndex = normalized.findIndex((part) => part.category === "controller");
  if (controllerIndex < 0) {
    throw new Error("planner_selection_missing_interface_ready_controller");
  }
  const controllerPlannerPart = prompt2CircuitPlannerCatalogById.get(normalized[controllerIndex].id);
  const peripheralPlannerParts = normalized
    .filter((part) => !["controller", "carrier", "cable", "power", "power_distribution"].includes(part.category))
    .map((part) => prompt2CircuitPlannerCatalogById.get(part.id))
    .filter(Boolean);
  const selectedXiaoBase = controllerPlannerPart?.controllerCarrierAssetId === "seeed-xiao-expansion-base-103030356";
  const hasNonGrovePeripheral = peripheralPlannerParts.some((part) =>
    !(part.assemblyInterfaces || []).some((profile) => /grove/i.test(profile.connectorIntent || "")));
  if (selectedXiaoBase && hasNonGrovePeripheral) {
    if (/\bxiao\b/i.test(idea)) throw new Error("xiao_expansion_base_requires_grove_only_peripherals");
    const replacementPlannerPart = [
      "b0gvf97wty-111",
      "b0bvvgnbb3-112",
    ].map((id) => prompt2CircuitPlannerCatalogById.get(id)).find((part) =>
      part?.category === "controller"
      && part.controllerCarrierAssetId
      && part.controllerCarrierAssetId !== "seeed-xiao-expansion-base-103030356");
    const replacement = replacementPlannerPart ? publicCatalogById.get(replacementPlannerPart.id) : null;
    if (!replacement) throw new Error("compatible_non_grove_carrier_controller_unavailable");
    const permittedAssetIds = new Set(replacementPlannerPart.assemblyAssetIds || []);
    const assemblyAssets = (replacement.assemblyAssets || []).filter((asset) => permittedAssetIds.has(asset.partId));
    if (assemblyAssets.length !== 1) throw new Error(`planner_part_exact_asset_resolution_invalid:${replacement.id}:${assemblyAssets.length}`);
    normalized[controllerIndex] = { ...replacement, assemblyAssets };
  }
  const finalControllerPlannerPart = prompt2CircuitPlannerCatalogById.get(normalized[controllerIndex].id);
  const requiredSupportAssetIds = new Set([
    finalControllerPlannerPart?.controllerCarrierAssetId,
    ...normalized
      .filter((part) => part.category !== "controller")
      .flatMap((part) => prompt2CircuitPlannerCatalogById.get(part.id)?.assemblyInterfaces || [])
      .flatMap((profile) => profile.compilerInjectedAccessoryAssetIds || []),
  ].filter(Boolean));
  for (const mention of eligibleExactCatalogMentions(idea, publicCatalog, prompt2CircuitCompilerSupportCatalog)) {
    const supportPart = prompt2CircuitCompilerSupportCatalog.find((part) => part.id === mention.catalogId);
    const supportAssetId = supportPart?.assemblyAssetIds?.[0];
    if (!supportAssetId || !requiredSupportAssetIds.has(supportAssetId)) {
      throw new Error(`exact_compiler_support_asset_not_required:${mention.catalogId}:${supportAssetId || "missing"}`);
    }
  }
  return normalized;
}

async function serveCircuitLab(pathname, response) {
  const normalizedPath = pathname === "/circuit-studio" ? "/circuit-studio/" : pathname;
  const staticFiles = new Map([
    ["/circuit-studio/", [path.join(CIRCUIT_LAB_ROOT, "index.html"), "text/html; charset=utf-8"]],
    ["/circuit-studio/index.html", [path.join(CIRCUIT_LAB_ROOT, "index.html"), "text/html; charset=utf-8"]],
    ["/circuit-studio/styles.css", [path.join(CIRCUIT_LAB_ROOT, "styles.css"), "text/css; charset=utf-8"]],
    ["/circuit-studio/app.js", [path.join(CIRCUIT_LAB_ROOT, "app.js"), "text/javascript; charset=utf-8"]],
    ["/circuit-studio/vendor/three.module.js", [path.join(THREE_ROOT, "build/three.module.js"), "text/javascript; charset=utf-8"]],
    ["/circuit-studio/vendor/three.core.js", [path.join(THREE_ROOT, "build/three.core.js"), "text/javascript; charset=utf-8"]],
    ["/circuit-studio/vendor/addons/controls/OrbitControls.js", [path.join(THREE_ROOT, "examples/jsm/controls/OrbitControls.js"), "text/javascript; charset=utf-8"]],
    ["/circuit-studio/vendor/addons/loaders/GLTFLoader.js", [path.join(THREE_ROOT, "examples/jsm/loaders/GLTFLoader.js"), "text/javascript; charset=utf-8"]],
    ["/circuit-studio/vendor/addons/utils/BufferGeometryUtils.js", [path.join(THREE_ROOT, "examples/jsm/utils/BufferGeometryUtils.js"), "text/javascript; charset=utf-8"]],
    ["/circuit-studio/vendor/addons/utils/SkeletonUtils.js", [path.join(THREE_ROOT, "examples/jsm/utils/SkeletonUtils.js"), "text/javascript; charset=utf-8"]],
  ]);
  const record = staticFiles.get(normalizedPath);
  if (!record) return false;
  const [filePath, contentType] = record;
  if (!existsSync(filePath)) return false;
  const body = readFileSync(filePath);
  response.statusCode = 200;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", body.length);
  response.setHeader("Cache-Control", "no-store");
  response.end(body);
  return true;
}

async function serveMakeableStatic(pathname, response) {
  if (!existsSync(RELEASE_DIST_ROOT)) return false;
  const decoded = decodeURIComponent(pathname || "/");
  const requested = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidates = path.extname(requested)
    ? [requested]
    : [requested, `${requested}.html`, path.join(requested, "index.html")];
  const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
  };
  for (const candidate of candidates) {
    const filePath = path.resolve(RELEASE_DIST_ROOT, candidate);
    if (filePath !== RELEASE_DIST_ROOT && !filePath.startsWith(`${RELEASE_DIST_ROOT}${path.sep}`)) continue;
    if (!existsSync(filePath)) continue;
    if (!statSync(filePath).isFile()) continue;
    const body = readFileSync(filePath);
    response.statusCode = 200;
    response.setHeader("Content-Type", contentTypes[path.extname(filePath)] || "application/octet-stream");
    response.setHeader("Content-Length", body.length);
    response.setHeader("Cache-Control", "no-store");
    response.end(body);
    return true;
  }
  return false;
}

function summarizeTimeline(timeline, build) {
  const at = (name) => timeline.find((entry) => entry.name === name)?.elapsedMs;
  const duration = (start, end) => {
    const from = at(start);
    const to = at(end);
    return Number.isFinite(from) && Number.isFinite(to) ? roundMs(to - from) : null;
  };
  const totalMs = at("response_ready") || timeline.at(-1)?.elapsedMs || 0;
  return {
    totalMs,
    requestValidationMs: duration("request_received", "auth_context_resolved"),
    planningMs: duration("planning_started", "planning_completed"),
    partFittingMs: duration("phase_fitting_parts", "parts_fitted"),
    awsAssemblyBranchMs: duration("artifact_generation_started", "artifact_generation_completed"),
    modelFetchWindowMs: duration("aws_models_fetch_started", "aws_models_fetch_completed"),
    persistenceMs: duration("persistence_write_started", "persistence_write_completed"),
    criticalBranch: "aws_assembly",
    heroApiCalls: 0,
    imageApiCalls: 0,
    stlFiles: 0,
    housingFiles: 0,
    selectedPartCount: Array.isArray(build.parts) ? build.parts.length : 0,
    remoteGlbCount: build.artifacts?.delivery?.modelFetches?.length || 0,
    remoteGlbBytes: build.artifacts?.delivery?.totalModelBytes || 0,
    generatedGlbCount: build.artifacts?.delivery?.generatedModelCount ?? null,
    localGlbRequests: build.artifacts?.delivery?.localModelRequests ?? null,
    localGlbBytes: build.artifacts?.delivery?.localModelBytes ?? null,
    wiringCount: build.artifacts?.wiring?.wireCount || 0,
    controllerNodeCount: build.artifacts?.assembly?.networkNodes?.length || 0,
    espNowWirelessLinkCount: build.artifacts?.assembly?.wirelessLinks?.length || 0,
    assemblyStepCount: build.artifacts?.assembly?.steps?.length || 0,
    firmwareSourceBytes: Buffer.byteLength(build.artifacts?.firmware?.source || "", "utf8"),
  };
}

function branchFor(name) {
  if (name.startsWith("aws_") || name.startsWith("assembly_")
    || name.startsWith("wiring_") || name.startsWith("firmware_")
    || name.startsWith("artifact_")) return "aws_assembly";
  if (name.startsWith("planning") || name.startsWith("parts_") || name.startsWith("phase_")) return "planning";
  if (name.startsWith("persistence_")) return "persistence";
  return "request";
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 16 * 1024) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON");
  }
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
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    output[key] = value;
  }
  return output;
}

function applyCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:3001");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response, value, status = 200) {
  const body = status === 204 ? "" : JSON.stringify(value);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function roundMs(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}
