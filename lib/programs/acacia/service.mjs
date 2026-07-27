import { createHash } from "node:crypto";

import { createAcaciaBuildPlan, validateAcaciaBuildPlan } from "./build-plan.mjs";
import {
  ACACIA_DIFFICULTIES,
  ACACIA_REGISTRY_VERSION,
  acaciaProgramManifest,
  getAcaciaHardware,
  listAcaciaHardware,
} from "./registry.mjs";
import { listAcaciaCapabilities } from "./capabilities.mjs";
import { routeAcaciaIdea } from "./router.mjs";

export const ACACIA_API_BODY_MAX_BYTES = 16 * 1024;

const PROPOSAL_FIELDS = Object.freeze(["idea", "difficulty"]);
const ACCEPT_FIELDS = Object.freeze(["idea", "difficulty", "registryVersion"]);
const PLAN_ID_PATTERN = /^acacia_[a-f0-9]{24}$/;

export function createAcaciaProgramResponse() {
  return deepFreeze({
    ok: true,
    schemaVersion: 1,
    program: acaciaProgramManifest(),
    difficultyOptions: [...ACACIA_DIFFICULTIES],
    capabilities: listAcaciaCapabilities().map((capability) => ({
      id: capability.id,
      label: capability.label,
      family: capability.family,
      difficulty: capability.difficulty,
      supportedIdea: capability.supportedIdea,
    })),
    hardware: listAcaciaHardware().map(publicPart),
  });
}

export function createAcaciaProposal(request) {
  const requestResult = normalizeProposalRequest(request);
  if (!requestResult.ok) return requestResult;

  const routeResult = routeAcaciaIdea(requestResult.value);
  if (!routeResult.ok) {
    return failure({
      status: 400,
      code: "INVALID_ACACIA_IDEA",
      error: "The idea could not be routed through the Acacia kit.",
      issues: routeResult.issues,
    });
  }

  const proposal = proposalFromRoute(routeResult.value);
  return deepFreeze({
    ok: true,
    proposal,
    parts: publicPartsForRoute(routeResult.value),
  });
}

export function acceptAcaciaProposal(planId, request) {
  const planIdIssues = validatePlanId(planId);
  const requestResult = normalizeAcceptRequest(request);
  const issues = [...planIdIssues, ...(requestResult.ok ? [] : requestResult.issues)];
  if (issues.length) {
    return failure({
      status: 400,
      code: "INVALID_ACACIA_ACCEPT_REQUEST",
      error: "The Acacia plan acceptance request is invalid.",
      issues,
    });
  }

  if (requestResult.value.registryVersion !== ACACIA_REGISTRY_VERSION) {
    return failure({
      status: 409,
      code: "STALE_ACACIA_REGISTRY",
      error: "The Acacia kit registry changed. Review a fresh proposal before building.",
      issues: [
        issue(
          "stale-registry-version",
          "registryVersion",
          `Expected registry version ${ACACIA_REGISTRY_VERSION}.`,
        ),
      ],
    });
  }

  const routeResult = routeAcaciaIdea({
    idea: requestResult.value.idea,
    ...(requestResult.value.difficulty
      ? { difficulty: requestResult.value.difficulty }
      : {}),
  });
  if (!routeResult.ok) {
    return failure({
      status: 400,
      code: "INVALID_ACACIA_IDEA",
      error: "The idea could not be routed through the Acacia kit.",
      issues: routeResult.issues,
    });
  }

  const proposal = proposalFromRoute(routeResult.value);
  if (proposal.planId !== planId) {
    return failure({
      status: 409,
      code: "ACACIA_PROPOSAL_CHANGED",
      error: "This proposal no longer matches the idea and difficulty. Review the updated plan.",
      issues: [
        issue(
          "proposal-digest-mismatch",
          "planId",
          "The submitted plan ID does not match the canonical Acacia route.",
        ),
      ],
    });
  }

  const buildPlan = createAcaciaBuildPlan(routeResult.value);
  const buildPlanIssues = validateAcaciaBuildPlan(buildPlan, routeResult.value);
  if (buildPlanIssues.length) {
    return failure({
      status: 500,
      code: "INVALID_ACACIA_BUILD_PLAN",
      error: "Makeable could not create a safe Acacia build plan.",
    });
  }

  return deepFreeze({
    ok: true,
    planId: proposal.planId,
    proposal,
    buildPlan,
  });
}

export function acaciaPlanIdForRoute(route) {
  const canonicalRoute = {
    programId: route?.programId,
    registryVersion: route?.registryVersion,
    originalIdea: cleanText(route?.originalIdea),
    routeStatus: route?.routeStatus,
    family: route?.family,
    difficulty: route?.difficulty,
    recommendedDifficulty: route?.recommendedDifficulty,
    capabilityId: route?.capabilityId,
    supportedIdea: cleanText(route?.supportedIdea),
    requiredHardwareIds: sortedStrings(route?.hardware?.requiredIds),
    optionalHardwareIds: sortedStrings(route?.hardware?.optionalIds),
    preservation: {
      change: cleanText(route?.preservation?.change) || null,
      reason: cleanText(route?.preservation?.reason) || null,
    },
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(canonicalRoute), "utf8")
    .digest("hex");
  return `acacia_${digest.slice(0, 24)}`;
}

export function validateAcaciaProposalRequest(request) {
  const result = normalizeProposalRequest(request);
  return result.ok ? [] : result.issues;
}

export function validateAcaciaAcceptRequest(request) {
  const result = normalizeAcceptRequest(request);
  return result.ok ? [] : result.issues;
}

