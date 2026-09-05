import { createHash } from "node:crypto";

export const INTERFACE_PROFILE_SCHEMA_VERSION = "MakeableInterfaceProfileV1";
export const PROMPT2CIRCUIT_BATCH_SIZE = 10;
export const RETIRED_ASSET_IDS = Object.freeze([
  "adafruit-half-size-breadboard-64",
  "lcd1602-keypad",
  "diyables-tlc555i-soil-moisture-b0dydn9rg4"
]);
export const PROMPT2CIRCUIT_ACTIVE_ASSET_COUNT = 91;

export const FOUNDATION_ASSET_IDS = Object.freeze([
  "adafruit-scd41-co2-breakout-5190",
  "seeed-xiao-esp32c3",
  "aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1",
  "aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx",
  "seeed-xiao-expansion-base-103030356",
  "adafruit-4397-qwiic-to-female-sockets",
  "thing-plus-esp32",
  "adafruit-tsl2591-hdr-light-breakout-1980",
  "diyables-capacitive-soil-moisture-tlc555i",
  "fs90r-paired-wheel-kit"
]);

const QWIIC_SIGNALS = Object.freeze(["GND", "3V3", "SDA", "SCL"]);
const S3_CARRIER_ASSET_ID = "aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx";
const S3_CARRIER_ASSET_SHA256 = "aec8e5e6e81deb28f3a1da8ab56a76aba0429501964e7c86227cef0e4006a9da";
const S3_MIRRORED_5V_NODE_NAME = "connector:left-breakout:5V:signal-inner:pin";
const MIRRORED_POWER_CONTACT_CLASS = "mirrored_controller_power_contact";
const INTEGRATED_CONTROLLER_ASSET_IDS = new Set([
  "esp32-2432s028r-smart-display",
  "esp32-0-96-oled-integrated-board",
  "esp32-c5-lcd-dev-board",
  "esp32-c6-1-3inch-lcd-display-development-board-with-pre-soldered-header",
  "esp32-c6-1-47inch-ips-touch-display-development-board-with-pre-soldered-header",
  "esp32-camera-board",
  "esp32-s3-cam-dev-kit-exact-pre-soldered-header-variant",
  "esp-wroom-32-multi-pack",
  "waveshare-esp32-s3-1-91-amoled-display-board",
  "waveshare-esp32-s3-eth-ov5640-camera-board"
]);
const CONNECTOR_BREAKOUT_ASSET_IDS = new Set([
  // This is a populated micro:bit breakout board, not a cable. Its 2x11
  // micro:bit header cannot become an ESP32 carrier or a compiler-injected
  // Qwiic cable merely because the marketplace category says connector.
  "sparkfun-qwiic-compatible-with-micro-bit-breakout-with-headers"
]);

// These are physical controller-to-carrier mating contracts, not project recipes.
// The seat values are hash-bound evidence from the populated breakout review and
// are interpreted against the controller GLB bounds by the placement compiler.
const CARRIER_MOUNT_CONTRACTS = Object.freeze({
  "aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1": Object.freeze([{
    assetSha256: "89a684174c1de207fd64a331e5a8bb894e63fcca75a2dcb4175ec44985bd5c98",
    id: "controller-socket-2x8",
    kind: "controller-carrier",
    compatibleAssetIds: ["aoicrie-4pcs-esp32-esp32-c3-mini-development-board-pre-soldered"],
    carrierConnectorIds: ["controller-left-1x8", "controller-right-1x8"],
    transformMethod: "align-matching-contact-frames",
    seatCenter: [0, 0, 0.00225],
    insertionClearanceM: 0.00035,
    rotation: [0, 0, 3.141592653589793],
    minimumPairedContacts: 16,
    contactAlignmentToleranceM: 0.00045,
    orientationRule: "usb-and-power-end-aligned-to-carrier-power-block",
    powerRestrictions: ["controller-usb-c-power-only", "3v3-sensor-rails-only", "no-battery-input", "no-rail-modification"],
    evidence: "serve_esp32_breakout_review:c3:controllerSeat"
  }]),
  "aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx": Object.freeze([{
    assetSha256: "aec8e5e6e81deb28f3a1da8ab56a76aba0429501964e7c86227cef0e4006a9da",
    id: "controller-socket-2x22",
    kind: "controller-carrier",
    compatibleAssetIds: [
      "esp32-s3-devkitc-1-n8r2",
      "esp32-s3-devkit-n16r8"
    ],
    carrierConnectorIds: ["controller-j1-1x22", "controller-j3-1x22"],
    transformMethod: "align-matching-contact-frames",
    seatCenter: [0, 0.008, 0.0032],
    insertionClearanceM: 0.00035,
    rotation: [0, 0, 0],
    minimumPairedContacts: 38,
    contactAlignmentToleranceM: 0.00045,
    orientationRule: "usb-c-edge-aligned-to-carrier-board-arrow",
    powerRestrictions: ["controller-usb-c-power-only", "dedicated-carrier-5v-user-bench-routes-allowed", "no-dc-barrel-input"],
    evidence: "serve_esp32_breakout_review:s3:controllerSeat"
  }]),
  "seeed-xiao-expansion-base-103030356": Object.freeze([{
    assetSha256: "46f48aeed6ef3e7606099fd14f3c2d5d5681cf934c98369533ef0f3e85d3bba4",
    id: "xiao-controller-socket-2x7",
    kind: "controller-carrier",
    compatibleAssetIds: [
      "seeed-xiao-esp32c3",
      "seeed-xiao-esp32c5",
      "seeed-xiao-esp32c6"
    ],
    carrierConnectorIds: ["xiao-controller-socket"],
    transformMethod: "align-matching-contact-frames",
    seatCenter: [-0.018459, 0.00005, 0.0021],
    insertionClearanceM: 0.00025,
    rotation: [0, 0, 1.5707963267948966],
    minimumPairedContacts: 14,
    contactAlignmentToleranceM: 0.00045,
    orientationRule: "usb-c-end-aligned-to-the-expansion-base-controller-outline",
    powerRestrictions: ["controller-usb-c-power-only", "grove-3v3-logic", "no-unverified-battery-path"],
    evidence: "corrected-15.24mm-xiao-socket-candidate-and-seeed-expansion-base-documentation"
  }])
});

function carrierMountContracts(asset) {
  return (CARRIER_MOUNT_CONTRACTS[asset.partId] || []).filter((mount) => !mount.assetSha256 || mount.assetSha256 === asset.sha256);
}

export function catalogBatchOrder(assets) {
  const retired = new Set(RETIRED_ASSET_IDS);
  return catalogOrderIncludingRetired(assets).filter((asset) => !retired.has(asset.partId));
}

function catalogOrderIncludingRetired(assets) {
  const byId = new Map(assets.map((asset) => [asset.partId, asset]));
  const priority = FOUNDATION_ASSET_IDS.map((id) => byId.get(id)).filter(Boolean);
  const priorityIds = new Set(priority.map((asset) => asset.partId));
  const remainder = assets.filter((asset) => !priorityIds.has(asset.partId));
  return [...priority, ...remainder];
}

export function selectCatalogBatch(assets, batchNumber, batchSize = PROMPT2CIRCUIT_BATCH_SIZE) {
  if (!Number.isInteger(batchNumber) || batchNumber < 1) throw new Error("batchNumber must be a positive integer");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10) throw new Error("batchSize must be between 1 and 10");
  const retired = new Set(RETIRED_ASSET_IDS);
  return catalogOrderIncludingRetired(assets)
    .slice((batchNumber - 1) * batchSize, batchNumber * batchSize)
    .filter((asset) => !retired.has(asset.partId));
}

export function buildInterfaceProfile({ asset, reviewDecision = null, catalogRow = null, sourceManifest = null, glbInterface = null, authoritativeEvidence = null }) {
  if (!asset?.partId || !/^[a-f0-9]{64}$/.test(asset.sha256 || "")) {
    throw new Error("An immutable AWS asset identity is required");
  }
  const active = activeManifestInterface(asset.interfaceProfile);
  const source = sourceManifestInterface(sourceManifest);
  const glb = glbInterface || { contacts: [], connectors: [], requiredNodes: [], routingAnchors: [], passiveComponents: [], includedFactoryHarnesses: [] };
  const sourceContacts = glbInterface ? [] : source.contacts;
  const sourceRequiredNodes = glbInterface ? [] : source.requiredNodes;
  const contacts = knownControllerContacts(asset, dedupeContacts([...glb.contacts, ...active.contacts, ...sourceContacts]))
    .map((contact) => ({
      ...contact,
      // A normal pin, socket cavity, screw terminal, or individual header
      // contact accepts one externally installed conductor. Any higher
      // capacity must be an explicit source-bound connector contract.
      maxExternalTerminations: Number.isInteger(contact.maxExternalTerminations)
        && contact.maxExternalTerminations > 0 ? contact.maxExternalTerminations : 1
    }));
  const contactConnectorIds = new Set(contacts.map((contact) => contact.connectorId).filter(Boolean));
  const connectors = dedupeConnectors([...glb.connectors, ...active.connectors, ...source.connectors])
    .filter((connector) => contactConnectorIds.has(connector.id));
  const passiveComponents = structuredClone(glb.passiveComponents || []);
  const includedFactoryHarnesses = structuredClone(glb.includedFactoryHarnesses || []);
  const servoHarness = structuredClone(authoritativeEvidence?.servoHarness || glb.servoHarness || null);
  const servoPowerSystem = structuredClone(authoritativeEvidence?.servoPowerSystem || glb.servoPowerSystem || null);
  const poweredLogicHarness = structuredClone(authoritativeEvidence?.poweredLogicHarness || glb.poweredLogicHarness || null);
  const poweredLogicInterfaceSystem = structuredClone(authoritativeEvidence?.poweredLogicInterfaceSystem || glb.poweredLogicInterfaceSystem || null);
  const exactMatingCable = structuredClone(authoritativeEvidence?.exactMatingCable || glb.exactMatingCable || null);
  const exactMatingCableRequirements = structuredClone(authoritativeEvidence?.exactMatingCableRequirements || []);
  const selectorShunt = structuredClone(authoritativeEvidence?.selectorShunt || glb.selectorShunt || null);
  const selectorShuntRequirements = structuredClone(authoritativeEvidence?.selectorShuntRequirements || []);
  const operatingModeContract = structuredClone(authoritativeEvidence?.operatingModeContract || null);
  const analogInputConsumer = structuredClone(authoritativeEvidence?.analogInputConsumer || null);
  const requiredNetTies = structuredClone(authoritativeEvidence?.requiredNetTies || []);
  const requiredSignalStraps = structuredClone(authoritativeEvidence?.requiredSignalStraps || []);
  const logicalGuideAccessoryRequirements = authoritativeEvidence?.logicalGuideAccessoryRequirement
    ? [structuredClone(authoritativeEvidence.logicalGuideAccessoryRequirement)]
    : structuredClone(authoritativeEvidence?.logicalGuideAccessoryRequirements || []);
  const disabledInterfaces = normalizeDisabledInterfaces(authoritativeEvidence?.disabledInterfaces, asset.partId);
  const requiredNodes = [...new Set([
    ...active.requiredNodes,
    ...sourceRequiredNodes,
    ...glb.requiredNodes,
    ...contacts.flatMap((contact) => (
      contact.sourceNodeNames || [contact.sourceNodeName || contact.nodeName]
    )).filter(Boolean)
  ])].sort();
  const category = normalizeCategory(catalogRow, asset);
  if (authoritativeEvidence && authoritativeEvidence.assetSha256 !== asset.sha256) {
    throw new Error(`Authoritative electrical evidence hash mismatch for ${asset.partId}`);
  }
  const electrical = electricalIntent(asset, catalogRow, contacts, category, authoritativeEvidence);
  const declaredContactCount = declaredContacts(connectors, contacts, category);
  const physicalEndpointCount = contacts.filter(validPhysicalContact).length;
  const uncoveredRequiredSignals = electrical.requiredSignals.filter((signal) => (
    !contacts.some((contact) => normalizeSignal(contact.signal) === normalizeSignal(signal) && validPhysicalContact(contact))
  ));
  const unclassifiedConnectorContacts = contacts.filter((contact) => (
    !classifiedInterfaceValue(contact.connectorFamily) || !classifiedInterfaceValue(contact.gender)
  ));
  const invalidSignalContacts = contacts.filter((contact) => !routeableSignalLabel(contact.signal));
  const ambiguousControllerSignals = category === "controller" ? repeatedControllerSignals(contacts) : [];
  const contactPositionsUnique = uniqueContactPositions(contacts);
  const nodeNamesUnique = new Set(contacts.map((contact) => contact.nodeName).filter(Boolean)).size
    === contacts.filter((contact) => contact.nodeName).length;
  const blockers = [];
  blockers.push(...physicalSubassemblyContractBlockers({
    assetId: asset.partId,
    contacts,
    passiveComponents,
    requiredNetTies
  }));
  blockers.push(...physicalSignalStrapContractBlockers({
    assetId: asset.partId,
    contacts,
    requiredSignalStraps
  }));
  blockers.push(...includedFactoryHarnessContractBlockers({
    assetId: asset.partId,
    required: authoritativeEvidence?.includedFactoryHarnessRequired === true,
    requiredSignals: electrical.requiredSignals,
    harnesses: includedFactoryHarnesses,
    primaryContacts: contacts
  }));
  let state = "pending";

  if (/breadboard|solderless_breadboard/i.test(`${asset.partId} ${asset.name} ${asset.connectorReadiness}`)) {
    state = "blocked";
    blockers.push("policy_breadboard_banned");
  } else if (!contacts.length) {
    blockers.push("glb_contact_nodes_missing");
  } else {
    state = "partial";
    if (unclassifiedConnectorContacts.length) blockers.push(`connector_contract_unclassified:${unclassifiedConnectorContacts.length}`);
    if (invalidSignalContacts.length) blockers.push(`electrical_signal_label_unrouteable:${invalidSignalContacts.length}`);
    if (!nodeNamesUnique) blockers.push("glb_contact_node_names_not_unique");
    if (!contactPositionsUnique) blockers.push("glb_contact_positions_coincident");
    if (physicalEndpointCount < declaredContactCount) blockers.push(`physical_contact_coverage_incomplete:${physicalEndpointCount}/${declaredContactCount}`);
    if (uncoveredRequiredSignals.length) blockers.push(`required_signal_contact_coverage_incomplete:${uncoveredRequiredSignals.join(",")}`);
    if (!["controller", "carrier", "cable", "part", "power", "power_distribution"].includes(category) && peripheralPowerDomainAmbiguous(electrical)) blockers.push("peripheral_power_domain_ambiguous");
    if (category === "controller"
      && !hasControllerCapabilityCoverage(contacts)
      && authoritativeEvidence?.controllerCapabilityMatrixComplete !== true) {
      blockers.push("controller_pin_capability_matrix_incomplete");
    }
    if (ambiguousControllerSignals.length) blockers.push(`controller_physical_pin_alias_ambiguous:${ambiguousControllerSignals.join(",")}`);
    if (category === "carrier" && !carrierMountContracts(asset).length) blockers.push("compatible_controller_mount_contract_missing");
    if (contacts.some((contact) => contact.connectorFamily === "arduino_uno_r3_shield_headers")
      && !carrierMountContracts(asset).length) {
      blockers.push("compatible_controller_mount_contract_missing");
    }
    if (!blockers.length) state = "ready";
  }

  if (reviewDecision?.interfaceEligibility === "ready" && !active.contacts.length && !source.contacts.length && !glb.contacts.length) {
    blockers.push("review_ready_interface_evidence_not_promoted_to_manifest");
  }
  const priorBlockedReviewSuperseded = reviewDecision?.interfaceEligibility === "blocked"
    && authoritativeEvidence?.supersedesPriorInterfaceReviewBlock === true;
  if (priorBlockedReviewSuperseded) {
    if (authoritativeEvidence.contactBindingsMode !== "replace"
      || !(authoritativeEvidence.numberedHeaderBindings?.length || authoritativeEvidence.connectorFaceBindings?.length)
      || !authoritativeEvidence.sourceUrl
      || !authoritativeEvidence.evidence) {
      throw new Error(`Unsafe prior-review supersession for ${asset.partId}`);
    }
  } else if (reviewDecision?.interfaceEligibility === "blocked") {
    state = "blocked";
    blockers.push("prior_interface_review_blocked");
  }
  for (const blocker of authoritativeEvidence?.knownBlockers || []) {
    if (typeof blocker !== "string" || !blocker.trim()) {
      throw new Error(`Invalid authoritative blocker for ${asset.partId}`);
    }
    blockers.push(blocker.trim());
  }
  if (authoritativeEvidence?.knownBlockers?.length && state === "ready") state = "partial";

  return {
    schemaVersion: INTERFACE_PROFILE_SCHEMA_VERSION,
    assetId: asset.partId,
    assetSha256: asset.sha256,
    catalogKey: asset.catalogKey || "",
    state,
    connectorReadiness: asset.connectorReadiness || "unclassified",
    electrical,
    geometry: {
      bounds: glbInterface?.rigidBodyBounds || glbInterface?.bounds || asset.interfaceProfile?.pcbBounds || null,
      ...(glbInterface?.rigidBodyBounds && glbInterface?.bounds
        ? { soldFormBounds: glbInterface.bounds }
        : {}),
      coordinateUnit: "metre",
      coordinateFrame: "glb_local"
    },
    mounts: structuredClone(carrierMountContracts(asset)),
    routingAnchors: structuredClone(glb.routingAnchors || []),
    passiveComponents,
    includedFactoryHarnesses,
    ...(servoHarness ? { servoHarness } : {}),
    ...(servoPowerSystem ? { servoPowerSystem } : {}),
    ...(poweredLogicHarness ? { poweredLogicHarness } : {}),
    ...(poweredLogicInterfaceSystem ? { poweredLogicInterfaceSystem } : {}),
    ...(exactMatingCable ? { exactMatingCable } : {}),
    exactMatingCableRequirements,
    ...(selectorShunt ? { selectorShunt } : {}),
    selectorShuntRequirements,
    ...(operatingModeContract ? { operatingModeContract } : {}),
    ...(analogInputConsumer ? { analogInputConsumer } : {}),
    requiredNetTies,
    requiredSignalStraps,
    terminalOccupancyPolicy: {
      id: "single-external-conductor-per-physical-contact-v1",
      defaultMaximumTerminations: 1,
      sameNetPhysicalReuse: "forbidden-without-explicit-splitter-or-multi-termination-contract",
      configurationStrapDestination: "separate-compatible-surface-contact"
    },
    logicalGuideAccessoryRequirements,
    disabledInterfaces,
    connectors,
    contacts,
    requiredNodes,
    coverage: {
      category,
      declaredContactCount,
      physicalEndpointCount,
      requiredSignalCount: electrical.requiredSignals.length,
      requiredSignalsCovered: electrical.requiredSignals.length - uncoveredRequiredSignals.length,
      ratio: declaredContactCount ? Number((physicalEndpointCount / declaredContactCount).toFixed(4)) : 0,
      nodeNamesUnique,
      contactPositionsUnique,
      activeManifestProfile: active.contacts.length > 0,
      localSourceManifest: Boolean(sourceManifest),
      glbExtracted: Boolean(glbInterface),
      glbExtractionOrigin: glbInterface?.origin || "",
      glbSha256: glbInterface?.sha256 || "",
      glbNodeCount: glbInterface?.glbNodeCount || 0,
      priorInterfaceEligibility: reviewDecision?.interfaceEligibility || "unreviewed",
      priorBlockedReviewSuperseded
    },
    blockers: [...new Set(blockers)].sort(),
    evidence: compactEvidence(asset, reviewDecision, catalogRow, sourceManifest, authoritativeEvidence)
  };
}

