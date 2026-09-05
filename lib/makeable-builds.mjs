import catalogCsv from "./verified-parts-catalog-data.mjs";
import assemblyAssetCsv from "./assembly-asset-catalog-data.mjs";
import { GoogleGenAI } from "@google/genai";
import { applyAssemblyPolicy } from "./assembly-policy.mjs";
import { breakoutResearchForController } from "./esp32-breakout-catalog.mjs";
import { geometrySummaryForBuild } from "./geometry-contract.mjs";
import { approvedPartThumbnailUrl } from "./part-thumbnail-registry.mjs";
import { sensorSpecForPart } from "./sensor-registry.mjs";
import { requestedCapabilitiesForIdea } from "./prompt2circuit-semantic-contract.mjs";

export const DEFAULT_BUILD_MODEL = "gpt-5.4-mini";
export const DEFAULT_IMAGE_MODEL = "gpt-image-2";
export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
export const DEFAULT_IMAGE_QUALITY = "low";
export const DEFAULT_BUILD_SERVICE_TIER = "priority";

const OWNER_FS90R_S3_GVS_RULE_ID = "owner-bench-fs90r-s3-carrier-gvs-v3";
const OWNER_FS90R_S3_CONTROLLER_ASSET_IDS = new Set([
  "esp32-s3-devkitc-1-n8r2",
  "esp32-s3-devkit-n16r8",
]);

const fallbackImages = [
  "/concepts/community-v1/assets/window-air-monitor-v1.webp",
  "/concepts/community-v1/assets/pet-water-reminder-v1.webp",
  "/concepts/community-v1/assets/quiet-door-chime-v1.webp",
];

const assemblyAssetCatalog = loadAssemblyAssetCatalog();
const assemblyAssetsByCatalogKey = groupAssemblyAssets(assemblyAssetCatalog);
const catalog = loadCatalog();
const catalogById = new Map(catalog.map((part) => [part.id, part]));
const catalogByAssemblyAssetId = new Map(
  catalog.flatMap((part) => (part.assemblyAssets || []).map((asset) => [asset.partId, part])),
);

const PRESENTATION_IMAGE_OVERRIDES = Object.freeze({
  "build_build-a-quiet-visual-door-open-notifier-using-a-magnetic_XHIYhukFprNH5A": {
    url: "/concepts/build-corrections/quiet-door-open-notifier-two-node-v2.png",
    source: "curated-assembly-correction",
    model: "gpt-image-2",
  },
});

export function presentationImageForBuild(build = {}) {
  const override = PRESENTATION_IMAGE_OVERRIDES[build.id];
  return override && build.image ? { ...build.image, ...override } : build.image;
}

export function verifiedPartsCatalog() {
  return catalog.map(publicPart);
}

export function catalogStats() {
  const selectable = catalog.filter((part) => part.modelSelectable);
  return {
    total: catalog.length,
    selectable: selectable.length,
    presolderedVerified: catalog.filter((part) => part.presoldered).length,
    assemblyMapped: catalog.filter((part) => part.assemblyAssets.length > 0).length,
    assemblyReady: catalog.filter((part) => part.assemblyAssets.some((asset) => asset.ready)).length,
  };
}

