export const ACACIA_PROGRAM_ID = "nus-acacia";
export const ACACIA_PROGRAM_ALIASES = Object.freeze(["acacia", ACACIA_PROGRAM_ID]);

const ACACIA_DIFFICULTIES = new Set(["beginner", "builder", "advanced"]);
const ACACIA_ROUTE_FAMILIES = new Set(["rules", "connected", "tinyml", "cloud", "hybrid"]);
const ACACIA_ROUTE_STATUSES = new Set(["supported", "reshaped"]);
const ACACIA_PART_POOLS = new Set(["core", "shared"]);

let acaciaRequestSequence = 0;

/**
 * Resolve an Acacia program query (or a bare alias) to its canonical program id.
 * Invalid or unrelated program values return null.
 */
export function parseAcaciaProgram(input = "") {
  return readAcaciaProgramAlias(input) ? ACACIA_PROGRAM_ID : null;
}

/**
 * Build a same-origin relative URL for stage navigation. Every query parameter
 * except a valid Acacia `program` value is deliberately discarded.
 */
export function buildProgramHashUrl(locationLike, hash = "") {
  const location = locationParts(locationLike);
  const alias = readAcaciaProgramAlias(location.search);
  const query = alias ? `?program=${encodeURIComponent(alias)}` : "";
  return `${location.pathname}${query}${normalizeHash(hash)}`;
}

/**
 * Keep the current Acacia alias when present. OAuth callbacks may arrive
 * without the program query, so fall back to the saved pre-auth return URL.
 */
export function buildAcaciaStageUrl(
  currentLocation,
  storedReturnUrl = "",
  hash = "#capture",
) {
  const current = locationParts(currentLocation);
  if (readAcaciaProgramAlias(current.search)) {
    return buildProgramHashUrl(current, hash);
  }

  const stored = locationParts(storedReturnUrl);
  if (readAcaciaProgramAlias(stored.search)) {
    return buildProgramHashUrl(stored, hash);
  }

  return buildProgramHashUrl(
    { ...current, search: "?program=acacia" },
    hash,
  );
}

/**
 * Remove OAuth callback parameters while keeping Acacia program context and the
 * current stage hash. This is suitable for history.replaceState().
 */
export function cleanOAuthCallbackUrl(locationLike, fallbackHash = "#capture") {
  const location = locationParts(locationLike);
  return buildProgramHashUrl(location, location.hash || fallbackHash);
}

/**
 * Create the exact request accepted by the public proposal endpoint. Unknown
 * input fields are never copied, so browser-held API keys or credentials cannot
 * cross this seam.
 */
export function buildAcaciaProposalRequest(input = {}) {
  if (!isRecord(input)) {
    throw new TypeError("The Acacia proposal request must be an object.");
  }

  const idea = cleanText(input.idea);
  if (!idea) throw new TypeError("Describe the idea before requesting an Acacia proposal.");

  const request = { idea };
  const difficulty = normalizeId(input.difficulty ?? input.selectedDifficulty ?? "recommended");
  if (difficulty && difficulty !== "recommended") {
    if (!ACACIA_DIFFICULTIES.has(difficulty)) {
      throw new RangeError("Difficulty must be recommended, beginner, builder, or advanced.");
    }
    request.difficulty = difficulty;
  }

  return deepFreeze(request);
}

/**
 * Validate the public proposal envelope:
 *   { ok: true, proposal, parts: { required, optional } }
 *
 * A direct routeAcaciaIdea envelope using `value` is also accepted so the
 * browser stays resilient across the server boundary.
 */
export function validateAcaciaProposalResponse(response) {
  const issues = [];
  if (!isRecord(response)) {
    return [responseIssue("invalid-response", "response", "The proposal response must be an object.")];
  }

  const forbiddenPath = findApiKeyField(response);
  if (forbiddenPath) {
    issues.push(
      responseIssue(
        "api-key-field-present",
        forbiddenPath,
        "Acacia proposal responses must not contain student API key fields.",
      ),
    );
  }

  if (response.ok !== true) {
    const serverMessage = Array.isArray(response.issues)
      ? response.issues.map((entry) => cleanText(entry?.message)).filter(Boolean).join(" ")
      : "";
    issues.push(
      responseIssue(
        "proposal-not-ok",
        "ok",
        serverMessage || "The backend did not return a successful Acacia proposal.",
      ),
    );
  }

  const { proposal, parts } = extractProposalEnvelope(response);
  validateProposal(proposal, issues);
  validatePartEnvelope(parts, proposal, issues);
  return issues;
}

