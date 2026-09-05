import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assessBuildBrief, verifiedPartsCatalog } from "./makeable-builds.mjs";
import {
  createPrompt2CircuitArtifacts,
  eligibleExactCatalogMentions,
  productionPlannerCatalog,
  requestedExactCatalogQuantities,
  requestSolAssemblyPresentation,
} from "./prompt2circuit-production.mjs";
import { loadProductionPromptPackage } from "./production-prompt-package.mjs";
import {
  requestedCapabilitiesForIdea,
  semanticCapabilitiesForPart,
  validateSemanticCohesion,
} from "./prompt2circuit-semantic-contract.mjs";

const ROOT = process.env.LAMBDA_TASK_ROOT
  ? path.resolve(process.env.LAMBDA_TASK_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The speech-capture release is ready-78 plus one exact, hash-bound INMP441
// profile. It does not activate the separate ready-79 C3 candidate.
const RELEASE = "prompt2circuit-production-ready79-speech-capture-20260904-v1";
const RELEASE_ROOT = path.join(ROOT, "artifacts", "aws-assembly-release", RELEASE);
const COMPILER_PATCH_REVISION = "bme280-straps-xiao-s3-contact-frame-v2";
const SEMANTIC_PATCH_REVISION = "speech-capture-and-cloud-api-v5";
const PAIRED_TOUCH_CONTROLLER_ASSET_ID = "esp32-c6-1-47inch-ips-touch-display-development-board-with-pre-soldered-header";
const GROVE_CONTROLLER_ASSET_ID = "seeed-xiao-esp32c6";
let pipelinePromise = null;

export function loadProductionBuildPipeline() {
  if (!pipelinePromise) pipelinePromise = createPipeline();
  return pipelinePromise;
}

async function createPipeline() {
  const [manifest, profilesDocument, connectorGeometryAudit, promptPackage] = await Promise.all([
    readJson(path.join(RELEASE_ROOT, "manifest.json")),
    readJson(path.join(RELEASE_ROOT, "profiles.json")),
    readJson(path.join(RELEASE_ROOT, "connector-geometry-audit.json")),
    loadProductionPromptPackage(ROOT),
  ]);
  if (manifest.revision !== RELEASE || profilesDocument.revision !== RELEASE) {
    throw new Error("production_pipeline_release_revision_mismatch");
  }
  const profiles = normalizeProductionProfileContracts(profilesDocument.profiles || []);
  const releasedAssetIds = new Set((manifest.assets || []).map((asset) => asset.partId));
  const fullCatalog = verifiedPartsCatalog();
  const fullCatalogById = new Map(fullCatalog.map((part) => [part.id, part]));
  const plannerCatalog = productionPlannerCatalog(fullCatalog, profiles, connectorGeometryAudit, {
    requireControllerCarrier: true,
    requireStrictOneShot: true,
    userSelectableOnly: true,
  }).filter((part) => requiredAssetIds(part).every((assetId) => releasedAssetIds.has(assetId)));
  const plannerById = new Map(plannerCatalog.map((part) => [part.id, part]));
  const defaultController = plannerCatalog.find((part) => (
    part.category === "controller"
    && (part.assemblyAssetIds || []).includes("esp32-s3-devkitc-1-n8r2")
  ));
  const briefStage = promptPackage.stage("brief_clarification");
  const partsStage = promptPackage.stage("parts_plan");
  const assemblyStage = promptPackage.stage("assembly_routing");

  function finalizeSelectedParts(parts, { idea = "" } = {}) {
    let selected = [];
    const exactMentions = eligibleExactCatalogMentions(idea, fullCatalog, plannerCatalog);
    const exactMentionIds = new Set(exactMentions.map((mention) => mention.catalogId));
    for (const part of parts || []) {
      const plannerPart = plannerById.get(part.id);
      if (!plannerPart) continue;
      selected.push(withExactAsset(part, plannerPart));
    }
    for (const mention of exactMentions) {
      if (selected.some((part) => part.id === mention.catalogId)) continue;
      selected.push(withExactAsset(fullCatalogById.get(mention.catalogId), plannerById.get(mention.catalogId)));
    }
    for (const quantity of requestedExactCatalogQuantities(idea, fullCatalog, plannerCatalog)) {
      const plannerPart = plannerById.get(quantity.catalogId);
      if (!plannerPart || plannerPart.category === "controller") continue;
      const exact = withExactAsset(fullCatalogById.get(quantity.catalogId), plannerPart);
      for (let index = selected.length - 1; index >= 0; index -= 1) {
        if (selected[index].id === quantity.catalogId) selected.splice(index, 1);
      }
      for (let index = 0; index < quantity.requestedCount; index += 1) selected.push(exact);
    }
    const requestedCapabilities = requestedCapabilitiesForIdea(idea);
    if (requestedCapabilities.includes("speech_audio_capture")
      && !selected.some((part) => semanticCapabilitiesForPart(part).includes("speech_audio_capture"))) {
      const speechCaptureCandidates = plannerCatalog.filter((part) => (
        semanticCapabilitiesForPart(part).includes("speech_audio_capture")
      ));
      if (speechCaptureCandidates.length !== 1) {
        throw new Error(`production_speech_capture_candidate_count_invalid:${speechCaptureCandidates.length}`);
      }
      const speechCapture = speechCaptureCandidates[0];
      selected.push(withExactAsset(fullCatalogById.get(speechCapture.id), speechCapture));
    }
    if (!selected.some((part) => part.category === "controller")) {
      if (!defaultController) throw new Error("production_default_controller_unavailable");
      selected.unshift(withExactAsset(fullCatalogById.get(defaultController.id), defaultController));
    }
    selected = normalizeProductControllerTopology({
      idea,
      selected,
      exactMentionIds,
      plannerById,
      fullCatalogById,
      defaultController,
      pairedTouchController: plannerCatalog.find((part) => (
        part.category === "controller"
        && (part.assemblyAssetIds || []).includes(PAIRED_TOUCH_CONTROLLER_ASSET_ID)
      )),
      groveController: plannerCatalog.find((part) => (
        part.category === "controller"
        && (part.assemblyAssetIds || []).includes(GROVE_CONTROLLER_ASSET_ID)
      )),
    });
    return selected;
  }

  return Object.freeze({
    catalogRevision: manifest.revision,
    promptPackageRevision: promptPackage.packageVersion,
    compilerPatchRevision: COMPILER_PATCH_REVISION,
    semanticPatchRevision: SEMANTIC_PATCH_REVISION,
    assessIdea({ idea, env, fetchFn = fetch } = {}) {
      return assessBuildBrief(idea, {
        env: { ...env, OPENAI_BUILD_MODEL: briefStage.owner },
        fetchFn,
        prompt: briefStage.prompt,
        model: briefStage.owner,
        reasoningEffort: briefStage.reasoningEffort,
        serviceTier: briefStage.serviceTier,
        plannerCatalog,
      });
    },
    createOptions({ env, buildIdentity, fetchFn = fetch, onEvent, onPhase } = {}) {
      const productionEnv = {
        ...env,
        OPENAI_BUILD_MODEL: partsStage.owner,
      };
      return {
        env: productionEnv,
        fetchFn,
        allowAnonymous: true,
        buildIdentity,
        compilerPatchRevision: COMPILER_PATCH_REVISION,
        partsPlannerPrompt: partsStage.prompt,
        partsPlannerModel: partsStage.owner,
        partsPlannerReasoningEffort: partsStage.reasoningEffort,
        partsPlannerServiceTier: partsStage.serviceTier,
        plannerCatalog,
        requireLivePlanner: true,
        enforceProjectCopyQuality: true,
        preservePlannerSelection: true,
        finalizeSelectedParts,
        validateSelectedPlan: validateSemanticCohesion,
        onEvent,
        onPhase,
        generateArtifacts: ({ parts, fetchFn: artifactFetch, onEvent: artifactEvent }) => createPrompt2CircuitArtifacts({
          parts,
          profiles,
          manifest,
          fetchFn: artifactFetch,
          onEvent: artifactEvent,
          validateRemoteAssets: true,
          connectorGeometryAudit,
          presentationPlanner: ({ placement, graph, resolved }) => requestSolAssemblyPresentation({
            env: productionEnv,
            fetchFn: artifactFetch,
            prompt: assemblyStage.prompt,
            placement,
            graph,
            resolved,
          }),
        }),
      };
    },
  });
}

export function inferredProductDeviceCount(idea = "") {
  const text = String(idea).toLowerCase();
  const pairedPeople = /\b(?:couple|partners?|two[- ]person|two[- ]people|both of us|each of us|one\b.{0,60}\b(?:for|on|at) each(?: person's)?(?: desk)?)\b/.test(text);
  const pairedProduct = /\b(?:buddy|buddies|companion|companions|emotion|emotions|feeling|feelings|mood|message|messenger|notifier|display|device|devices)\b/.test(text);
  return pairedPeople && pairedProduct ? 2 : 1;
}

function normalizeProductControllerTopology({
  idea,
  selected,
  exactMentionIds,
  plannerById,
  fullCatalogById,
  defaultController,
  pairedTouchController,
  groveController,
}) {
  const deviceCount = inferredProductDeviceCount(idea);
  const exactControllerIds = new Set([...exactMentionIds].filter((id) => (
    plannerById.get(id)?.category === "controller"
  )));
  const grovePeripheralSelected = selected.some((part) => (
    part.category !== "controller"
    && (plannerById.get(part.id)?.assemblyInterfaces || []).some((entry) => entry.connectorIntent === "grove_4p")
  ));
  const selectedControllers = selected.filter((part) => part.category === "controller");
  const genericXiaoSelected = selectedControllers.some((part) => (
    plannerById.get(part.id)?.controllerConnectionMode === "xiao_base_required"
    && !exactControllerIds.has(part.id)
  ));
  const pairedInteractiveProduct = deviceCount > 1
    && /\b(?:buddy|companion|emotion|feeling|mood|message|messenger|display)\b/i.test(String(idea));

  let replacement = null;
  if (pairedInteractiveProduct && exactControllerIds.size === 0) {
    if (!pairedTouchController) throw new Error("paired_touch_controller_unavailable");
    replacement = pairedTouchController;
  } else if (genericXiaoSelected && grovePeripheralSelected && exactControllerIds.size === 0) {
    if (!groveController) throw new Error("grove_controller_visual_contract_unavailable");
    replacement = groveController;
  }
  else if (genericXiaoSelected && !grovePeripheralSelected && exactControllerIds.size === 0) replacement = defaultController;

  if (replacement) {
    const exactReplacement = withExactAsset(fullCatalogById.get(replacement.id), replacement);
    selected = [exactReplacement, ...selected.filter((part) => part.category !== "controller")];
  }

  if (deviceCount > 1) {
    const controllers = selected.filter((part) => part.category === "controller");
    if (controllers.length !== 1) {
      throw new Error(`paired_product_controller_seed_invalid:${controllers.length}`);
    }
    selected = [
      ...Array.from({ length: deviceCount }, () => ({ ...controllers[0] })),
      ...selected.filter((part) => part.category !== "controller"),
    ];
  }
  return selected;
}

export function normalizeProductionProfileContracts(profiles) {
  return (profiles || []).map((profile) => {
    if (profile?.assetId === "seeed-xiao-esp32s3") {
      return {
        ...profile,
        // The ready-78 snapshot predates the manufacturer-CAD axis correction.
        // These header pins leave the underside of the XIAO along local -Y,
        // rather than the legacy local +Z assumption.
        contacts: (profile.contacts || []).map((contact) => ({
          ...contact,
          normal: [0, -1, 0],
        })),
      };
    }
    if (profile?.assetId === "seeed-xiao-expansion-base-103030356") {
      const sharedMount = (profile.mounts || []).find((mount) => (
        mount.id === "xiao-controller-socket-2x7"
      ));
      if (!sharedMount) throw new Error("production_xiao_shared_mount_contract_missing");
      return {
        ...profile,
        mounts: [
          ...(profile.mounts || []).map((mount) => (
            mount.id === sharedMount.id
              ? {
                ...mount,
                compatibleAssetIds: (mount.compatibleAssetIds || []).filter((assetId) => (
                  assetId !== "seeed-xiao-esp32s3"
                )),
              }
              : mount
          )),
          {
            ...sharedMount,
            id: "xiao-esp32s3-controller-socket-2x7",
            compatibleAssetIds: ["seeed-xiao-esp32s3"],
            rotation: [Math.PI / 2, 0, Math.PI],
            evidence: "exact-xiao-esp32s3-manufacturer-cad-axis-to-expansion-base-d-label-frame-2026-09-01",
          },
        ],
      };
    }
    if (profile?.assetId !== "bme280-gy-bme280") return profile;
    const expected = new Map([
      ["csb-to-vcc-i2c-mode", ["CSB", "VCC"]],
      ["sdo-to-gnd-address-0x76", ["SDO", "GND"]],
    ]);
    const straps = profile.requiredSignalStraps || [];
    if (straps.length !== expected.size) throw new Error("production_bme280_strap_contract_invalid");
    return {
      ...profile,
      requiredSignalStraps: straps.map((strap) => {
        const signals = expected.get(strap.id);
        if (!signals
          || strap.fromSignal !== signals[0]
          || strap.toSignal !== signals[1]
          || strap.connectionMode !== "routed-conductor"
          || !["direct-contact-strap", "separate-surface-contact-strap"].includes(strap.terminationMode)) {
          throw new Error(`production_bme280_strap_contract_invalid:${strap.id || "missing"}`);
        }
        // The immutable ready-78 profile names this as a direct-contact strap,
        // while the compiler's physically proven contract routes CSB and SDO
        // to their own carrier rail contacts. Preserve the exact endpoints and
        // interpret that legacy label as the verified six-contact topology.
        return { ...strap, terminationMode: "separate-surface-contact-strap" };
      }),
    };
  });
}

function withExactAsset(part, plannerPart) {
  if (!part || !plannerPart) throw new Error("planner_part_exact_resolution_missing");
  const allowed = new Set(plannerPart.assemblyAssetIds || []);
  const assemblyAssets = (part.assemblyAssets || []).filter((asset) => allowed.has(asset.partId));
  if (assemblyAssets.length !== 1) {
    throw new Error(`planner_part_exact_asset_resolution_invalid:${part.id}:${assemblyAssets.length}`);
  }
  return { ...part, assemblyAssets };
}

function requiredAssetIds(part) {
  return [...new Set([
    ...(part.assemblyAssetIds || []),
    part.controllerCarrierAssetId,
    ...(part.assemblyInterfaces || []).flatMap((profile) => profile.compilerInjectedAccessoryAssetIds || []),
  ].filter(Boolean))];
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