export function buildIdeaNeedsClarification(rawIdea) {
  const idea = sanitizeIdea(rawIdea).toLowerCase();
  if (!idea) return true;
  const words = idea.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [];
  const unresolvedObject = /\b(?:something|anything|whatever|a thing|an idea|a project)\b/.test(idea);
  const broadTheme = /\b(?:halloween|christmas|holiday|holidays|easter|birthday|party|valentine(?:'s)?|spooky|festive)\b/.test(idea);
  const concreteBehavior = /\b(?:display|monitor|measure|detect|sense|track|show|light|lamp|clock|timer|alarm|speaker|sound|chime|camera|robot|rover|controller|button|dial|knob|screen|sensor|reminder|sign|counter|thermometer|weather|air quality|temperature|humidity|motion|distance)\b/.test(idea);
  const abstractInformationDevice = /\b(?:task|tasks|to-do|todo|checklist|agenda|crypto|stocks?|portfolio)\b/.test(idea)
    && !/\b(?:display|screen|oled|lcd|e-?ink|touch(?:screen)?|button|dial|knob|keypad|led|light|speaker|buzzer|phone|mobile)\b/.test(idea);
  return unresolvedObject
    || unspecifiedSensorIntent(idea)
    || (broadTheme && words.length <= 8 && !concreteBehavior)
    || abstractInformationDevice
    || remoteMessagingNeedsClarification(idea);
}

export async function assessBuildBrief(rawIdea, options = {}) {
  const idea = sanitizeIdea(rawIdea);
  if (!idea) return fallbackBuildClarification(idea);
  if (!buildIdeaNeedsClarification(idea)) {
    return { status: "ready", reason: "The idea names a concrete build outcome.", question: "", options: [] };
  }

  const env = options.env || {};
  if (!env.OPENAI_API_KEY || env.MAKEABLE_FORCE_BUILD_FALLBACK === "1") {
    return fallbackBuildClarification(idea);
  }

  try {
    const response = await openAIResponses({
      model: options.model || env.OPENAI_BUILD_MODEL || env.OPENAI_MODEL || DEFAULT_BUILD_MODEL,
      service_tier: options.serviceTier || openAIServiceTier(env),
      reasoning: { effort: options.reasoningEffort || "high" },
      input: [
        { role: "developer", content: String(options.prompt || "Clarify underspecified physical build ideas with three concrete choices.") },
        { role: "user", content: JSON.stringify({
          idea,
          catalogSummary: (options.plannerCatalog || plannerCatalog()).map((part) => ({
            id: part.id,
            name: part.name,
            category: part.category,
            subtype: part.subtype,
          })),
        }) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "makeable_build_brief_clarification",
          strict: true,
          schema: buildBriefClarificationSchema(),
        },
      },
    }, env, options.fetchFn || fetch);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "Brief clarification request failed.");
    return normalizeBuildClarification(JSON.parse(outputText(data)), idea);
  } catch {
    return fallbackBuildClarification(idea);
  }
}

export function createLocalBuildStore(filePath) {
  return {
    async list() {
      const { existsSync } = await import("node:fs");
      if (!existsSync(filePath)) return [];
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(filePath, "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
    async get(id) {
      return (await this.list()).find((build) => build.id === id) || null;
    },
    async save(build) {
      const [{ appendFile, mkdir }, path] = await Promise.all([
        import("node:fs/promises"),
        import("node:path"),
      ]);
      await mkdir(path.dirname(filePath), { recursive: true });
      await appendFile(filePath, `${JSON.stringify(build)}\n`, "utf8");
      return build;
    },
  };
}

export function createNetlifyBuildStore(store) {
  return {
    async list() {
      const page = await store.list();
      const builds = await Promise.all(
        page.blobs
          .filter((blob) => String(blob.key || "").startsWith("builds/"))
          .map((blob) => store.get(blob.key, { type: "json" })),
      );
      return builds
        .filter(Boolean)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
    async get(id) {
      return await store.get(buildStoreKey(id), { type: "json" });
    },
    async save(build) {
      await store.setJSON(buildStoreKey(build.id), build, {
        metadata: { createdAt: build.createdAt },
      });
      return build;
    },
  };
}

export async function listPublicBuilds(store) {
  const builds = await store.list();
  return builds.map(publicBuild);
}

export async function getPublicBuild(store, id) {
  if (!safeBuildId(id)) return null;
  const build = await store.get(id);
  return build ? publicBuild(build) : null;
}

export async function createBuild(body, options) {
  const idea = sanitizeIdea(body?.idea);
  const email = sanitizeEmail(options?.userEmail || body?.email);
  if (!idea) return { status: 400, body: { error: "Describe what you want to build." } };
  if (!email && !options?.allowAnonymous) {
    return { status: 400, body: { error: "Enter a valid email to continue." } };
  }

  const env = options.env || {};
  const fetchFn = options.fetchFn || fetch;
  const buildIdentity = options.buildIdentity || null;
  if (buildIdentity && idea !== buildIdentity.normalizedPrompt) {
    throw new Error("build_identity_prompt_lineage_mismatch");
  }
  await options.onEvent?.("request_validated", { ideaLength: idea.length });
  await options.onPhase?.("planning");
  await options.onEvent?.("planning_started");
  let selected = await planBuild(idea, env, fetchFn, options.partsPlannerPrompt, {
    plannerCatalog: options.plannerCatalog,
    requireLivePlanner: options.requireLivePlanner === true,
    model: options.partsPlannerModel,
    reasoningEffort: options.partsPlannerReasoningEffort,
    serviceTier: options.partsPlannerServiceTier,
    buildIdentity,
    enforceProjectCopyQuality: options.enforceProjectCopyQuality === true,
  });
  await options.onEvent?.("planning_completed", {
    selectedPartCount: Array.isArray(selected?.selectedPartIds) ? selected.selectedPartIds.length : 0,
    selectedPartIds: Array.isArray(selected?.selectedPartIds) ? selected.selectedPartIds : [],
    plannerModel: selected?.model || "",
    plannerTitle: selected?.title || "",
    plannerWarnings: Array.isArray(selected?.warnings) ? selected.warnings : [],
  });
  await options.onPhase?.("fitting_parts");
  const resolvePlanParts = (plan) => {
    const resolved = options?.preservePlannerSelection === true
      ? resolveExactSelectedParts(plan.selectedPartIds)
      : pruneUnrequestedControls(
          pruneRedundantPresenceSensors(
            resolveSelectedParts(plan.selectedPartIds, idea),
            idea,
            plan,
          ),
          idea,
          plan,
        );
    // A caller may pin a known physical kit after the planner has chosen roles.
    // This is intentionally applied before geometry, image prompting, artifacts,
    // cost, and persistence so every downstream branch sees the same exact BOM.
    return typeof options?.finalizeSelectedParts === "function"
      ? options.finalizeSelectedParts(resolved, { idea, plan })
      : resolved;
  };
  let parts = resolvePlanParts(selected);
  if (!Array.isArray(parts) || !parts.length) {
    throw new Error("Selected-parts finalizer must return a non-empty parts array.");
  }
  let selectedPlanValidation = null;
  if (typeof options?.validateSelectedPlan === "function") {
    let validation = await options.validateSelectedPlan({ idea, plan: selected, parts });
    if (validation?.ok !== true
      && options.requireLivePlanner === true
      && (validation?.missingCapabilities?.length
        || validation?.planUnrequestedCapabilities?.length
        || validation?.unrelatedParts?.length)) {
      await options.onEvent?.("semantic_repair_started", {
        requestedCapabilities: validation.requestedCapabilities || [],
        planUnrequestedCapabilities: validation.planUnrequestedCapabilities || [],
        unrelatedPartIds: (validation.unrelatedParts || []).map((part) => part.id),
      });
      const repairInstruction = semanticRepairInstruction(validation);
      try {
        selected = await planBuild(
          idea,
          env,
          fetchFn,
          [String(options.partsPlannerPrompt || buildPlannerInstructions()), repairInstruction].join("\n\n"),
          {
            plannerCatalog: options.plannerCatalog,
            requireLivePlanner: true,
            model: options.partsPlannerModel,
            reasoningEffort: options.partsPlannerReasoningEffort,
            serviceTier: options.partsPlannerServiceTier,
            buildIdentity,
            enforceProjectCopyQuality: options.enforceProjectCopyQuality === true,
          },
        );
      } catch (error) {
        const localCopyRepair = await deterministicSemanticCopyRepair({
          idea,
          plan: selected,
          parts,
          validation,
          validateSelectedPlan: options.validateSelectedPlan,
        });
        if (!localCopyRepair) throw error;
        selected = localCopyRepair.plan;
        validation = localCopyRepair.validation;
        await options.onEvent?.("semantic_copy_repair_fallback", {
          reason: String(error?.code || error?.cause?.code || error?.message || "repair_request_failed"),
          selectedPartIds: selected.selectedPartIds || [],
        });
      }
      parts = resolvePlanParts(selected);
      validation = await options.validateSelectedPlan({ idea, plan: selected, parts });
      await options.onEvent?.("semantic_repair_completed", {
        ok: validation?.ok === true,
        selectedPartIds: selected.selectedPartIds || [],
      });
    }
    selectedPlanValidation = validation;
    if (validation?.ok !== true) {
      await options.onEvent?.("semantic_fulfillment_blocked", {
        reason: validation?.reason || "semantic_fulfillment_incomplete",
        requestedCapabilities: validation?.requestedCapabilities || [],
        missingCapabilities: validation?.missingCapabilities || [],
        planUnrequestedCapabilities: validation?.planUnrequestedCapabilities || [],
        unrelatedPartIds: (validation?.unrelatedParts || []).map((part) => part.id),
      });
      return {
        status: Number(validation?.status || 422),
        body: {
          error: validation?.message || "The selected parts do not cover every requested capability.",
          code: validation?.reason || "semantic_fulfillment_incomplete",
          semanticFulfillment: validation,
        },
      };
    }
    await options.onEvent?.("semantic_fulfillment_validated", {
      requestedCapabilities: validation.requestedCapabilities || [],
      providedCapabilities: validation.providedCapabilities || [],
    });
  }
  const blockedPlannerReason = plannerBlockedReason(selected);
  if (blockedPlannerReason) {
    await options.onEvent?.("planner_output_blocked", {
      reason: blockedPlannerReason,
      plannerTitle: String(selected?.title || ""),
      plannerWarnings: Array.isArray(selected?.warnings) ? selected.warnings : [],
    });
    return {
      status: 422,
      body: {
        error: "The planner returned a blocked build and it was not accepted for persistence.",
        code: "planner_output_blocked",
        details: {
          reason: blockedPlannerReason,
          plannerTitle: String(selected?.title || ""),
          plannerWarnings: Array.isArray(selected?.warnings) ? selected.warnings : [],
        },
      },
    };
  }
  const normalizedPlan = normalizePlan(selected, idea, parts);
  const circuitOnly = options?.circuitOnly === true;
  let artifacts = null;
  if (typeof options.generateArtifacts === "function") {
    await options.onPhase?.("assembling");
    await options.onEvent?.("artifact_generation_started");
    artifacts = await options.generateArtifacts({
      idea,
      parts,
      plan: normalizedPlan,
      buildIdentity,
      geometry: null,
      imagePrompt: "",
      env,
      fetchFn,
      onEvent: options.onEvent,
    });
    await options.onEvent?.("artifact_generation_completed", {
      assetCount: Array.isArray(artifacts?.assembly?.requiredAssets)
        ? artifacts.assembly.requiredAssets.length
        : 0,
      wireCount: Array.isArray(artifacts?.wiring?.wires)
        ? artifacts.wiring.wires.length
        : 0,
    });
  }
  parts = reconcileBuildPartsWithAssembly(parts, artifacts);
  const geometry = circuitOnly ? null : geometrySummaryForBuild({
    idea,
    parts,
    plan: normalizedPlan,
    requestedAffordances: normalizedPlan.visibleHardwareCues,
  });
  const assemblyPromptBlock = circuitOnly ? "" : assemblyHeroPromptBlock(artifacts);
  const imagePrompt = circuitOnly ? "" : makeImagePrompt(
    normalizedPlan,
    parts,
    idea,
    [geometry.promptBlock, assemblyPromptBlock].filter(Boolean).join("\n\n"),
  );
  await options.onEvent?.("parts_fitted", {
    partCount: parts.length,
    assemblyAssetCount: parts.reduce(
      (count, part) => count + (Array.isArray(part?.assemblyAssets)
        ? part.assemblyAssets.filter((asset) => asset?.ready).length
        : 0),
      0,
    ),
  });
  await options.onPhase?.(circuitOnly ? "assembling" : "rendering");
  if (!circuitOnly) await options.onEvent?.("hero_generation_from_final_assembly_started");
  const imagePromise = circuitOnly
    ? Promise.resolve(null)
    : options?.skipImageGeneration
    ? (async () => {
        await options.onEvent?.("image_generation_skipped", { reason: "api_circuit_only_test" });
        return {
          url: "",
          source: "skipped",
          model: "skipped",
          skipped: true,
        };
      })()
    : (async () => {
        await options.onEvent?.("image_generation_started", {
          route: hasGeminiImageGateway(env)
            ? "gemini_gateway"
            : usesDirectOpenAI(env)
            || String(env.OPENAI_IMAGE_BASE_URL || "").trim()
            || String(env.OPENAI_IMAGE_API_KEY || "").trim()
            ? "images_api"
            : "responses_image_tool",
        });
        const heroImagePrompt = typeof options.refineImagePrompt === "function"
          ? await options.refineImagePrompt({
              idea,
              parts,
              plan: normalizedPlan,
              geometry,
              imagePrompt,
              env,
              fetchFn,
              onEvent: options.onEvent,
            })
          : imagePrompt;
        const image = await generateBuildImage(heroImagePrompt, idea, env, fetchFn, {
          buildIdentity,
          plan: normalizedPlan,
          parts,
          geminiClientFactory: options.geminiClientFactory,
        });
        await options.onEvent?.("image_generation_completed", {
          source: image?.source || "",
          model: image?.model || "",
          status: image?.status || "",
          fallbackReason: image?.fallbackReason || "",
        });
        return image;
      })();
  const image = await imagePromise;
  const lineage = buildIdentity ? {
    buildId: buildIdentity.buildId,
    requestFingerprint: buildIdentity.requestFingerprint,
    catalogRevision: buildIdentity.catalogRevision,
    promptPackageRevision: buildIdentity.promptPackageRevision,
    ...(options.compilerPatchRevision ? { compilerPatchRevision: options.compilerPatchRevision } : {}),
  } : null;
  const boundImage = image && lineage ? { ...image, ...lineage } : image;
  const boundArtifacts = artifacts && lineage ? { ...artifacts, lineage } : artifacts;
  const createdAt = new Date().toISOString();
  const build = {
    id: buildIdentity?.buildId || newBuildId(idea),
    createdAt,
    idea,
    ...(email ? { email } : {}),
    title: normalizedPlan.title,
    summary: normalizedPlan.summary,
    behavior: normalizedPlan.behavior,
    visibleHardwareCues: normalizedPlan.visibleHardwareCues,
    ...(!circuitOnly ? { imagePrompt, image: boundImage } : {}),
    parts,
    warnings: normalizedPlan.warnings,
    ...(selectedPlanValidation ? { semanticFulfillment: selectedPlanValidation } : {}),
    ...(!circuitOnly ? { geometryContract: geometry.contract } : {}),
    cost: calculateCost(parts),
    models: {
      planner: normalizedPlan.model,
      ...(!circuitOnly ? { image: boundImage.model } : {}),
    },
    ...(boundArtifacts ? { artifacts: boundArtifacts } : {}),
    ...(buildIdentity ? { identity: buildIdentity } : {}),
    status: "Concept",
  };

  await options.store.save(build);
  await options.onEvent?.("build_persisted", { buildId: build.id });
  return { status: 201, body: publicBuild(build) };
}

async function planBuild(idea, env, fetchFn, partsPlannerPrompt = "", options = {}) {
  if (!env.OPENAI_API_KEY || env.MAKEABLE_FORCE_BUILD_FALLBACK === "1") {
    if (options.requireLivePlanner) throw new Error("live_parts_planner_required");
    return fallbackPlan(idea, "deterministic_fallback", options.buildIdentity);
  }

  try {
    const model = options.model || env.OPENAI_BUILD_MODEL || env.OPENAI_MODEL || DEFAULT_BUILD_MODEL;
    const reasoningEffort = options.reasoningEffort || "low";
    const serviceTier = options.serviceTier || openAIServiceTier(env);
    const requestOptions = {
      idea,
      env,
      fetchFn,
      model,
      reasoningEffort,
      serviceTier,
      partsPlannerPrompt,
      plannerCatalog: options.plannerCatalog,
      buildIdentity: options.buildIdentity,
    };
    let parsed = await requestBuildPlan(requestOptions);
    assertPlannerIdentity(parsed, options.buildIdentity);
    if (options.enforceProjectCopyQuality) {
      const initialIssues = generatedProjectCopyIssues(parsed);
      if (initialIssues.length) {
        const lockedPartIds = [...parsed.selectedPartIds];
        const repaired = await requestBuildPlan({
          ...requestOptions,
          copyRepairInstruction: projectCopyRepairInstruction(parsed, initialIssues, lockedPartIds),
        });
        assertPlannerIdentity(repaired, options.buildIdentity);
        if (!sameOrderedStrings(repaired.selectedPartIds, lockedPartIds)) {
          throw new Error("planner_copy_repair_selection_drift");
        }
        if (!sameOrderedStrings(repaired.warnings, parsed.warnings)
          || !sameOrderedStrings(repaired.visibleHardwareCues, parsed.visibleHardwareCues)) {
          throw new Error("planner_copy_repair_scope_drift");
        }
        const remainingIssues = generatedProjectCopyIssues(repaired);
        if (remainingIssues.length) {
          throw new Error(`planner_project_copy_invalid:${remainingIssues.join(",")}`);
        }
        parsed = repaired;
      }
    }
    return { ...parsed, model };
  } catch (error) {
    if (options.requireLivePlanner) throw error;
    return {
      ...fallbackPlan(idea, "fallback_after_openai_error", options.buildIdentity),
      warnings: [
        ...fallbackPlan(idea, "fallback_after_openai_error", options.buildIdentity).warnings,
        "OpenAI planning failed in this environment, so Makeable used the deterministic catalog matcher.",
      ],
    };
  }
}

async function requestBuildPlan({
  idea,
  env,
  fetchFn,
  model,
  reasoningEffort,
  serviceTier,
  partsPlannerPrompt,
  plannerCatalog: providedCatalog,
  buildIdentity,
  copyRepairInstruction = "",
}) {
  const response = await openAIResponses(
    {
      model,
      service_tier: serviceTier,
      reasoning: { effort: reasoningEffort },
      input: [
        {
          role: "developer",
          content: [
            String(partsPlannerPrompt || buildPlannerInstructions()),
            ...(buildIdentity ? [
              "The user payload includes requestIdentity. Copy requestIdentity.buildId and requestIdentity.requestFingerprint exactly into the same-named output fields. Never alter or infer either value.",
            ] : []),
            copyRepairInstruction,
          ].filter(Boolean).join("\n\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            idea,
            ...(buildIdentity ? { requestIdentity: {
              buildId: buildIdentity.buildId,
              requestFingerprint: buildIdentity.requestFingerprint,
            } } : {}),
            catalog: Array.isArray(providedCatalog) ? providedCatalog : plannerCatalog(),
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "makeable_build_plan",
          strict: true,
          schema: buildPlanSchema(Boolean(buildIdentity)),
        },
      },
    },
    env,
    fetchFn,
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Planner request failed.");
  return JSON.parse(outputText(data));
}

function assertPlannerIdentity(plan, buildIdentity) {
  if (buildIdentity && (
    plan.buildId !== buildIdentity.buildId
    || plan.requestFingerprint !== buildIdentity.requestFingerprint
  )) throw new Error("planner_identity_echo_mismatch");
}

function projectCopyRepairInstruction(plan, issues, lockedPartIds) {
  return [
    "COPY QUALITY RETRY: The previous response failed the deterministic customer-copy gate.",
    `Failed checks: ${issues.join(", ")}.`,
    `Keep selectedPartIds byte-for-byte identical and in this exact order: ${JSON.stringify(lockedPartIds)}.`,
    "Keep every identity field, warning, and hardware claim unchanged. Rewrite only title, summary, and behavior so they satisfy the customer-facing copy contract in the production prompt.",
    `Previous copy: ${JSON.stringify({ title: plan.title, summary: plan.summary, behavior: plan.behavior })}`,
  ].join("\n");
}

function semanticRepairInstruction(validation = {}) {
  return [
    "SEMANTIC COHESION RETRY: The previous response missed a requested capability, added an unrequested capability, or selected an unrelated part.",
    `Requested capabilities: ${JSON.stringify(validation.requestedCapabilities || [])}.`,
    `Missing capabilities to add with exact catalog parts: ${JSON.stringify(validation.missingCapabilities || [])}.`,
    `Unrequested capabilities to remove: ${JSON.stringify(validation.planUnrequestedCapabilities || [])}.`,
    `Unrelated functional part ids to remove: ${JSON.stringify((validation.unrelatedParts || []).map((part) => part.id))}.`,
    "Return a complete replacement plan for the same user idea. Select only the minimum functional parts needed for the requested behavior, plus one compatible controller. Remove optional sensors, displays, lights, sounds, cameras, controls, and decorative behaviors unless the user's words require them. Do not weaken, reinterpret, or add to the requested outcome.",
  ].join("\n");
}

async function deterministicSemanticCopyRepair({
  idea,
  plan,
  parts,
  validation,
  validateSelectedPlan,
}) {
  if (validation?.missingCapabilities?.length
    || validation?.unrelatedParts?.length
    || !validation?.planUnrequestedCapabilities?.length
    || typeof validateSelectedPlan !== "function") {
    return null;
  }
  const ideaSentence = sentenceFromIdea(idea);
  const repaired = {
    ...plan,
    visibleHardwareCues: [],
  };
  for (const field of ["title", "summary", "behavior"]) {
    const probe = {
      title: "",
      summary: "",
      behavior: "",
      visibleHardwareCues: [],
      [field]: plan?.[field] || "",
    };
    const fieldValidation = await validateSelectedPlan({ idea, plan: probe, parts });
    if (fieldValidation?.planUnrequestedCapabilities?.length) {
      repaired[field] = field === "title" ? readableTitle("", idea) : ideaSentence;
    }
  }
  repaired.visibleHardwareCues = [];
  for (const cue of Array.isArray(plan?.visibleHardwareCues) ? plan.visibleHardwareCues : []) {
    const cueValidation = await validateSelectedPlan({
      idea,
      plan: { title: "", summary: "", behavior: "", visibleHardwareCues: [cue] },
      parts,
    });
    if (!cueValidation?.planUnrequestedCapabilities?.length) repaired.visibleHardwareCues.push(cue);
  }
  const repairedValidation = await validateSelectedPlan({ idea, plan: repaired, parts });
  return repairedValidation?.ok === true
    ? { plan: repaired, validation: repairedValidation }
    : null;
}

function sentenceFromIdea(idea) {
  const sentence = cleanSentence(idea);
  if (!sentence) return "This project follows the selected build idea.";
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function sameOrderedStrings(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

async function generateBuildImage(prompt, idea, env, fetchFn, buildContext = {}) {
  const fallback = fallbackImageForIdea(idea);
  if (env.MAKEABLE_SKIP_IMAGE_GENERATION === "1" || env.MAKEABLE_FORCE_BUILD_FALLBACK === "1") {
    return {
      url: fallback,
      source: "preview_fallback",
      status: "fallback",
      model: "static-preview",
    };
  }

  let geminiFailure = null;
  if (hasGeminiImageGateway(env)) {
    try {
      return await generateGeminiGatewayImage(prompt, env, buildContext.geminiClientFactory);
    } catch (error) {
      geminiFailure = error;
    }
  }

  if (!env.OPENAI_API_KEY) {
    return geminiFailure
      ? deterministicBuildHero(buildContext, idea, failureCode(geminiFailure, "gemini_image_unavailable"))
      : {
          url: fallback,
          source: "preview_fallback",
          status: "fallback",
          model: "static-preview",
        };
  }

  if (!usesDirectOpenAI(env)
    && !String(env.OPENAI_IMAGE_BASE_URL || "").trim()
    && !String(env.OPENAI_IMAGE_API_KEY || "").trim()) {
    const model = env.OPENAI_IMAGE_TOOL_MODEL || env.OPENAI_BUILD_MODEL || env.OPENAI_MODEL || DEFAULT_BUILD_MODEL;
    const payload = openAIRequestPayload({
      model,
      service_tier: openAIServiceTier(env),
      input: prompt,
      tools: [{
        type: "image_generation",
        action: "generate",
        quality: imageQuality(env.OPENAI_IMAGE_QUALITY),
        size: env.OPENAI_IMAGE_SIZE || "1024x1024",
      }],
    }, env);
    try {
      const response = await openAIImageToolResponse(payload, env, fetchFn);
      const data = await response.json();
      if (!response.ok) throw buildGenerationError(data?.error?.message || "Image generation failed.");
      const imageCall = (data?.output || []).find((item) => item?.type === "image_generation_call" && item?.result);
      if (!imageCall?.result) throw buildGenerationError("Image generation returned no image.");
      return {
        url: `data:image/png;base64,${imageCall.result}`,
        source: "openai_responses_image_tool",
        status: "generated",
        model,
      };
    } catch (error) {
      return deterministicBuildHero(
        buildContext,
        idea,
        failureCode(error, failureCode(geminiFailure, "image_tool_unavailable")),
      );
    }
  }

  const response = await fetchFn(openAIImageEndpoint(env, "/v1/images/generations"), {
      method: "POST",
      headers: openAIImageHeaders(env),
      signal: openAITimeoutSignal(env),
      body: JSON.stringify({
        model: env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
        prompt,
        n: 1,
        size: env.OPENAI_IMAGE_SIZE || "1024x1024",
        quality: imageQuality(env.OPENAI_IMAGE_QUALITY),
      }),
    });
  const data = await response.json();
  if (!response.ok) throw buildGenerationError(data?.error?.message || "Image generation failed.");
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw buildGenerationError("Image generation returned no image.");
  return {
    url: `data:image/png;base64,${b64}`,
    source: "openai",
    status: "generated",
    model: env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
  };
}

function hasGeminiImageGateway(env) {
  return Boolean(
    String(env.GEMINI_API_KEY || "").trim()
    && String(env.GOOGLE_GEMINI_BASE_URL || "").trim(),
  );
}

async function generateGeminiGatewayImage(prompt, env, clientFactory) {
  const timeoutMs = boundedTimeout(env.GEMINI_IMAGE_TIMEOUT_MS, 240_000, 30_000, 840_000);
  const client = typeof clientFactory === "function"
    ? clientFactory(env)
    : new GoogleGenAI({
        apiKey: env.GEMINI_API_KEY,
        httpOptions: {
          baseUrl: env.GOOGLE_GEMINI_BASE_URL,
          timeout: timeoutMs,
        },
      });
  const model = String(env.GEMINI_IMAGE_MODEL || DEFAULT_GEMINI_IMAGE_MODEL).trim();
  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseModalities: ["image", "text"],
      imageConfig: { aspectRatio: "3:4" },
    },
  });
  const imagePart = response?.candidates?.[0]?.content?.parts?.find(
    (part) => part?.inlineData?.mimeType?.startsWith("image/") && part?.inlineData?.data,
  );
  if (!imagePart?.inlineData?.data) throw buildGenerationError("Gemini image generation returned no image.");
  return {
    url: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
    source: "netlify_gemini_image_gateway",
    status: "generated",
    model,
  };
}

function boundedTimeout(value, fallback, minimum, maximum) {
  const requested = Number.parseInt(value, 10);
  return Number.isFinite(requested)
    ? Math.max(minimum, Math.min(requested, maximum))
    : fallback;
}

function failureCode(error, fallback) {
  return String(error?.code || error?.cause?.code || fallback || "provider_unavailable");
}

async function openAIImageToolResponse(payload, env, fetchFn) {
  const endpoint = openAIEndpoint(env, "/v1/responses");
  const requestedDelay = Number.parseInt(env.OPENAI_IMAGE_RETRY_DELAY_MS, 10);
  const retryDelayMs = Number.isFinite(requestedDelay)
    ? Math.max(0, Math.min(requestedDelay, 10_000))
    : 1_000;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetchFn(endpoint, {
        method: "POST",
        headers: openAIHeaders(env),
        signal: openAIImageToolTimeoutSignal(env),
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (!isRetryableOpenAINetworkError(error) || attempt === 2) throw error;
      if (retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (2 ** attempt)));
      }
    }
  }
  throw new Error("openai_image_unavailable_after_retries");
}

async function openAIResponses(payload, env, fetchFn) {
  const requestPayload = openAIRequestPayload(payload, env);
  const endpoint = openAIEndpoint(env, "/v1/responses");
  const request = {
    method: "POST",
    headers: openAIHeaders(env),
    body: JSON.stringify(requestPayload),
  };
  let response = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      response = await fetchFn(endpoint, request);
      break;
    } catch (error) {
      if (!isRetryableOpenAINetworkError(error) || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_500 * (2 ** attempt)));
    }
  }
  if (!response) throw new Error("openai_response_unavailable_after_retries");
  if (!usesDirectOpenAI(env) || payload.service_tier !== "priority" || response.ok) return response;

  const text = await response.clone().text();
  if (!/service[_\s-]*tier|priority.*(?:unavailable|not enabled|not supported)/i.test(text)) {
    return response;
  }
  return fetchFn(endpoint, {
    method: "POST",
    headers: openAIHeaders(env),
    body: JSON.stringify({ ...payload, service_tier: "default" }),
  });
}

function isRetryableOpenAINetworkError(error) {
  const code = String(error?.cause?.code || error?.code || "");
  const message = String(error?.message || "");
  return /^(?:ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT)$/.test(code)
    || /fetch failed|network.*(?:failed|reset)|socket.*(?:closed|reset)/i.test(message);
}

