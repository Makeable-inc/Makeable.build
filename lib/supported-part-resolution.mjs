const MAX_NEGOTIATION_ATTEMPTS = 3;
const MAX_CLARIFICATION_LENGTH = 800;

const CATEGORY_KEYWORDS = Object.freeze({
  actuator: ["actuator", "motor", "servo", "wheel", "pump", "valve"],
  controller: ["controller", "esp32", "microcontroller", "development board", "dev board"],
  display: ["display", "screen", "lcd", "oled", "amoled", "touchscreen"],
  input: ["input", "button", "switch", "knob", "encoder", "joystick"],
  output: ["output", "buzzer", "speaker", "led", "light", "alarm"],
  sensor: ["sensor", "temperature", "humidity", "pressure", "co2", "motion", "presence", "soil", "water", "light", "distance", "radar", "gps", "gnss"],
});

export function createSupportedPartsCatalog(parts, releaseManifest) {
  const assetById = new Map((releaseManifest?.assets || []).map((asset) => [String(asset.partId), asset]));
  return {
    schemaVersion: "MakeableSupportedPartsCatalogV1",
    productionRevision: String(releaseManifest?.revision || "unknown"),
    count: (parts || []).length,
    parts: (parts || []).map((part) => {
      const primaryAssetId = String(part.assemblyAssetIds?.[0] || "");
      const asset = assetById.get(primaryAssetId);
      const requiredAssetIds = [...new Set([
        ...(part.assemblyAssetIds || []),
        part.controllerCarrierAssetId,
        ...(part.assemblyInterfaces || []).flatMap((entry) => entry.compilerInjectedAccessoryAssetIds || []),
      ].map(String).filter(Boolean))];
      return {
        catalogId: String(part.id),
        name: String(part.name || part.subtype || part.id),
        category: String(part.category || "part"),
        subtype: String(part.subtype || ""),
        requestAliases: [...new Set((part.requestAliases || []).map(String).filter(Boolean))],
        assemblyAssetIds: [...new Set((part.assemblyAssetIds || []).map(String).filter(Boolean))],
        carrierAssetId: String(part.controllerCarrierAssetId || ""),
        status: "one-shot-ready",
        aws: asset ? { url: String(asset.url || ""), sha256: String(asset.sha256 || "") } : null,
        awsAssets: requiredAssetIds.map((assetId) => {
          const requiredAsset = assetById.get(assetId);
          return requiredAsset ? {
            partId: assetId,
            url: String(requiredAsset.url || ""),
            sha256: String(requiredAsset.sha256 || ""),
          } : null;
        }).filter(Boolean),
      };
    }),
  };
}

export function normalizeNegotiationInput(input, supportedParts) {
  const attemptValue = Number(input?.negotiationAttempt || 1);
  const attempt = Number.isInteger(attemptValue) && attemptValue >= 1 && attemptValue <= MAX_NEGOTIATION_ATTEMPTS
    ? attemptValue
    : 1;
  const clarification = String(input?.clarification || "").trim().slice(0, MAX_CLARIFICATION_LENGTH);
  const supportedById = new Map((supportedParts || []).map((part) => [String(part.id || part.catalogId), part]));
  const substitutions = [];
  for (const candidate of Array.isArray(input?.substitutions) ? input.substitutions : []) {
    if (substitutions.length >= 12) break;
    const unsupportedCatalogId = String(candidate?.unsupportedCatalogId || "").trim();
    const replacementCatalogId = String(candidate?.replacementCatalogId || "").trim();
    const replacement = supportedById.get(replacementCatalogId);
    if (!unsupportedCatalogId || !replacement || unsupportedCatalogId === replacementCatalogId) continue;
    if (substitutions.some((item) => item.unsupportedCatalogId === unsupportedCatalogId)) continue;
    substitutions.push({ unsupportedCatalogId, replacementCatalogId, replacement });
  }
  return { attempt, clarification, substitutions };
}

export function applyApprovedSubstitutions(idea, negotiation) {
  const lines = negotiation.substitutions.map(({ unsupportedCatalogId, replacementCatalogId, replacement }) => (
    `- Replace unsupported catalog ID ${unsupportedCatalogId} with exact supported catalog ID ${replacementCatalogId}: ${replacement.name || replacement.subtype || replacementCatalogId}.`
  ));
  const sections = [String(idea || "").trim()];
  if (lines.length) {
    sections.push([
      "USER-APPROVED PART REPLACEMENTS (these explicit choices override only the matching unsupported identities in the original request):",
      ...lines,
    ].join("\n"));
  }
  if (negotiation.clarification) {
    sections.push(`USER CLARIFICATION FOR THIS RETRY:\n${negotiation.clarification}`);
  }
  return sections.filter(Boolean).join("\n\n");
}

export function unresolvedPartFailures(failures, negotiation) {
  const approved = new Set(negotiation.substitutions.map((item) => item.unsupportedCatalogId));
  return (failures || []).filter((failure) => !approved.has(String(failure.catalogId)));
}

export function replacementCategoryAllowed(unsupportedPart, replacementPart) {
  if (!unsupportedPart || !replacementPart) return false;
  const allowed = alternativeCategories(String(unsupportedPart.category || ""), {
    name: unsupportedPart.name,
    reason: unsupportedPart.breakoutResearch?.blocker || unsupportedPart.notes || "",
  });
  return allowed.includes(String(replacementPart.category || ""));
}