/**
 * Return a small, immutable browser model. Server-only fields and AI credential
 * policy are intentionally not copied into the browser proposal.
 */
export function normalizeAcaciaProposalResponse(response) {
  const issues = validateAcaciaProposalResponse(response);
  if (issues.length) {
    const error = new TypeError(issues.map(({ message }) => message).join(" "));
    error.name = "AcaciaProposalResponseError";
    error.issues = issues;
    throw error;
  }

  const extracted = extractProposalEnvelope(response);
  const proposal = normalizeProposal(extracted.proposal);
  const rawParts = normalizePartEnvelopeShape(extracted.parts, proposal);
  const required = orderPartRecords(rawParts.required, proposal.hardware.requiredIds);
  const optional = orderPartRecords(rawParts.optional, proposal.hardware.optionalIds);
  const normalized = {
    ok: true,
    proposal,
    parts: {
      required,
      optional,
    },
  };
  normalized.requiredPartsByPool = groupAcaciaRequiredParts(normalized);
  return deepFreeze(normalized);
}

/**
 * Split only the parts required by the selected route. Optional shared-pool
 * extensions are not presented as prerequisites.
 */
export function groupAcaciaRequiredParts(normalizedResponse) {
  const required = Array.isArray(normalizedResponse?.parts?.required)
    ? normalizedResponse.parts.required
    : [];
  return deepFreeze({
    core: required.filter(({ pool }) => pool === "core"),
    shared: required.filter(({ pool }) => pool === "shared"),
  });
}

/**
 * Produce a sequence-backed fingerprint. Sequence order, rather than request
 * content alone, prevents an older response for an identical idea from winning
 * a race against a later request.
 */
export function createAcaciaRequestFingerprint(request) {
  if (acaciaRequestSequence >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("The Acacia request sequence is exhausted.");
  }
  const safeRequest = buildAcaciaProposalRequest(request);
  acaciaRequestSequence += 1;
  return Object.freeze({
    sequence: acaciaRequestSequence,
    signature: hashText(stableStringify(safeRequest)),
  });
}

export function compareAcaciaRequestFingerprints(left, right) {
  const leftSequence = fingerprintSequence(left);
  const rightSequence = fingerprintSequence(right);
  return Math.sign(leftSequence - rightSequence);
}

/**
 * True only for secret-bearing `apiKey`-style property names. Policy fields
 * such as `studentApiKeyRequired: false` are not secret fields.
 */
export function hasApiKeyField(value) {
  return Boolean(findApiKeyField(value));
}

