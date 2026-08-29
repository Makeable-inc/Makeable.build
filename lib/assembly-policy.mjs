export const BREADBOARD_POLICY = Object.freeze({
  id: "no-breadboards-v1",
  state: "enforced",
  reason: "Breadboards are prohibited. Use exact factory connectors, a verified expansion board, or direct pin-to-pin factory leads.",
});

const BANNED_ASSET_IDS = new Set([
  "adafruit-half-size-breadboard-64",
]);

export function isBreadboardLike(value) {
  const text = typeof value === "string"
    ? value
    : `${value?.id || ""} ${value?.partId || ""} ${value?.assetId || ""} ${value?.name || ""} ${value?.label || ""} ${value?.connectionReadiness || ""}`;
  return /breadboard|solderless_breadboard/i.test(text)
    || BANNED_ASSET_IDS.has(value?.id)
    || BANNED_ASSET_IDS.has(value?.partId)
    || BANNED_ASSET_IDS.has(value?.assetId);
}

export function applyAssemblyPolicy(asset) {
  if (!isBreadboardLike(asset)) return asset;
  return {
    ...asset,
    ready: false,
    selectionStatus: "blocked",
    blocker: "policy_breadboard_banned",
  };
}

export function assertNoBreadboards(contract) {
  const offenders = [
    ...(contract?.requiredAssets || []),
    ...(contract?.parts || []),
    ...(contract?.wires || []).flatMap((wire) => [wire?.from, wire?.to]),
  ].filter(isBreadboardLike);
  if (offenders.length) {
    throw new Error(`Assembly violates ${BREADBOARD_POLICY.id}: ${offenders.map((item) => item.id || item.partId || item.label).join(", ")}`);
  }
  return contract;
}

export function assertDirectWiring(contract) {
  assertNoBreadboards(contract);
  const allowedKinds = new Set(["verified-part-pin", "verified-keyed-connector-contact"]);
  for (const wire of contract?.wires || []) {
    for (const [side, endpoint] of [["from", wire?.from], ["to", wire?.to]]) {
      if (!endpoint?.partId || !allowedKinds.has(endpoint.kind)) {
        throw new Error(`Wire ${wire?.id || "unknown"} has a non-direct ${side} endpoint.`);
      }
      if (!Array.isArray(endpoint.position) || endpoint.position.length !== 3 || !endpoint.position.every(Number.isFinite)) {
        throw new Error(`Wire ${wire?.id || "unknown"} has an invalid ${side} position.`);
      }
    }
  }
  return contract;
}