export function buildSupportedPartResolution({
  idea,
  attempt = 1,
  failures = [],
  supportedParts = [],
  code = "project_not_supported_yet",
}) {
  const boundedAttempt = Math.max(1, Math.min(MAX_NEGOTIATION_ATTEMPTS, Number(attempt) || 1));
  const exhausted = boundedAttempt >= MAX_NEGOTIATION_ATTEMPTS;
  const uniqueFailures = [...new Map((failures || []).map((failure) => [String(failure.catalogId || failure.name || failure.reason), failure])).values()];
  const unsupported = uniqueFailures.map((failure) => ({
    catalogId: String(failure.catalogId || "requested-part"),
    name: String(failure.name || "Requested part"),
    reason: friendlyUnsupportedReason(failure.reason),
    alternatives: exhausted ? [] : rankAlternatives({ idea, failure, supportedParts }).slice(0, 3),
  }));
  if (!unsupported.length) {
    unsupported.push({
      catalogId: "project-request",
      name: "This project setup",
      reason: friendlyUnsupportedReason(code),
      alternatives: exhausted ? [] : rankAlternatives({ idea, failure: {}, supportedParts }).slice(0, 3),
    });
  }
  return {
    schemaVersion: "MakeableSupportedPartResolutionV1",
    status: exhausted ? "unable-after-three-attempts" : "needs-user-choice",
    attempt: boundedAttempt,
    maxAttempts: MAX_NEGOTIATION_ATTEMPTS,
    title: exhausted ? "We could not make a reliable wiring guide" : "Let’s adjust one of the parts",
    message: exhausted
      ? "We tried three versions, but this exact setup still cannot be connected reliably with the supported parts. Start a new request or choose simpler requirements."
      : "That exact part is not ready for a reliable wiring guide yet. Choose a supported alternative below, or tell us what matters most and we’ll try again.",
    question: exhausted ? "" : "Which supported option should we use instead?",
    code,
    unsupported,
    allowClarification: !exhausted,
  };
}

export function friendlyUnsupportedReason(reason) {
  const value = String(reason || "").toLowerCase();
  if (/carrier|expansion|mount|socket/.test(value)) return "Its expansion-board setup is not fully ready yet.";
  if (/connector|harness|cable|contact|endpoint|header|pitch|geometry/.test(value)) return "Its pin or connector layout is not fully ready yet.";
  if (/power|voltage|current|rail|logic level/.test(value)) return "Its power setup is not fully verified for this circuit yet.";
  if (/capabilit|semantic|fulfillment|missing/.test(value)) return "The supported catalog cannot yet cover every requested job in this setup.";
  if (/remediation|unfinished|deferred|not.ready|not_ready/.test(value)) return "Its one-shot wiring setup is still being completed.";
  return "It has not completed all one-shot wiring checks yet.";
}

function rankAlternatives({ idea, failure, supportedParts }) {
  const requestedCategory = String(failure.category || inferCategory(`${failure.name || ""} ${idea || ""}`));
  const allowedCategories = alternativeCategories(requestedCategory, failure);
  const carrierFallback = ["accessory", "connector"].includes(requestedCategory)
    && /carrier|expansion|breakout/.test(`${failure?.name || ""} ${failure?.reason || ""}`.toLowerCase());
  const tokens = searchTokens(`${failure.name || ""} ${idea || ""}`);
  return (supportedParts || [])
    .filter((part) => String(part.id || part.catalogId) !== String(failure.catalogId || ""))
    .filter((part) => !allowedCategories.length || allowedCategories.includes(String(part.category || "part")))
    .filter((part) => !carrierFallback || Boolean(part.controllerCarrierAssetId || part.carrierAssetId))
    .map((part) => {
      const id = String(part.id || part.catalogId);
      const name = String(part.name || part.subtype || id);
      const category = String(part.category || "part");
      const haystack = searchTokens([name, part.subtype, ...(part.requestAliases || [])].join(" "));
      const overlap = [...tokens].filter((token) => haystack.has(token)).length;
      const categoryMatch = allowedCategories.includes(category) ? 1 : 0;
      return {
        catalogId: id,
        name,
        category,
        score: categoryMatch * 100 + overlap * 10 + (part.status === "one-shot-ready" ? 1 : 0),
      };
    })
    .filter((candidate) => candidate.score > 1 || !requestedCategory)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .map(({ score: _score, ...candidate }) => ({
      ...candidate,
      whyItFits: `A supported ${plainCategory(candidate.category)} with verified connection points.`,
    }));
}

function alternativeCategories(requestedCategory, failure) {
  const identity = `${failure?.name || ""} ${failure?.reason || ""}`.toLowerCase();
  if (["accessory", "connector"].includes(requestedCategory) && /carrier|expansion|breakout/.test(identity)) {
    // Carrier boards are compiler-owned in the production catalog. Offer a
    // ready controller whose exact compatible carrier will be injected, not a
    // visually similar standalone board.
    return ["controller"];
  }
  return requestedCategory ? [requestedCategory] : [];
}

function inferCategory(text) {
  const normalized = String(text || "").toLowerCase();
  let best = "";
  let bestScore = 0;
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = words.filter((word) => normalized.includes(word)).length;
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return best;
}

function searchTokens(value) {
  return new Set(String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((token) => token.length >= 3));
}

function plainCategory(category) {
  return ({ actuator: "motion part", controller: "controller", display: "display", input: "control", output: "output part", sensor: "sensor" })[category] || "part";
}

export { MAX_NEGOTIATION_ATTEMPTS };