function validateProposal(proposal, issues) {
  if (!isRecord(proposal)) {
    issues.push(
      responseIssue("missing-proposal", "proposal", "A successful response must contain a proposal."),
    );
    return;
  }

  if (proposal.programId !== ACACIA_PROGRAM_ID) {
    issues.push(
      responseIssue(
        "wrong-program",
        "proposal.programId",
        `The proposal programId must be "${ACACIA_PROGRAM_ID}".`,
      ),
    );
  }
  if (proposal.schemaVersion !== 1) {
    issues.push(
      responseIssue(
        "wrong-schema-version",
        "proposal.schemaVersion",
        "The Acacia proposal schemaVersion must be 1.",
      ),
    );
  }
  if (!Number.isInteger(proposal.registryVersion) || proposal.registryVersion < 1) {
    issues.push(
      responseIssue(
        "invalid-registry-version",
        "proposal.registryVersion",
        "The Acacia registryVersion must be a positive integer.",
      ),
    );
  }

  for (const [field, label] of [
    ["originalIdea", "original idea"],
    ["projectTitle", "project title"],
    ["supportedIdea", "supported idea"],
    ["capabilityId", "capability id"],
  ]) {
    if (!cleanText(proposal[field])) {
      issues.push(
        responseIssue(
          `missing-${field}`,
          `proposal.${field}`,
          `The proposal needs a non-empty ${label}.`,
        ),
      );
    }
  }

  if (!ACACIA_ROUTE_STATUSES.has(proposal.routeStatus)) {
    issues.push(
      responseIssue(
        "invalid-route-status",
        "proposal.routeStatus",
        "The proposal routeStatus must be supported or reshaped.",
      ),
    );
  }
  if (!ACACIA_ROUTE_FAMILIES.has(proposal.family)) {
    issues.push(
      responseIssue(
        "invalid-route-family",
        "proposal.family",
        "The proposal route family is not supported.",
      ),
    );
  }
  if (!ACACIA_DIFFICULTIES.has(proposal.difficulty)) {
    issues.push(
      responseIssue(
        "invalid-difficulty",
        "proposal.difficulty",
        "The proposal difficulty is not supported.",
      ),
    );
  }
  if (!ACACIA_DIFFICULTIES.has(proposal.recommendedDifficulty)) {
    issues.push(
      responseIssue(
        "invalid-recommended-difficulty",
        "proposal.recommendedDifficulty",
        "The recommended difficulty is not supported.",
      ),
    );
  }

  if (!isRecord(proposal.hardware)) {
    issues.push(
      responseIssue(
        "missing-hardware",
        "proposal.hardware",
        "The proposal must include its approved hardware selection.",
      ),
    );
  } else {
    validateIdList(proposal.hardware.requiredIds, "proposal.hardware.requiredIds", issues);
    validateIdList(proposal.hardware.optionalIds, "proposal.hardware.optionalIds", issues);
  }

  if (proposal.routeStatus === "reshaped" && !cleanText(proposal.preservation?.change)) {
    issues.push(
      responseIssue(
        "missing-reshape-explanation",
        "proposal.preservation.change",
        "A reshaped proposal must explain what changed.",
      ),
    );
  }
  if (proposal.warnings !== undefined && !Array.isArray(proposal.warnings)) {
    issues.push(
      responseIssue(
        "invalid-warnings",
        "proposal.warnings",
        "Proposal warnings must be an array.",
      ),
    );
  }
}

function validateIdList(value, path, issues) {
  if (!Array.isArray(value) || value.some((id) => !cleanText(id))) {
    issues.push(
      responseIssue("invalid-id-list", path, `${path} must be an array of non-empty IDs.`),
    );
    return;
  }
  const normalized = value.map(normalizeId);
  if (new Set(normalized).size !== normalized.length) {
    issues.push(
      responseIssue("duplicate-part-id", path, `${path} cannot contain duplicate IDs.`),
    );
  }
}

function validatePartEnvelope(parts, proposal, issues) {
  if (!isRecord(proposal?.hardware)) return;
  const normalizedParts = normalizePartEnvelopeShape(parts, proposal);
  if (!normalizedParts) {
    issues.push(
      responseIssue(
        "missing-public-parts",
        "parts",
        "The response must include public required and optional part records.",
      ),
    );
    return;
  }

  validatePartRecords(
    normalizedParts.required,
    proposal.hardware.requiredIds,
    "parts.required",
    issues,
  );
  validatePartRecords(
    normalizedParts.optional,
    proposal.hardware.optionalIds,
    "parts.optional",
    issues,
  );

  if (Array.isArray(normalizedParts.required)) {
    const hasRequiredSharedPart = normalizedParts.required.some(
      (part) => normalizeId(part?.pool) === "shared",
    );
    if (proposal.hardware.sharedPoolRequired !== hasRequiredSharedPart) {
      issues.push(
        responseIssue(
          "shared-pool-requirement-mismatch",
          "parts.required",
          "Required part pools do not match the proposal shared-pool requirement.",
        ),
      );
    }
  }
  if (Array.isArray(normalizedParts.optional)) {
    const hasOptionalSharedPart = normalizedParts.optional.some(
      (part) => normalizeId(part?.pool) === "shared",
    );
    if (proposal.hardware.sharedPoolOptional !== hasOptionalSharedPart) {
      issues.push(
        responseIssue(
          "shared-pool-option-mismatch",
          "parts.optional",
          "Optional part pools do not match the proposal shared-pool option.",
        ),
      );
    }
  }
}