export function validateInterfaceProfile(profile) {
  if (profile?.schemaVersion !== INTERFACE_PROFILE_SCHEMA_VERSION) throw new Error("Invalid interface profile schema version");
  if (!profile.assetId || !/^[a-f0-9]{64}$/.test(profile.assetSha256 || "")) throw new Error("Invalid profile asset identity");
  if (!["ready", "partial", "pending", "blocked"].includes(profile.state)) throw new Error("Invalid profile state");
  if (!Array.isArray(profile.contacts) || !Array.isArray(profile.connectors) || !Array.isArray(profile.requiredNodes)
    || (profile.routingAnchors !== undefined && !Array.isArray(profile.routingAnchors))
    || (profile.mounts !== undefined && !Array.isArray(profile.mounts))
    || (profile.passiveComponents !== undefined && !Array.isArray(profile.passiveComponents))
    || (profile.includedFactoryHarnesses !== undefined && !Array.isArray(profile.includedFactoryHarnesses))
    || (profile.requiredNetTies !== undefined && !Array.isArray(profile.requiredNetTies))
    || (profile.requiredSignalStraps !== undefined && !Array.isArray(profile.requiredSignalStraps))
    || (profile.logicalGuideAccessoryRequirements !== undefined && !Array.isArray(profile.logicalGuideAccessoryRequirements))
    || (profile.exactMatingCableRequirements !== undefined && !Array.isArray(profile.exactMatingCableRequirements))
    || (profile.selectorShuntRequirements !== undefined && !Array.isArray(profile.selectorShuntRequirements))
    || (profile.disabledInterfaces !== undefined && !Array.isArray(profile.disabledInterfaces))) {
    throw new Error("Incomplete interface profile arrays");
  }
  for (const mount of profile.mounts || []) validateMountContract(mount, profile.assetId);
  validateMirroredPowerContactSemantics(profile);
  validateMirroredPowerAuthorization(profile);
  if (profile.electrical?.surfaceCapabilitiesBySignal !== undefined
    && (typeof profile.electrical.surfaceCapabilitiesBySignal !== "object"
      || Array.isArray(profile.electrical.surfaceCapabilitiesBySignal)
      || Object.values(profile.electrical.surfaceCapabilitiesBySignal).some((value) => typeof value !== "string" || !value))) {
    throw new Error(`Invalid surface capability map:${profile.assetId}`);
  }
  validateServoAuxiliaryContracts(profile);
  validatePoweredLogicAuxiliaryContracts(profile);
  validateExactMatingCableContracts(profile);
  validateSelectorShuntContracts(profile);
  validateOperatingModeContract(profile);
  validateAnalogInputConsumer(profile);
  if (profile.terminalOccupancyPolicy !== undefined && (
    profile.terminalOccupancyPolicy.id !== "single-external-conductor-per-physical-contact-v1"
    || profile.terminalOccupancyPolicy.defaultMaximumTerminations !== 1
    || profile.terminalOccupancyPolicy.sameNetPhysicalReuse !== "forbidden-without-explicit-splitter-or-multi-termination-contract"
    || profile.terminalOccupancyPolicy.configurationStrapDestination !== "separate-compatible-surface-contact"
  )) throw new Error(`Invalid terminal occupancy policy:${profile.assetId}`);
  const subassemblyBlockers = physicalSubassemblyContractBlockers({
    assetId: profile.assetId,
    contacts: profile.contacts,
    passiveComponents: profile.passiveComponents || [],
    requiredNetTies: profile.requiredNetTies || []
  });
  const strapBlockers = physicalSignalStrapContractBlockers({
    assetId: profile.assetId,
    contacts: profile.contacts,
    requiredSignalStraps: profile.requiredSignalStraps || []
  });
  const harnessBlockers = includedFactoryHarnessContractBlockers({
    assetId: profile.assetId,
    required: profile.evidence?.some((entry) => entry.type === "authoritative_electrical_evidence" && entry.includedFactoryHarnessRequired === true),
    requiredSignals: profile.electrical?.requiredSignals || [],
    harnesses: profile.includedFactoryHarnesses || [],
    primaryContacts: profile.contacts
  });
  if (profile.state === "ready") {
    if (!profile.contacts.length || profile.blockers.length) throw new Error(`Ready profile ${profile.assetId} has incomplete evidence`);
    if (!profile.contacts.every(validPhysicalContact)) throw new Error(`Ready profile ${profile.assetId} has unresolved contacts`);
    if (subassemblyBlockers.length) throw new Error(`Ready profile ${profile.assetId} has incomplete physical subassembly evidence`);
    if (strapBlockers.length) throw new Error(`Ready profile ${profile.assetId} has incomplete physical signal-strap evidence`);
    if (harnessBlockers.length) throw new Error(`Ready profile ${profile.assetId} has incomplete included factory harness evidence`);
  }
  return profile;
}

function validateServoAuxiliaryContracts(profile) {
  const servoLoad = profile.electrical?.servoLoad;
  if (servoLoad !== undefined) {
    if (!Array.isArray(servoLoad.acceptedVoltageRangeV) || servoLoad.acceptedVoltageRangeV.length !== 2
      || !servoLoad.acceptedVoltageRangeV.every(Number.isFinite)
      || servoLoad.acceptedVoltageRangeV[0] <= 0
      || servoLoad.acceptedVoltageRangeV[1] < servoLoad.acceptedVoltageRangeV[0]
      || !Number.isFinite(servoLoad.continuousCurrentA) || servoLoad.continuousCurrentA <= 0
      || !Number.isFinite(servoLoad.peakCurrentA) || servoLoad.peakCurrentA < servoLoad.continuousCurrentA
      || (servoLoad.channelCount !== undefined
        && (!Number.isInteger(servoLoad.channelCount) || servoLoad.channelCount < 1 || servoLoad.channelCount > 16))) {
      throw new Error(`Invalid servo load contract:${profile.assetId}`);
    }
  }
  if (profile.state === "ready" && profile.electrical?.connectorIntent === "servo_3p" && !servoLoad) {
    throw new Error(`Ready servo profile ${profile.assetId} has no measured load contract`);
  }

  const harness = profile.servoHarness;
  if (harness !== undefined && harness !== null) {
    if (!harness.id || !harness.servoConnectorId || !harness.sourceConnectorIds
      || !["GND", "POWER", "PWM"].every((signal) => typeof harness.sourceConnectorIds[signal] === "string" && harness.sourceConnectorIds[signal])
      || !Number.isFinite(harness.maximumCableLengthM) || harness.maximumCableLengthM <= 0
      || !Number.isFinite(harness.diameterM) || harness.diameterM <= 0
      || !Number.isFinite(harness.minimumBendRadiusM) || harness.minimumBendRadiusM < harness.diameterM
      || !Number.isFinite(harness.engagementDepthM) || harness.engagementDepthM < 0) {
      throw new Error(`Invalid servo harness contract:${profile.assetId}`);
    }
    const servoConnector = (profile.connectors || []).find((connector) => connector.id === harness.servoConnectorId);
    if (!servoConnector || !String(servoConnector.family || "").toLowerCase().includes("servo_2.54mm_3p")
      || !/male/.test(String(servoConnector.gender || "").toLowerCase())
      || /female/.test(String(servoConnector.gender || "").toLowerCase())) {
      throw new Error(`Invalid servo harness mate:${profile.assetId}`);
    }
    for (const signal of ["GND", "POWER", "PWM"]) {
      const sourceConnectorId = harness.sourceConnectorIds[signal];
      const servoContact = (profile.contacts || []).find((contact) => (
        contact.connectorId === harness.servoConnectorId && normalizeSignal(contact.signal) === signal
      ));
      const sourceContact = (profile.contacts || []).find((contact) => (
        contact.connectorId === sourceConnectorId && normalizeSignal(contact.signal) === signal
      ));
      const servoAnchor = (profile.routingAnchors || []).find((anchor) => anchor.nodeName === `anchor:servo:${signal.toLowerCase()}:wire-exit`);
      const sourceAnchor = (profile.routingAnchors || []).find((anchor) => anchor.nodeName === `anchor:source:${signal.toLowerCase()}:wire-exit`);
      if (!servoContact || !sourceContact || !servoAnchor || !sourceAnchor
        || !/female|socket|receptacle/.test(String(sourceContact.gender || "").toLowerCase())) {
        throw new Error(`Incomplete servo harness conductor contract:${profile.assetId}:${signal}`);
      }
    }
  }

  const power = profile.servoPowerSystem;
  if (power !== undefined && power !== null) {
    if (!Number.isFinite(power.outputVoltageV) || power.outputVoltageV <= 0
      || !Number.isFinite(power.continuousCurrentA) || power.continuousCurrentA <= 0
      || !Number.isFinite(power.peakCurrentA) || power.peakCurrentA < power.continuousCurrentA
      || power.commonGroundRequired !== true || power.upstreamPowerResolved !== true
      || typeof power.commonGroundInputNodeName !== "string" || !power.commonGroundInputNodeName
      || !Array.isArray(power.outputs) || !power.outputs.length) {
      throw new Error(`Invalid servo power-system contract:${profile.assetId}`);
    }
    const nodeNames = new Set((profile.contacts || []).map((contact) => contact.nodeName));
    if (!nodeNames.has(power.commonGroundInputNodeName)) {
      throw new Error(`Missing servo power common-ground contact:${profile.assetId}`);
    }
    const outputIds = new Set();
    for (const output of power.outputs) {
      if (!output?.id || outputIds.has(output.id) || !nodeNames.has(output.powerNodeName)
        || !nodeNames.has(output.groundNodeName) || output.powerNodeName === output.groundNodeName) {
        throw new Error(`Invalid servo power output:${profile.assetId}:${output?.id || "unknown"}`);
      }
      outputIds.add(output.id);
    }
  }
}