function proposalFromRoute(route) {
  return deepFreeze({
    planId: acaciaPlanIdForRoute(route),
    schemaVersion: route.schemaVersion,
    programId: route.programId,
    registryVersion: route.registryVersion,
    originalIdea: route.originalIdea,
    projectTitle: route.projectTitle,
    supportedIdea: route.supportedIdea,
    routeStatus: route.routeStatus,
    family: route.family,
    difficulty: route.difficulty,
    recommendedDifficulty: route.recommendedDifficulty,
    capabilityId: route.capabilityId,
    hardware: route.hardware,
    preservation: route.preservation,
    ai: route.ai,
    warnings: route.warnings,
  });
}

function publicPartsForRoute(route) {
  return deepFreeze({
    required: route.hardware.requiredIds.map(partForId),
    optional: route.hardware.optionalIds.map(partForId),
  });
}

function partForId(hardwareId) {
  const part = getAcaciaHardware(hardwareId);
  if (!part) {
    throw new Error(`Acacia route references unknown hardware "${hardwareId}".`);
  }
  return publicPart(part);
}

function publicPart(part) {
  return {
    id: part.id,
    label: part.label,
    quantity: 1,
    pool: part.pool,
    availability: part.pool === "shared" ? "checkout_required" : "included",
    kind: part.kind,
    interface: part.interface,
    power: part.power,
    ...(Array.isArray(part.safetyNotes)
      ? { safetyNotes: [...part.safetyNotes] }
      : {}),
  };
}

function normalizeProposalRequest(request) {
  const commonResult = normalizeCommonRequest(request, PROPOSAL_FIELDS);
  if (!commonResult.ok) {
    return failure({
      status: 400,
      code: "INVALID_ACACIA_PROPOSAL_REQUEST",
      error: "The Acacia proposal request is invalid.",
      issues: commonResult.issues,
    });
  }
  return {
    ok: true,
    value: {
      idea: commonResult.value.idea,
      ...(commonResult.value.difficulty
        ? { difficulty: commonResult.value.difficulty }
        : {}),
    },
  };
}

function normalizeAcceptRequest(request) {
  const commonResult = normalizeCommonRequest(request, ACCEPT_FIELDS);
  const issues = commonResult.ok ? [] : [...commonResult.issues];
  const registryVersion = request?.registryVersion;
  if (
    isPlainObject(request) &&
    (!Number.isInteger(registryVersion) || registryVersion < 1)
  ) {
    issues.push(
      issue(
        "invalid-registry-version",
        "registryVersion",
        "registryVersion must be a positive integer.",
      ),
    );
  }
  if (issues.length) {
    return failure({
      status: 400,
      code: "INVALID_ACACIA_ACCEPT_REQUEST",
      error: "The Acacia plan acceptance request is invalid.",
      issues: uniqueIssues(issues),
    });
  }
  return {
    ok: true,
    value: {
      ...commonResult.value,
      registryVersion,
    },
  };
}

function normalizeCommonRequest(request, allowedFields) {
  if (!isPlainObject(request)) {
    return {
      ok: false,
      issues: [
        issue("invalid-request", "request", "The request body must be a JSON object."),
      ],
    };
  }

  const issues = [];
  if (hasForbiddenApiKeyField(request)) {
    issues.push(
      issue(
        "student-api-key-not-accepted",
        "request",
        "Acacia uses Makeable-managed AI; do not submit an API key.",
      ),
    );
  }
  for (const field of Object.keys(request)) {
    if (!allowedFields.includes(field)) {
      issues.push(
        issue(
          "unknown-field",
          field,
          `"${field}" is not accepted by this Acacia endpoint.`,
        ),
      );
    }
  }

  const idea = cleanText(request.idea);
  if (typeof request.idea !== "string") {
    issues.push(issue("invalid-idea", "idea", "idea must be a string."));
  } else if (idea.length < 5) {
    issues.push(
      issue("idea-too-short", "idea", "Describe the idea using at least 5 characters."),
    );
  } else if (idea.length > 1_000) {
    issues.push(
      issue("idea-too-long", "idea", "Keep the idea at or below 1,000 characters."),
    );
  }

  const difficulty = normalizeDifficulty(request.difficulty);
  if (request.difficulty !== undefined && difficulty === null) {
    issues.push(
      issue(
        "unknown-difficulty",
        "difficulty",
        `difficulty must be "recommended" or one of: ${ACACIA_DIFFICULTIES.join(", ")}.`,
      ),
    );
  }

  return issues.length
    ? { ok: false, issues: uniqueIssues(issues) }
    : {
        ok: true,
        value: {
          idea,
          ...(difficulty ? { difficulty } : {}),
        },
      };
}

function validatePlanId(planId) {
  return PLAN_ID_PATTERN.test(String(planId || ""))
    ? []
    : [
        issue(
          "invalid-plan-id",
          "planId",
          "planId must be a canonical Acacia proposal ID.",
        ),
      ];
}

function normalizeDifficulty(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "recommended") return undefined;
  return ACACIA_DIFFICULTIES.includes(normalized) ? normalized : null;
}

function failure({ status, code, error, issues = [] }) {
  return deepFreeze({
    ok: false,
    status,
    code,
    error,
    ...(issues.length ? { issues: uniqueIssues(issues) } : {}),
  });
}

function issue(code, path, message) {
  return { code, path, message };
}

function uniqueIssues(issues) {
  const seen = new Set();
  return issues.filter((entry) => {
    const fingerprint = `${entry.code}:${entry.path}:${entry.message}`;
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasForbiddenApiKeyField(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (/(?:^|[-_ ])api[-_ ]?key$|apikey$/i.test(key)) return true;
    if (hasForbiddenApiKeyField(child, seen)) return true;
  }
  return false;
}

function sortedStrings(values) {
  return Array.isArray(values)
    ? [...values].map((value) => String(value)).sort()
    : [];
}

function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