function validatePartRecords(records, expectedIds, path, issues) {
  if (!Array.isArray(records)) {
    issues.push(
      responseIssue("invalid-part-records", path, `${path} must be an array of public part records.`),
    );
    return;
  }
  const expected = Array.isArray(expectedIds) ? expectedIds.map(normalizeId) : [];
  const seen = new Set();

  records.forEach((part, index) => {
    const partPath = `${path}[${index}]`;
    if (!isRecord(part)) {
      issues.push(
        responseIssue("invalid-part-record", partPath, "Every public part record must be an object."),
      );
      return;
    }
    const id = normalizeId(part.id);
    if (!id) {
      issues.push(responseIssue("missing-part-id", `${partPath}.id`, "A public part needs an id."));
    } else if (seen.has(id)) {
      issues.push(
        responseIssue("duplicate-public-part", `${partPath}.id`, `"${id}" is listed more than once.`),
      );
    }
    seen.add(id);
    if (!cleanText(part.label)) {
      issues.push(
        responseIssue("missing-part-label", `${partPath}.label`, `"${id}" needs a public label.`),
      );
    }
    if (!ACACIA_PART_POOLS.has(normalizeId(part.pool))) {
      issues.push(
        responseIssue(
          "invalid-part-pool",
          `${partPath}.pool`,
          `"${id}" must belong to the core or shared pool.`,
        ),
      );
    }
    if (
      part.quantity !== undefined &&
      (!Number.isInteger(part.quantity) || part.quantity < 1)
    ) {
      issues.push(
        responseIssue(
          "invalid-part-quantity",
          `${partPath}.quantity`,
          `"${id}" must have a positive whole-number quantity.`,
        ),
      );
    }
    if (part.availability !== undefined && !cleanText(part.availability)) {
      issues.push(
        responseIssue(
          "invalid-part-availability",
          `${partPath}.availability`,
          `"${id}" needs a non-empty availability label.`,
        ),
      );
    }
  });

  for (const id of expected) {
    if (!seen.has(id)) {
      issues.push(
        responseIssue("missing-public-part", path, `The public record for "${id}" is missing.`),
      );
    }
  }
  for (const id of seen) {
    if (id && !expected.includes(id)) {
      issues.push(
        responseIssue("unexpected-public-part", path, `"${id}" is not selected in the proposal.`),
      );
    }
  }
}

function normalizeProposal(proposal) {
  const normalized = {
    schemaVersion: proposal.schemaVersion,
    programId: proposal.programId,
    registryVersion: proposal.registryVersion,
    originalIdea: cleanText(proposal.originalIdea),
    projectTitle: cleanText(proposal.projectTitle),
    supportedIdea: cleanText(proposal.supportedIdea),
    routeStatus: proposal.routeStatus,
    family: proposal.family,
    difficulty: proposal.difficulty,
    recommendedDifficulty: proposal.recommendedDifficulty,
    capabilityId: cleanText(proposal.capabilityId),
    hardware: {
      boardId: normalizeId(proposal.hardware.boardId),
      requiredIds: proposal.hardware.requiredIds.map(normalizeId),
      optionalIds: proposal.hardware.optionalIds.map(normalizeId),
      sharedPoolRequired: proposal.hardware.sharedPoolRequired === true,
      sharedPoolOptional: proposal.hardware.sharedPoolOptional === true,
    },
    preservation: {
      originalGoal: cleanText(proposal.preservation?.originalGoal || proposal.originalIdea),
      change: cleanNullableText(proposal.preservation?.change),
      reason: cleanNullableText(proposal.preservation?.reason),
    },
    warnings: (proposal.warnings || []).map((warning) => ({
      code: normalizeId(warning?.code),
      message: cleanText(warning?.message),
    })).filter(({ code, message }) => code || message),
  };
  const planId = cleanText(proposal.planId);
  if (planId) normalized.planId = planId;
  return normalized;
}

function normalizePartRecord(part) {
  const normalized = {
    id: normalizeId(part.id),
    label: cleanText(part.label),
    pool: normalizeId(part.pool),
    kind: cleanText(part.kind),
    interface: cleanText(part.interface),
    power: cleanText(part.power),
  };
  const signals = Array.isArray(part.signals)
    ? part.signals.map(cleanText).filter(Boolean)
    : [];
  if (signals.length) normalized.signals = unique(signals);
  if (Number.isInteger(part.quantity) && part.quantity > 0) {
    normalized.quantity = part.quantity;
  }
  const availability = cleanText(part.availability);
  if (availability) normalized.availability = availability;
  return normalized;
}