function buildPlannerInstructions() {
  return [
    "You are Makeable's parts planner for beginner-friendly ESP32 builds.",
    "Return only JSON matching the schema.",
    "Write title as a concise, friendly product name of 2-7 words. Name the object and its distinguishing purpose, not its circuit. Do not put controller families, sensor model numbers, display technologies, voltages, pin counts, or shopping-list language in the title. Keep a user-facing capability such as GPS, MIDI, FPV, or Wi-Fi only when people would genuinely use it to distinguish the product. Never copy a raw prompt fragment or end with a dangling word such as with, using, and, dual, single, moving, rotary, small, or tiny.",
    "Use conventional capitalization wherever a technical term is genuinely needed in customer copy, including ESP32, OLED, LCD, GPS, GNSS, BLE, Wi-Fi, USB-C, RGB, MIDI, NFC, FPV, JSON, CSV, CAD, AI, and WALL-E.",
    "Write summary as one or two warm, natural customer-facing sentences of 12-45 words. Lead with the everyday use or satisfying outcome, then briefly explain how the selected hardware makes it happen. Do not open with phrases such as 'A compact ESP32-based', 'built around', 'this build uses', or a parts list. Avoid stiff engineering-report language, generic starter-build filler, and ellipses.",
    "Write behavior as one to three complete sentences of 8-70 words describing the supported input, processing, and output. Before returning, rewrite any incomplete title, generic summary, mis-capitalized acronym, or hardware claim not backed by selectedPartIds.",
    "Select only part ids present in the provided catalog.",
    "For speech recording, meeting notes, or transcription, select the exact pre-soldered INMP441 digital I2S microphone catalog row with a Wi-Fi ESP32 controller. Streaming captured audio to an external transcription API is supported architecture; do not reject it merely because transcription runs off-device. Do not claim local AI or already-generated firmware.",
    "Never substitute a KY-037 sound-level or threshold detector for speech capture. It cannot provide the digital PCM audio required for transcription.",
    "Treat the user's words as a strict functional boundary. Select the minimum functional BOM that delivers the requested behavior plus one compatible controller. Do not add a nice-to-have sensor, display, light, sound, camera, control, notification, or secondary behavior merely because it would make the concept more interesting. If the user did not request a functional capability, do not name it in the title, summary, behavior, visibleHardwareCues, or warnings and do not select a part whose only purpose is that capability.",
    "Select only visually verified no-solder rows. Accepted connection forms are factory-soldered male headers, factory-installed female sockets, factory-installed Qwiic/STEMMA QT/JST/terminal connectors with an exact catalog cable path, or complete factory-crimped and housed cables. Never require the beginner to solder, crimp, or assemble a connector.",
    "Every row in the provided catalog has already passed its applicable ready-to-use verification gate; do not claim a matching verified input, cable, or actuator is unavailable when it appears in the catalog.",
    "Select one logical coordinator ESP32 plus every exact functional sensor, input, output, display, or actuator required by the request. Repeat a non-controller catalog id when the user requests multiple physical copies. Do not omit requested peripherals merely because one controller appears to lack GPIO: the deterministic compiler will exhaust legal bus sharing and distinct carrier contacts, then inject additional compatible ESP32-and-carrier nodes and an ESP-NOW transport contract.",
    "Use a verified low-power FS90R continuous-rotation micro servo when the user explicitly requests powered wheels, continuous rotation, or small robot-car movement. Do not substitute an ordinary positional SG90 servo, invent a DC motor or driver, or claim autonomous motion without a selected motion part.",
    "An FS90R must use its factory-attached three-pin servo plug and a separate regulated 4.8-6V servo supply with common ground. The ESP32 provides only the PWM control signal; never power a servo from an ESP32 GPIO or 3.3V pin. If the exact power or mating path is not present in the catalog, state that gap in warnings instead of pretending the wiring is complete.",
    `Exact owner exception ${OWNER_FS90R_S3_GVS_RULE_ID}: the preceding generic FS90R warning does not apply when the selected controller resolves to esp32-s3-devkitc-1-n8r2 or esp32-s3-devkit-n16r8 and the deterministic compiler injects the exact AITRIP 44-pin ESP32-S3 carrier. For that exact hash-bound combination, preserve the owner-verified route: one complete, otherwise-unused carrier GVS row per servo, with black GND, red 3V3 positive supply, and yellow PWM on the same row. Never ask for a separate supply, splitter, servo mate, Dupont cable, or external power-distribution path for this exact exception. Four channels require four rows and twelve unique physical carrier contacts; electrical rail commonality never permits terminal reuse. Keep the manufacturer nominal 4.8-6V rating only as separate evidence, not as a contradictory build instruction.`,
    "Select a verified cable assembly only when its exact connector geometry matches the connection: a 2P female-to-female Dupont cable joins two 2-pin male headers, while a 2P female-to-male cable joins a male header to a compatible two-position female connection. Never describe a 2P cable as a three-pin servo adapter, and never invent loose jumpers or unverified adapters.",
    "Choose a physical product architecture before describing the enclosure. Preserve the requested object's use, scale, posture, and silhouette; do not default to a rounded rectangular electronics box. Exposed mechanisms, desktop instruments, handheld controllers, environmental fixtures, and retro appliances should look materially different from one another.",
    "Closed housings must use concealed, serviceable snap fits only: tapered cantilever clips, locating lugs, a clean split line, and a small rear or underside release notch. Never specify screws, threaded fasteners, heat-set inserts, or visible fastener heads.",
    "Place the controller's USB-C opening on the rear, side-rear, or underside with cable bend clearance. Never place USB-C on the primary front interaction face unless the user's literal use case explicitly requires it.",
    "Use a closed opaque FDM shell for ordinary appliances. For a project where seeing the electronics materially explains the build, a localized smoke, frosted-clear, or tinted translucent PETG service shell is allowed only when it reveals exact selected, dimension-verified parts. Never use a transparent dome, glass cover, or decorative clear bubble.",
    "Every visibleHardwareCue must describe the enclosure itself or an external affordance supported by a selected part. Explicitly describe the fitted opening or affordance for a selected screen, knob, button, camera, speaker, light, or sensor when it needs to be visible, but never invent one that is not backed by a selected catalog part.",
    "Every hardware capability named in the title, summary, behavior, visibleHardwareCues, or warnings must be backed by one of the selected part ids. If a requested capability has no selected part, omit that capability from the prose and render rather than pretending it exists.",
    "Never propose a clear or transparent dome, glass cover, decorative topper, mascot, figurine, sculpture, toy animal, physical pet, or other object the maker would need to source separately.",
    "If the idea mentions a pet, cat, face, character, or companion, treat it as software behavior: show it only as simple pixels on a selected display. If no display is selected, omit the character entirely.",
    "Avoid batteries, mains power, relays, heaters, pumps, unverified DC or stepper motors, high-current motion hardware, level shifters, shift registers, and advanced glue parts. The only currently supported powered-motion exception is an exact verified low-power continuous-rotation micro-servo catalog row.",
    "Do not select ordinary HC-SR04 ultrasonic modules. The current catalog has no verified 3.3V-safe HC-SR04P direct-Echo listing, so use ToF/radar alternatives or add a warning.",
    "Do not claim HC-SR04 Echo can connect directly to ESP32 unless the exact selected catalog row is a verified 3.3V-safe HC-SR04P listing.",
    "Keep the controller and logic physically plausible for low-power ESP32 GPIO and USB-C operation. Treat a selected FS90R as a separately powered actuator with common ground, never as a GPIO-powered load.",
  ].join("\n");
}

function buildPlanSchema(requireIdentityEcho = false) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string", minLength: 8, maxLength: 80 },
      summary: { type: "string", minLength: 40, maxLength: 320 },
      behavior: { type: "string", minLength: 30, maxLength: 420 },
      selectedPartIds: {
        type: "array",
        minItems: 1,
        maxItems: 32,
        items: { type: "string" },
      },
      visibleHardwareCues: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: { type: "string" },
      },
      warnings: {
        type: "array",
        maxItems: 6,
        items: { type: "string" },
      },
      ...(requireIdentityEcho ? {
        buildId: { type: "string" },
        requestFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
      } : {}),
    },
    required: [
      "title", "summary", "behavior", "selectedPartIds", "visibleHardwareCues", "warnings",
      ...(requireIdentityEcho ? ["buildId", "requestFingerprint"] : []),
    ],
  };
}

function buildBriefClarificationSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["ready", "needs_clarification"] },
      reason: { type: "string", minLength: 1, maxLength: 240 },
      question: { type: "string", maxLength: 180 },
      options: {
        type: "array",
        minItems: 0,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", minLength: 1, maxLength: 48 },
            label: { type: "string", minLength: 2, maxLength: 52 },
            description: { type: "string", minLength: 12, maxLength: 180 },
            refinedIdea: { type: "string", minLength: 20, maxLength: 500 },
          },
          required: ["id", "label", "description", "refinedIdea"],
        },
      },
    },
    required: ["status", "reason", "question", "options"],
  };
}

function normalizeBuildClarification(value, idea) {
  if (value?.status === "ready") {
    return fallbackBuildClarification(idea);
  }
  const options = Array.isArray(value?.options) ? value.options.slice(0, 3).map((option, index) => ({
    id: sanitizeIdentifier(option?.id) || `direction-${index + 1}`,
    label: sanitizeShortText(option?.label, 52),
    description: sanitizeShortText(option?.description, 180),
    refinedIdea: sanitizeIdea(option?.refinedIdea),
  })).filter((option) => option.label
    && option.description
    && option.refinedIdea
    && !buildIdeaNeedsClarification(option.refinedIdea)
    && clarificationDirectionMatchesIdea(idea, option.refinedIdea)) : [];
  if (options.length !== 3) return fallbackBuildClarification(idea);
  return {
    status: "needs_clarification",
    reason: sanitizeShortText(value?.reason, 240) || "The theme could become several different builds.",
    question: sanitizeShortText(value?.question, 180) || "What kind of build did you have in mind?",
    options,
  };
}

function fallbackBuildClarification(idea) {
  if (unspecifiedSensorIntent(idea)) {
    return {
      status: "needs_clarification",
      reason: "Choose what the sensors should measure before we select the parts.",
      question: "What should it sense?",
      options: [
        ["room-conditions", "Temperature and humidity", "See how warm and humid the room is.", "Measure room temperature and humidity and show both on a small display."],
        ["nearby-motion", "Nearby movement", "Show when someone approaches.", "Detect nearby motion and show its status on a small display."],
        ["room-light", "Room brightness", "See how bright the room is.", "Measure ambient light and show the brightness on a small display."],
      ].map(([id, label, description, direction]) => ({id,label,description,refinedIdea:`${idea}. Chosen direction: ${direction}`})),
    };
  }
  if (remoteMessagingIntent(idea)) {
    const missingTrigger = !remoteMessagingTriggerIsConcrete(idea);
    const missingChannel = !remoteMessagingChannelIsConcrete(idea);
    return {
      status: "needs_clarification",
      reason: missingTrigger && missingChannel
        ? "The phone message needs a clear trigger and delivery method before the hardware can be selected."
        : missingTrigger
          ? "The delivery method is clear, but the build still needs a physical trigger."
          : "The trigger is clear, but the phone-message delivery method is still ambiguous.",
      question: missingTrigger && missingChannel
        ? "What should trigger the message, and how should it reach the phone?"
        : missingTrigger
          ? "What should trigger the phone message?"
          : "How should the message reach the phone?",
      options: [
        {
          id: "touch-check-in",
          label: "Touch check-in",
          description: "Touch a desk button to send a preset push notification over Wi-Fi.",
          refinedIdea: "Build a compact Wi-Fi check-in button with a capacitive touch sensor that sends a preconfigured push notification to my partner's phone when touched.",
        },
        {
          id: "arrival-notification",
          label: "Arrival notification",
          description: "Detect someone approaching and send a preset phone notification.",
          refinedIdea: "Build a Wi-Fi arrival notifier with a human-presence sensor that sends a preconfigured push notification to my partner's phone when someone approaches.",
        },
        {
          id: "door-notification",
          label: "Door notification",
          description: "Detect a door opening and send a preset phone notification over Wi-Fi.",
          refinedIdea: "Build a Wi-Fi door-opening notifier with a magnetic door sensor that sends a preconfigured push notification to my partner's phone when the door opens.",
        },
      ],
    };
  }
  if (/\b(?:task|tasks|to-do|todo|checklist|agenda)\b/i.test(idea)) {
    return {
      status: "needs_clarification",
      reason: "A desk task buddy can use several different controls, so Makeable needs to know how you want to use it.",
      question: "How would you like to view and check off your tasks?",
      options: [
        {
          id: "touch-task-list",
          label: "Touch task list",
          description: "Read tasks on a small touchscreen and tap to move through them.",
          refinedIdea: "Build a tabletop task-list buddy with a color touchscreen that shows everyday tasks and lets me tap to move through the list.",
        },
        {
          id: "dial-task-list",
          label: "Dial task list",
          description: "Turn a dial to browse tasks and press it to mark the current one done.",
          refinedIdea: "Build a tabletop task-list display with a small screen and a rotary control for browsing everyday tasks and marking the current task complete.",
        },
        {
          id: "button-checklist",
          label: "Button checklist",
          description: "Use simple buttons to step through a short daily checklist on a display.",
          refinedIdea: "Build a tabletop daily-checklist display with a small screen and buttons for moving between tasks and marking each task complete.",
        },
      ],
    };
  }
  if (/\b(?:crypto|stocks?|portfolio)\b/i.test(idea)) {
    return {
      status: "needs_clarification",
      reason: "A market tracker needs a clear display style and interaction before Makeable chooses the hardware.",
      question: "What should your market tracker show at a glance?",
      options: [
        {
          id: "price-screen",
          label: "Live price screen",
          description: "Show a small watchlist with the latest prices on a color display.",
          refinedIdea: "Build a Wi-Fi desktop market display with a color screen that shows the latest prices for a short crypto and stock watchlist.",
        },
        {
          id: "portfolio-dial",
          label: "Portfolio dial",
          description: "Turn a dial to move between assets and see one clear price at a time.",
          refinedIdea: "Build a Wi-Fi desktop portfolio display with a small screen and rotary control for browsing crypto and stock prices one asset at a time.",
        },
        {
          id: "price-move-light",
          label: "Price move light",
          description: "Use a display and colored status light to make major daily moves easy to notice.",
          refinedIdea: "Build a Wi-Fi desktop price monitor with a small display and RGB status light that indicates whether a selected crypto or stock moved up or down today.",
        },
      ],
    };
  }
  const christmas = /\bchristmas|holiday|festive\b/i.test(idea);
  const halloween = /\bhalloween|spooky\b/i.test(idea);
  const seasonal = halloween ? [
    ["pumpkin-light", "Pumpkin mood light", "A pumpkin-shaped light with an animated orange glow.", "Build a pumpkin-shaped Halloween mood light with an RGB glow and a button that changes the lighting pattern."],
    ["spooky-display", "Spooky motion display", "A small screen that wakes up with a spooky animation when someone approaches.", "Build a Halloween desk display that detects nearby motion and shows a spooky animated face on a color screen."],
    ["door-chime", "Halloween door chime", "A door-side button that triggers a playful spooky sound and light.", "Build a Halloween door chime with a push button, a spooky sound output, and a flashing status light."],
  ] : christmas ? [
    ["tree-light", "Mini tree light", "A tabletop tree-shaped light with selectable festive colors.", "Build a tabletop Christmas tree light with RGB color patterns selected by a push button."],
    ["countdown-display", "Christmas countdown", "A small screen that shows the days remaining until Christmas.", "Build a Christmas countdown display with a color screen that shows the days remaining and a festive status light."],
    ["gift-reminder", "Gift reminder", "A desk reminder that lights up and displays a short gift-list status.", "Build a Christmas gift reminder with a small display, a button to cycle items, and a colored completion light."],
  ] : [
    ["status-light", "Desk status light", "A compact light whose color changes with a button press.", "Build a compact desk status light with an RGB output and a button that cycles through three clearly labeled states."],
    ["environment-display", "Room conditions display", "A small screen that shows temperature and humidity.", "Build a tabletop room monitor that measures temperature and humidity and shows both readings on a color display."],
    ["motion-greeting", "Motion greeting", "A small display that reacts when someone approaches.", "Build a small greeting display that detects nearby motion and shows a friendly animation on a color screen."],
  ];
  return {
    status: "needs_clarification",
    reason: "The request names a theme but not yet the physical object or behavior.",
    question: `What would you like ${halloween ? "your Halloween" : christmas ? "your Christmas" : "this"} build to do?`,
    options: seasonal.map(([id, label, description, refinedIdea]) => ({ id, label, description, refinedIdea })),
  };
}

const REMOTE_MESSAGE_INTENT = /(?:\b(?:send|deliver|receive|message|notify|notification|alert)\b.{0,120}\b(?:phone|mobile|partner|someone|person|family|friend)\b|\b(?:phone|mobile|partner|someone|person|family|friend)\b.{0,120}\b(?:message|notification|alert|text)\b)/i;
const REMOTE_MESSAGE_TRIGGER = /\b(?:when|whenever|if|after|upon|button|touch|sensor|detect|motion|presence|door|window|timer|schedule|scheduled|alarm|approaches|opens|closes|pressed|touched)\b/i;
const REMOTE_MESSAGE_CHANNEL = /\b(?:sms|text message|push notification|phone notification|mobile notification|whatsapp|telegram|signal|email|webhook|mobile app|phone app|wi-fi|wifi|bluetooth)\b/i;

function remoteMessagingIntent(value) {
  return REMOTE_MESSAGE_INTENT.test(String(value || ""));
}

function remoteMessagingTriggerIsConcrete(value) {
  return REMOTE_MESSAGE_TRIGGER.test(String(value || ""));
}

function remoteMessagingChannelIsConcrete(value) {
  return REMOTE_MESSAGE_CHANNEL.test(String(value || ""));
}

function remoteMessagingNeedsClarification(value) {
  return remoteMessagingIntent(value)
    && (!remoteMessagingTriggerIsConcrete(value) || !remoteMessagingChannelIsConcrete(value));
}

function clarificationDirectionMatchesIdea(originalIdea, refinedIdea) {
  if (unspecifiedSensorIntent(originalIdea)) {
    return !unspecifiedSensorIntent(refinedIdea)
      && requestedCapabilitiesForIdea(refinedIdea).includes("generic_sensing");
  }
  return !remoteMessagingIntent(originalIdea) || remoteMessagingIntent(refinedIdea);
}

function unspecifiedSensorIntent(idea) {
  const capabilities = requestedCapabilitiesForIdea(idea);
  return /\bsensors?\b/i.test(idea)
    && capabilities.includes("generic_sensing")
    && capabilities.every((capability) => ["generic_sensing", "display"].includes(capability));
}