function validatePoweredLogicAuxiliaryContracts(profile) {
  const load = profile.electrical?.poweredLogicLoad;
  if (load !== undefined && load !== null) {
    const logic = load.logicSignal;
    if (!Array.isArray(load.acceptedSupplyVoltageRangeV) || load.acceptedSupplyVoltageRangeV.length !== 2
      || !load.acceptedSupplyVoltageRangeV.every(Number.isFinite)
      || load.acceptedSupplyVoltageRangeV[0] <= 0
      || load.acceptedSupplyVoltageRangeV[1] < load.acceptedSupplyVoltageRangeV[0]
      || !Number.isFinite(load.continuousCurrentA) || load.continuousCurrentA <= 0
      || !Number.isFinite(load.peakCurrentA) || load.peakCurrentA < load.continuousCurrentA
      || typeof load.deviceConnectorId !== "string" || !load.deviceConnectorId
      || typeof load.powerSignal !== "string" || !load.powerSignal
      || typeof load.groundSignal !== "string" || !load.groundSignal
      || !logic || typeof logic.deviceSignal !== "string" || !logic.deviceSignal
      || logic.direction !== "device-to-controller"
      || logic.controllerCapability !== "DIGITAL_INPUT"
      || logic.translationRequired !== true
      || !Array.isArray(logic.deviceVoltageRangeV) || logic.deviceVoltageRangeV.length !== 2
      || !logic.deviceVoltageRangeV.every(Number.isFinite)
      || !Array.isArray(logic.controllerAcceptedVoltageRangeV)
      || logic.controllerAcceptedVoltageRangeV.length !== 2
      || !logic.controllerAcceptedVoltageRangeV.every(Number.isFinite)
      || !Number.isFinite(logic.maximumFrequencyHz) || logic.maximumFrequencyHz <= 0) {
      throw new Error(`Invalid powered-logic load contract:${profile.assetId}`);
    }
    const connector = (profile.connectors || []).find((entry) => entry.id === load.deviceConnectorId);
    const signals = new Set((profile.contacts || [])
      .filter((contact) => contact.connectorId === load.deviceConnectorId)
      .map((contact) => normalizeSignal(contact.signal)));
    if (!connector || ![load.powerSignal, load.groundSignal, logic.deviceSignal]
      .every((signal) => signals.has(normalizeSignal(signal)))) {
      throw new Error(`Incomplete powered-logic device connector:${profile.assetId}`);
    }
  }
  if (profile.state === "ready"
    && Object.values(profile.electrical?.signalDomains || {}).some((domain) => /5V_LOGIC.*LEVEL_SHIFT|LEVEL_SHIFT/i.test(String(domain)))
    && !load) {
    throw new Error(`Ready level-shifted peripheral ${profile.assetId} has no powered-logic load contract`);
  }

  const harness = profile.poweredLogicHarness;
  if (harness !== undefined && harness !== null) {
    const requiredRoles = [
      "DEVICE_POWER",
      "DEVICE_GROUND",
      "DEVICE_SIGNAL_HIGH",
      "SURFACE_GROUND",
      "SURFACE_LOGIC_SUPPLY",
      "SURFACE_SIGNAL_LOW"
    ];
    if (!harness.id || !harness.deviceConnectorId || !Array.isArray(harness.conductors)
      || harness.conductors.length !== requiredRoles.length
      || new Set(harness.conductors.map((conductor) => conductor.role)).size !== requiredRoles.length
      || requiredRoles.some((role) => !harness.conductors.some((conductor) => conductor.role === role))) {
      throw new Error(`Invalid powered-logic harness contract:${profile.assetId}`);
    }
    const contacts = new Map((profile.contacts || []).map((contact) => [contact.nodeName, contact]));
    const anchors = new Map((profile.routingAnchors || []).map((anchor) => [anchor.nodeName, anchor]));
    const conductorIds = new Set();
    for (const conductor of harness.conductors) {
      const fromContact = contacts.get(conductor.fromContactNodeName);
      const toContact = contacts.get(conductor.toContactNodeName);
      const fromAnchor = anchors.get(conductor.fromWireExitAnchorNodeName);
      const toAnchor = anchors.get(conductor.toWireExitAnchorNodeName);
      if (!conductor.id || conductorIds.has(conductor.id) || !fromContact || !toContact
        || !fromAnchor || !toAnchor || !finiteVec3(fromAnchor.position) || !finiteVec3(fromAnchor.normal)
        || !finiteVec3(toAnchor.position) || !finiteVec3(toAnchor.normal)
        || typeof conductor.fromNodePrefix !== "string" || !conductor.fromNodePrefix
        || typeof conductor.toNodePrefix !== "string" || !conductor.toNodePrefix
        || typeof conductor.fromTransformGroup !== "string" || !conductor.fromTransformGroup
        || typeof conductor.toTransformGroup !== "string" || !conductor.toTransformGroup
        || !Number.isFinite(conductor.maximumCableLengthM) || conductor.maximumCableLengthM <= 0
        || !Number.isFinite(conductor.diameterM) || conductor.diameterM <= 0
        || !Number.isFinite(conductor.minimumBendRadiusM) || conductor.minimumBendRadiusM < conductor.diameterM) {
        throw new Error(`Invalid powered-logic harness conductor:${profile.assetId}:${conductor?.id || "unknown"}`);
      }
      if (["DEVICE_POWER", "DEVICE_GROUND", "DEVICE_SIGNAL_HIGH"].includes(conductor.role)
        && fromContact.connectorId !== harness.deviceConnectorId) {
        throw new Error(`Powered-logic device mate split across connectors:${profile.assetId}:${conductor.role}`);
      }
      conductorIds.add(conductor.id);
    }
  }

  const system = profile.poweredLogicInterfaceSystem;
  if (system !== undefined && system !== null) {
    const channel = system.channel;
    const nodeFields = [
      "devicePowerOutputNodeName",
      "deviceGroundOutputNodeName",
      "highSideSignalInputNodeName",
      "surfaceGroundNodeName",
      "logicSupplyInputNodeName",
      "lowSideSignalOutputNodeName"
    ];
    if (system.upstreamPowerResolved !== true || system.commonGroundRequired !== true
      || !Number.isFinite(system.outputSupplyVoltageV) || system.outputSupplyVoltageV <= 0
      || !Number.isFinite(system.logicSupplyVoltageV) || system.logicSupplyVoltageV <= 0
      || !Number.isFinite(system.continuousCurrentA) || system.continuousCurrentA <= 0
      || !Number.isFinite(system.peakCurrentA) || system.peakCurrentA < system.continuousCurrentA
      || !channel || channel.direction !== "device-to-controller" || channel.thresholdsProven !== true
      || !Array.isArray(channel.inputVoltageRangeV) || channel.inputVoltageRangeV.length !== 2
      || !channel.inputVoltageRangeV.every(Number.isFinite)
      || !Array.isArray(channel.outputVoltageRangeV) || channel.outputVoltageRangeV.length !== 2
      || !channel.outputVoltageRangeV.every(Number.isFinite)
      || !Number.isFinite(channel.maximumFrequencyHz) || channel.maximumFrequencyHz <= 0
      || nodeFields.some((field) => typeof channel[field] !== "string" || !channel[field])) {
      throw new Error(`Invalid powered-logic interface-system contract:${profile.assetId}`);
    }
    const nodes = new Set(nodeFields.map((field) => channel[field]));
    const contacts = new Set((profile.contacts || []).map((contact) => contact.nodeName));
    if (nodes.size !== nodeFields.length || [...nodes].some((nodeName) => !contacts.has(nodeName))) {
      throw new Error(`Incomplete powered-logic interface-system contacts:${profile.assetId}`);
    }
  }
}

function validateExactMatingCableContracts(profile) {
  const requirements = profile.exactMatingCableRequirements || [];
  const requirementIds = new Set();
  for (const requirement of requirements) {
    if (!requirement?.id || requirementIds.has(requirement.id)
      || !requirement.connectorId
      || !Array.isArray(requirement.orderedSignals) || requirement.orderedSignals.length < 1
      || new Set(requirement.orderedSignals.map(normalizeSignal)).size !== requirement.orderedSignals.length
      || !Array.isArray(requirement.routedSignals) || !requirement.routedSignals.length
      || requirement.routedSignals.some((signal) => !requirement.orderedSignals.map(normalizeSignal).includes(normalizeSignal(signal)))
      || !Array.isArray(requirement.unmatedSignals)
      || requirement.unmatedSignals.some((signal) => !requirement.orderedSignals.map(normalizeSignal).includes(normalizeSignal(signal)))
      || requirement.routedSignals.some((signal) => requirement.unmatedSignals.map(normalizeSignal).includes(normalizeSignal(signal)))
      || !Array.isArray(requirement.signalStraps)
      || (requirement.surfaceCapabilities !== undefined
        && (!requirement.surfaceCapabilities || typeof requirement.surfaceCapabilities !== "object" || Array.isArray(requirement.surfaceCapabilities)
          || Object.entries(requirement.surfaceCapabilities).some(([signal, capability]) => (
            !requirement.routedSignals.map(normalizeSignal).includes(normalizeSignal(signal))
            || typeof capability !== "string" || !capability.trim()
          ))))) {
      throw new Error(`Invalid exact mating-cable requirement:${profile.assetId}:${requirement?.id || "unknown"}`);
    }
    const connector = (profile.connectors || []).find((entry) => entry.id === requirement.connectorId);
    const connectorSignals = (profile.contacts || [])
      .filter((contact) => contact.connectorId === requirement.connectorId)
      .map((contact) => normalizeSignal(contact.signal));
    if (!connector || requirement.orderedSignals.some((signal) => !connectorSignals.includes(normalizeSignal(signal)))) {
      throw new Error(`Incomplete exact mating-cable endpoint:${profile.assetId}:${requirement.id}`);
    }
    for (const strap of requirement.signalStraps) {
      if (!strap?.id || !requirement.routedSignals.map(normalizeSignal).includes(normalizeSignal(strap.fromSignal))
        || !requirement.routedSignals.map(normalizeSignal).includes(normalizeSignal(strap.toSignal))
        || normalizeSignal(strap.fromSignal) === normalizeSignal(strap.toSignal)
        || strap.terminationMode !== "opposite-cable-termination") {
        throw new Error(`Invalid exact mating-cable signal strap:${profile.assetId}:${requirement.id}:${strap?.id || "unknown"}`);
      }
    }
    requirementIds.add(requirement.id);
  }

  const cable = profile.exactMatingCable;
  if (cable === undefined || cable === null) return;
  if (!cable.id || !cable.endpointConnectorId
    || !Array.isArray(cable.orderedSignals) || cable.orderedSignals.length < 1
    || new Set(cable.orderedSignals.map(normalizeSignal)).size !== cable.orderedSignals.length
    || !Array.isArray(cable.conductors) || !cable.conductors.length
    || !Array.isArray(cable.unmatedSignals)
    || !Array.isArray(cable.unmatedContacts)
    || !Array.isArray(cable.hiddenNodeIncludes)) {
    throw new Error(`Invalid exact mating-cable contract:${profile.assetId}`);
  }
  const endpointConnector = (profile.connectors || []).find((entry) => entry.id === cable.endpointConnectorId);
  const endpointSignals = new Set((profile.contacts || [])
    .filter((contact) => contact.connectorId === cable.endpointConnectorId)
    .map((contact) => normalizeSignal(contact.signal)));
  if (!endpointConnector || cable.orderedSignals.some((signal) => !endpointSignals.has(normalizeSignal(signal)))) {
    throw new Error(`Incomplete exact mating-cable keyed endpoint:${profile.assetId}`);
  }
  const contacts = new Map((profile.contacts || []).map((contact) => [contact.nodeName, contact]));
  const anchors = new Map((profile.routingAnchors || []).map((anchor) => [anchor.nodeName, anchor]));
  const conductorIds = new Set();
  const conductorSignals = new Set();
  for (const conductor of cable.conductors) {
    const signal = normalizeSignal(conductor?.signal);
    const fromContact = contacts.get(conductor?.fromContactNodeName);
    const toContact = contacts.get(conductor?.toContactNodeName);
    const fromAnchor = anchors.get(conductor?.fromWireExitAnchorNodeName);
    const toAnchor = anchors.get(conductor?.toWireExitAnchorNodeName);
    if (!conductor?.id || conductorIds.has(conductor.id) || !signal || signal === "NC" || conductorSignals.has(signal)
      || !fromContact || !toContact || fromContact.connectorId !== cable.endpointConnectorId
      || normalizeSignal(fromContact.signal) !== signal
      || !fromAnchor || !toAnchor || !finiteVec3(fromAnchor.position) || !finiteVec3(fromAnchor.normal)
      || !finiteVec3(toAnchor.position) || !finiteVec3(toAnchor.normal)
      || !conductor.fromNodePrefix || !conductor.toNodePrefix
      || !conductor.fromTransformGroup || !conductor.toTransformGroup
      || !Number.isFinite(conductor.maximumCableLengthM) || conductor.maximumCableLengthM <= 0
      || !Number.isFinite(conductor.diameterM) || conductor.diameterM <= 0
      || !Number.isFinite(conductor.minimumBendRadiusM) || conductor.minimumBendRadiusM < conductor.diameterM) {
      throw new Error(`Invalid exact mating-cable conductor:${profile.assetId}:${conductor?.id || "unknown"}`);
    }
    conductorIds.add(conductor.id);
    conductorSignals.add(signal);
  }
  for (const signal of cable.unmatedSignals) {
    const normalized = normalizeSignal(signal);
    if (!cable.orderedSignals.map(normalizeSignal).includes(normalized) || conductorSignals.has(normalized)) {
      throw new Error(`Invalid exact mating-cable unmated signal:${profile.assetId}:${signal}`);
    }
    const declared = cable.unmatedContacts.find((entry) => normalizeSignal(entry?.signal) === normalized);
    const endpointContact = contacts.get(declared?.endpointContactNodeName);
    const farContact = contacts.get(declared?.farContactNodeName);
    if (!declared || !endpointContact || !farContact
      || endpointContact.connectorId !== cable.endpointConnectorId
      || normalizeSignal(endpointContact.signal) !== normalized
      || normalizeSignal(farContact.signal) !== normalized
      || endpointContact.nodeName === farContact.nodeName) {
      throw new Error(`Missing exact mating-cable unmated contact pair:${profile.assetId}:${signal}`);
    }
  }
  if (cable.unmatedContacts.length !== cable.unmatedSignals.length) {
    throw new Error(`Unexpected exact mating-cable unmated contact:${profile.assetId}`);
  }
}

function validateSelectorShuntContracts(profile) {
  const requirementIds = new Set();
  for (const requirement of profile.selectorShuntRequirements || []) {
    if (!requirement?.id || requirementIds.has(requirement.id) || !requirement.connectorId
      || typeof requirement.mode !== "string" || !requirement.mode
      || !Array.isArray(requirement.orderedTargetSignals) || requirement.orderedTargetSignals.length !== 2
      || new Set(requirement.orderedTargetSignals.map(normalizeSignal)).size !== 2) {
      throw new Error(`Invalid selector-shunt requirement:${profile.assetId}:${requirement?.id || "unknown"}`);
    }
    const connector = (profile.connectors || []).find((entry) => entry.id === requirement.connectorId);
    const contacts = (profile.contacts || []).filter((contact) => contact.connectorId === requirement.connectorId);
    if (!connector || requirement.orderedTargetSignals.some((signal) => (
      !contacts.some((contact) => normalizeSignal(contact.signal) === normalizeSignal(signal))
    ))) {
      throw new Error(`Incomplete selector-shunt target:${profile.assetId}:${requirement.id}`);
    }
    requirementIds.add(requirement.id);
  }

  const shunt = profile.selectorShunt;
  if (shunt === undefined || shunt === null) return;
  if (!shunt.id || !shunt.connectorId || shunt.internalContinuity !== true
    || !Array.isArray(shunt.contactNodeNames) || shunt.contactNodeNames.length !== 2
    || new Set(shunt.contactNodeNames).size !== 2
    || !Number.isFinite(shunt.engagementDepthM) || shunt.engagementDepthM < 0) {
    throw new Error(`Invalid selector-shunt contract:${profile.assetId}`);
  }
  const connector = (profile.connectors || []).find((entry) => entry.id === shunt.connectorId);
  const contacts = shunt.contactNodeNames.map((nodeName) => (
    (profile.contacts || []).find((contact) => contact.nodeName === nodeName)
  ));
  if (!connector || contacts.some((contact) => !contact || contact.connectorId !== shunt.connectorId)
    || !contacts.every(validPhysicalContact)) {
    throw new Error(`Incomplete selector-shunt contacts:${profile.assetId}`);
  }
}

function validateOperatingModeContract(profile) {
  const contract = profile.operatingModeContract;
  if (contract === undefined || contract === null) return;
  const requiredSignals = contract.requiredSignals;
  const capabilities = contract.surfaceCapabilitiesBySignal;
  const outputRanges = contract.outputVoltageRangesV || {};
  if (!contract.id || typeof contract.mode !== "string" || !contract.mode.trim()
    || typeof contract.bus !== "string" || !contract.bus.trim()
    || !Number.isFinite(contract.supplyVoltageV) || contract.supplyVoltageV <= 0
    || !Array.isArray(requiredSignals) || !requiredSignals.length
    || new Set(requiredSignals.map(normalizeSignal)).size !== requiredSignals.length
    || !capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)
    || requiredSignals.some((signal) => typeof capabilities[signal] !== "string" || !capabilities[signal].trim())
    || Object.keys(capabilities).some((signal) => !requiredSignals.map(normalizeSignal).includes(normalizeSignal(signal)))
    || !contract.configurationState || contract.configurationState.resolved !== true
    || typeof contract.configurationState.kind !== "string" || !contract.configurationState.kind.trim()
    || typeof contract.configurationState.immutableSource !== "string" || !contract.configurationState.immutableSource.trim()
    || !Number.isFinite(contract.controllerMaximumInputVoltageV) || contract.controllerMaximumInputVoltageV <= 0) {
    throw new Error(`Invalid operating-mode contract:${profile.assetId}`);
  }
  const physicalSignals = new Set((profile.contacts || []).map((contact) => normalizeSignal(contact.signal)));
  if (requiredSignals.some((signal) => !physicalSignals.has(normalizeSignal(signal)))) {
    throw new Error(`Operating-mode contact missing:${profile.assetId}`);
  }
  if (!(profile.electrical?.acceptedInputVoltagesV || []).some((voltage) => Math.abs(voltage - contract.supplyVoltageV) < 1e-9)) {
    throw new Error(`Operating-mode supply not accepted:${profile.assetId}`);
  }
  for (const [signal, range] of Object.entries(outputRanges)) {
    if (!requiredSignals.map(normalizeSignal).includes(normalizeSignal(signal))
      || !Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite)
      || range[0] < 0 || range[1] < range[0]
      || range[1] > contract.controllerMaximumInputVoltageV) {
      throw new Error(`Unsafe operating-mode output:${profile.assetId}:${signal}`);
    }
  }
  const profileRequired = (profile.electrical?.requiredSignals || []).map(normalizeSignal);
  if (profileRequired.length !== requiredSignals.length
    || requiredSignals.some((signal) => !profileRequired.includes(normalizeSignal(signal)))) {
    throw new Error(`Operating-mode signal set mismatch:${profile.assetId}`);
  }
  for (const [signal, capability] of Object.entries(capabilities)) {
    if (profile.electrical?.surfaceCapabilitiesBySignal?.[signal] !== capability) {
      throw new Error(`Operating-mode capability mismatch:${profile.assetId}:${signal}`);
    }
  }
}