function orderPartRecords(records, orderedIds) {
  const byId = new Map(records.map((part) => [normalizeId(part.id), normalizePartRecord(part)]));
  return orderedIds.map((id) => byId.get(id));
}

function normalizePartEnvelopeShape(parts, proposal) {
  if (Array.isArray(parts)) {
    const requiredIds = new Set((proposal?.hardware?.requiredIds || []).map(normalizeId));
    const optionalIds = new Set((proposal?.hardware?.optionalIds || []).map(normalizeId));
    return {
      required: parts.filter((part) => requiredIds.has(normalizeId(part?.id))),
      optional: parts.filter((part) => optionalIds.has(normalizeId(part?.id))),
    };
  }
  if (!isRecord(parts)) return null;
  return {
    required: parts.required,
    optional: parts.optional,
  };
}

function extractProposalEnvelope(response) {
  const nestedEnvelope = isRecord(response?.value) && isRecord(response.value.proposal)
    ? response.value
    : null;
  const proposal =
    response?.proposal ??
    nestedEnvelope?.proposal ??
    response?.route ??
    (isRecord(response?.value) ? response.value : null);
  const parts =
    response?.parts ??
    nestedEnvelope?.parts ??
    response?.publicParts ??
    proposal?.parts ??
    null;
  return { proposal, parts };
}

function readAcaciaProgramAlias(input) {
  if (typeof input === "string") {
    const direct = normalizeId(input);
    if (ACACIA_PROGRAM_ALIASES.includes(direct)) return direct;
  }
  const params = searchParamsFrom(input);
  const alias = normalizeId(params?.get("program"));
  return ACACIA_PROGRAM_ALIASES.includes(alias) ? alias : null;
}

function searchParamsFrom(input) {
  if (typeof URLSearchParams !== "undefined" && input instanceof URLSearchParams) return input;
  if (typeof URL !== "undefined" && input instanceof URL) return input.searchParams;
  if (isRecord(input) && typeof input.search === "string") {
    return new URLSearchParams(input.search);
  }
  if (typeof input !== "string") return new URLSearchParams();

  const text = input.trim();
  if (!text) return new URLSearchParams();
  if (text.startsWith("?")) return new URLSearchParams(text);
  if (!/[/?#]/.test(text) && text.includes("=")) return new URLSearchParams(text);
  try {
    return new URL(text, "https://makeable.invalid").searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function locationParts(input) {
  if (typeof URL !== "undefined" && input instanceof URL) {
    return { pathname: input.pathname || "/", search: input.search, hash: input.hash };
  }
  if (isRecord(input)) {
    return {
      pathname: cleanPathname(input.pathname),
      search: typeof input.search === "string" ? input.search : "",
      hash: typeof input.hash === "string" ? input.hash : "",
    };
  }
  try {
    const url = new URL(String(input || "/"), "https://makeable.invalid");
    return { pathname: cleanPathname(url.pathname), search: url.search, hash: url.hash };
  } catch {
    return { pathname: "/", search: "", hash: "" };
  }
}

function cleanPathname(value) {
  const pathname = String(value || "/").trim();
  if (!pathname) return "/";
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function normalizeHash(value) {
  const hash = String(value || "").trim();
  if (!hash || hash === "#") return "";
  return hash.startsWith("#") ? hash : `#${hash}`;
}

function findApiKeyField(value, path = "response", seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedKey.endsWith("apikey")) return `${path}.${key}`;
    const childPath = findApiKeyField(child, `${path}.${key}`, seen);
    if (childPath) return childPath;
  }
  return null;
}

function fingerprintSequence(value) {
  const sequence = Number(value?.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new TypeError("An Acacia request fingerprint needs a positive sequence.");
  }
  return sequence;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashText(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function responseIssue(code, path, message) {
  return Object.freeze({ code, path, message });
}

function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function cleanNullableText(value) {
  const text = cleanText(value);
  return text || null;
}

function normalizeId(value) {
  return cleanText(value).toLowerCase();
}

function unique(values) {
  return [...new Set(values)];
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