function sanitizeShortText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeIdentifier(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function plannerCatalog() {
  return catalog
    .filter((part) => part.modelSelectable)
    .map((part) => ({
      id: part.id,
      name: part.name,
      category: part.category,
      subtype: part.subtype,
      price: part.price,
      voltage: part.voltage,
      notes: part.notes,
      why: part.why,
      connectionType: part.connectionType,
      assemblyAssetIds: part.assemblyAssets.filter((asset) => asset.ready).map((asset) => asset.partId),
    }));
}

function resolveSelectedParts(ids, idea) {
  const seen = new Set();
  const requested = Array.isArray(ids) ? ids : [];
  const parts = [];
  let controllerSelected = false;
  for (const id of requested) {
    const part = catalogById.get(String(id));
    if (!part || seen.has(part.id) || !part.modelSelectable) continue;
    if (isControllerPart(part)) {
      if (controllerSelected) continue;
      controllerSelected = true;
    }
    if (parts.some((selectedPart) => sameFunctionalRole(selectedPart, part))) continue;
    seen.add(part.id);
    parts.push(publicPart(part));
  }

  if (!parts.some(isControllerPart)) {
    const controller = fallbackController(idea);
    if (controller && !seen.has(controller.id)) {
      parts.unshift(publicPart(controller));
      seen.add(controller.id);
      controllerSelected = true;
    }
  }

  // Deterministically fill obvious intent-critical roles (for example, a
  // rotary encoder for a knob request) even when the model returns a plan that
  // is technically valid but incomplete. This also makes the no-key preview
  // path and live model path obey the same physical requirements.
  for (const part of fallbackPartsForIdea(idea)) {
    if (seen.has(part.id)) continue;
    if (isControllerPart(part) && controllerSelected) continue;
    if (part.category === "display" && parts.some(hasBuiltInOrStandaloneDisplay)) continue;
    if (parts.some((selectedPart) => sameFunctionalRole(selectedPart, part))) continue;
    parts.push(publicPart(part));
    seen.add(part.id);
    if (isControllerPart(part)) controllerSelected = true;
    if (parts.length >= 6) break;
  }

  return parts.slice(0, 32);
}

function resolveExactSelectedParts(ids) {
  const seen = new Set();
  const repeatCounts = new Map();
  const repeatLimits = new Map([
    // One catalog row is a physical two-servo/two-wheel kit. Repeating the
    // exact ID represents buying/placing a second identical kit, not an alias.
    ["b086zgtlzb-79", 2],
    ["7427505d74-80", 4],
  ]);
  const parts = [];
  let controllerSelected = false;
  for (const id of Array.isArray(ids) ? ids : []) {
    const part = catalogById.get(String(id));
    const repeatLimit = repeatLimits.get(part?.id)
      || (part && !isControllerPart(part) ? 20 : 1);
    const repeatCount = repeatCounts.get(part?.id) || 0;
    if (!part || repeatCount >= repeatLimit || !part.modelSelectable) continue;
    if (isControllerPart(part)) {
      if (controllerSelected) continue;
      controllerSelected = true;
    }
    seen.add(part.id);
    repeatCounts.set(part.id, repeatCount + 1);
    parts.push(publicPart(part));
  }
  return parts.slice(0, 32);
}

function hasBuiltInOrStandaloneDisplay(part) {
  return part?.category === "display"
    || /\b(?:display|screen|oled|lcd)\b/i.test(`${part?.name || ""} ${part?.subtype || ""}`);
}

function sameFunctionalRole(left, right) {
  if (left.category === "controller" && right.category === "controller") return true;
  if (left.category === "display" && right.category === "display") return true;

  const leftRole = partFunctionalRole(left);
  return Boolean(leftRole && leftRole === partFunctionalRole(right));
}

function partFunctionalRole(part) {
  const text = `${part.category || ""} ${part.subtype || ""} ${part.name || ""}`.toLowerCase();
  if (/rotary|encoder|\bknob\b/.test(text)) return "rotary-input";
  if (/touch|capacitive button/.test(text)) return "touch-input";
  if (/bme280|temperature.*humidity|environment/.test(text)) return "environment-sensor";
  if (/bh1750|ambient light|lux/.test(text)) return "ambient-light-sensor";
  if (/reed|magnetic switch/.test(text)) return "contact-sensor";
  if (/buzzer|piezo/.test(text)) return "buzzer-output";
  if (/rain|water level|leak|liquid/.test(text)) return "water-sensor";
  if (/rgb.*led|led.*rgb/.test(text)) return "status-light-output";
  if (/ld2410|presence|radar/.test(text)) return "presence-sensor";
  if (/vl53|time.of.flight|\btof\b|distance/.test(text)) return "distance-sensor";
  if (/microphone|sound sensor/.test(text)) return "sound-input";
  if (/camera|imaging|vision/.test(text)) return "camera";
  if (/fs90r|continuous.rotation.*servo|servo.*continuous.rotation/.test(text)) return "continuous-motion-actuator";
  if (/dupont.*female.to.female|female.to.female.*dupont/.test(text)) return "two-pin-ff-cable";
  if (/dupont.*female.to.male|female.to.male.*dupont/.test(text)) return "two-pin-fm-cable";
  return "";
}

function pruneRedundantPresenceSensors(parts, idea, plan) {
  const proximityParts = parts.filter((part) => ["presence-sensor", "distance-sensor"].includes(partFunctionalRole(part)));
  if (proximityParts.length < 2) return parts;

  const ideaText = idea.toLowerCase();
  const asksForDistanceHardware = /\b(?:tof|time[- ]of[- ]flight|distance sensor|range sensor|proximity sensor|ultrasonic)\b/.test(ideaText);
  const asksForPresenceHardware = /\b(?:radar|mmwave|ld2410)\b/.test(ideaText);
  if (asksForDistanceHardware && asksForPresenceHardware) return parts;

  const planText = `${plan?.summary || ""} ${plan?.behavior || ""}`.toLowerCase();
  const describesDistanceHardware = /\b(?:tof|time[- ]of[- ]flight|distance sensor|range sensor|proximity sensor|ultrasonic)\b/.test(planText);
  const describesPresenceHardware = /\b(?:radar|mmwave|ld2410)\b/.test(planText);
  if (describesDistanceHardware === describesPresenceHardware) return parts;

  const keepRole = describesDistanceHardware ? "distance-sensor" : "presence-sensor";
  let kept = false;
  return parts.filter((part) => {
    const role = partFunctionalRole(part);
    if (!["presence-sensor", "distance-sensor"].includes(role)) return true;
    if (role !== keepRole || kept) return false;
    kept = true;
    return true;
  });
}

function pruneUnrequestedControls(parts, idea, plan) {
  const intentText = `${idea} ${plan?.summary || ""} ${plan?.behavior || ""}`.toLowerCase();
  return parts.filter((part) => {
    const role = partFunctionalRole(part);
    if (role === "touch-input") return /\b(?:touch|tap|press|button|capacitive)\b/.test(intentText);
    if (role === "rotary-input") return /\b(?:knob|dial|rotary|encoder)\b/.test(intentText);
    return true;
  });
}

function normalizePlan(plan, idea, parts) {
  const fallback = fallbackPlan(idea, "normalization_fallback");
  const title = readableTitle(plan?.title || fallback.title, idea);
  const selectedCategories = new Set(parts.map((part) => part.category));
  const selectedText = parts.map((part) => `${part.name} ${part.subtype || ""}`).join(" ").toLowerCase();
  const ownerFs90rS3GvsRuleActive = hasOwnerFs90rS3GvsRule(parts);
  const planWarnings = (Array.isArray(plan?.warnings) ? plan.warnings : []).filter((warning) => {
    const text = clean(warning).toLowerCase();
    if (ownerFs90rS3GvsRuleActive && isLegacyFs90rPowerWarning(text)) return false;
    if (/not selected/.test(text) && /dupont|jumper|cable/.test(text) && /dupont|jumper|cable/.test(selectedText)) {
      return false;
    }
    if (/no catalog item|could not be selected|not available/.test(text)) {
      if (/(button|knob|control|input|encoder)/.test(text) && selectedCategories.has("input")) return false;
      if (/(display|screen|oled|lcd)/.test(text) && selectedCategories.has("display")) return false;
      if (/(sensor|sensing)/.test(text) && selectedCategories.has("sensor")) return false;
    }
    return true;
  });
  const warnings = new Set([
    ...planWarnings,
    ...safetyWarnings(idea, parts),
  ]);

  return {
    title,
    summary: reconcileControllerModelClaims(cleanSentence(plan?.summary) || fallback.summary, parts),
    behavior: reconcileControllerModelClaims(cleanSentence(plan?.behavior) || fallback.behavior, parts),
    visibleHardwareCues: enclosureHardwareCues(plan?.visibleHardwareCues, parts, idea),
    warnings: [...warnings].map((warning) => cleanSentence(warning)).filter(Boolean).slice(0, 8),
    model: plan?.model || fallback.model,
  };
}

export function reconcileControllerModelClaims(value, parts = []) {
  const text = String(value || "");
  const controllerAssets = parts
    .filter((part) => part?.category === "controller")
    .flatMap((part) => (part.assemblyAssets || []).map((asset) => asset.partId));
  const xiaoController = controllerAssets.find((assetId) => /^seeed-xiao-esp32(?:c3|c5|c6|s3)$/.test(assetId));
  if (!xiaoController) return text;
  const model = xiaoController.replace("seeed-xiao-esp32", "").toUpperCase();
  const canonical = `Seeed Studio XIAO ESP32${model}`;
  return text.replace(/\b(?:Seeed Studio\s+)?XIAO\s+ESP32[- ]?(?:C3|C5|C6|S3)\b/gi, canonical);
}

function plannerBlockedReason(plan) {
  if (!plan || typeof plan !== "object") return null;
  const title = clean(String(plan.title || "")).toLowerCase();
  if (title.startsWith("blocked")) return "planner_title_blocked";
  if (String(plan.status || plan.state || "").toLowerCase() === "blocked") return "planner_state_blocked";
  const warnings = Array.isArray(plan.warnings) ? plan.warnings : [];
  const blockedWarning = warnings.find((warning) => /^blocked(?:[_\s:-]|$)/i.test(String(warning || "")));
  return blockedWarning ? `planner_warning_blocked:${clean(String(blockedWarning)).slice(0, 120)}` : null;
}

function enclosureHardwareCues(value, parts, idea = "") {
  const selectedText = parts.map((part) => `${part.category || ""} ${part.subtype || ""} ${part.name || ""} ${part.voltage || ""}`).join(" ").toLowerCase();
  const hasDisplay = parts.some((part) => part.category === "display") || /\boled\b|\blcd\b|display|screen/.test(selectedText);
  const hasInput = parts.some((part) => part.category === "input") || /button|touch|rotary|encoder|knob/.test(selectedText);
  const hasOutput = parts.some((part) => part.category === "output") || /\bled\b|buzzer|speaker/.test(selectedText);
  const hasSensor = parts.some((part) => part.category === "sensor");
  const hasCamera = /camera|imaging|vision/.test(selectedText);
  const hasUsbC = /usb-c|usb c|type-c|type c/.test(selectedText);
  const hasRotary = /rotary|encoder|knob|dial/.test(selectedText);
  const hasTouch = /touch|capacitive/.test(selectedText);
  const hasAudio = /buzzer|speaker|piezo/.test(selectedText);
  const hasVisualOutput = /\bled\b|rgb/.test(selectedText);
  const hasMotion = /fs90r|continuous.rotation.*servo|servo.*continuous.rotation/.test(selectedText);
  const hasWheelIntent = /\bcar\b|rover|wheeled|wheel|vacuum|floor robot|trash sort/.test(String(idea).toLowerCase());
  const hasPositionalServo = /positional.*servo|servo.*(?:90|180|270)[- ]?degree/.test(selectedText)
    && !/continuous.rotation/.test(selectedText);
  const allowed = [];

  for (const rawCue of cleanStringArray(value, [])) {
    const cue = cleanSentence(rawCue, 180);
    const text = cue.toLowerCase();
    const describesCharacter = /pet|cat|dog|animal|character|creature|mascot/.test(text)
      || (/\bface\b/.test(text) && /cute|pixel|smil|expression/.test(text));
    if (describesCharacter) {
      if (hasDisplay) allowed.push("simple pixel companion shown only on the selected display screen");
      continue;
    }
    if (/clear dome|dome|glass|cloche|bubble|acrylic|figurine|sculpture|decorative topper|floating|separate prop/.test(text)) continue;
    if (/display|screen|oled|lcd/.test(text) && !hasDisplay) continue;
    if (/button|touch|knob|dial|rotary|encoder/.test(text) && !hasInput) continue;
    if (/light|led|indicator|buzzer|speaker/.test(text) && !hasOutput) continue;
    if (/sensor|probe|vent|aperture/.test(text) && !hasSensor && !hasCamera) continue;
    if (/camera|lens/.test(text) && !hasCamera) continue;
    if (/powered wheel|drive wheel|wheel opening|axle/.test(text) && (!hasMotion || !hasWheelIntent)) continue;
    if (/motor|servo/.test(text) && !hasMotion) continue;
    if (/usb|power.*cutout|programming.*cutout|connector.*cutout/.test(text)) continue;
    if (/screw|threaded|heat[- ]set|fastener head/.test(text)) continue;
    allowed.push(cue);
  }

  const inferred = [];
  if (hasDisplay) inferred.push("flush display opening sized to the selected screen module");
  if (hasRotary) inferred.push("single clean shaft opening sized to the selected rotary control");
  else if (hasTouch) inferred.push("flat marked touch area supported by the selected capacitive input");
  else if (hasInput) inferred.push("clean panel feature sized to the selected input control");
  if (hasSensor || hasCamera) inferred.push("unblocked sensor aperture aligned with the selected module");
  if (hasAudio) inferred.push("small printable sound grille aligned with the selected audio output");
  if (hasVisualOutput && !hasDisplay) inferred.push("small indicator opening aligned with the selected light output");
  if (hasMotion && hasWheelIntent) inferred.push("paired wheel clearances and axle openings aligned with the selected continuous-rotation servos");
  else if (hasMotion) inferred.push("single continuous-servo output clearance aligned to the requested rotating linkage; omit the listing's optional wheels");

  return [...new Set([
    "project-specific FDM body shaped by the requested object's real use and silhouette",
    "clean two-part shell seam with concealed tapered snap clips and locating lugs; zero screws",
    hasUsbC ? "recessed USB-C opening on the rear, side-rear, or underside with cable bend room" : "rear or underside power and programming access matched to the selected controller",
    ...allowed,
    ...inferred,
  ])].slice(0, 8);
}

function fallbackPlan(idea, model, buildIdentity = null) {
  const title = readableTitle("", idea);
  const parts = fallbackPartsForIdea(idea).map((part) => part.id);
  return {
    title,
    summary: `A compact Makeable build for ${idea.toLowerCase()}.`,
    behavior: "Uses an ESP32 controller with simple sensors or outputs from the verified pre-soldered catalog.",
    selectedPartIds: parts,
    visibleHardwareCues: [
      "project-specific FDM body shaped by the requested object's real use and silhouette",
      "concealed serviceable snap-fit seam with locating lugs and zero screws",
      "recessed rear or side-rear USB-C power opening",
    ],
    warnings: safetyWarnings(idea, parts.map(publicPart)),
    model,
    ...(buildIdentity ? {
      buildId: buildIdentity.buildId,
      requestFingerprint: buildIdentity.requestFingerprint,
    } : {}),
  };
}

function fallbackPartsForIdea(idea) {
  const text = idea.toLowerCase();
  const picks = [fallbackController(idea)];
  const add = (...needles) => {
    for (const needle of needles) {
      const part = findPart(needle);
      if (part && !picks.includes(part)) picks.push(part);
    }
  };

  if (/(plant|soil|humidity|weather|air (?:quality|monitor|sensor)|temperature|temp|climate)/.test(text)) {
    add("BME280");
  }
  if (/(door|mailbox|cabinet|drawer)/.test(text)) add("Reed switch");
  if (/(water|bowl|leak|rain|liquid)/.test(text)) add("Rain Water Level");
  if (/\b(?:motion|presence|walk|person|occupancy)\b/.test(text)) add("LD2410C");
  if (/(distance|range|near|far|ultrasonic|hc-sr04|hcsr04)/.test(text)) add("VL53L1X", "0.91-inch I2C OLED");
  if (/(sound|noise|voice|microphone|clap)/.test(text)) add("Sound Sensor", "0.91-inch I2C OLED");
  if (/(camera|photo|vision|image)/.test(text)) add("Camera Development Board");
  if (/\b(?:button|touch|press|control)\b/.test(text)) add("Touch Sensor");
  if (/(knob|dial|rotary|encoder)/.test(text)) add("Rotary Encoder");
  if (/(pet|companion|character|face)/.test(text)) add("0.91-inch I2C OLED");
  if (/(display|screen|status|dashboard|clock)/.test(text)) add("0.91-inch I2C OLED");
  if (/(ambient light|light sensor|lux|brightness)/.test(text)) add("BH1750");
  if (/\b(?:lamp|led|glow)\b/.test(text)) add("DIYables RGB LED Module");
  if (/(continuous[- ]rotation|powered wheels?|robot car|toy car|drive wheels?|motorized|\bfs90r\b)/.test(text)) {
    add("FS90R 360-degree continuous-rotation micro servos with wheels");
  }
  if (/(dupont|jumper (?:wire|cable)|female[- ]to[- ]female cable)/.test(text)) {
    add("ZYAMY 10PCS 2P 2.54mm Female-to-Female Dupont Cable");
  }

  if (picks.length < 2) add("0.91-inch I2C OLED");
  return picks.filter(Boolean).slice(0, 6);
}

function fallbackController(idea) {
  const text = idea.toLowerCase();
  if (/(camera|photo|vision|image)/.test(text)) return findPart("ESP32-S3 WROOM N16R8 Camera");
  return findPart("Seeed Studio XIAO ESP32C3") || findPart("Seeed Studio XIAO ESP32S3");
}

function findPart(nameNeedle) {
  const needle = nameNeedle.toLowerCase();
  return catalog.find((part) => (
    part.modelSelectable
    && `${part.name} ${part.listingTitle} ${part.subtype}`.toLowerCase().includes(needle)
  ));
}

function safetyWarnings(idea, parts) {
  const warnings = [];
  const text = idea.toLowerCase();
  const partText = parts.map((part) => `${part.id || ""} ${part.name || ""} ${part.subtype || ""}`).join(" ").toLowerCase();
  const hasExactC3CarrierServoException = (
    /aoicrie/.test(partText)
    && /esp32[- ]?c3/.test(partText)
    && /aitrip/.test(partText)
    && /supermini expansion board|esp32_c3_supermini_expansion_board/.test(partText)
    && /fs90r/.test(partText)
  );
  const hasOwnerFs90rS3GvsException = hasOwnerFs90rS3GvsRule(parts);
  if (/(hc-sr04|hcsr04|ultrasonic)/.test(text)) {
    warnings.push(
      "The current verified catalog does not include a 3.3V-safe HC-SR04P listing, so this build avoids direct HC-SR04 Echo-to-ESP32 wiring.",
    );
  }
  if (hasOwnerFs90rS3GvsException) {
    warnings.push(`Use ${OWNER_FS90R_S3_GVS_RULE_ID}: allocate one complete unused carrier GVS row per FS90R channel—black GND, red 3V3 positive supply, and yellow PWM—with no physical endpoint reuse.`);
    warnings.push("The manufacturer nominal 4.8–6 V rating remains in the evidence record, but this exact owner-bench build instruction preserves the verified 3V3 GVS-row route and adds no separate servo supply, splitter, or mating accessory.");
  } else if (hasExactC3CarrierServoException) {
    warnings.push("The exact AOICRIE ESP32-C3 Super Mini plus AITRIP B0FBGFWFB1 carrier plus FS90R exception uses the carrier VCC1 5V servo rows only: brown GND, red VCC1 5V, orange PWM. Battery and external carrier power stay disconnected; this exception does not transfer to any other controller, carrier, or motor.");
    warnings.push("Keep both FS90R factory three-pin plugs intact and seat them only on the verified GPIO4 and GPIO3 carrier rows. Never power a servo from GPIO or VCC3 3.3V.");
  } else if (parts.some((part) => /fs90r|continuous.rotation.*servo|servo.*continuous.rotation/i.test(`${part.name} ${part.subtype || ""}`))) {
    warnings.push("Power each FS90R from a separate regulated 4.8-6V servo supply with common ground; the ESP32 supplies PWM signal only and must not power the servo from GPIO or its 3.3V pin.");
    warnings.push("The selected FS90R has a factory-attached three-pin servo plug. Do not treat a two-pin Dupont cable as its mating adapter; confirm the exact power-distribution and three-pin mating path before assembly.");
  } else if (parts.some((part) => /motor|mosfet|12v|24v|36v|high voltage/i.test(`${part.name} ${part.notes || ""}`))) {
    warnings.push("Confirm the load current and driver limits before powering anything beyond small indicator modules.");
  }
  warnings.push("All suggested parts are from visually verified no-solder catalog rows: factory male headers, female or Qwiic/STEMMA sockets with a verified cable path, or factory-crimped housed leads. Stock and pricing can change.");
  return warnings;
}

function hasOwnerFs90rS3GvsRule(parts) {
  const hasServo = parts.some((part) => /fs90r|continuous.rotation.*servo|servo.*continuous.rotation/i.test(
    `${part.id || ""} ${part.name || ""} ${part.subtype || ""}`,
  ));
  const hasAllowedController = parts.some((part) => (part.assemblyAssets || []).some(
    (asset) => OWNER_FS90R_S3_CONTROLLER_ASSET_IDS.has(String(asset.partId || "")),
  ));
  return hasServo && hasAllowedController;
}

function isLegacyFs90rPowerWarning(value) {
  const text = String(value || "").toLowerCase();
  return /separate regulated\s*4\.8\s*[-–]\s*6\s*v.*servo supply/.test(text)
    || /must not power.*(?:3\.3v|3\.3\s*v)/.test(text)
    || /three-pin servo plug.*(?:mating|adapter|power-distribution)/.test(text)
    || /confirm.*(?:servo mating|power-distribution).*path/.test(text);
}

function calculateCost(parts) {
  const priced = parts.filter((part) => part.priceSource === "listing");
  const knownSubtotal = priced.reduce((sum, part) => sum + (part.unitPriceUsd * Math.max(1, Number(part.quantity || 1))), 0);
  const estimatedTotal = parts.reduce((sum, part) => sum + (part.unitPriceUsd * Math.max(1, Number(part.quantity || 1))), 0);
  const planningEstimates = parts
    .filter((part) => part.priceSource !== "listing")
    .reduce((sum, part) => sum + Math.max(1, Number(part.quantity || 1)), 0);
  const totalParts = parts.reduce((sum, part) => sum + Math.max(1, Number(part.quantity || 1)), 0);
  return {
    estimatedTotalUsd: Number(estimatedTotal.toFixed(2)),
    knownSubtotalUsd: Number(knownSubtotal.toFixed(2)),
    pricedParts: priced.reduce((sum, part) => sum + Math.max(1, Number(part.quantity || 1)), 0),
    totalParts,
    totalLineItems: parts.length,
    estimateLabel: `$${estimatedTotal.toFixed(2)} estimated parts total`,
    note: planningEstimates
      ? `${planningEstimates} item price${planningEstimates === 1 ? " is" : "s are"} a clearly marked planning estimate. Confirm live listing prices; shipping and tax are not included.`
      : "All item prices came from the verified catalog snapshot. Confirm live listing prices; shipping and tax are not included.",
  };
}

export function createBuildImagePrompt(build = {}) {
  const idea = sanitizeIdea(build.idea || build.title || "beginner electronics project");
  const parts = Array.isArray(build.parts) ? build.parts : [];
  const plan = {
    title: clean(build.title || readableTitle("", idea)),
    summary: cleanSentence(build.summary || ""),
    behavior: cleanSentence(build.behavior || build.summary || "A beginner-buildable electronics project."),
    visibleHardwareCues: enclosureHardwareCues(build.visibleHardwareCues, parts, idea),
    warnings: cleanStringArray(build.warnings, []),
  };
  const geometry = geometrySummaryForBuild({
    idea,
    parts,
    plan,
    requestedAffordances: plan.visibleHardwareCues,
  });
  return {
    prompt: makeImagePrompt(
      plan,
      parts,
      idea,
      [geometry.promptBlock, assemblyHeroPromptBlock(build.artifacts)].filter(Boolean).join("\n\n"),
    ),
    geometryContract: geometry.contract,
    designBrief: renderDesignBrief(idea, plan, parts),
  };
}

function makeImagePrompt(plan, parts, idea, geometryPromptBlock = "") {
  const partsSummary = parts.map((part) => (
    part.voltage ? `${part.name} (${part.voltage})` : part.name
  )).join("; ");
  const cues = plan.visibleHardwareCues.join(", ");
  const limitations = (plan.warnings || []).join("; ") || "No additional limitation was identified.";
  const hasDisplay = parts.some((part) => part.category === "display")
    || parts.some((part) => /oled|lcd|display|screen/i.test(`${part.name} ${part.subtype || ""}`));
  const hasContinuousServo = parts.some((part) => /fs90r|continuous.rotation.*servo|servo.*continuous.rotation/i.test(`${part.name} ${part.subtype || ""}`));
  const hasWheelIntent = /\bcar\b|rover|wheeled|wheel|vacuum|floor robot|trash sort/i.test(`${idea} ${plan.title || ""} ${plan.behavior || ""}`);
  const selectedCables = parts.filter((part) => part.category === "connector" && /cable|jumper|dupont/i.test(`${part.name} ${part.subtype || ""}`));
  const design = renderDesignBrief(idea, plan, parts);
  return [
    "Create one physically credible project-documentation photograph of a beginner-buildable Makeable electronics project. It must look like a real, carefully assembled prototype photographed in a product studio—not an AI concept render.",
    "",
    `User intent: ${idea}. Interpret aesthetic references semantically instead of copying the nearest modern product. Preserve the requested use, environment, posture, and recognizable physical archetype without turning every idea into the same box or illustrating every noun literally.`,
    `Build concept: ${plan.title}.`,
    `Supported behavior: ${plan.behavior}`,
    `Exact selected electronic inventory: ${partsSummary}. No other electronic component may appear.`,
    `Supported exterior cues only: ${cues}.`,
    `Honest limitations and adaptations: ${limitations}. Any unsupported requested feature must become passive, manual, omitted, or visibly simplified; never render it as if unsupported electronics exist.`,
    "",
    geometryPromptBlock,
    "",
    "PROJECT-SPECIFIC DESIGN BRIEF:",
    `- Physical archetype: ${design.archetype}.`,
    `- Form language: ${design.formLanguage}`,
    `- Construction visibility: ${design.visibilityStrategy}`,
    `- Connector placement: ${design.connectorPlacement}`,
    `- Camera and composition: ${design.cameraDirection}`,
    `- Material direction: ${design.materialDirection}`,
    `- Signature silhouette: ${design.signatureSilhouette}`,
    `- Delight moment: ${design.delightMoment}`,
    `- Color story: ${design.colorStory}`,
    design.semanticReferenceRule,
    "",
    "FDM construction contract: Closed housings use one or two printable shell pieces with 2.0-2.4 mm-looking walls, a build-plate-friendly orientation, modest radii, one honest seam, concealed tapered cantilever snap clips, root fillets, locating lugs, about 0.5 mm snap clearance, and a small release notch hidden on the rear or underside. Show zero screws, zero bolts, zero threaded inserts, and zero visible fastener heads anywhere. Exposed mechanisms use printed pins, captured axles, press fits, or snap retainers instead of screws. Avoid deep undercuts and support-heavy geometry.",
    "Exact-parts contract: Every visible control, display, light, lens, grille, sensor opening, connector, and port must correspond to the exact selected inventory. Keep electronics subordinate to the requested object. Hide internal modules behind only the necessary fitted openings. Do not invent a knob, button, screen, camera, speaker, light, sensor, cable, battery, or accessory.",
    "Proportion contract: Drive the body dimensions from the verified component envelope and keepouts. A selected display must remain within its verified active area and serve only its supported function; it must never substitute for the requested object. Leave believable wiring, connector, and service clearance without making the body oversized.",
    "Desirability contract: This must look like a crisp, mature small-batch hardware prototype from a strong industrial-design studio—professional enough to trust, attainable enough to build, and distinctive enough to want immediately. Create warmth through proportion, posture, tactility, one subtle interaction detail, and honest construction. Do not use candy colors, oversized toy features, arbitrary holes, mascot styling, or novelty geometry.",
    "Design-rationale gate: Every curve, opening, recess, shoulder, stand, transparent area, split line, and color break must have one defensible job: grip, viewing angle, motion clearance, airflow, sensor line of sight, stability, mounting, cable routing, assembly, or access to an exact selected part. Delete any form feature that cannot be explained this way. Do not force an arch, ring, waist, or asymmetry merely to avoid a box.",
    "Silhouette test: At 64 pixels the object should communicate its real product category through posture, proportion, interaction layout, or exposed mechanism. A compact rectilinear shell is acceptable when function demands it, but it must not be the same rounded box reused across unrelated projects. Distinction must come from the use case and assembly—not decorative distortion.",
    hasContinuousServo && hasWheelIntent
      ? "Motion contract: Use only the selected FS90R continuous-rotation servos and the exact wheels included with the selected listing. Show exactly two wheels total: one single 60 mm diameter by 8 mm wide tire on the left and one single 60 mm diameter by 8 mm wide tire on the right, both centered on the same transverse axle line. Never show a dual tire, doubled rim, tandem wheel, caster, hidden third wheel, or overlapping extra wheel. Use a narrow project-specific structural spine or cradle rather than a generic box; let the exact FS90R body proportions and believable output-shaft alignment read through purposeful side openings or snap-in printed retainers, but cover every factory screw head with a screw-free clip-on printed side bezel. Do not invent a gearbox, DC motor, motor driver, battery, extra wheel, or hidden power source. The ESP32 provides PWM signal only; servo power comes through a separate regulated 4.8-6V path that is acknowledged by the plan but not replaced by imaginary hardware in the render."
      : hasContinuousServo
        ? "Motion contract: The selected FS90R listing includes optional wheels, but this project is not wheeled. Do not show any wheel, tire, axle, drivetrain, car chassis, or caster. Use only one exact FS90R body and its output shaft for the requested continuous rotating linkage, retained with a screw-free printed clip or captured shaft cover. If the requested linkage cannot be shown without inventing parts, keep the servo internal and show no external mechanism."
      : "Motion contract: No verified motion actuator is selected, so show no powered wheel, motor, servo, drivetrain, or autonomous movement.",
    selectedCables.length
      ? `Cable contract: The selected factory-terminated cable assemblies (${selectedCables.map((part) => part.name).join("; ")}) may be visible only through an intentional translucent service shell or on an exposed mechanism. Preserve their exact pin count and end genders, route them in short tidy bundles with believable bend radii and strain relief, and do not turn a 2P cable into a three-pin servo adapter.`
      : "Cable contract: No cable assembly is selected, so do not show loose jumpers, pigtails, or invented adapters.",
    hasDisplay
      ? "Character rule: If the idea mentions a pet, cat, face, mascot, creature, or companion, show it only as a simple low-resolution pixel graphic inside the selected display. The enclosure may have friendly proportions, but there must be no physical character attached to it or sitting under a cover."
      : "Character rule: No display is selected, so do not show any face, character, pet, cat, mascot, creature, or companion anywhere on or around the product.",
    "",
    "Studio contract: Photograph one complete prototype on a seamless white-to-light-gray cyclorama with a soft high-key backlight, large diffused key, gentle fill, neutral white balance, crisp natural contact shadow, and generous clean negative space. No wooden table, plant, room, workshop clutter, lifestyle scene, dramatic orange/blue grading, or fake showroom pedestal. Follow the project-specific camera direction above; otherwise use a natural 3/4 documentation angle that reveals the primary interaction face and a non-connector side. The USB-C cutout belongs on the unseen rear or underside and must not be visible anywhere in the final hero photograph. The front and camera-facing side must be completely uninterrupted except for exact selected displays, controls, sensors, light paths, vents, or mechanisms; do not draw any black oval or rectangular service-port opening there.",
    "Image-quality contract: High-end prototype photography with sharp clean edges, smooth neutral gradients, subtle honest FDM layer texture at correct scale, physically plausible micro-shadows, accurate material response, and crisp separation between adjacent parts. No grain, muddy detail, waxy plastic, fake words, logos, warped geometry, duplicated parts, impossible seams, synthetic CGI gloss, or over-smoothed concept-art surfaces. It should resemble a real finished prototype photographed for a respected design portfolio.",
    `Materials: ${design.materialDirection} Translucency, when allowed by the design brief, is limited to a localized smoke, frosted-clear, or restrained tinted PETG service shell that reveals only exact selected dimension-verified parts; never a dome or decorative bubble. If the exact board count, board geometry, or cable conductor count cannot be preserved, fail closed to an opaque service shell instead of inventing internals.`,
    "UI rule: If a selected display is present, show only abstract pixels, a tiny generic status icon, or a simple pixel face. Never show readable words, brand names, logos, a real app screen, or a physical object protruding from the display.",
    hasContinuousServo
      ? "Power rule: Power and program the ESP32 through USB-C, but treat the selected FS90R servos as a separate regulated 4.8-6V load with common ground. Do not show the ESP32 powering a servo, and do not invent a battery, exposed terminal, motor driver, wall adapter, or magical hidden supply. A simple enclosure cable exit may acknowledge the external low-voltage power path without adding unselected hardware."
      : "Power rule: Treat this as a low-power USB-powered ESP32 prototype. Do not imply a battery unless an exact selected controller or power module supports it. Never show mains wiring, high-current loads, exposed terminals, or magical hidden power.",
    "",
    "Absolute exclusions: no screws; no bolts; no threaded inserts; no visible fastener heads; no visible USB-C port or plug in the hero image; no front-facing connector; no transparent dome; no glass; no acrylic; no decorative clear bubble; no physical mascot; no decorative topper; no floating electronics; no solderless breadboard; no loose decorative wires; no extra board; no camera unless selected; no battery; no unsupported mechanism; no unselected button-like accent patch; no instruction diagram; no neon sci-fi styling; no wooden tabletop; no crowded room scene; no multiple versions; no generic rounded rectangle reused across unrelated projects; no candy-colored primary palette; no children's-toy styling; no arbitrary arch, ring, hole, fin, foot, or color block without a functional rationale.",
  ].join("\n");
}

function renderDesignBrief(idea, plan, parts) {
  const text = `${idea} ${plan.title || ""} ${plan.summary || ""} ${plan.behavior || ""}`.toLowerCase();
  const selectedText = parts.map((part) => `${part.category || ""} ${part.name || ""} ${part.subtype || ""}`).join(" ").toLowerCase();
  const hasMotion = /fs90r|continuous.rotation.*servo|servo.*continuous.rotation/.test(selectedText);
  const hasPositionalServo = /positional.*servo|servo.*(?:90|180|270)[- ]?degree/.test(selectedText)
    && !/fs90r|continuous.rotation/.test(selectedText);
  const hasSelectedCable = parts.some((part) => part.category === "connector" && /cable|dupont|jumper/i.test(`${part.name} ${part.subtype || ""}`));
  const isIntegratedBoard = parts.length === 1 && /display|screen|controller/.test(selectedText);
  const wantsVisibleElectronics = /translucent|transparent|see[- ]through|visible (?:electronics|internals)|show (?:the )?(?:board|wires|electronics)/.test(text);
  let archetype = "purpose-built compact electronic product";
  let formLanguage = "derive a restrained, project-specific silhouette from the use case, interaction face, service path, and verified component envelope; prioritize coherent volumes, disciplined radii, and functional part breaks over novelty geometry";
  let cameraDirection = "eye-level 3/4 front-side documentation view, with the primary affordance readable and the connector side receding away from the viewer";
  let signatureSilhouette = "a concise primary volume with posture and proportions determined by how the project is viewed, held, mounted, or moved; no arbitrary cutout or decorative distortion";
  let delightMoment = "one quiet tactile or visual detail tied to the real interaction—such as a precise bezel, a satisfying control, a subtle status glow, or an honest mechanism reveal";
  let semanticReferenceRule = "- Reference-language rule: treat named design eras or product families as proportions, posture, vent rhythm, and interaction hierarchy—not as a logo, a literal copy, or the nearest current product.";

  if (/pen holder|pencil holder|desk organizer/.test(text)) {
    archetype = "integrated functional desk organizer";
    formLanguage = "make the open pen cup the dominant useful volume, then integrate the exact selected display and control into a low front apron or offset side wing; use a curved mouth, arched feet, and asymmetric stance instead of an A-frame or electronics box";
    signatureSilhouette = "a generous open cup with a sweeping scooped rim, two small arched feet, and one offset interaction wing; the pen-holding void must dominate the black silhouette";
    delightMoment = "make the real pen storage and one supported moving or rotary interaction the focus; use a restrained darker interior so inserted pens complete the composition";
    cameraDirection = "slightly elevated 3/4 front-side view that proves the pen cup is usable while hiding the connector side";
  } else if (/dragon/.test(text)) {
    archetype = "compact dragon-inspired interactive desk object";
    formLanguage = "use a low rounded egg or crouched pebble body with an integrated swept-back printed crest and a wide planted belly; the selected display is the only face, while fins and vents are structural shell geometry rather than separate figurine pieces";
    signatureSilhouette = "a squat asymmetric egg with a curved back and one rhythmic swept crest integrated into the shell, never a tent, wedge, A-frame, or rectangular appliance";
    delightMoment = "let the selected display carry a minimal pixel-dragon expression while a restrained integrated crest gives the enclosure identity without reading as a toy figurine";
    cameraDirection = "low eye-level 3/4 portrait that emphasizes the crouched stance, integrated crest, and selected display while hiding all service ports";
  } else if (/desk pet|desktop pet|companion robot|expressive companion/.test(text)) {
    archetype = "friendly expressive desktop companion";
    formLanguage = "use a compact low body on a recessed stable base, with a gently canted interaction face and one controlled offset shoulder for the exact sensor or control; the selected display is the only face, with no ears, horns, animal shell, A-frame, tent, or arbitrary belly opening";
    signatureSilhouette = "a low compact companion with a forward-canted display face, recessed service base, and one measured shoulder driven by the selected interaction";
    delightMoment = "give the selected display a minimal expressive pixel moment and use a precise shadow-gap snap seam that makes the enclosure feel serviceable";
    cameraDirection = "low eye-level 3/4 product view, showing the selected display and functional posture while hiding every service port";
  } else if (/macintosh|classic mac|compact mac|retro mac(?! mini)/.test(text)) {
    archetype = "1984-era compact Macintosh-inspired desktop appliance";
    formLanguage = "upright one-piece computer posture, tall compact proportions, softly chamfered warm-beige shell, inset dark display opening, subtle rear/side vents, and a quiet lower service band; never a Mac mini slab, laptop, monitor-on-stand, or modern aluminum computer";
    signatureSilhouette = "a compact 1980s all-in-one posture with a subtly convex forehead, narrow shoulders, an inset display, and a gently smiling lower snap-fit service band—clearly upright even as a tiny black silhouette";
    delightMoment = "the tiny selected display becomes the emotional focal point while a single contrasting rotary control feels like a satisfyingly oversized physical dial; no fake floppy slot";
    cameraDirection = "slightly low eye-level 3/4 front-side view that shows the upright compact-computer silhouette and lets the rear connector remain peripheral";
    semanticReferenceRule = "- Macintosh rule: 'Macintosh-inspired' means the original upright compact Macintosh family of the 1980s—vertical posture, inset display, beige molded shell, and restrained vents. It never means Mac mini, iMac, MacBook, Apple logo, a literal replica, or a fake floppy-drive slot unsupported by the selected parts.";
  } else if (/mac mini/.test(text)) {
    archetype = "small desktop-computer-inspired instrument";
    formLanguage = "low compact square desktop footprint with a distinct raised interaction/display feature required by the selected parts; avoid copying Apple hardware or producing an empty featureless slab";
    signatureSilhouette = "a low floating-looking plinth supported by a recessed snap-fit base and one raised interaction island, with the rear connector hidden";
    delightMoment = "a restrained darker underside and precise perimeter shadow gap clarify the snap-fit construction at the three-quarter angle";
  } else if (/robot arm|manipulator|gripper|3[- ]?axis arm/.test(text)) {
    archetype = hasPositionalServo ? "open-frame positional-servo mechanism" : "honest robot-arm control and calibration prototype";
    formLanguage = hasPositionalServo
      ? "expose the real selected positional-servo bodies, printed links, captured pivot pins, cable routing, joint limits, and stable base; do not hide the mechanism in a monolithic enclosure"
      : "show the exact selected controller and controls in a compact calibration stand while omitting any unselected positional arm, servo, gripper, or magical mechanism";
    signatureSilhouette = hasPositionalServo
      ? "a lively articulated S-curve from base to gripper with generous negative space between links and a stable radial foot"
      : "an angled calibration easel with a scooped base and an empty, honest mounting bay that does not pretend an arm exists";
    delightMoment = hasPositionalServo
      ? "use two closely related neutral tones so the motion chain is readable without toy-like color blocking"
      : "make the selected control the tactile hero through scale, color, and a satisfying finger-clearance scoop";
    cameraDirection = "side-biased 3/4 engineering-documentation view that clearly reveals joint architecture or, when actuators are missing, the honest control prototype";
  } else if (/drone|quadcopter|fpv/.test(text)) {
    archetype = "open-frame aerial-electronics prototype";
    formLanguage = "use a purposeful light frame and expose only exact selected boards and routed cables; if motors, propellers, battery, or flight controller are not selected, omit them instead of depicting a complete flyable drone";
    signatureSilhouette = "a compact X or diamond frame with thin swept arms, open negative space, and a small central snap cradle sized only for selected boards";
    delightMoment = "use one restrained orientation accent on the front snap guards so direction is obvious without adding unselected electronics";
    cameraDirection = "slightly elevated 3/4 view with the frame geometry readable against the seamless background";
  } else if (/car|rover|wheeled|vacuum|floor robot|trash sorter/.test(text)) {
    archetype = hasMotion ? "low open-wheel mobile prototype" : "project-specific mobile-object electronics prototype";
    formLanguage = hasMotion
      ? "a narrow H-shaped or T-shaped printed structural spine with large negative space around two visibly nested FS90R servo bodies, exactly two outboard wheels on one axle line, a small snap-fit electronics pod only where needed, honest wheel clearance, and no broad rectangular lid, sealed shoebox body, cosmetic body kit, or featureless slab"
      : "preserve the recognizable requested object but show no powered drivetrain, hidden wheel, or invented mechanical hardware";
    signatureSilhouette = hasMotion
      ? "a low-slung bow-tie structural chassis: two outboard wheels, a narrow load-bearing waist, real motion clearance under the center spine, and a compact electronics pod—not a car-shaped box"
      : "a recognizable static object profile with one large purposeful cutout and no fake drivetrain";
    delightMoment = hasMotion
      ? "use a subtly contrasting snap-on center spine and covered wheel retainers so the drive geometry reads clearly while remaining mechanically honest"
      : "use a confident accent snap panel that clearly signals the beginner-serviceable area";
    cameraDirection = "low 3/4 front-side engineering view that shows wheel alignment or the honest static adaptation without pointing USB-C at the camera";
  } else if (/rubik|cube/.test(text)) {
    archetype = "display-tile cube study";
    formLanguage = "preserve the requested cube as the honest primary archetype, but show only the exact selected display area on one visible face unless multiple display modules are selected; use deep rounded edge channels, offset colored corner bumpers, and a snap-fit split that evokes movable tiles without inventing screens";
    signatureSilhouette = "a compact softened cube with deep rhythmic face channels and contrasting corner protection; this is the one intentional exception to the non-box silhouette rule because the user explicitly requested a cube";
    delightMoment = "use a restrained Rubik-inspired set of desaturated face accents while the one real display shows only abstract pixels";
  } else if (/handheld|controller|console|game|player|remote|tag|wearable|portable/.test(text)) {
    archetype = "handheld or compact interactive instrument";
    formLanguage = "interaction-first front face, comfortable edge radii, purposeful control spacing, slim snap-fit rear shell, and a side/rear connector; use a measured grip relief, offset thumb bay, cartridge shoulder, or curved back only where ergonomics require it";
    signatureSilhouette = "a compact soft dog-bone or rounded-cartridge outline with one side scooped for the hand and the interaction face visually balanced by asymmetry";
    delightMoment = "let one supported control or selected display become the precise focal point, with a subtle material change at the snap-fit rear shell";
  } else if (/vinyl|turntable|music player/.test(text)) {
    archetype = "miniature digital turntable-inspired controller";
    formLanguage = "organize the exact display and rotary control around a broad circular recessed platter motif on an asymmetric low deck with a curved front corner; no A-frame, tent, rectangular receiver, or fake tonearm";
    signatureSilhouette = "a low asymmetric kidney-shaped deck with one dominant circular platter recess and a clipped control corner";
    delightMoment = "the selected rotary control becomes the satisfyingly oversized platter interaction, accented like a tiny record without adding a fake mechanism";
  } else if (/message board|couple companion|send messages/.test(text)) {
    archetype = "tabletop message display";
    formLanguage = "mount the exact selected display in a thin, correctly proportioned frame on one integrated rear kickstand or weighted base; keep the body shallow and serviceable, with no portal ring, decorative void, A-frame tent, or oversized empty shell";
    signatureSilhouette = "a thin canted display frame with a single functional rear support and a low center of gravity";
    delightMoment = "a restrained inner bezel and soft status glow make each incoming abstract drawing feel considered without decorative geometry";
  } else if (/json|csv|table viewer|data input|dashboard|info panel/.test(text)) {
    archetype = "professional desktop data instrument";
    formLanguage = "use a folded-ribbon side profile, cantilevered display deck, and open underside with a small weighted foot; avoid an A-frame, tent, slab, or generic monitor";
    signatureSilhouette = "an offset cantilevered ribbon: display deck projecting from a curved spine above a clearly open base";
    delightMoment = "a high-contrast underside color reveal makes the display feel like it is being presented, without floating or adding supports";
  } else if (/timer|alarm clock|clock/.test(text)) {
    archetype = "friendly timekeeping object";
    formLanguage = /alarm/.test(text)
      ? "use a low bridge clock with a shallow viewing tilt, two short stable feet, and the exact display centered under a functional glare brow; no tent or oversized filled rectangle"
      : "use a compact weighted timer body with an integral rear viewing stand, correctly proportioned display, and one exact control in a comfortable reach zone; no loop, hourglass, ring, A-frame, or arbitrary void";
    signatureSilhouette = /alarm/.test(text)
      ? "a low smiling bridge with daylight beneath the display and two planted feet"
      : "a concise timer body canted on one integrated rear support, with its display and exact primary control forming a clear hierarchy";
    delightMoment = "use the selected button, touch area, or rotary control as one precisely detailed time interaction with a restrained accent";
  } else if (!/plant|soil|water|door|window|air|light|sensor|monitor|chime/.test(text)
    && /clock|timer|message board|dashboard|display|status|music|vinyl/.test(text)) {
    archetype = "desktop information instrument";
    formLanguage = "a compact upright instrument or shallow canted console chosen for viewing angle, with a correctly proportioned display bezel, clear primary/secondary controls, an integrated rear support, a quiet service seam, and no oversized empty body";
    signatureSilhouette = "a shallow canted interaction plane supported by one integrated rear spine or recessed base, with proportions driven by the exact display and controls";
    delightMoment = "a precise inner bezel or subtle underside material change frames the selected display without bright color blocking";
  } else if (/plant|soil|water|door|window|air|light|sensor|monitor|chime/.test(text)) {
    archetype = "environment-specific sensing fixture";
    formLanguage = /window|air/.test(text)
      ? "use a low horizontal breathing bridge with a large open arch beneath it, two short feet, a gently bowed vented canopy, and the exact display integrated into one end; never an upright A-frame, tent, wedge, or filled box"
      : /door|chime/.test(text)
        ? "use a slim vertical pebble with one offset shoulder that nestles against a wall or door frame; keep the exact display, sensor zone, or light path small and clear, with no front service-port opening"
        : "use a slim crescent mount, soft arch, purposeful clip, petal diffuser, or tapered freestanding fixture chosen for the place it works; align vents, light paths, probes, and sensor apertures with the actual environment instead of using a generic desktop box";
    signatureSilhouette = /plant|soil|water/.test(text)
      ? "a low asymmetrical leaf-like arch with a narrow sensor-facing neck and a broad stable snap-fit foot—abstractly botanical, never a literal leaf decoration"
      : /door|chime/.test(text)
        ? "a slim vertical pebble with one offset shoulder that nestles against a wall or door frame and keeps the interaction face clear"
        : /light/.test(text)
          ? "a shallow radial petal or folded-ribbon diffuser supported by a tiny recessed sensor base, using only the selected light source"
          : "a breathable bridge-like shell with a large central arch and purposeful vent rhythm around the verified sensor path";
    delightMoment = "use a restrained accent only on the real status light path or service seam so the fixture feels considered rather than clinical";
    if (/door|chime/.test(text)) {
      cameraDirection = "straight-on front view of the fixture mounted flush to a plain studio wall, with zero visible side or rear surface; show only the exact selected display or status light on the front and show no USB opening, plug, loose cable, pigtail, magnetic-sensor opening, or service cutout";
    }
  }

  let visibilityStrategy = "use an opaque shell and reveal only the selected screen, control, sensor aperture, or light path required for operation";
  const colorStory = professionalColorStory(text);
  let materialDirection = `Use tactile matte FDM plastic with the ${colorStory} palette: one dominant neutral, one secondary neutral, and a single restrained accent on no more than 5-10% of the form. The accent must follow a real bezel, snap seam, structural member, or selected light path; never draw an isolated control-sized color patch that could be mistaken for a button. Preserve subtle real layer lines and use no metal enclosure fasteners.`;
  if (/robot arm|manipulator|drone|quadcopter|fpv/.test(text)) {
    visibilityStrategy = "use an honest open-frame construction: exact selected boards, actuators, and factory-terminated cables may remain visible where mechanically necessary; do not fabricate missing electronics";
    materialDirection = `Use matte printed structural parts in the ${colorStory} palette, alternating dominant and accent colors to make the mechanism legible; exact selected modules provide the only non-printed material detail. No cosmetic outer shell and no screws.`;
  } else if ((wantsVisibleElectronics || /prototype|maker|cyberdeck|handheld|tag/.test(text)) && (hasSelectedCable || isIntegratedBoard)) {
    visibilityStrategy = "use one localized smoke or softly tinted translucent PETG rear/service shell to reveal the exact selected board and any selected factory-terminated cable; keep the main interaction face opaque and legible";
    materialDirection = `Combine a matte opaque primary shell in the ${colorStory} palette with one restrained smoke, amber, or frosted translucent PETG service shell of believable thickness; show only exact selected internals.`;
  }

  return {
    archetype,
    formLanguage,
    visibilityStrategy,
    connectorPlacement: "recess USB-C on the unseen rear or underside with strain relief and cable bend clearance; choose the hero angle so the port is completely hidden, never on the front interaction face and never pointed toward the viewer. Do not depict the USB-C shape at all in the hero image",
    cameraDirection,
    materialDirection,
    signatureSilhouette,
    delightMoment,
    colorStory,
    semanticReferenceRule,
  };
}

function professionalColorStory(text) {
  const palettes = [
    "warm off-white, graphite, and a restrained burnt-orange accent",
    "soft bone, charcoal, and a muted cobalt accent",
    "cool gray, matte black, and a subdued amber accent",
    "stone gray, deep navy, and a desaturated sage accent",
    "warm gray, dark plum, and a restrained coral accent",
    "matte black, smoke gray, and a pale blue status accent",
  ];
  let value = 0;
  for (const character of text) value = ((value * 31) + character.charCodeAt(0)) >>> 0;
  return palettes[value % palettes.length];
}

export function publicBuild(build) {
  const parts = reconcileBuildPartsWithAssembly(build.parts, build.artifacts);
  return {
    id: build.id,
    createdAt: build.createdAt,
    title: build.title,
    idea: build.idea,
    summary: build.summary,
    behavior: build.behavior,
    visibleHardwareCues: build.visibleHardwareCues || [],
    ...(build.image ? { image: presentationImageForBuild(build) } : {}),
    parts,
    warnings: build.warnings || [],
    ...(build.semanticFulfillment ? { semanticFulfillment: build.semanticFulfillment } : {}),
    cost: build.cost,
    ...(build.artifacts ? { artifacts: build.artifacts } : {}),
    ...(build.identity ? { identity: build.identity } : {}),
    ...(build.artifactStates ? { artifactStates: build.artifactStates } : {}),
    ...(build.manifest ? { manifest: build.manifest } : {}),
    status: build.status || "Concept",
  };
}

/**
 * The circuit compiler may add a controller, carrier, or cable that is
 * physically required after the planner has selected the user-facing parts.
 * Reconcile those exact assembly instances back into one purchasable BOM so
 * Overview, Parts, Wiring, cost, and the hero prompt all describe one build.
 */
export function reconcileBuildPartsWithAssembly(inputParts = [], artifacts = null) {
  const assemblyParts = Array.isArray(artifacts?.assembly?.parts)
    ? artifacts.assembly.parts
    : [];
  if (!assemblyParts.length) return collapsePartQuantities(inputParts);

  const inputByAssetId = new Map();
  for (const part of inputParts || []) {
    for (const asset of part?.assemblyAssets || []) inputByAssetId.set(asset.partId, part);
  }
  const rows = [];
  const byId = new Map();
  for (const instance of assemblyParts) {
    const assetId = clean(instance?.assetId);
    if (!assetId) continue;
    const source = inputByAssetId.get(assetId)
      || (catalogByAssemblyAssetId.has(assetId) ? publicPart(catalogByAssemblyAssetId.get(assetId)) : null);
    if (!source) continue;
    const key = clean(source.id || source.asin || assetId).toLowerCase();
    const existing = byId.get(key);
    if (existing) {
      existing.quantity += 1;
      continue;
    }
    const explicitPackageQuantity = packageQuantityFromName(source.name);
    const packageQuantity = explicitPackageQuantity || Math.max(1, Number(source.packQty || 1));
    const row = {
      ...source,
      quantity: 1,
      ...(packageQuantity > 1 ? { packageQuantity } : {}),
      ...(assetId === "esp32-camera-board" ? { includedComponents: ["camera module"] } : {}),
      assemblyRole: clean(instance.role || source.category),
      compilerInjected: instance.compilerInjected === true || !inputByAssetId.has(assetId),
    };
    rows.push(row);
    byId.set(key, row);
  }
  return rows.length ? rows : collapsePartQuantities(inputParts);
}

function collapsePartQuantities(inputParts = []) {
  const rows = [];
  const byId = new Map();
  for (const part of inputParts || []) {
    const key = clean(part?.id || part?.asin || part?.name).toLowerCase();
    if (!key) continue;
    const existing = byId.get(key);
    if (existing) {
      existing.quantity += Number(part.quantity || 1);
      continue;
    }
    const explicitPackageQuantity = packageQuantityFromName(part.name);
    const packageQuantity = explicitPackageQuantity || Math.max(1, Number(part.packQty || 1));
    const row = {
      ...part,
      quantity: Math.max(1, Number(part.quantity || 1)),
      ...(packageQuantity > 1 ? { packageQuantity } : {}),
    };
    rows.push(row);
    byId.set(key, row);
  }
  return rows;
}

function packageQuantityFromName(value) {
  const text = clean(value);
  const match = text.match(/(?:\b(\d+)\s*[- ]?pack\b|\b(\d+)\s*pcs?\b)/i);
  return Math.max(0, Number(match?.[1] || match?.[2] || 0));
}

function assemblyHeroPromptBlock(artifacts) {
  const assembly = artifacts?.assembly;
  const parts = Array.isArray(assembly?.parts) ? assembly.parts : [];
  if (!parts.length) return "";
  const wirelessLinks = Array.isArray(assembly?.wirelessLinks) ? assembly.wirelessLinks : [];
  const nodeIds = new Set();
  for (const link of wirelessLinks) {
    if (link?.fromNodeId) nodeIds.add(link.fromNodeId);
    if (link?.toNodeId) nodeIds.add(link.toNodeId);
  }
  const topology = nodeIds.size > 1
    ? `The final circuit contains ${nodeIds.size} physically separate wireless devices. Show every device fully in frame and make their different roles visually obvious. Do not merge them into one enclosure.`
    : "Show the complete final physical assembly, not a cropped module or an incomplete subset.";
  const inventory = parts.map((part) => `${part.label} [${part.role}]`).join("; ");
  return [
    "FINAL-ASSEMBLY IMAGE CONTRACT:",
    `- ${topology}`,
    `- Final modeled BOM (${parts.length} physical line items): ${inventory}.`,
    `- Wireless links: ${wirelessLinks.length}. Never draw a physical cable between wireless nodes.`,
    "- The image must communicate the actual finished use case, include every distinct device, and avoid generic single-box compositions.",
  ].join("\n");
}

function publicPart(part) {
  const listingPrice = typeof part.price === "number" ? part.price : null;
  const unitPriceUsd = listingPrice ?? planningPrice(part.category);
  const assemblyAssets = Array.isArray(part.assemblyAssets) ? part.assemblyAssets : [];
  const thumbnailUrl = trustedPartThumbnailUrl(part);
  const breakoutResearch = part.category === "controller" && /esp32/i.test(`${part.name} ${part.listingTitle || ""}`)
    ? breakoutResearchForController(part)
    : null;
  return {
    id: part.id,
    name: part.name,
    category: part.category,
    subtype: part.subtype,
    price: listingPrice,
    unitPriceUsd,
    priceSource: listingPrice == null ? "planning-estimate" : "listing",
    priceLabel: listingPrice == null
      ? `About $${unitPriceUsd.toFixed(2)} planning estimate`
      : `$${listingPrice.toFixed(2)} catalog price`,
    packQty: part.packQty,
    asin: part.asin,
    url: part.url,
    voltage: part.voltage,
    notes: part.notes,
    why: customerFacingPartWhy(part),
    checkedDate: part.checkedDate,
    presoldered: part.presoldered,
    connectionReady: part.presoldered && part.modelSelectable,
    modelSelectable: part.modelSelectable,
    selectionStatus: part.modelSelectable
      ? "ready"
      : (assemblyAssets.some((asset) => asset.selectionStatus === "candidate_review") ? "candidate_review" : "blocked"),
    connectionType: part.connectionType,
    assemblyAssetAvailable: assemblyAssets.some((asset) => asset.ready),
    assemblyAssets,
    ...(part.sensorSpec ? { sensorSpec: part.sensorSpec } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(breakoutResearch ? { breakoutResearch } : {}),
  };
}

function customerFacingPartWhy(part) {
  const supplied = String(part.why || "").trim();
  if (!supplied) return "";
  if (/visual(?:ly)?[_\s-]*pass(?:ed)?|\.csv\b|source[_\s-]*row|\bloop\b|\baudit\b|\bcandidate\b|\baws\b|\bglb\b|\bcatalog\b|\bexact\b|\bpre-soldered\b|\bfactory-soldered\b|\blive amazon price\b|\buser-approved modeled\b/i.test(supplied)) {
    return "";
  }
  return supplied;
}

function trustedPartThumbnailUrl(part) {
  const candidate = approvedPartThumbnailUrl(part);
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") return "";
    if (url.hostname === "dvy6bet209exg.cloudfront.net") return "";
    return /\.(?:jpe?g|png|webp)$/i.test(url.pathname) ? url.toString() : "";
  } catch {
    return "";
  }
}

function planningPrice(category) {
  return {
    controller: 14.99,
    display: 9.99,
    sensor: 7.99,
    input: 6.99,
    output: 6.99,
    actuator: 12.99,
    support: 7.99,
    connector: 6.99,
    storage: 8.99,
    time: 7.99,
    power: 19.99,
  }[category] || 7.99;
}

function isControllerPart(part) {
  if (part.category === "controller") return true;
  const text = `${part.name || ""} ${part.subtype || ""}`.toLowerCase();
  return /\bxiao\s+esp32/.test(text)
    || /\besp32(?:-[a-z0-9]+)?\b.{0,90}(?:dev(?:elopment)? board|mini|wroom|camera|lora)/.test(text)
    || /(?:dev(?:elopment)? board|mini|wroom|camera|lora).{0,90}\besp32(?:-[a-z0-9]+)?\b/.test(text);
}

function outputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("");
}