function validateAnalogInputConsumer(profile) {
  const contract = profile.analogInputConsumer;
  if (contract === undefined || contract === null) return;
  if (!contract.id
    || contract.inputMode !== "single-ended-ground-referenced"
    || !Array.isArray(contract.inputSignals) || !contract.inputSignals.length
    || contract.inputSignals.some((signal) => typeof signal !== "string" || !signal.trim())
    || new Set(contract.inputSignals.map(normalizeSignal)).size !== contract.inputSignals.length
    || !Number.isInteger(contract.minimumSourceCount) || contract.minimumSourceCount < 1
    || contract.minimumSourceCount > contract.inputSignals.length
    || !Number.isFinite(contract.maximumInputVoltageV) || contract.maximumInputVoltageV <= 0) {
    throw new Error(`Invalid analog-input consumer contract:${profile.assetId}`);
  }
  const physicalSignals = new Set((profile.contacts || []).map((contact) => normalizeSignal(contact.signal)));
  if (contract.inputSignals.some((signal) => !physicalSignals.has(normalizeSignal(signal)))) {
    throw new Error(`Analog-input consumer contact missing:${profile.assetId}`);
  }
}

function normalizeDisabledInterfaces(value, assetId) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Invalid disabled interfaces for ${assetId}`);
  const interfaces = value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id.trim()
      || typeof entry.reason !== "string" || !entry.reason.trim()
      || !Array.isArray(entry.capabilities) || entry.capabilities.some((capability) => typeof capability !== "string" || !capability.trim())) {
      throw new Error(`Invalid disabled interface for ${assetId}:${index + 1}`);
    }
    return {
      id: entry.id.trim(),
      reason: entry.reason.trim(),
      capabilities: [...new Set(entry.capabilities.map((capability) => capability.trim()))]
    };
  });
  if (new Set(interfaces.map((entry) => entry.id)).size !== interfaces.length) {
    throw new Error(`Duplicate disabled interface for ${assetId}`);
  }
  return interfaces;
}

function physicalSignalStrapContractBlockers({ assetId, contacts, requiredSignalStraps }) {
  const required = [];
  for (const contact of contacts) {
    for (const capability of contact.capabilities || []) {
      const match = String(capability).toUpperCase().match(/^STRAP_TO_([A-Z0-9_]+)$/);
      if (match) required.push({ fromSignal: normalizeSignal(contact.signal), toSignal: normalizeSignal(match[1]) });
    }
  }
  if (!required.length && !requiredSignalStraps.length) return [];
  const contactSignals = new Set(contacts.map((contact) => normalizeSignal(contact.signal)));
  const strapIds = new Set();
  const strapKeys = new Set();
  for (const strap of requiredSignalStraps) {
    const fromSignal = normalizeSignal(strap?.fromSignal);
    const toSignal = normalizeSignal(strap?.toSignal);
    if (!strap?.id || strapIds.has(strap.id)
      || !contactSignals.has(fromSignal) || !contactSignals.has(toSignal)
      || fromSignal === toSignal
      || strap.connectionMode !== "routed-conductor"
      || !["separate-surface-contact-strap", "opposite-cable-termination"].includes(strap.terminationMode)) {
      throw new Error(`Invalid required signal strap:${assetId}:${strap?.id || "unknown"}`);
    }
    strapIds.add(strap.id);
    const key = `${fromSignal}->${toSignal}`;
    if (strapKeys.has(key)) throw new Error(`Duplicate required signal strap:${assetId}:${key}`);
    strapKeys.add(key);
  }
  return required
    .filter(({ fromSignal, toSignal }) => !strapKeys.has(`${fromSignal}->${toSignal}`))
    .map(({ fromSignal, toSignal }) => `required_signal_strap_contract_missing:${fromSignal.toLowerCase()}_to_${toSignal.toLowerCase()}`);
}

function includedFactoryHarnessContractBlockers({ assetId, required, requiredSignals, harnesses, primaryContacts }) {
  if (!harnesses.length) return required ? ["required_included_factory_harness_contract_missing"] : [];
  const harnessIds = new Set();
  const sourceNodeNames = new Set();
  const conductorSignals = new Map();
  for (const harness of harnesses) {
    if (!harness?.id || harnessIds.has(harness.id)
      || harness.kind !== "independent-single-contact-female-to-female"
      || harness.signalAssignmentMethod !== "installation-order-not-rendered-color"
      || harness.renderPolicy !== "retain-terminations-hide-conductors-rerender-runtime"
      || harness.connectorFamily !== "2.54mm_individual_female_socket"
      || harness.gender !== "female-socket"
      || !Number.isFinite(harness.engagementDepthM) || harness.engagementDepthM <= 0
      || !Array.isArray(harness.conductors) || !harness.conductors.length
      || !Array.isArray(harness.requiredNodeNames) || !harness.requiredNodeNames.length
      || !Array.isArray(harness.continuityRules) || !harness.continuityRules.length
      || !Array.isArray(harness.acceptanceRules) || !harness.acceptanceRules.length) {
      throw new Error(`Invalid included factory harness:${assetId}:${harness?.id || "unknown"}`);
    }
    harnessIds.add(harness.id);
    const conductorIds = new Set();
    for (const conductor of harness.conductors) {
      const signal = normalizeSignal(conductor?.signal);
      if (!conductor?.id || conductorIds.has(conductor.id) || !routeableSignalLabel(signal) || signal === "NC"
        || !conductor.sourceNodeName || sourceNodeNames.has(conductor.sourceNodeName)
        || !Number.isFinite(conductor.usableLengthM) || conductor.usableLengthM <= 0
        || !Number.isFinite(conductor.diameterM) || conductor.diameterM <= 0
        || !Number.isFinite(conductor.minimumBendRadiusM) || conductor.minimumBendRadiusM < conductor.diameterM * 2
        || !validIncludedHarnessEnd(conductor.deviceEnd, signal, harness)
        || !validIncludedHarnessEnd(conductor.surfaceEnd, signal, harness)
        || !validIncludedHarnessTopology(conductor.topologyEvidence)) {
        throw new Error(`Invalid included factory harness conductor:${assetId}:${harness.id}:${conductor?.id || "unknown"}`);
      }
      conductorIds.add(conductor.id);
      sourceNodeNames.add(conductor.sourceNodeName);
      conductorSignals.set(signal, (conductorSignals.get(signal) || 0) + 1);
      for (const end of [conductor.deviceEnd, conductor.surfaceEnd]) {
        for (const nodeName of end.sourceNodeNames) {
          if (sourceNodeNames.has(nodeName)) throw new Error(`Included factory harness node reused:${assetId}:${nodeName}`);
          sourceNodeNames.add(nodeName);
        }
      }
      const primary = primaryContacts.find((contact) => normalizeSignal(contact.signal) === signal);
      if (!primary || !connectorsMateForProfile(conductor.deviceEnd.contact, primary)) {
        throw new Error(`Included factory harness cannot mate to primary contact:${assetId}:${harness.id}:${signal}`);
      }
    }
  }
  const requiredRouteSignals = [...new Set(requiredSignals.map(normalizeSignal).filter((signal) => signal && signal !== "NC"))];
  return requiredRouteSignals
    .filter((signal) => conductorSignals.get(signal) !== 1)
    .map((signal) => `included_factory_harness_signal_coverage_invalid:${signal.toLowerCase()}:${conductorSignals.get(signal) || 0}/1`);
}

function validIncludedHarnessEnd(end, signal, harness) {
  return end && typeof end === "object"
    && typeof end.connectorId === "string" && end.connectorId
    && typeof end.housingNodeName === "string" && end.housingNodeName
    && typeof end.recessNodeName === "string" && end.recessNodeName
    && Array.isArray(end.sourceNodeNames) && end.sourceNodeNames.length === 2
    && end.sourceNodeNames.includes(end.housingNodeName) && end.sourceNodeNames.includes(end.recessNodeName)
    && Number(end.engagementDepthM) === Number(harness.engagementDepthM)
    && normalizeSignal(end.contact?.signal) === signal
    && end.contact?.connectorId === end.connectorId
    && end.contact?.connectorFamily === harness.connectorFamily
    && end.contact?.gender === harness.gender
    && validPhysicalContact(end.contact)
    && normalizeSignal(end.wireExit?.signal) === signal
    && finiteVec3(end.wireExit?.position)
    && finiteVec3(end.wireExit?.normal)
    && Math.hypot(...end.wireExit.normal) > 0;
}

function validIncludedHarnessTopology(topology) {
  return topology?.primitiveMode === 4
    && Number.isInteger(topology.radialSegments) && topology.radialSegments >= 3
    && Number.isInteger(topology.ringCount) && topology.ringCount >= 2
    && Number.isInteger(topology.vertexCount) && topology.vertexCount === topology.radialSegments * topology.ringCount + 2
    && Number.isInteger(topology.indexCount) && topology.indexCount === topology.radialSegments * topology.ringCount * 6
    && topology.capped === true
    && topology.extractionMethod === "indexed-capped-tube-ring-centers";
}

function connectorsMateForProfile(left, right) {
  if (normalizeConnectorFamilyForMate(left?.connectorFamily) !== normalizeConnectorFamilyForMate(right?.connectorFamily)) return false;
  const leftGender = String(left?.gender || "").toLowerCase();
  const rightGender = String(right?.gender || "").toLowerCase();
  const leftMale = /male|\bplug\b|plated-ring|contact-pad/.test(leftGender) && !/female/.test(leftGender);
  const rightMale = /male|\bplug\b|plated-ring|contact-pad/.test(rightGender) && !/female/.test(rightGender);
  const leftFemale = /female|receptacle|socket|hook|jaw|clip/.test(leftGender);
  const rightFemale = /female|receptacle|socket|hook|jaw|clip/.test(rightGender);
  return (leftMale && rightFemale) || (rightMale && leftFemale);
}

function normalizeConnectorFamilyForMate(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("2.54mm") && (text.includes("header") || text.includes("socket"))) return "2.54mm_individual_contact";
  if (text.includes("ic_hook") || text.includes("hook_ring") || text.includes("plated_through_hole")) return "ic_hook_plated_contact";
  return text;
}

function physicalSubassemblyContractBlockers({ assetId, contacts, passiveComponents, requiredNetTies }) {
  if (!passiveComponents.length && !requiredNetTies.length) return [];
  if (!passiveComponents.length && requiredNetTies.length) {
    throw new Error(`Required net ties reference no physical subcomponents:${assetId}`);
  }
  const componentById = new Map();
  for (const component of passiveComponents) {
    if (!component?.id || component.componentType !== "resistor"
      || !Number.isFinite(component.resistanceOhms) || component.resistanceOhms <= 0
      || !Number.isFinite(component.tolerancePercent) || component.tolerancePercent < 0
      || component.placementMode !== "retain-glb-local-transform"
      || !Array.isArray(component.sourceNodeNames) || component.sourceNodeNames.length < 3
      || !Array.isArray(component.terminals) || component.terminals.length !== 2
      || !finiteBounds(component.bounds)
      || component.terminals.some((terminal) => !validPhysicalContact(terminal))) {
      throw new Error(`Invalid physical passive component:${assetId}:${component?.id || "unknown"}`);
    }
    if (componentById.has(component.id)) throw new Error(`Duplicate physical passive component:${assetId}:${component.id}`);
    if (new Set(component.terminals.map((terminal) => terminal.id)).size !== component.terminals.length) {
      throw new Error(`Duplicate physical passive terminal:${assetId}:${component.id}`);
    }
    componentById.set(component.id, component);
  }
  if (!requiredNetTies.length) return ["required_passive_network_contract_missing"];
  const contactSignals = new Set(contacts.map((contact) => normalizeSignal(contact.signal)));
  const coveredTerminals = new Set();
  const tieIds = new Set();
  for (const tie of requiredNetTies) {
    if (!tie?.id || tieIds.has(tie.id)) throw new Error(`Duplicate or missing required net tie:${assetId}:${tie?.id || "unknown"}`);
    tieIds.add(tie.id);
    const component = componentById.get(tie.componentId);
    if (!component || !Array.isArray(tie.terminalBindings) || tie.terminalBindings.length !== component.terminals.length) {
      throw new Error(`Incomplete required net tie:${assetId}:${tie.id}`);
    }
    const terminalIds = new Set(component.terminals.map((terminal) => terminal.id));
    for (const binding of tie.terminalBindings) {
      const key = `${component.id}:${binding?.terminalId || ""}`;
      if (!terminalIds.has(binding?.terminalId) || coveredTerminals.has(key)
        || !contactSignals.has(normalizeSignal(binding?.targetSignal))
        || binding.connectionMode !== "routed-conductor"
        || binding.spliceMode !== "at-peripheral-contact") {
        throw new Error(`Invalid required net-tie terminal binding:${assetId}:${tie.id}:${binding?.terminalId || "unknown"}`);
      }
      coveredTerminals.add(key);
    }
  }
  const terminalCount = passiveComponents.reduce((sum, component) => sum + component.terminals.length, 0);
  return coveredTerminals.size === terminalCount
    ? []
    : [`required_passive_network_terminal_coverage_incomplete:${coveredTerminals.size}/${terminalCount}`];
}

function validateMountContract(mount, assetId) {
  if (mount?.kind !== "controller-carrier" || !["align-controller-bounds-to-seat", "align-matching-contact-frames"].includes(mount.transformMethod)) {
    throw new Error(`Invalid mount contract:${assetId}:${mount?.id || "unknown"}`);
  }
  if (!Array.isArray(mount.compatibleAssetIds) || !mount.compatibleAssetIds.length
    || !Array.isArray(mount.seatCenter) || mount.seatCenter.length !== 3 || !mount.seatCenter.every(Number.isFinite)
    || !Array.isArray(mount.rotation) || mount.rotation.length !== 3 || !mount.rotation.every(Number.isFinite)
    || !Number.isFinite(mount.insertionClearanceM)
    || (mount.transformMethod === "align-matching-contact-frames" && (!Number.isInteger(mount.minimumPairedContacts)
      || mount.minimumPairedContacts < 2 || !Number.isFinite(mount.contactAlignmentToleranceM)))) {
    throw new Error(`Incomplete mount contract:${assetId}:${mount.id}`);
  }
}

export function summarizeInterfaceProfiles(profiles) {
  const states = Object.fromEntries(Object.entries(Object.groupBy(profiles, (profile) => profile.state))
    .map(([state, entries]) => [state, entries.length]));
  return {
    total: profiles.length,
    states,
    readyAssetIds: profiles.filter((profile) => profile.state === "ready").map((profile) => profile.assetId),
    incomplete: profiles.filter((profile) => profile.state !== "ready").map((profile) => ({
      assetId: profile.assetId,
      state: profile.state,
      blockers: profile.blockers
    }))
  };
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += character;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

export function catalogRowsByKey(csvText) {
  const rows = parseCsv(csvText);
  const header = rows[0] || [];
  return new Map(rows.slice(1).map((row) => {
    const value = Object.fromEntries(header.map((key, index) => [key, row[index] || ""]));
    return [String(value.asin || catalogKeyFromUrl(value.direct_url)).toUpperCase(), value];
  }).filter(([key]) => key));
}

function activeManifestInterface(profile) {
  if (!profile || typeof profile !== "object") return { contacts: [], connectors: [], requiredNodes: [] };
  const contacts = (profile.endpoints || []).map((endpoint, index) => ({
    id: `${profile.connectorNode || "interface"}:${index}`,
    connectorId: profile.connectorNode || "primary",
    signal: signalFromNode(endpoint.nodeName, index),
    physicalLabel: signalFromNode(endpoint.nodeName, index),
    nodeName: endpoint.nodeName,
    position: endpoint.position || endpoint.tip || null,
    normal: endpoint.normal,
    matingSide: endpoint.matingSide,
    gender: profile.connectorFamily?.includes("male_header") ? "male" : "contact",
    connectorFamily: profile.connectorFamily || "unclassified",
    voltageDomain: voltageForSignal(signalFromNode(endpoint.nodeName, index))
  }));
  const connectors = [{
    id: profile.connectorNode || "primary",
    family: profile.connectorFamily || "unclassified",
    gender: profile.connectorFamily?.includes("male_header") ? "male" : "receptacle",
    contactCount: contacts.length,
    nodeName: profile.connectorNode || null,
    normal: contacts[0]?.normal || null
  }];
  return { contacts, connectors, requiredNodes: profile.requiredNodes || contacts.map((contact) => contact.nodeName) };
}

function sourceManifestInterface(manifest) {
  if (!manifest) return { contacts: [], connectors: [], requiredNodes: [] };
  const anchorContacts = (manifest.anchors || []).map((anchor) => ({
    id: anchor.anchorId,
    connectorId: anchor.connectorId || "primary",
    signal: normalizeSignal(anchor.electricalRole || anchor.physicalLabel),
    physicalLabel: anchor.physicalLabel || anchor.electricalRole || anchor.anchorId,
    nodeName: anchor.nodeName,
    position: Array.isArray(anchor.positionMm) ? anchor.positionMm.map((value) => Number(value) / 1000) : null,
    normal: anchor.normal || null,
    matingSide: matingSide(anchor.normal),
    gender: connectorGender(manifest.connectors, anchor.connectorId),
    connectorFamily: anchor.connectorFamily || connectorFamily(manifest.connectors, anchor.connectorId),
    voltageDomain: anchor.voltageDomain || voltageForSignal(anchor.electricalRole)
  }));
  const cableContacts = (manifest.requiredNodes || []).filter((name) => /(?:contact:\d+|pin-entry)$/.test(name)).map((nodeName, index) => ({
    id: nodeName,
    connectorId: nodeName.includes("qwiic") ? "qwiic-plug" : "individual-socket",
    signal: signalFromNode(nodeName, index),
    physicalLabel: signalFromNode(nodeName, index),
    nodeName,
    position: null,
    normal: null,
    matingSide: nodeName.includes("qwiic") ? "keyed-entry" : "pin-entry",
    gender: nodeName.includes("qwiic") ? "male-plug" : "female-socket",
    connectorFamily: nodeName.includes("qwiic") ? (manifest.connectorFamily || "jst_sh_1.0mm_4p_qwiic") : "2.54mm_individual_female_socket",
    voltageDomain: voltageForSignal(signalFromNode(nodeName, index)),
    nodeResolvedByGlb: true
  }));
  const connectors = (manifest.connectors || []).map((connector) => ({
    id: connector.connectorId,
    family: connector.family,
    gender: connector.gender,
    contactCount: connector.contactCount,
    nodeName: connector.nodeName,
    position: Array.isArray(connector.facePositionMm) ? connector.facePositionMm.map((value) => Number(value) / 1000) : null,
    normal: connector.normal || null,
    compatibleWith: connector.compatibleWith || []
  }));
  if (manifest.requiredNodes?.length && !connectors.length) {
    connectors.push(
      { id: "qwiic-plug", family: manifest.connectorFamily, gender: "male-plug", contactCount: 4, nodeName: "connector:qwiic-jst-sh-1.0mm-4p:plug-body", normal: null },
      { id: "individual-socket", family: "2.54mm_individual_female_socket", gender: "female-socket", contactCount: 4, nodeName: null, normal: null }
    );
  }
  return { contacts: [...anchorContacts, ...cableContacts], connectors, requiredNodes: manifest.requiredNodes || anchorContacts.map((contact) => contact.nodeName) };
}

function electricalIntent(asset, row, contacts, category, authoritativeEvidence = null) {
  const catalogElectricalEvidence = [row?.esp32_voltage, row?.current_or_power_notes, row?.listing_title, row?.part_name, row?.exact_qualifying_variant, row?.pin_source_evidence]
    .filter(Boolean).join(" ");
  const text = `${asset.name || ""} ${asset.electricalNote || ""} ${catalogElectricalEvidence}`.toLowerCase();
  const availableSignals = [...new Set(contacts.map((contact) => contact.signal).filter(Boolean))];
  const evidenceRequiredSignals = authoritativeRequiredSignals(authoritativeEvidence, availableSignals, asset.partId);
  const requiredSignals = contacts.length
    ? evidenceRequiredSignals || selectRequiredInterfaceSignals(availableSignals, text, category)
    : inferredRequiredSignals(text);
  const operatingMode = authoritativeEvidence?.operatingModeContract || null;
  const signalDomains = structuredClone(authoritativeEvidence?.signalDomains || {});
  const outputVoltageRangesV = structuredClone(authoritativeEvidence?.outputVoltageRangesV || {});
  for (const [signal, domain] of Object.entries(signalDomains)) {
    if (!outputVoltageRangesV[signal] && /^3\.3V_(?:LOGIC|SINGLE_WIRE_DATA)$/i.test(String(domain))) {
      outputVoltageRangesV[signal] = [0, 3.3];
    }
  }
  const buses = [];
  if (operatingMode?.bus) buses.push(operatingMode.bus);
  else {
    if (/qwiic|stemma|\bi2c\b|\biic\b/.test(text) || requiredSignals.some((signal) => ["SDA", "SCL"].includes(signal))) buses.push("I2C");
    if (/\bspi\b/.test(text)) buses.push("SPI");
    if (/uart|serial|rs-?485/.test(text)) buses.push("UART");
    if (/analog|\badc\b|aout/.test(text)) buses.push("ADC");
    if (/\bpwm\b|servo/.test(text)) buses.push("PWM");
  }
  return {
    buses: [...new Set(buses)],
    requiredSignals,
    availableSignals,
    connectorIntent: inferConnectorIntent(text),
    inferenceState: contacts.length ? "physical_contacts" : (requiredSignals.length ? "catalog_electrical_only" : "insufficient_evidence"),
    voltageEvidence: authoritativeEvidence?.evidence || row?.esp32_voltage || catalogElectricalEvidence || asset.electricalNote || "",
    powerEvidence: authoritativeEvidence?.powerEvidence || row?.current_or_power_notes || asset.electricalNote || "",
    pinSourceEvidence: authoritativeEvidence?.sourceUrl || row?.pin_source_evidence || "",
    acceptedInputVoltagesV: authoritativeEvidence?.acceptedInputVoltagesV || [],
    preferredEsp32Supply: authoritativeEvidence?.preferredEsp32Supply || "",
    evidenceType: authoritativeEvidence?.evidenceType || "",
    evidenceDate: authoritativeEvidence?.evidenceDate || "",
    signalDomains,
    outputVoltageRangesV,
    controllerMaximumInputVoltageV: authoritativeEvidence?.controllerMaximumInputVoltageV
      ?? controllerMaximumInputVoltageV(asset.partId, category),
    surfaceCapabilitiesBySignal: {
      ...structuredClone(authoritativeEvidence?.surfaceCapabilitiesBySignal || {}),
      ...structuredClone(operatingMode?.surfaceCapabilitiesBySignal || {})
    },
    ...(authoritativeEvidence?.servoLoad ? { servoLoad: structuredClone(authoritativeEvidence.servoLoad) } : {}),
    ...(authoritativeEvidence?.ownerVerifiedCarrierPower
      ? { ownerVerifiedCarrierPower: structuredClone(authoritativeEvidence.ownerVerifiedCarrierPower) }
      : {}),
    ...(authoritativeEvidence?.poweredLogicLoad ? { poweredLogicLoad: structuredClone(authoritativeEvidence.poweredLogicLoad) } : {})
  };
}

function controllerMaximumInputVoltageV(assetId, category) {
  if (category !== "controller") return null;
  return /(?:esp32|xiao)/i.test(String(assetId || "")) ? 3.6 : null;
}

function authoritativeRequiredSignals(evidence, availableSignals, assetId) {
  const declared = evidence?.requiredSignals ?? evidence?.operatingModeContract?.requiredSignals;
  if (declared === undefined) return null;
  if (!Array.isArray(declared) || !declared.length
    || declared.some((signal) => typeof signal !== "string" || !signal.trim())) {
    throw new Error(`Invalid authoritative required signals for ${assetId}`);
  }
  const normalizedAvailable = new Map(availableSignals.map((signal) => [normalizeSignal(signal), signal]));
  const normalizedRequired = declared.map((signal) => normalizeSignal(signal));
  if (new Set(normalizedRequired).size !== normalizedRequired.length) {
    throw new Error(`Duplicate authoritative required signal for ${assetId}`);
  }
  return normalizedRequired.map((signal) => {
    const available = normalizedAvailable.get(signal);
    if (!available) throw new Error(`Authoritative required signal has no physical contact for ${assetId}:${signal}`);
    return available;
  });
}

function peripheralPowerDomainAmbiguous(electrical) {
  const requiresGenericPower = (electrical.requiredSignals || []).some((signal) => /^(?:VCC|VIN|VDD|POWER)$/i.test(signal));
  if (!requiresGenericPower) return false;
  if (["3V3", "5V"].includes(electrical.preferredEsp32Supply)) return false;
  return !/(?:\b3\.3\s*v\b|\b3v3\b|\b5\s*v\b|\bdc\s*5\s*v\b)/i.test(`${electrical.voltageEvidence || ""} ${electrical.powerEvidence || ""}`);
}

function selectRequiredInterfaceSignals(availableSignals, text, category) {
  if (["controller", "carrier", "cable", "power", "power_distribution"].includes(category)) return availableSignals;
  const normalized = new Map(availableSignals.map((signal) => [normalizeSignal(signal), signal]));
  const power = normalized.get("3V3") || normalized.get("VCC") || normalized.get("VIN") || normalized.get("VDD") || normalized.get("5V") || normalized.get("POWER");
  const ground = normalized.get("GND");
  const select = (...signals) => signals.filter(Boolean).filter((signal, index, values) => values.indexOf(signal) === index);
  if (/rs-?485|max485/.test(text) && ground && power
    && ["RO", "RE", "DE", "DI"].every((signal) => normalized.has(signal))) {
    return select(ground, power, ...["RO", "RE", "DE", "DI"].map((signal) => normalized.get(signal)));
  }
  if (/hx711|load.?cell/.test(text) && ground && normalized.has("DAT") && normalized.has("CLK")) {
    return select(ground, normalized.get("VCC"), normalized.get("VDD"), normalized.get("DAT"), normalized.get("CLK"));
  }
  if ((/qwiic|stemma|\bi2c\b|\biic\b/.test(text) || (normalized.has("SDA") && normalized.has("SCL")))
    && ground && power && normalized.has("SDA") && normalized.has("SCL")) {
    return select(ground, power, normalized.get("SDA"), normalized.get("SCL"));
  }
  if ((/uart|serial/.test(text) || (normalized.has("TX") && normalized.has("RX")))
    && ground && power && normalized.has("TX") && normalized.has("RX")) {
    return select(ground, power, normalized.get("TX"), normalized.get("RX"));
  }
  return availableSignals;
}

function normalizeCategory(row, asset) {
  const text = `${row?.category || ""} ${row?.subcategory_or_subtype || ""} ${asset.name || ""}`.toLowerCase();
  const declared = String(row?.category || "").toLowerCase();
  if (INTEGRATED_CONTROLLER_ASSET_IDS.has(asset.partId)) return "controller";
  if (CONNECTOR_BREAKOUT_ASSET_IDS.has(asset.partId)) return "part";
  if (declared === "sensor") return "sensor";
  if (["motion_imu", "color_light", "temperature_humidity_pressure", "temperature_ir", "temperature_pressure"].includes(declared)) return "sensor";
  if (declared === "input") return "input";
  if (declared === "output") return "output";
  if (declared === "display") return "display";
  if (declared === "actuator") return "actuator";
  if (["power", "power_supply", "power_distribution"].includes(declared)) return "power_distribution";
  if (declared === "connector") return "cable";
  if (/dev_board|esp32 boards/.test(declared)) return "controller";
  if (declared === "board" && /esp32|xiao|dev(?:elopment)? board/.test(text)) return "controller";
  if (/accessory/.test(declared) && /expansion|carrier|breakout base/.test(text)) return "carrier";
  if (/expansion|carrier|breakout base/.test(text)) return "carrier";
  if (/dev_board|esp32 board|development board|controller/.test(text)) return "controller";
  if (/\b(?:gps|gnss)\b/.test(text)) return "sensor";
  if (/cable|adapter|connector/.test(text)) return "cable";
  if (/regulated[^.]{0,40}(?:power|supply)|power distribution|servo power/.test(text)) return "power_distribution";
  if (/servo|actuator|motor/.test(text)) return "actuator";
  if (/display|oled|lcd|tft/.test(text)) return "display";
  if (/sensor|breakout|transceiver/.test(text)) return "sensor";
  return "part";
}

function inferredRequiredSignals(text) {
  if (/qwiic|stemma|\bi2c\b|\biic\b/.test(text)) return ["GND", "3V3", "SDA", "SCL"];
  if (/servo/.test(text)) return ["GND", /\b5v\b/.test(text) ? "5V" : "POWER", "PWM"];
  if (/uart|serial|rs-?485/.test(text)) return ["GND", /\b5v\b/.test(text) ? "5V" : "3V3", "TX", "RX"];
  if (/analog|aout|soil moisture|water level/.test(text)) return ["GND", /\b5v\b/.test(text) && !/3\.3v/.test(text) ? "5V" : "3V3", "AOUT"];
  if (/digital|gpio|led module|radar/.test(text)) return ["GND", /\b5v\b/.test(text) && !/3\.3v/.test(text) ? "5V" : "3V3", "GPIO"];
  return [];
}

function inferConnectorIntent(text) {
  if (/grove/.test(text)) return "grove_4p";
  if (/qwiic|stemma/.test(text)) return "jst_sh_1.0mm_4p_qwiic";
  if (/servo/.test(text)) return "servo_3p";
  if (/factory[^.]{0,40}(?:cable|connector)|shrouded connector/.test(text)) return "factory_cable_or_shrouded";
  if (/header|dupont|2\.54\s*mm/.test(text)) return "2.54mm_header";
  return "unclassified";
}

function declaredContacts(connectors, contacts, category) {
  const declared = connectors.reduce((sum, connector) => sum + Math.max(0, Number(connector.contactCount || 0)), 0);
  if (category === "controller") return Math.max(declared, contacts.length, 8);
  return Math.max(declared, contacts.length);
}

function hasControllerCapabilityCoverage(contacts) {
  const signals = new Set(contacts.map((contact) => contact.signal));
  const capabilities = new Set(contacts.flatMap((contact) => contact.capabilities || []));
  const io = contacts.filter((contact) => /GPIO|D\d+|A\d+/.test(contact.signal || ""));
  return signals.has("GND") && signals.has("3V3") && io.length >= 4
    && ["DIGITAL", "ADC", "PWM", "I2C_SDA", "I2C_SCL", "UART_TX", "UART_RX"].every((capability) => capabilities.has(capability));
}

function validPhysicalContact(contact) {
  return Boolean(contact?.nodeName
    && contact?.signal
    && !/^(?:UNSPECIFIED|CONTACT_\d+)$/i.test(contact.signal)
    && Array.isArray(contact?.position)
    && contact.position.length === 3
    && contact.position.every(Number.isFinite)
    && Array.isArray(contact?.normal)
    && contact.normal.length === 3
    && contact.normal.every(Number.isFinite)
    && contact.matingSide);
}

function validateMirroredPowerContactSemantics(profile) {
  const contacts = profile.contacts || [];
  const mirrored = contacts.filter((contact) => (
    contact.mirroredControllerPowerPin === true
    || contact.powerSourceClass === "mirrored_controller_power_contact"
  ));
  if (!mirrored.length) return;

  if (profile.assetId !== S3_CARRIER_ASSET_ID
    || profile.assetSha256 !== S3_CARRIER_ASSET_SHA256
    || mirrored.length !== 1) {
    throw new Error(`Mirrored power contact outside exact carrier scope:${profile.assetId}`);
  }

  const declaredNodes = new Set(
    profile.carrierNetlist?.physicalOutputPolicy?.validatedMirrored5VSupplyNodeNames || []
  );
  for (const contact of mirrored) {
    const scope = contact.mirroredPowerAuthorizationScope;
    const valid = contact.mirroredControllerPowerPin === true
      && contact.powerSourceClass === MIRRORED_POWER_CONTACT_CLASS
      && contact.electricalUsageRole === "positive_power"
      && contact.wireColorRole === "positive_power"
      && normalizeSignal(contact.signal) === "5V"
      && normalizeSignal(contact.physicalLabel) === "5V"
      && contact.voltageDomain === "5V"
      && contact.breakoutLaneRole === "signal"
      && contact.physicalColor === "yellow"
      && contact.allocationAllowed === true
      && (contact.capabilities || []).map(normalizeSignal).includes("5V")
      && declaredNodes.has(contact.nodeName)
      && contact.nodeName === S3_MIRRORED_5V_NODE_NAME
      && scope?.schemaVersion === "MakeableMirroredPowerContactScopeV1"
      && scope?.carrierAssetId === S3_CARRIER_ASSET_ID
      && scope?.carrierAssetSha256 === S3_CARRIER_ASSET_SHA256
      && scope?.contactNodeName === S3_MIRRORED_5V_NODE_NAME
      && scope?.maximumConnections === 1
      && scope?.physicalContactReuse === "forbidden";
    if (!valid) throw new Error(`Invalid mirrored power contact:${profile.assetId}:${contact.nodeName || "unknown"}`);
  }
  if (declaredNodes.size !== mirrored.length
    || [...declaredNodes].some((nodeName) => !mirrored.some((contact) => contact.nodeName === nodeName))) {
    throw new Error(`Mirrored power contact policy mismatch:${profile.assetId}`);
  }
  const policy = profile.carrierNetlist?.physicalOutputPolicy;
  if (policy?.mirrored5VRequiresExplicitPeripheralAuthorization !== true
    || policy?.mirrored5VMaximumConnectionsPerNode !== 1
    || policy?.mirrored5VPhysicalContactReuse !== "forbidden") {
    throw new Error(`Mirrored power contact authorization policy missing:${profile.assetId}`);
  }
}

function validateMirroredPowerAuthorization(profile) {
  const disposition = profile.ownerDisposition;
  const allowedClasses = disposition?.allowedSurfacePowerContactClasses || [];
  const allowsMirrored = allowedClasses.includes(MIRRORED_POWER_CONTACT_CLASS);
  const authorization = disposition?.mirroredPowerAuthorization;
  if (!allowsMirrored && authorization === undefined) return;
  const valid = allowsMirrored
    && authorization?.schemaVersion === "MakeableMirroredPowerAuthorizationV1"
    && typeof authorization?.authorizationId === "string"
    && authorization.authorizationId.length > 0
    && authorization?.peripheralAssetId === profile.assetId
    && authorization?.peripheralAssetSha256 === profile.assetSha256
    && authorization?.carrierAssetId === S3_CARRIER_ASSET_ID
    && authorization?.carrierAssetSha256 === S3_CARRIER_ASSET_SHA256
    && authorization?.contactNodeName === S3_MIRRORED_5V_NODE_NAME
    && authorization?.maximumConnections === 1
    && authorization?.physicalContactReuse === "forbidden";
  if (!valid) throw new Error(`Invalid mirrored power authorization:${profile.assetId}`);
}

function finiteBounds(bounds) {
  return Boolean(bounds
    && Array.isArray(bounds.min)
    && Array.isArray(bounds.max)
    && bounds.min.length === 3
    && bounds.max.length === 3
    && bounds.min.every(Number.isFinite)
    && bounds.max.every(Number.isFinite)
    && bounds.min.every((value, axis) => value <= bounds.max[axis]));
}

function finiteVec3(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function classifiedInterfaceValue(value) {
  const text = String(value || "").trim().toLowerCase();
  return Boolean(text && !["unclassified", "unknown", "unspecified"].includes(text));
}

function routeableSignalLabel(value) {
  const signal = normalizeSignal(value);
  if (!signal || /(?:CONTACT|SLOT|UNSPECIFIED|UNKNOWN)/.test(signal)) return false;
  return /^[A-Z0-9][A-Z0-9_+\/-]{0,23}$/.test(signal);
}

function repeatedControllerSignals(contacts) {
  const counts = new Map();
  for (const contact of contacts) {
    const signal = canonicalControllerSignal(contact.signal);
    if (!/^GPIO\d+$/.test(signal)) continue;
    counts.set(signal, (counts.get(signal) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([signal]) => signal).sort();
}

function canonicalControllerSignal(value) {
  const signal = normalizeSignal(value);
  const match = signal.match(/^(?:GP|IO|GPIO)(\d+)$/);
  return match ? `GPIO${match[1]}` : signal;
}

function uniqueContactPositions(contacts) {
  const positions = contacts.filter((contact) => Array.isArray(contact.position) && contact.position.length === 3);
  const keys = positions.map((contact) => contact.position.map((value) => Math.round(Number(value) * 100_000)).join(":"));
  return new Set(keys).size === keys.length;
}

function dedupeContacts(contacts) {
  const output = new Map();
  for (const contact of contacts) {
    const key = contact.nodeName || contact.id;
    if (key && !output.has(key)) output.set(key, contact);
  }
  return [...output.values()];
}

function knownControllerContacts(asset, contacts) {
  if (asset.partId === "seeed-xiao-esp32s3") {
    const gpioByLabel = Object.freeze({
      D0: 1, D1: 2, D2: 3, D3: 4, D4: 5, D5: 6,
      D6: 43, D7: 44, D8: 7, D9: 8, D10: 9
    });
    return contacts.map((contact) => {
      const physicalLabel = normalizeSignal(contact.physicalLabel || contact.signal);
      const gpio = gpioByLabel[physicalLabel];
      const signal = Number.isInteger(gpio) ? `GPIO${gpio}` : canonicalControllerSignal(contact.signal);
      const capabilities = [
        ...(Number.isInteger(gpio) ? ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM"] : []),
        ...([1, 2, 3, 4, 5, 6].includes(gpio) ? ["ADC"] : []),
        ...(physicalLabel === "D4" ? ["I2C_SDA"] : []),
        ...(physicalLabel === "D5" ? ["I2C_SCL"] : []),
        ...(physicalLabel === "D6" ? ["UART_TX"] : []),
        ...(physicalLabel === "D7" ? ["UART_RX"] : []),
        ...(physicalLabel === "D8" ? ["SPI_SCK"] : []),
        ...(physicalLabel === "D9" ? ["SPI_MISO"] : []),
        ...(physicalLabel === "D10" ? ["SPI_MOSI"] : [])
      ];
      return {
        ...contact,
        signal,
        physicalLabel,
        voltageDomain: voltageForSignal(signal),
        controllerPin: /^GPIO\d+$/.test(signal) ? signal : undefined,
        capabilities: [...new Set(capabilities)],
        capabilityEvidence: "Seeed Studio XIAO ESP32-S3 official pin map for SKU 102010634; D0-D10 map to GPIO1,2,3,4,5,6,43,44,7,8,9 with fixed D4/D5 I2C, D6/D7 UART, and D8-D10 SPI roles"
      };
    });
  }
  if (asset.partId === "thing-plus-esp32") {
    const aliases = Object.freeze({
      SDA: "GPIO21", SCL: "GPIO22", "04": "GPIO14", "06": "GPIO32", "08": "GPIO15",
      "10": "GPIO33", "11": "GPIO27", "12": "GPIO12", FREE: "GPIO4", TX: "GPIO17",
      RX: "GPIO16", POCI: "GPIO19", PICO: "GPIO23", SCK: "GPIO18", A5: "GPIO35",
      A4: "GPIO36", A3: "GPIO39", A2: "GPIO34", A1: "GPIO25", A0: "GPIO26"
    });
    const safeOutputPins = new Set([4, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33]);
    const inputOnlyPins = new Set([34, 35, 36, 39]);
    const adcPins = new Set([4, 14, 25, 26, 27, 32, 33, 34, 35, 36, 39]);
    return contacts.map((contact) => {
      const physicalLabel = normalizeSignal(contact.physicalLabel || contact.signal);
      const signal = aliases[physicalLabel]
        || (physicalLabel === "VUSB" ? "5V" : physicalLabel);
      const gpio = Number(signal.match(/^GPIO(\d+)$/)?.[1]);
      const legalOutput = safeOutputPins.has(gpio);
      const legalInput = legalOutput || inputOnlyPins.has(gpio);
      const capabilities = [
        ...(legalInput ? ["DIGITAL_INPUT"] : []),
        ...(legalOutput ? ["DIGITAL", "DIGITAL_OUTPUT", "PWM"] : []),
        ...(legalInput && adcPins.has(gpio) ? ["ADC"] : []),
        ...(signal === "GPIO21" ? ["I2C_SDA"] : []),
        ...(signal === "GPIO22" ? ["I2C_SCL"] : []),
        ...(signal === "GPIO17" ? ["UART_TX"] : []),
        ...(signal === "GPIO16" ? ["UART_RX"] : []),
        ...(signal === "GPIO19" ? ["SPI_MISO"] : []),
        ...(signal === "GPIO23" ? ["SPI_MOSI"] : []),
        ...(signal === "GPIO18" ? ["SPI_SCK"] : [])
      ];
      return {
        ...contact,
        signal,
        physicalLabel,
        voltageDomain: voltageForSignal(signal),
        controllerPin: /^GPIO\d+$/.test(signal) ? signal : undefined,
        capabilities: [...new Set(capabilities)],
        capabilityEvidence: "SparkFun WRL-20168 graphical datasheet and schematic; GPIO12/GPIO15 strapping, onboard LED/RGB, enable/reset, battery, and NC contacts remain unavailable for generic allocation"
      };
    });
  }
  if (asset.partId === "esp32-c5-lcd-dev-board") {
    const genericSafe = new Set([0, 1, 9, 15]);
    return contacts.map((contact) => {
      const signal = canonicalControllerSignal(contact.signal);
      const gpio = Number(signal.match(/^GPIO(\d+)$/)?.[1]);
      const capabilities = [
        ...(genericSafe.has(gpio) ? ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM"] : []),
        ...([0, 1].includes(gpio) ? ["ADC"] : []),
        ...(signal === "GPIO0" ? ["I2C_SDA"] : []),
        ...(signal === "GPIO1" ? ["I2C_SCL", "SPI_MISO"] : []),
        ...(signal === "GPIO9" ? ["SPI_SCK"] : []),
        ...(signal === "GPIO15" ? ["SPI_MOSI"] : []),
        ...(signal === "GPIO11" ? ["UART_TX"] : []),
        ...(signal === "GPIO12" ? ["UART_RX"] : [])
      ];
      return {
        ...contact,
        signal,
        controllerPin: /^GPIO\d+$/.test(signal) ? signal : contact.controllerPin,
        capabilities: [...new Set(capabilities)],
        capabilityEvidence: "Exact Waveshare ESP32-C5-LCD-2.73 header labels and official board/chip documentation; GPIO2/GPIO3 buttons, GPIO4/GPIO5 SD, GPIO13/GPIO14 USB, GPIO27 onboard I2C/strap, and GPIO28 boot are unavailable for generic allocation"
      };
    });
  }
  if (asset.partId === "esp32-c6-1-3inch-lcd-display-development-board-with-pre-soldered-header") {
    const genericSafe = new Set([1, 2, 3, 16, 17, 20, 23]);
    const adcPins = new Set([1, 2, 3]);
    return contacts.map((contact) => {
      const signal = canonicalControllerSignal(contact.signal);
      const gpio = Number(signal.match(/^GPIO(\d+)$/)?.[1]);
      const capabilities = [
        ...(genericSafe.has(gpio) ? ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM", "I2C_SDA", "I2C_SCL", "UART_TX", "UART_RX"] : []),
        ...(adcPins.has(gpio) ? ["ADC"] : []),
        ...(signal === "GND" ? ["GND"] : []),
        ...(signal === "3V3" ? ["3V3"] : []),
        ...(signal === "5V" ? ["5V"] : [])
      ];
      return {
        ...contact,
        signal,
        controllerPin: /^GPIO\d+$/.test(signal) ? signal : contact.controllerPin,
        capabilities: [...new Set(capabilities)],
        capabilityEvidence: "Waveshare ESP32-C6-LCD-1.3 official interface definition for SKU 33644; GPIO1/GPIO2/GPIO3/GPIO16/GPIO17/GPIO20/GPIO23 are exposed for generic digital, I2C, PWM, and UART use, GPIO1-GPIO3 also support ADC, while GPIO12/GPIO13 remain unavailable to generic allocation because they are the native USB pair"
      };
    });
  }
  if (["esp-wroom-32-multi-pack", "esp32-wroom-32-classic-dev-board", "esp32-0-96-oled-integrated-board"].includes(asset.partId)) {
    const integratedOled = asset.partId === "esp32-0-96-oled-integrated-board";
    const reservedStrappingPins = new Set([2, 5, 12, 15]);
    const safeOutputPins = new Set([4, 13, 14, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33]);
    const inputOnlyPins = new Set([34, 35, 36, 39]);
    const adcPins = new Set([4, 13, 14, 25, 26, 27, 32, 33, 34, 35, 36, 39]);
    return contacts.map((contact) => {
      const physicalLabel = String(contact.nodeName || contact.physicalLabel || contact.signal || "").split(":").at(-1).toUpperCase();
      const aliases = {
        VP: "GPIO36", VN: "GPIO39",
        TX0: "GPIO1", RX0: "GPIO3",
        TX2: "GPIO17", RX2: "GPIO16",
        "GND-L": "GND", "GND-R": "GND",
        EN: "RST"
      };
      const aliased = aliases[physicalLabel]
        || (/^(?:IO|D)(\d+)$/.test(physicalLabel) ? `GPIO${physicalLabel.match(/\d+/)[0]}` : physicalLabel);
      const gpio = Number(aliased.match(/^GPIO(\d+)$/)?.[1]);
      const internalOledPin = integratedOled && [21, 22].includes(gpio);
      const legalOutput = safeOutputPins.has(gpio) && !reservedStrappingPins.has(gpio) && !internalOledPin;
      const legalInput = (legalOutput || inputOnlyPins.has(gpio));
      const capabilities = [
        ...(legalInput ? ["DIGITAL_INPUT"] : []),
        ...(legalOutput ? ["DIGITAL", "DIGITAL_OUTPUT", "PWM"] : []),
        ...(legalInput && adcPins.has(gpio) ? ["ADC"] : []),
        ...(!integratedOled && aliased === "GPIO21" ? ["I2C_SDA"] : []),
        ...(!integratedOled && aliased === "GPIO22" ? ["I2C_SCL"] : []),
        ...(integratedOled && aliased === "GPIO25" ? ["I2C_SDA"] : []),
        ...(integratedOled && aliased === "GPIO26" ? ["I2C_SCL"] : []),
        ...(aliased === "GPIO17" ? ["UART_TX"] : []),
        ...(aliased === "GPIO16" ? ["UART_RX"] : []),
        ...(aliased === "GPIO23" ? ["SPI_MOSI"] : []),
        ...(aliased === "GPIO19" ? ["SPI_MISO"] : []),
        ...(aliased === "GPIO18" ? ["SPI_SCK"] : [])
      ];
      return {
        ...contact,
        signal: aliased,
        controllerPin: /^GPIO\d+$/.test(aliased) ? aliased : contact.controllerPin,
        capabilities: [...new Set(capabilities)],
        capabilityEvidence: integratedOled
          ? "Exact ideaspark B0CN4F354N 30-pin board map and Espressif ESP32 capability constraints; GPIO21/GPIO22 are reserved for the onboard OLED, GPIO2/GPIO5/GPIO12/GPIO15 are excluded from generic output allocation, and GPIO34-GPIO39 remain input-only"
          : "Exact 30-pin ESP-WROOM-32 board map and Espressif ESP32 capability constraints; GPIO2/GPIO5/GPIO12/GPIO15 are excluded from generic output allocation and GPIO34-GPIO39 remain input-only"
      };
    });
  }
  if (asset.partId === "esp32-2432s028r-smart-display") {
    const pinPolicy = Object.freeze({
      GPIO21_TFT_BL: { controllerPin: "GPIO21", capabilities: [], reason: "onboard TFT backlight" },
      GPIO22_P3: { controllerPin: "GPIO22", capabilities: ["DIGITAL", "PWM", "I2C_SCL"] },
      GPIO35: { controllerPin: "GPIO35", capabilities: ["ADC", "DIGITAL_INPUT"] },
      GPIO27: { controllerPin: "GPIO27", capabilities: ["DIGITAL", "PWM", "ADC", "I2C_SDA"] },
      GPIO22_CN1: { controllerPin: "GPIO22", capabilities: ["DIGITAL", "PWM", "I2C_SCL"] },
      GPIO1_TX: { controllerPin: "GPIO1", capabilities: ["UART_TX"] },
      GPIO3_RX: { controllerPin: "GPIO3", capabilities: ["UART_RX"] },
      SPK_A: { capabilities: ["NON_ROUTABLE"], reason: "amplified differential speaker output" },
      SPK_B: { capabilities: ["NON_ROUTABLE"], reason: "amplified differential speaker output" }
    });
    return contacts.map((contact) => {
      const signal = normalizeSignal(contact.signal);
      const policy = pinPolicy[signal];
      if (!policy) return contact;
      return {
        ...contact,
        signal,
        controllerPin: policy.controllerPin,
        capabilities: [...policy.capabilities],
        capabilityEvidence: `ESP32-2432S028R schematic and immutable rear-contact map${policy.reason ? `; unavailable for generic allocation because it is the ${policy.reason}` : ""}`
      };
    });
  }
  if ([
    "esp32-c6-1-47inch-ips-touch-display-development-board-with-pre-soldered-header",
    "waveshare-esp32-c6-lcd-1_47-m"
  ].includes(asset.partId)) {
    return contacts.map((contact) => {
      const physicalLabel = normalizeSignal(contact.physicalLabel || contact.signal);
      const aliases = asset.partId === "waveshare-esp32-c6-lcd-1_47-m"
        ? {
            "BOOT/IO8": "GPIO8", USB_N: "GPIO12", USB_P: "GPIO13", RXD: "GPIO17", RX: "GPIO17",
            TXD: "GPIO16", TX: "GPIO16", VCC_5V: "5V"
          }
        : {};
      const signal = aliases[physicalLabel] || canonicalControllerSignal(contact.signal);
      const gpio = Number(signal.match(/^GPIO(\d+)$/)?.[1]);
      const boardConflicts = asset.partId === "waveshare-esp32-c6-lcd-1_47-m"
        ? new Set([4, 5, 8, 12, 13])
        : new Set([8, 12, 13]);
      const legalIo = Number.isInteger(gpio) && !boardConflicts.has(gpio);
      const capabilities = [
        ...(legalIo ? ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM"] : []),
        ...(legalIo && gpio >= 0 && gpio <= 6 ? ["ADC"] : []),
        ...(signal === "GPIO18" ? ["I2C_SDA"] : []),
        ...(signal === "GPIO19" ? ["I2C_SCL"] : []),
        ...(signal === "GPIO16" ? ["UART_TX"] : []),
        ...(signal === "GPIO17" ? ["UART_RX"] : []),
        ...(signal === "GPIO1" ? ["SPI_SCK"] : []),
        ...(signal === "GPIO2" ? ["SPI_MOSI"] : []),
        ...(signal === "GPIO3" ? ["SPI_MISO"] : [])
      ];
      return {
        ...contact,
        signal,
        physicalLabel,
        voltageDomain: voltageForSignal(signal),
        controllerPin: /^GPIO\d+$/.test(signal) ? signal : contact.controllerPin,
        capabilities: [...new Set([
          ...(legalIo
            ? (contact.capabilities || [])
            : (contact.capabilities || []).filter((capability) => !["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM", "ADC"].includes(capability))),
          ...capabilities
        ])],
        capabilityEvidence: asset.partId === "waveshare-esp32-c6-lcd-1_47-m"
          ? "Waveshare ESP32-C6-LCD-1.47-M official interface definition and ESP32-C6 pin capabilities; GPIO4/GPIO5 TF card, GPIO8 boot/RGB, and GPIO12/GPIO13 native USB remain unavailable for generic allocation"
          : "Waveshare ESP32-C6-Touch-LCD-1.47 official header definition and ESP32-C6 pin capabilities; GPIO8 boot and GPIO12/13 USB remain unavailable for generic allocation"
      };
    });
  }
  if (asset.partId === "waveshare-esp32-s3-eth-ov5640-camera-board") {
    return contacts.map((contact) => {
      const signal = canonicalControllerSignal(contact.signal);
      const gpio = Number(signal.match(/^GPIO(\d+)$/)?.[1]);
      // The board exposes a complete 2x20 Pico-compatible header, but most GPIOs
      // are shared with onboard Ethernet, camera, SD, USB, RGB, or PSRAM. Keep
      // every physical contact in the profile while allowing the allocator to
      // use only the manufacturer's verified conflict-free external bus subset.
      const legalIo = [16, 17, 43, 44].includes(gpio);
      const capabilities = [
        ...(legalIo ? ["DIGITAL", "PWM"] : []),
        ...(legalIo && [16, 17].includes(gpio) ? ["ADC"] : []),
        ...(signal === "GPIO16" ? ["I2C_SDA"] : []),
        ...(signal === "GPIO17" ? ["I2C_SCL"] : []),
        ...(signal === "GPIO43" ? ["UART_TX"] : []),
        ...(signal === "GPIO44" ? ["UART_RX"] : [])
      ];
      return {
        ...contact,
        signal,
        controllerPin: /^GPIO\d+$/.test(signal) ? signal : contact.controllerPin,
        capabilities: [...new Set([
          ...(legalIo
            ? (contact.capabilities || [])
            : (contact.capabilities || []).filter((capability) => !["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM", "ADC"].includes(capability))),
          ...capabilities
        ])],
        capabilityEvidence: "Waveshare ESP32-S3-ETH official schematic and GPIO definition; complete hash-bound 2x20 header map with generic allocation restricted to conflict-free GPIO16, GPIO17, GPIO43, and GPIO44"
      };
    });
  }
  if (asset.partId === "aoicrie-4pcs-esp32-esp32-c3-mini-development-board-pre-soldered") {
    return contacts.map((contact) => {
      const signal = normalizeSignal(contact.signal);
      const capabilities = [
        ...(/^GPIO\d+$/.test(signal) ? ["DIGITAL"] : []),
        ...(/^GPIO[0-5]$/.test(signal) ? ["ADC"] : []),
        ...(/^GPIO(?:[0-9]|10)$/.test(signal) ? ["PWM"] : []),
        ...(signal === "GPIO6" ? ["I2C_SDA"] : []),
        ...(signal === "GPIO7" ? ["I2C_SCL"] : []),
        ...(signal === "GPIO20" ? ["UART_RX"] : []),
        ...(signal === "GPIO21" ? ["UART_TX"] : [])
      ];
      return {
        ...contact,
        capabilities: [...new Set([...(contact.capabilities || []), ...capabilities])],
        controllerPin: /^GPIO\d+$/.test(signal) ? signal : contact.controllerPin,
        capabilityEvidence: "esp32-c3-board-pin-map-and-deterministic-makeable-bus-policy"
      };
    });
  }
  if (asset.partId === "esp32-c3-mini") {
    return contacts.map((contact) => {
      const signal = canonicalControllerSignal(contact.signal);
      const gpio = Number(signal.match(/^GPIO(\d+)$/)?.[1]);
      // This exact DORHEA board exposes a 2x8 header. GPIO2, GPIO8, and GPIO9
      // remain represented physically but are excluded from generic allocation
      // because they are ESP32-C3 strapping pins. USB uses GPIO18/19, which are
      // not present on this header revision.
      const legalIo = Number.isInteger(gpio) && ![2, 8, 9].includes(gpio);
      const capabilities = [
        ...(legalIo ? ["DIGITAL", "PWM"] : []),
        ...(legalIo && gpio >= 0 && gpio <= 5 ? ["ADC"] : []),
        ...(signal === "GPIO6" ? ["I2C_SDA"] : []),
        ...(signal === "GPIO7" ? ["I2C_SCL"] : []),
        ...(signal === "GPIO4" ? ["SPI_SCK"] : []),
        ...(signal === "GPIO5" ? ["SPI_MOSI"] : []),
        ...(signal === "GPIO6" ? ["SPI_MISO"] : []),
        ...(signal === "GPIO10" ? ["UART_TX"] : []),
        ...(signal === "GPIO20" ? ["UART_RX"] : [])
      ];
      return {
        ...contact,
        signal,
        controllerPin: /^GPIO\d+$/.test(signal) ? signal : contact.controllerPin,
        capabilities: [...new Set([
          ...(legalIo
            ? (contact.capabilities || [])
            : (contact.capabilities || []).filter((capability) => !["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM", "ADC"].includes(capability))),
          ...capabilities
        ])],
        capabilityEvidence: "Exact DORHEA 2x8 GLB silkscreen and Espressif ESP32-C3 capability/strapping definition; GPIO2, GPIO8, and GPIO9 are unavailable for generic allocation"
      };
    });
  }
  if (asset.partId === "esp32-camera-board") {
    return contacts.map((contact) => {
      const signal = canonicalControllerSignal(contact.signal);
      const gpio = Number(signal.match(/^GPIO(\d+)$/)?.[1]);
      // This exact 2x20 WROVER camera-board sale form matches Freenove's
      // component-side pin map. Keep the complete physical header, but never
      // allocate camera GPIO4/5/18/19/21/22/23/25/26/27/34/35/36/39,
      // strapping GPIO0/2/12/15, input-only camera pins, or the USB/programming
      // UART. The remaining GPIO13/14/32/33 set is conflict-free while the
      // supplied camera is active; ADC is restricted to ADC1 GPIO32/33 so Wi-Fi
      // cannot invalidate a generated circuit at runtime.
      const legalIo = [13, 14, 32, 33].includes(gpio);
      const capabilities = [
        ...(legalIo ? ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM"] : []),
        ...(legalIo && [32, 33].includes(gpio) ? ["ADC"] : []),
        ...(signal === "GPIO13" ? ["I2C_SDA", "SPI_MOSI", "UART_TX"] : []),
        ...(signal === "GPIO14" ? ["I2C_SCL", "SPI_SCK", "UART_RX"] : []),
        ...(signal === "GPIO32" ? ["SPI_MISO", "UART_RX"] : []),
        ...(signal === "GPIO33" ? ["SPI_CS", "UART_TX"] : [])
      ];
      return {
        ...contact,
        signal,
        controllerPin: /^GPIO\d+$/.test(signal) ? signal : contact.controllerPin,
        capabilities: [...new Set([
          ...(legalIo
            ? (contact.capabilities || [])
            : (contact.capabilities || []).filter((capability) => !["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM", "ADC"].includes(capability))),
          ...capabilities
        ])],
        capabilityEvidence: "Exact hash-bound WROVER camera-board 2x20 GLB silkscreen, Freenove ESP32 WROVER pin map, Freenove camera-reservation table, and Espressif ESP32/WROVER capability restrictions"
      };
    });
  }
  if (asset.partId === "esp32-s3-cam-dev-kit-exact-pre-soldered-header-variant") {
    return contacts.map((contact) => {
      const signal = canonicalControllerSignal(contact.signal);
      const gpio = Number(signal.match(/^GPIO(\d+)$/)?.[1]);
      // The exact 2x7 sale form leaves the separate BOOT/GPIO0 and RESET/EN
      // through-holes unpopulated. Preserve the NC header position physically,
      // and expose only GPIOs that do not collide with camera, TF/MMC, native
      // USB, flash LED, octal PSRAM, or ESP32-S3 strapping functions.
      const legalIo = [1, 14, 41, 42, 43, 44, 47, 48].includes(gpio);
      const capabilities = [
        ...(legalIo ? ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM"] : []),
        ...(legalIo && [1, 14].includes(gpio) ? ["ADC"] : []),
        ...(signal === "GPIO41" ? ["I2C_SDA", "SPI_MOSI"] : []),
        ...(signal === "GPIO42" ? ["I2C_SCL", "SPI_SCK"] : []),
        ...(signal === "GPIO43" ? ["UART_TX"] : []),
        ...(signal === "GPIO44" ? ["UART_RX"] : []),
        ...(signal === "GPIO47" ? ["SPI_MISO"] : []),
        ...(signal === "GPIO48" ? ["SPI_CS"] : [])
      ];
      return {
        ...contact,
        signal,
        controllerPin: /^GPIO\d+$/.test(signal) ? signal : contact.controllerPin,
        capabilities: [...new Set([
          ...(legalIo
            ? (contact.capabilities || [])
            : (contact.capabilities || []).filter((capability) => !["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM", "ADC"].includes(capability))),
          ...capabilities
        ])],
        capabilityEvidence: "Exact hash-bound ESP32-S3-CAM 2x7 sale-form GLB, nulllab schematic and pinout, and Espressif ESP32-S3 capability/strapping restrictions"
      };
    });
  }
  if (asset.partId === "heltec-wifi-lora-32-v4") {
    return contacts.map((contact) => {
      const signal = canonicalControllerSignal(contact.signal);
      const gpio = Number(signal.match(/^GPIO(\d+)$/)?.[1]);
      // The immutable GLB contains the two installed 1x18 main rows, but not
      // the two optional 1x2 auxiliary rows from Heltec's complete 40-pin V4
      // interface. Keep all 36 main contacts. Generic allocation is limited to
      // pins that do not collide with LoRa, GNSS, OLED, USB, user-button,
      // board-control, strapping, or the default debug UART functions.
      const legalIo = [2, 4, 5, 6, 7, 21, 26, 33, 47, 48].includes(gpio);
      const capabilities = [
        ...(legalIo ? ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM"] : []),
        ...(legalIo && [2, 4, 5, 6, 7].includes(gpio) ? ["ADC"] : []),
        ...(signal === "GPIO5" ? ["I2C_SDA"] : []),
        ...(signal === "GPIO6" ? ["I2C_SCL"] : []),
        ...(signal === "GPIO7" ? ["SPI_SCK"] : []),
        ...(signal === "GPIO21" ? ["SPI_MOSI", "UART_TX"] : []),
        ...(signal === "GPIO26" ? ["SPI_MISO", "UART_RX"] : []),
        ...(signal === "GPIO33" ? ["SPI_CS"] : [])
      ];
      return {
        ...contact,
        signal,
        controllerPin: /^GPIO\d+$/.test(signal) ? signal : contact.controllerPin,
        capabilities: [...new Set([
          ...(legalIo
            ? (contact.capabilities || [])
            : (contact.capabilities || []).filter((capability) => !["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM", "ADC"].includes(capability))),
          ...capabilities
        ])],
        capabilityEvidence: "Exact Heltec WiFi LoRa 32 V4 official pin map, immutable manufacturer STEP-derived 2x18 installed-header geometry, and ESP32-S3 onboard-resource/strapping restrictions"
      };
    });
  }
  if (asset.partId === "waveshare-esp32-s3-1-91-amoled-display-board") {
    return contacts.map((contact) => {
      const signal = canonicalControllerSignal(contact.signal);
      const gpio = Number(signal.match(/^GPIO(\d+)$/)?.[1]);
      // The exact -M variant exposes two complete 1x20 rows. Restrict generic
      // allocation to pins not consumed by AMOLED, TF card, IMU, battery ADC,
      // UART, native USB, boot strapping, or the S3R8 octal-memory interface.
      const legalIo = [2, 4, 16, 17, 21, 26, 33, 34, 38].includes(gpio);
      const capabilities = [
        ...(legalIo ? ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM"] : []),
        ...(legalIo && [2, 4].includes(gpio) ? ["ADC"] : []),
        ...(signal === "GPIO16" ? ["I2C_SDA"] : []),
        ...(signal === "GPIO17" ? ["I2C_SCL"] : []),
        ...(signal === "GPIO21" ? ["UART_TX"] : []),
        ...(signal === "GPIO26" ? ["UART_RX"] : []),
        ...(signal === "GPIO33" ? ["SPI_MOSI"] : []),
        ...(signal === "GPIO34" ? ["SPI_MISO"] : []),
        ...(signal === "GPIO38" ? ["SPI_SCK"] : [])
      ];
      return {
        ...contact,
        signal,
        controllerPin: /^GPIO\d+$/.test(signal) ? signal : contact.controllerPin,
        capabilities: [...new Set([
          ...(legalIo
            ? (contact.capabilities || [])
            : (contact.capabilities || []).filter((capability) => !["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM", "ADC"].includes(capability))),
          ...capabilities
        ])],
        capabilityEvidence: "Exact Waveshare ESP32-S3-AMOLED-1.91-M two-row pin map, immutable semantic row centers, onboard-resource map, and Espressif ESP32-S3R8 restrictions"
      };
    });
  }
  if (asset.partId === "waveshare-esp32-s3-2-1-round-display-board") {
    return contacts.map((contact) => {
      const signal = normalizeSignal(contact.signal);
      const policy = {
        SCL: { controllerPin: "GPIO7", capabilities: ["I2C_SCL"] },
        SDA: { controllerPin: "GPIO15", capabilities: ["I2C_SDA"] },
        TX: { controllerPin: "GPIO43", capabilities: ["UART_TX"] },
        RX: { controllerPin: "GPIO44", capabilities: ["UART_RX"] }
      }[signal];
      return {
        ...contact,
        signal,
        controllerPin: policy?.controllerPin || contact.controllerPin,
        capabilities: [...new Set([...(contact.capabilities || []), ...(policy?.capabilities || [])])],
        capabilityEvidence: "Waveshare ESP32-S3-Touch-LCD-2.1 exact connector map; GPIO7/15 are the fixed external I2C bus, GPIO43/44 are the external UART bus, GPIO19/20 remain native USB, and GPIO0 remains a boot-strapping contact"
      };
    });
  }
  if (asset.partId === "esp32-s3-wroom-n16r8-camera-board") {
    return contacts.map((contact) => {
      const signal = canonicalControllerSignal(contact.signal);
      const gpio = Number(signal.match(/^GPIO(\d+)$/)?.[1]);
      // The exact N16R8 camera board exposes 44 header contacts. Preserve the
      // full physical map, but allocate only pins that do not collide with the
      // onboard DVP camera, SD interface, native USB, strapping pins, flash
      // LED, or the N16R8 module's octal PSRAM signals.
      const legalIo = [1, 2, 14, 21, 41, 42, 43, 44, 47, 48].includes(gpio);
      const capabilities = [
        ...(legalIo ? ["DIGITAL", "PWM"] : []),
        ...(legalIo && [1, 2, 14].includes(gpio) ? ["ADC"] : []),
        ...(signal === "GPIO1" ? ["I2C_SDA"] : []),
        ...(signal === "GPIO2" ? ["I2C_SCL"] : []),
        ...(signal === "GPIO43" ? ["UART_TX"] : []),
        ...(signal === "GPIO44" ? ["UART_RX"] : []),
        ...(signal === "GPIO41" ? ["SPI_MOSI"] : []),
        ...(signal === "GPIO47" ? ["SPI_MISO"] : []),
        ...(signal === "GPIO42" ? ["SPI_SCK"] : [])
      ];
      return {
        ...contact,
        signal,
        controllerPin: /^GPIO\d+$/.test(signal) ? signal : contact.controllerPin,
        capabilities: [...new Set([
          ...(legalIo
            ? (contact.capabilities || [])
            : (contact.capabilities || []).filter((capability) => !["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM", "ADC"].includes(capability))),
          ...capabilities
        ])],
        capabilityEvidence: "Exact N16R8 camera-board 2x22 GLB silkscreen, Espressif ESP32-S3 capabilities, and fixed onboard camera/SD/USB/PSRAM conflict exclusions"
      };
    });
  }
  if (["esp32-s3-devkitc-1-n8r2", "esp32-s3-devkit-n16r8"].includes(asset.partId)) {
    return contacts.filter((contact) => /^pin:(?:left|right):/i.test(contact.nodeName || "")).map((contact) => {
      const signal = canonicalS3DevKitSignal(contact.signal);
      const gpio = Number(signal.match(/^GPIO(\d+)$/)?.[1]);
      const legalIo = Number.isInteger(gpio) && ![0, 3, 19, 20, 35, 36, 37, 38, 45, 46].includes(gpio);
      // ESP32-S3 peripheral signals are routed through the GPIO matrix. For
      // independent no-breadboard Qwiic adapters, any conflict-free
      // bidirectional GPIO may therefore serve as SDA or SCL. Keep boot
      // strapping, native USB, the onboard RGB LED, and N8R2 memory pins out
      // of this generic pool instead of pretending multiple adapters can
      // occupy the same physical header contact.
      const legalMatrixI2c = legalIo;
      const capabilities = [
        ...(legalIo ? ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM"] : []),
        ...(legalIo && gpio >= 1 && gpio <= 20 ? ["ADC"] : []),
        ...(legalMatrixI2c ? ["I2C_SDA", "I2C_SCL"] : []),
        ...(signal === "GPIO17" ? ["UART_TX"] : []),
        ...(signal === "GPIO18" ? ["UART_RX"] : []),
        ...(signal === "GPIO43" ? ["UART_TX"] : []),
        ...(signal === "GPIO44" ? ["UART_RX"] : []),
        ...(signal === "GPIO11" ? ["SPI_MOSI"] : []),
        ...(signal === "GPIO13" ? ["SPI_MISO"] : []),
        ...(signal === "GPIO12" ? ["SPI_SCK"] : [])
      ];
      return {
        ...contact,
        signal,
        physicalLabel: signal,
        voltageDomain: voltageForSignal(signal),
        capabilities: [...new Set([...(contact.capabilities || []), ...capabilities])],
        controllerPin: /^GPIO\d+$/.test(signal) ? signal : contact.controllerPin,
        capabilityEvidence: "Espressif ESP32-S3-DevKitC-1 J1/J3 tables and ESP32-S3 GPIO matrix; octal-memory GPIO35/GPIO36/GPIO37, strapping, native USB, and onboard RGB conflicts excluded"
      };
    });
  }
  if (["seeed-xiao-esp32c5", "seeed-xiao-esp32c6"].includes(asset.partId)) {
    const isC5 = asset.partId === "seeed-xiao-esp32c5";
    const gpioByXiaoPin = isC5
      ? Object.freeze({
          D0: "GPIO1", D1: "GPIO0", D2: "GPIO25", D3: "GPIO7", D4: "GPIO23", D5: "GPIO24",
          D6: "GPIO11", D7: "GPIO12", D8: "GPIO8", D9: "GPIO9", D10: "GPIO10"
        })
      : Object.freeze({
          D0: "GPIO0", D1: "GPIO1", D2: "GPIO2", D3: "GPIO21", D4: "GPIO22", D5: "GPIO23",
          D6: "GPIO16", D7: "GPIO17", D8: "GPIO19", D9: "GPIO20", D10: "GPIO18"
        });
    const adcPins = new Set(isC5 ? ["D0"] : ["D0", "D1", "D2"]);
    return contacts.map((contact) => {
      const physicalLabel = normalizeSignal(contact.physicalLabel || contact.signal);
      const controllerPin = gpioByXiaoPin[physicalLabel];
      const signal = physicalLabel === "VBUS" ? "5V" : physicalLabel;
      const capabilities = [
        ...(controllerPin ? ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "PWM"] : []),
        ...(adcPins.has(physicalLabel) ? ["ADC"] : []),
        ...(physicalLabel === "D4" ? ["I2C_SDA"] : []),
        ...(physicalLabel === "D5" ? ["I2C_SCL"] : []),
        ...(physicalLabel === "D6" ? ["UART_TX"] : []),
        ...(physicalLabel === "D7" ? ["UART_RX"] : []),
        ...(physicalLabel === "D8" ? ["SPI_SCK"] : []),
        ...(physicalLabel === "D9" ? ["SPI_MISO"] : []),
        ...(physicalLabel === "D10" ? ["SPI_MOSI"] : []),
        ...(signal === "5V" ? ["5V"] : []),
        ...(signal === "3V3" ? ["3V3"] : []),
        ...(signal === "GND" ? ["GND"] : [])
      ];
      return {
        ...contact,
        signal,
        physicalLabel,
        controllerPin,
        capabilities: [...new Set(capabilities)],
        voltageDomain: voltageForSignal(signal),
        capabilityEvidence: isC5
          ? "Seeed Studio XIAO ESP32-C5 exact pin map: D0-D10 are digital/PWM; D0 ADC; D4/D5 I2C; D6/D7 UART; D8/D9/D10 SPI"
          : "Seeed Studio XIAO ESP32-C6 exact pin map: D0-D10 are digital/PWM; D0-D2 ADC; D4/D5 I2C; D6/D7 UART; D8/D9/D10 SPI"
      };
    });
  }
  if (asset.partId !== "seeed-xiao-esp32c3") return contacts;
  const calibrated = new Map(contacts.map((contact) => [contact.nodeName, contact]));
  const z = calibrated.get("interface:seeed-xiao-esp32c3:right:02:gnd")?.position?.[2] ?? -0.010125000029802322;
  const normal = [0, 0, -1];
  const left = [
    ["D0", "GPIO2", ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "ADC", "PWM"]],
    ["D1", "GPIO3", ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "ADC", "PWM"]],
    ["D2", "GPIO4", ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "ADC", "PWM"]],
    ["D3", "GPIO5", ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "ADC", "PWM"]],
    ["D4", "GPIO6", ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "I2C_SDA", "PWM"]],
    ["D5", "GPIO7", ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "I2C_SCL", "PWM"]],
    ["D6", "GPIO21", ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "UART_TX", "PWM"]]
  ];
  const right = [
    ["5V", "5V", ["5V"]],
    ["GND", "GND", ["GND"]],
    ["3V3", "3V3", ["3V3"]],
    ["D10", "GPIO10", ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "SPI_MOSI"]],
    ["D9", "GPIO9", ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "SPI_MISO"]],
    ["D8", "GPIO8", ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "SPI_SCK"]],
    ["D7", "GPIO20", ["DIGITAL", "DIGITAL_INPUT", "DIGITAL_OUTPUT", "UART_RX", "PWM"]]
  ];
  return [
    ...xiaoRow("left", -0.00762000004760921, left, z, normal),
    ...xiaoRow("right", 0.00762000004760921, right, z, normal)
  ];
}

function canonicalS3DevKitSignal(value) {
  const signal = normalizeSignal(value);
  if (/^GND(?:_|-)?(?:L|R\d?|T|B|C)?$/i.test(signal)) return "GND";
  if (/^3V3(?:_|-)?(?:2|A|B)?$/i.test(signal)) return "3V3";
  if (signal === "EN") return "RST";
  if (signal === "TX") return "GPIO43";
  if (signal === "RX") return "GPIO44";
  return canonicalControllerSignal(signal);
}

function xiaoRow(side, x, pins, z, normal) {
  return pins.map(([signal, controllerPin, capabilities], index) => ({
    id: `xiao-${side}:${index + 1}:${signal}`,
    connectorId: `${side}-header-1x7`,
    signal,
    physicalLabel: signal,
    controllerPin,
    capabilities,
    nodeName: `interface:seeed-xiao-esp32c3:${side}:${String(index + 1).padStart(2, "0")}:${signal.toLowerCase()}`,
    position: [x, 0.007556499797919524 - index * 0.00254, z],
    normal,
    matingSide: "underside",
    gender: "male",
    connectorFamily: "2.54mm_male_header",
    voltageDomain: voltageForSignal(signal),
    evidence: index < 3 && side === "right" || [4, 5].includes(index + 1) && side === "left"
      ? "active-manifest-calibration-node"
      : "calibrated-2.54mm-footprint-and-published-pin-order"
  }));
}

function dedupeConnectors(connectors) {
  const output = new Map();
  for (const connector of connectors) if (connector?.id && !output.has(connector.id)) output.set(connector.id, connector);
  return [...output.values()];
}

function compactEvidence(asset, review, row, source, authoritativeEvidence = null) {
  return [
    { type: "aws_manifest", revision: asset.registryRevision || asset.revision || "", url: asset.url, sha256: asset.sha256 },
    review ? { type: "review_ledger", interfaceEligibility: review.interfaceEligibility || "unreviewed", sourceManifest: review.sourceManifest || "" } : null,
    row ? { type: "verified_catalog", key: asset.catalogKey || row.asin || "", pinSourceEvidence: row.pin_source_evidence || "", sourceUrl: row.direct_url || "" } : null,
    source ? { type: "local_source_manifest", schemaVersion: source.schemaVersion || "", revision: source.revision || "" } : null,
    authoritativeEvidence ? {
      type: "authoritative_electrical_evidence",
      sourceUrl: authoritativeEvidence.sourceUrl,
      assetSha256: authoritativeEvidence.assetSha256,
      acceptedInputVoltagesV: authoritativeEvidence.acceptedInputVoltagesV,
      evidenceType: authoritativeEvidence.evidenceType || "",
      evidenceDate: authoritativeEvidence.evidenceDate || "",
      controllerCapabilityMatrixComplete: authoritativeEvidence.controllerCapabilityMatrixComplete === true,
      includedFactoryHarnessRequired: authoritativeEvidence.includedFactoryHarnessRequired === true,
      supersedesPriorInterfaceReviewBlock: authoritativeEvidence.supersedesPriorInterfaceReviewBlock === true,
      knownBlockers: authoritativeEvidence.knownBlockers || []
    } : null
  ].filter(Boolean);
}

function signalFromNode(nodeName, index) {
  const text = String(nodeName || "").toUpperCase();
  for (const signal of ["GND", "3V3", "5V", "SDA", "SCL", "AOUT", "MOSI", "MISO", "SCK", "TX", "RX", "PWM"]) {
    if (text.includes(signal)) return signal;
  }
  const qwiic = QWIIC_SIGNALS[index % 4];
  return qwiic || `CONTACT_${index + 1}`;
}

function normalizeSignal(value) {
  const text = String(value || "").toUpperCase().replace(/\s+/g, "_");
  if (text === "POWER") return "3V3";
  if (text === "GROUND") return "GND";
  return text || "UNSPECIFIED";
}

function voltageForSignal(signal) {
  const value = normalizeSignal(signal);
  if (value === "GND") return "0V";
  if (value === "3V3") return "3.3V";
  if (value === "5V") return "5V";
  return "3.3V_logic_or_profile_defined";
}

function matingSide(normal) {
  if (!Array.isArray(normal) || normal.length !== 3) return null;
  if (Math.abs(normal[2]) >= Math.max(Math.abs(normal[0]), Math.abs(normal[1]))) return normal[2] >= 0 ? "top" : "underside";
  return "side-entry";
}

function connectorGender(connectors, id) {
  return connectors?.find((connector) => connector.connectorId === id)?.gender || "unclassified";
}

function connectorFamily(connectors, id) {
  return connectors?.find((connector) => connector.connectorId === id)?.family || "unclassified";
}

function catalogKeyFromUrl(value) {
  const match = String(value || "").match(/(?:aliexpress\.(?:us|com)\/item\/)(\d+)/i);
  return match ? `ALI-${match[1]}` : "";
}