function openAIHeaders(env) {
  return {
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function openAIImageHeaders(env) {
  return {
    Authorization: `Bearer ${env.OPENAI_IMAGE_API_KEY || env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function openAIEndpoint(env, pathname) {
  return `${openAIBaseUrl(env)}${pathname}`;
}

function openAIImageEndpoint(env, pathname) {
  const base = String(env.OPENAI_IMAGE_BASE_URL || "").trim()
    || (String(env.OPENAI_IMAGE_API_KEY || "").trim()
      ? "https://api.openai.com"
      : (usesDirectOpenAI(env) ? openAIBaseUrl(env) : "https://api.openai.com"));
  const parsed = new URL(base.replace(/\/+$/, ""));
  if (parsed.protocol !== "https:") throw buildGenerationError("The OpenAI image endpoint must use HTTPS.");
  return `${parsed.toString().replace(/\/+$/, "")}${pathname}`;
}

function openAIBaseUrl(env) {
  const raw = String(env.OPENAI_BASE_URL || "https://api.openai.com").trim().replace(/\/+$/, "");
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:") throw buildGenerationError("The OpenAI endpoint must use HTTPS.");
  return parsed.toString().replace(/\/+$/, "");
}

function usesDirectOpenAI(env) {
  return new URL(openAIBaseUrl(env)).hostname === "api.openai.com";
}

function openAIRequestPayload(payload, env) {
  if (usesDirectOpenAI(env)) return payload;
  const gatewayPayload = { ...payload };
  delete gatewayPayload.service_tier;
  return gatewayPayload;
}

function openAITimeoutSignal(env) {
  const requested = Number.parseInt(env.OPENAI_IMAGE_TIMEOUT_MS, 10);
  const timeoutMs = Number.isFinite(requested)
    ? Math.max(30_000, Math.min(requested, 840_000))
    : 720_000;
  return AbortSignal.timeout(timeoutMs);
}

function openAIImageToolTimeoutSignal(env) {
  const requested = Number.parseInt(env.OPENAI_IMAGE_TOOL_TIMEOUT_MS, 10);
  const timeoutMs = Number.isFinite(requested)
    ? Math.max(30_000, Math.min(requested, 300_000))
    : 120_000;
  return AbortSignal.timeout(timeoutMs);
}

function deterministicBuildHero({ buildIdentity, plan = {}, parts = [] } = {}, idea = "", reason = "") {
  const title = escapeSvgText(String(plan.title || "Makeable build").slice(0, 70));
  const summary = escapeSvgText(String(plan.summary || idea || "Exact parts, exact project.").slice(0, 125));
  const partLabels = parts.slice(0, 4).map((part) => escapeSvgText(String(part.name || part.id || "Part").slice(0, 42)));
  const fingerprint = escapeSvgText(String(buildIdentity?.requestFingerprint || "unbound").slice(0, 12));
  const cueText = escapeSvgText((plan.visibleHardwareCues || []).slice(0, 2).join(" · ").slice(0, 90));
  const partRows = partLabels.map((label, index) => (
    `<g transform="translate(725 ${250 + index * 82})"><circle cx="18" cy="18" r="18" fill="#f3696e"/>`
    + `<text x="18" y="24" text-anchor="middle" class="num">${index + 1}</text>`
    + `<text x="54" y="24" class="part">${label}</text></g>`
  )).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#f8f3eb"/><stop offset="1" stop-color="#e8ded0"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-opacity=".18"/></filter></defs>
  <style>.brand{font:700 30px system-ui,sans-serif;fill:#f3696e}.title{font:700 48px system-ui,sans-serif;fill:#121722}.copy{font:400 20px system-ui,sans-serif;fill:#4c5360}.part{font:600 17px system-ui,sans-serif;fill:#202631}.num{font:700 14px system-ui,sans-serif;fill:#fff}.screen{font:700 24px ui-monospace,monospace;fill:#87f1db}.meta{font:500 14px ui-monospace,monospace;fill:#777f89}</style>
  <rect width="1200" height="800" fill="url(#bg)"/><text x="70" y="72" class="brand">Makeable ✦</text>
  <g transform="translate(105 170)" filter="url(#shadow)"><rect width="500" height="470" rx="52" fill="#151b27"/><rect x="72" y="68" width="356" height="238" rx="22" fill="#071d22" stroke="#334852" stroke-width="4"/><text x="105" y="125" class="screen">TEMP  22.4°C</text><text x="105" y="176" class="screen">HUM   48%</text><text x="105" y="227" class="screen">PRES  1012 hPa</text><circle cx="250" cy="375" r="46" fill="#e7dfd2"/><circle cx="250" cy="375" r="31" fill="#89929e"/><path d="M250 344v18" stroke="#151b27" stroke-width="5" stroke-linecap="round"/></g>
  <text x="690" y="125" class="title">${title}</text><text x="690" y="170" class="copy">${summary}</text><text x="690" y="210" class="meta">BOUND BUILD ${fingerprint}</text>${partRows}
  <text x="690" y="640" class="copy">${cueText}</text><text x="690" y="690" class="meta">DETERMINISTIC BUILD PREVIEW · ${escapeSvgText(reason)}</text>
  </svg>`;
  return {
    url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    source: "deterministic_build_preview",
    status: "generated_fallback",
    model: "makeable-bound-hero-v1",
    fallbackReason: String(reason || "image_generation_unavailable"),
  };
}

function escapeSvgText(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildGenerationError(message) {
  const error = new Error(String(message || "Build generation failed."));
  error.code = "build_generation_failed";
  return error;
}

function openAIServiceTier(env) {
  const tier = String(env.OPENAI_BUILD_SERVICE_TIER || env.OPENAI_SERVICE_TIER || DEFAULT_BUILD_SERVICE_TIER).toLowerCase();
  return ["auto", "default", "flex", "priority"].includes(tier) ? tier : DEFAULT_BUILD_SERVICE_TIER;
}

function imageQuality(value) {
  const quality = String(value || DEFAULT_IMAGE_QUALITY).toLowerCase();
  return ["low", "medium", "high"].includes(quality) ? quality : DEFAULT_IMAGE_QUALITY;
}

function loadCatalog() {
  const rows = parseCsv(catalogCsv);
  const header = rows[0] || [];
  return rows
    .slice(1)
    .map((row, index) => normalizeCatalogPart(Object.fromEntries(header.map((key, column) => [key, row[column] || ""])), index))
    .filter((part) => part.presoldered);
}

function loadAssemblyAssetCatalog() {
  const rows = parseCsv(assemblyAssetCsv);
  const header = rows[0] || [];
  const seen = new Set();
  return rows.slice(1).map((row) => {
    const value = Object.fromEntries(header.map((key, column) => [key, row[column] || ""]));
    const partId = clean(value.assembly_asset_id);
    const url = clean(value.glb_url);
    const sha256 = clean(value.glb_sha256).toLowerCase();
    const registryRevision = clean(value.registry_revision);
    if (!partId || seen.has(partId)) throw new Error(`Duplicate or missing assembly asset id: ${partId || "<empty>"}`);
    seen.add(partId);
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "dvy6bet209exg.cloudfront.net") {
      throw new Error(`Unapproved assembly asset URL for ${partId}`);
    }
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Invalid assembly asset hash for ${partId}`);
    if (!/^[a-z0-9._-]+$/i.test(registryRevision)) throw new Error(`Invalid assembly registry revision for ${partId}`);
    return applyAssemblyPolicy({
      partId,
      name: clean(value.assembly_asset_name),
      registryRevision,
      revision: clean(value.assembly_revision),
      url,
      sha256,
      reviewState: clean(value.review_state),
      catalogKey: clean(value.catalog_asin_or_key),
      catalogBinding: clean(value.catalog_binding),
      connectionReadiness: clean(value.connector_readiness),
      selectionStatus: clean(value.selection_status),
      blocker: clean(value.selection_blocker),
      connectionRequirement: clean(value.connection_requirement),
      requiredAccessory: clean(value.required_accessory),
      approvalBasis: clean(value.approval_basis),
      soldFormGeometry: clean(value.sold_form_geometry),
      electricalNote: clean(value.electrical_note),
      reviewEvidenceUrl: clean(value.review_evidence_url),
      marketplaceUrl: clean(value.marketplace_url),
      ready: clean(value.selection_status) === "ready",
    });
  });
}

function groupAssemblyAssets(assets) {
  const grouped = new Map();
  for (const asset of assets) {
    if (!asset.catalogKey) continue;
    const list = grouped.get(asset.catalogKey) || [];
    list.push(asset);
    grouped.set(asset.catalogKey, list);
  }
  return grouped;
}

function normalizeCatalogPart(row, index) {
  const asin = clean(row.asin);
  const name = clean(row.part_name || row.subcategory_or_subtype || row.listing_title || `Part ${index + 1}`);
  const listingTitle = clean(row.listing_title || name);
  const price = parsePrice(row.estimated_price_usd);
  const id = `${asin || hash(`${name}-${index}`).slice(0, 10)}-${index + 1}`.toLowerCase();
  const advancedText = `${row.category} ${row.subcategory_or_subtype} ${name} ${listingTitle}`.toLowerCase();
  const verificationText = `${row.visual_status} ${row.verification_status} ${row.visual_pass_evidence} ${row.pin_source_evidence}`;
  const candidateReview = /candidate_review/i.test(`${verificationText} ${row.exclusion_flags}`);
  const readyToUseException = /exception_(?:factory_|modeled_|solderless_)|not_applicable_factory_attached_3pin_female_servo_plug/i.test(row.factory_presoldered_male_pins_verified)
    && /visual_pass/i.test(verificationText);
  const factoryAssembledCandidate = /exception_factory_/i.test(row.factory_presoldered_male_pins_verified)
    && candidateReview;
  const verifiedContinuousServo = /\bfs90r\b/.test(advancedText)
    && /continuous[- ]rotation/.test(advancedText)
    && /factory_attached_servo_lead/i.test(verificationText)
    && /external_servo_power_required/i.test(row.exclusion_flags);
  const excludedAdvancedPart = /(max485|rs-485|mosfet|12v|24v|36v|buck|mcp23017|gpio expander|level shifter|shift register|diode|relay|pump|heater|mains|high[ -]?current|battery cell)/.test(advancedText);
  const unsupportedMotor = /motor|servo|powered wheel/.test(advancedText) && !verifiedContinuousServo;
  const excludedForPlanning = excludedAdvancedPart || unsupportedMotor;
  const electricalText = `${row.esp32_voltage} ${name} ${listingTitle}`.toLowerCase();
  const fiveVoltOnly = /\b5(?:\.0)?v\b/.test(electricalText)
    && !/\b3(?:\.0|\.3)?v\b/.test(electricalText);
  const weirdAuditRow = /visual_pass_factory|^yes$/i.test(name);
  const presoldered = clean(row.factory_presoldered_male_pins_verified).toLowerCase() === "yes"
    || readyToUseException
    || factoryAssembledCandidate
    || /visual_pass_factory_presoldered|pre-?soldered|presoldered/i.test(verificationText);
  const checkedDate = clean(row.last_checked_yyyy_mm_dd);
  const hasVerifiedCheckedDate = /^\d{4}-\d{2}-\d{2}$/.test(checkedDate);
  const catalogKey = asin || catalogKeyFromUrl(row.direct_url);
  const assemblyAssets = (assemblyAssetsByCatalogKey.get(catalogKey) || []).map(publicAssemblyAsset);
  const hasApprovedAssemblyAsset = assemblyAssets.some((asset) => asset.ready);
  const connectionType = normalizeConnectionType(row.factory_presoldered_male_pins_verified, verificationText);

  return {
    id,
    sourceMarketplace: clean(row.source_marketplace),
    category: normalizeCategory(row.category, name, listingTitle),
    subtype: clean(row.subcategory_or_subtype),
    name,
    listingTitle,
    brand: clean(row.brand_or_seller),
    price,
    priceLabel: price == null ? clean(row.estimated_price_usd) || "Live price check needed" : `$${price.toFixed(2)}`,
    packQty: Number.parseInt(row.pack_qty, 10) || 1,
    asin,
    url: clean(row.direct_url),
    voltage: clean(row.esp32_voltage),
    notes: clean(row.current_or_power_notes),
    why: clean(row.why_include),
    checkedDate,
    visualStatus: clean(row.visual_status),
    verificationStatus: clean(row.verification_status),
    presoldered,
    connectionType,
    assemblyAssets,
    sensorSpec: sensorSpecForPart({ asin, id }),
    // A reviewed AWS asset may carry a separately validated factory socket,
    // cable/adapter, or installed-header assembly profile. That explicit
    // per-asset contract overrides the old name-based beginner exclusions;
    // its electrical note still has to be honored by project wiring.
    modelSelectable: hasVerifiedCheckedDate && !weirdAuditRow && (
      hasApprovedAssemblyAsset
      || (presoldered && !candidateReview && !excludedForPlanning && !fiveVoltOnly)
    ),
  };
}

function publicAssemblyAsset(asset) {
  return {
    partId: asset.partId,
    name: asset.name,
    registryRevision: asset.registryRevision,
    revision: asset.revision,
    url: asset.url,
    sha256: asset.sha256,
    ready: asset.ready,
    selectionStatus: asset.selectionStatus,
    blocker: asset.blocker,
    connectionReadiness: asset.connectionReadiness,
    connectionRequirement: asset.connectionRequirement,
    requiredAccessory: asset.requiredAccessory,
    approvalBasis: asset.approvalBasis,
    soldFormGeometry: asset.soldFormGeometry,
    electricalNote: asset.electricalNote,
    reviewEvidenceUrl: asset.reviewEvidenceUrl,
  };
}

function catalogKeyFromUrl(value) {
  const match = clean(value).match(/(?:aliexpress\.(?:us|com)\/item\/)(\d+)/i);
  return match ? `ALI-${match[1]}` : "";
}

function normalizeConnectionType(value, verificationText) {
  const text = `${clean(value)} ${verificationText}`.toLowerCase();
  if (/modeled_installed_male_header/.test(text)) return "modeled_installed_male_header";
  if (/solderless_breadboard/.test(text)) return "solderless_breadboard";
  if (/terminal_adapter/.test(text)) return "solderless_terminal_adapter";
  if (/cable_adapter/.test(text)) return "solderless_cable_adapter";
  if (/qwiic_ic_hooks/.test(text)) return "factory_qwiic_ic_hooks";
  if (/socket_cable/.test(text)) return "factory_socket_cable";
  if (/factory_jst/.test(text)) return "factory_jst";
  if (/qwiic|stemma/.test(text)) return "factory_qwiic";
  if (/female_socket/.test(text)) return "factory_female_socket";
  if (/servo_plug|servo_lead/.test(text)) return "factory_servo_plug";
  if (/factory_cable|crimped|housed/.test(text)) return "factory_cable";
  if (/connector/.test(text)) return "factory_connector";
  return "factory_male_header";
}

function normalizeCategory(category, name, title) {
  const sourceCategory = clean(category).toLowerCase();
  const productText = `${name} ${title}`.toLowerCase();
  const integratedEsp32Board = /\besp32(?:-[a-z0-9]+)?\b.{0,90}(?:dev(?:elopment)? board|mini|wroom|camera|lora)/.test(productText)
    || /(?:dev(?:elopment)? board|mini|wroom|camera|lora).{0,90}\besp32(?:-[a-z0-9]+)?\b/.test(productText);

  // Exact integrated ESP32 boards are controllers even when an upstream
  // marketplace sheet accidentally grouped a camera bundle under output or a
  // flash-bearing board under storage. This check is deliberately narrower
  // than a generic "compatible with ESP32" title match.
  if (integratedEsp32Board && !["accessory", "connector"].includes(sourceCategory)) return "controller";

  // Interface, conversion, and expansion boards are useful catalog parts, but
  // they are not sensors. Keep them addressable without allowing the planner or
  // UI to treat an ADC, bus switch, GPIO expander, or transceiver as sensing
  // hardware merely because an upstream sheet called it a board or sensor.
  if (/\b(?:ads1115|hx711|max485|mcp23017|mcp2515|tca9548a)\b|\bdc-?dc\s+buck\b/.test(productText)) return "support";

  // The curated sheet already carries a useful product class. Prefer it over
  // compatibility phrases in listing titles (for example, a BME280 sensor
  // saying "for ESP32" must not become a controller, and an ambient-light
  // sensor must not become an LED output).
  if (/^(?:dev_board|esp32 boards)$/.test(sourceCategory)) return "controller";
  if (sourceCategory === "display") return "display";
  if (sourceCategory === "input") return "input";
  if (sourceCategory === "output") return "output";
  if (sourceCategory === "actuator") return "actuator";
  if (sourceCategory === "accessory") return "accessory";
  if (sourceCategory === "connector") return "connector";
  if (sourceCategory === "storage") return "storage";
  if (sourceCategory === "time") return "time";
  if (sourceCategory === "power") return "power";
  if (/sensor|temperature|humidity|pressure|motion|imu|color_light/.test(sourceCategory)) return "sensor";
  if (sourceCategory === "board" && integratedEsp32Board) {
    return "controller";
  }

  if (/display|oled|lcd|screen/.test(productText)) return "display";
  if (/\bxiao\b|\besp32(?:-[a-z0-9]+)?\b.*(?:dev(?:elopment)? board|mini|wroom|camera|lora)/.test(productText)) return "controller";
  if (/button|keypad|joystick|encoder|potentiometer|touch|microphone|sound/.test(productText)) return "input";
  if (/buzzer|\bled\b|motor/.test(productText)) return "output";
  if (/connector|qwiic|usb to ttl/.test(productText)) return "connector";
  if (/storage|sd card|flash/.test(productText)) return "storage";
  if (/rtc|clock|time/.test(productText)) return "time";
  if (/power|lipo|battery|charger/.test(productText)) return "power";
  if (/\b(?:gps|gnss|neo-[67]m)\b/.test(productText)) return "sensor";
  return "support";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parsePrice(value) {
  const match = String(value || "").match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : null;
}

function sanitizeIdea(value) {
  // The production API accepts complete project briefs up to 2,000 characters.
  // Never silently shorten the brief before the planner sees it: truncation can drop
  // required parts, exclusions, and the end of an electrical requirement.
  const idea = clean(value).slice(0, 2_000);
  return idea.length >= 4 ? idea : "";
}

function sanitizeEmail(value) {
  const email = clean(value).toLowerCase().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function newBuildId(idea) {
  const randomId = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${slug(idea).slice(0, 42)}-${randomId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}`;
}

function safeBuildId(id) {
  return /^[a-z0-9][a-z0-9-]{4,80}$/i.test(String(id || ""));
}

function buildStoreKey(id) {
  if (!safeBuildId(id)) throw new Error("Invalid build id.");
  return `builds/${id}.json`;
}

const PROJECT_TITLE_ACRONYMS = new Map([
  ["ai", "AI"], ["ble", "BLE"], ["cad", "CAD"], ["csv", "CSV"], ["esp32", "ESP32"],
  ["fpv", "FPV"], ["gnss", "GNSS"], ["gps", "GPS"], ["json", "JSON"], ["lcd", "LCD"],
  ["midi", "MIDI"], ["naca", "NACA"], ["nfc", "NFC"], ["oled", "OLED"], ["pc", "PC"],
  ["pir", "PIR"], ["rc", "RC"], ["rgb", "RGB"], ["ros", "ROS"], ["usb", "USB"], ["usb-c", "USB-C"],
  ["wi-fi", "Wi-Fi"], ["wifi", "Wi-Fi"], ["wall-e", "WALL-E"],
  ["xiao", "XIAO"], ["c3", "C3"], ["c5", "C5"], ["c6", "C6"], ["s3", "S3"],
]);
const PROJECT_TITLE_SMALL_WORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "the", "to", "with", "without"]);
const PROJECT_TITLE_GENERIC = /^(?:makeable build|no[- ]build match|minimal starter build|build match|project build|untitled build)$/i;
const PROJECT_TITLE_DANGLING = /\b(?:a|an|and|at|dual|double|for|in|mini|moving|of|on|rotary|single|small|the|tiny|to|using|with|without)$/i;
const PROJECT_COPY_ELLIPSIS = /(?:…|\.\.\.)$/;

export function generatedProjectCopyIssues(plan) {
  const issues = [];
  const rawTitle = cleanSentence(plan?.title, 120);
  const title = readableTitle(rawTitle, "");
  const summary = cleanSentence(plan?.summary);
  const behavior = cleanSentence(plan?.behavior);
  const titleWords = title.split(/\s+/).filter(Boolean);
  const summaryWords = summary.split(/\s+/).filter(Boolean);
  const behaviorWords = behavior.split(/\s+/).filter(Boolean);

  if (!rawTitle || titleWords.length < 2 || titleWords.length > 10 || title.length > 80) issues.push("title_length");
  if (PROJECT_TITLE_GENERIC.test(title)) issues.push("title_generic");
  if (/^(?:i\s+(?:am|want|would)|please\b|make\s+me\b|build\s+me\b|create\s+me\b)/i.test(rawTitle)) issues.push("title_raw_prompt");
  if (PROJECT_TITLE_DANGLING.test(rawTitle)) issues.push("title_incomplete");
  if (/\b(?:development board|module)\b/i.test(rawTitle)
    || /\b(?:buddy|companion|emotion|mood|notifier|monitor)\b.*\bcontroller\b/i.test(rawTitle)) {
    issues.push("title_internal_hardware");
  }
  if (!summary || summaryWords.length < 10 || summary.length > 320) issues.push("summary_length");
  if (summary && (!/[.!?]$/.test(summary) || PROJECT_COPY_ELLIPSIS.test(summary))) issues.push("summary_incomplete");
  if (/\b(?:simple starter build|everyday use|keeps one helpful task easy to see and use)\b/i.test(summary)) issues.push("summary_generic");
  if (!behavior || behaviorWords.length < 8 || behavior.length > 420) issues.push("behavior_length");
  if (behavior && (!/[.!?]$/.test(behavior) || PROJECT_COPY_ELLIPSIS.test(behavior))) issues.push("behavior_incomplete");
  return [...new Set(issues)];
}

// Backward-compatible copy helper for existing callers; atomic build titles
// remain exact and are not run through this optional display utility.
export function beginnerBuildCopy({ title, idea }) {
  const source = clean(title) || clean(idea);
  const text = `${source} ${clean(idea)}`.toLowerCase();
  if (/rubik|cube/.test(text)) return { title: "Puzzle Cube", summary: "A small desk cube that shows a simple pattern or message. It adds a playful touch to your space." };
  if (/(bedside|desk).*(clock|alarm)|(clock|alarm).*(bedside|desk)/.test(text)) return { title: "Compact Bedside Clock", summary: "A compact clock that keeps time easy to see from your desk or bedside. It gives you a clear display at a glance." };
  if (/(desk.*(?:light|lamp)|(?:light|lamp).*desk)/.test(text)) return { title: "Compact Desk Light", summary: "A small desk light that gives your workspace a gentle glow. It is simple to place, use, and enjoy." };
  if (/(plant|soil|moisture)/.test(text)) return { title: "Plant Monitor", summary: "A small helper that lets you know when your plant needs attention. It makes plant care easier to check at a glance." };
  if (/(air quality|air monitor|window air|climate)/.test(text)) return { title: "Air Monitor", summary: "A small display that helps you notice when your room feels stuffy. It makes it easier to know when to open a window." };
  if (/(door|mailbox|chime)/.test(text)) return { title: "Door Chime", summary: "A quiet helper that lets you know when someone arrives. It gives a gentle signal without a loud interruption." };
  if (/(water|bowl|leak|rain)/.test(text)) return { title: "Water Reminder", summary: "A simple reminder that helps you keep an eye on water. It gives you a clear signal when something needs attention." };
  if (/(crypto|price|market)/.test(text)) return { title: "Price Display", summary: "A small desktop display that keeps the numbers you care about easy to check. It gives you a simple update at a glance." };
  const cleanedTitle = readableTitle(source, idea);
  return {
    title: cleanedTitle,
    summary: `A simple ${cleanedTitle.toLowerCase()} you can make for everyday use. It keeps one helpful task easy to see and use.`,
  };
}

function readableTitle(title, idea) {
  const suppliedTitle = clean(title);
  const source = suppliedTitle || clean(idea);
  const words = source
    .replace(/[^a-z0-9'\s-]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  const leadingFillers = new Set(["a", "an", "the", "make", "build", "create", "design"]);
  while (words.length > 2 && leadingFillers.has(words[0].toLowerCase())) words.shift();
  if (!suppliedTitle) words.splice(8);
  while (words.length > 2 && PROJECT_TITLE_DANGLING.test(words.at(-1))) words.pop();
  const result = words.map(titleWordForProject).join(" ");
  return result || "Makeable Build";
}

function titleWordForProject(word, index) {
  const normalized = word.toLowerCase();
  if (PROJECT_TITLE_ACRONYMS.has(normalized)) return PROJECT_TITLE_ACRONYMS.get(normalized);
  if (index > 0 && PROJECT_TITLE_SMALL_WORDS.has(normalized)) return normalized;
  return word.split("-").map((segment) => {
    const key = segment.toLowerCase();
    if (PROJECT_TITLE_ACRONYMS.has(key)) return PROJECT_TITLE_ACRONYMS.get(key);
    return `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  }).join("-");
}

function cleanSentence(value, maxLength = 420) {
  const sentence = clean(value);
  if (sentence.length <= maxLength) return sentence;

  const candidate = sentence.slice(0, maxLength + 1);
  const sentenceEnd = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? "),
  );
  if (sentenceEnd >= Math.floor(maxLength * 0.55)) {
    return candidate.slice(0, sentenceEnd + 1);
  }

  const wordEnd = candidate.lastIndexOf(" ");
  const cutoff = wordEnd >= Math.floor(maxLength * 0.75) ? wordEnd : maxLength;
  return `${candidate.slice(0, cutoff).replace(/[,:;\s]+$/, "")}…`;
}

function cleanStringArray(value, fallback) {
  const array = Array.isArray(value) ? value : fallback;
  return array.map((item) => cleanSentence(item)).filter(Boolean).slice(0, 8);
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function slug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "build";
}

function hash(value) {
  // FNV-1a is sufficient here because the hash only chooses a deterministic
  // fallback artwork; it is not used for authentication or integrity.
  let result = 0x811c9dc5;
  for (const char of String(value)) {
    result ^= char.codePointAt(0) || 0;
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result.toString(16).padStart(8, "0").repeat(8);
}

function fallbackImageForIdea(idea) {
  const index = Number.parseInt(hash(idea).slice(0, 2), 16) % fallbackImages.length;
  return fallbackImages[index];
}
