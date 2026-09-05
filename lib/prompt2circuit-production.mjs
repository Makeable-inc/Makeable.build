import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { compileElectricalGraph, connectorIntentForProfile, sourceCapability } from "./prompt2circuit-electrical-compiler.mjs";
import { PROMPT2CIRCUIT_ACTIVE_ASSET_COUNT } from "./prompt2circuit-interface-profiles.mjs";
import { placeAndRouteCircuit } from "./prompt2circuit-placement-router.mjs";
import { mergePrompt2CircuitNodes } from "./prompt2circuit-network-compiler.mjs";
import { semanticCapabilitiesForPart } from "./prompt2circuit-semantic-contract.mjs";
import {
  CONNECTION_MODES,
  connectionModeRequiresCarrier,
  controllerConnectionPolicy,
} from "./controller-connection-mode-policy.mjs";

const QWIIC_ADAPTER_ASSET_ID = "adafruit-4397-qwiic-to-female-sockets";
const LOGICAL_GUIDE_SIGNAL_PALETTE = Object.freeze([
  "#f2cc3d", "#3f8cff", "#35c77a", "#a66cff", "#ff9f43", "#25c4c9",
  "#e879f9", "#84cc16", "#f59e0b", "#6366f1", "#14b8a6", "#ec4899"
]);

export async function loadPrompt2CircuitProfiles(root) {
  const profiles = [];
  for (let batch = 1; batch <= 10; batch += 1) {
    const file = path.join(root, "prompt2circuit/registry/batches", `batch-${String(batch).padStart(3, "0")}.json`);
    const value = JSON.parse(await readFile(file, "utf8"));
    profiles.push(...(value.profiles || []));
  }
  if (profiles.length !== PROMPT2CIRCUIT_ACTIVE_ASSET_COUNT
    || new Set(profiles.map((profile) => profile.assetId)).size !== profiles.length) {
    throw new Error(`interface_registry_cardinality_invalid:${profiles.length}`);
  }
  return profiles;
}

export async function loadPrompt2CircuitGeometryAudit(root) {
  const file = path.join(root, "prompt2circuit/registry/connector-geometry-audit.json");
  const audit = JSON.parse(await readFile(file, "utf8"));
  if (audit.schemaVersion !== "MakeableConnectorGeometryAuditV1") throw new Error(`connector_geometry_audit_schema_invalid:${audit.schemaVersion || "missing"}`);
  if (audit.summary?.profiles !== PROMPT2CIRCUIT_ACTIVE_ASSET_COUNT || !Array.isArray(audit.results)) {
    throw new Error("connector_geometry_audit_coverage_invalid");
  }
  return audit;
}

export function productionPlannerCatalog(parts, profiles, connectorGeometryAudit = null, options = {}) {
  const readyProfiles = new Map((profiles || []).filter((profile) => profileSelectable(profile, connectorGeometryAudit)).map((profile) => [profile.assetId, profile]));
  return (parts || []).filter((part) => {
    // Carriers and cable/adapter products are compiler-owned support assets.
    // They remain available to the electrical compiler through the interface
    // registry, but a user-facing planner must never select them as if they
    // were an independent project capability.
    if (options.userSelectableOnly === true && ["accessory", "connector"].includes(part.category)) return false;
    const readyAssetIds = new Set((part.assemblyAssets || [])
      .filter((asset) => assemblyAssetSelectable(asset, readyProfiles))
      .map((asset) => asset.partId));
    // Multiple ready meshes on one marketplace row are aliases, not permission
    // for the planner to guess which physical sold form the user will receive.
    if (readyAssetIds.size !== 1) return false;
    const [readyAssetId] = [...readyAssetIds];
    if (options.requireStrictOneShot === true
      && oneShotQualificationFailure(part, readyProfiles.get(readyAssetId), { profiles: readyProfiles })) return false;
    if (options.requireControllerCarrier === true && part.category === "controller") {
      const policy = effectiveControllerConnectionPolicy(readyAssetId, part);
      if (policy.mode === CONNECTION_MODES.DEFERRED_NOT_SELECTABLE || policy.readinessBlocker) return false;
      if (!connectionModeRequiresCarrier(policy.mode)) return policy.mode === CONNECTION_MODES.INTEGRATED_DIRECT_WIRE;
      const carrier = readyProfiles.get(policy.requiredCarrierAssetId);
      if (!carrier) return false;
      return (carrier.mounts || []).some((mount) => (
        (mount.compatibleAssetIds || []).includes(readyAssetId)
      ));
    }
    return true;
  }).map((part) => {
    const readyAssetId = (part.assemblyAssets || [])
      .find((asset) => assemblyAssetSelectable(asset, readyProfiles))?.partId || "";
    return ({
    id: part.id,
    name: part.name,
    category: part.category,
    subtype: part.subtype,
    price: part.price,
    voltage: part.voltage,
    notes: part.notes,
    why: part.why,
    connectionType: part.connectionType,
    semanticCapabilities: semanticCapabilitiesForPart(part),
    sensorEvidence: plannerSensorEvidence(part.sensorSpec),
    visualEligibility: "ready",
    interfaceEligibility: "ready",
    selectionStatus: "ready",
    requestAliases: part.category !== "controller"
      ? (readyProfiles.get(readyAssetId)?.aliasPolicy?.requestAliases || [])
      : [],
    controllerConnectionMode: part.category === "controller"
      ? effectiveControllerConnectionPolicy(readyAssetId, part).mode
      : "not_applicable",
    maximumExternalPeripherals: part.category === "controller"
      ? effectiveControllerConnectionPolicy(readyAssetId, part).maximumExternalPeripherals
      : null,
    controllerCarrierAssetId: part.category === "controller"
      ? effectiveControllerConnectionPolicy(readyAssetId, part).requiredCarrierAssetId
      : "",
    controllerCarrier: part.category === "controller"
      ? plannerCarrierContract(
          readyProfiles.get(effectiveControllerConnectionPolicy(readyAssetId, part).requiredCarrierAssetId),
          readyProfiles.get(readyAssetId),
        )
      : null,
    assemblyAssetIds: part.assemblyAssets.filter((asset) => assemblyAssetSelectable(asset, readyProfiles)).map((asset) => asset.partId),
    assemblyInterfaces: part.assemblyAssets.filter((asset) => assemblyAssetSelectable(asset, readyProfiles)).map((asset) => {
      const profile = readyProfiles.get(asset.partId);
      const connectorIntent = connectorIntentForProfile(profile);
      return {
        assetId: asset.partId,
        category: profile.coverage?.category || "part",
        connectorIntent,
        requiredSignals: profile.electrical?.requiredSignals || [],
        requiredControllerCapabilities: Object.fromEntries((profile.electrical?.requiredSignals || []).map((signal) => [
          signal,
          plannerRequiredCapability(signal, profile),
        ])),
        acceptedInputVoltagesV: resolvedAcceptedVoltages(profile),
        preferredEsp32Supply: resolvedPreferredSupply(profile),
        signalDomains: profile.electrical?.signalDomains || {},
        outputVoltageRangesV: profile.electrical?.outputVoltageRangesV || {},
        controllerMaximumInputVoltageV: profile.electrical?.controllerMaximumInputVoltageV ?? null,
        evidenceType: profile.electrical?.evidenceType || "",
        evidenceDate: profile.electrical?.evidenceDate || "",
        ownerDisposition: profile.ownerDisposition || null,
        interfaceEligibility: "ready",
        selectionStatus: "ready",
        physicalEndpointCount: profile.coverage?.physicalEndpointCount || profile.contacts?.length || 0,
        requiredSignalsCovered: profile.coverage?.requiredSignalsCovered || 0,
        nodeNamesUnique: profile.coverage?.nodeNamesUnique === true,
        contactPositionsUnique: profile.coverage?.contactPositionsUnique === true,
        capabilityMatrix: plannerContactMatrix(profile.contacts || []),
        servoLoad: profile.electrical?.servoLoad || null,
        ownerVerifiedCarrierPower: profile.electrical?.ownerVerifiedCarrierPower || null,
        servoHarness: profile.servoHarness ? {
          id: profile.servoHarness.id,
          servoConnectorId: profile.servoHarness.servoConnectorId,
          maximumCableLengthM: profile.servoHarness.maximumCableLengthM,
          diameterM: profile.servoHarness.diameterM,
          minimumBendRadiusM: profile.servoHarness.minimumBendRadiusM
        } : null,
        servoPowerSystem: profile.servoPowerSystem ? {
          outputVoltageV: profile.servoPowerSystem.outputVoltageV,
          continuousCurrentA: profile.servoPowerSystem.continuousCurrentA,
          peakCurrentA: profile.servoPowerSystem.peakCurrentA,
          upstreamPowerResolved: profile.servoPowerSystem.upstreamPowerResolved,
          commonGroundRequired: profile.servoPowerSystem.commonGroundRequired,
          outputCount: profile.servoPowerSystem.outputs?.length || 0
        } : null,
        poweredLogicLoad: profile.electrical?.poweredLogicLoad || null,
        poweredLogicHarness: profile.poweredLogicHarness ? {
          id: profile.poweredLogicHarness.id,
          deviceConnectorId: profile.poweredLogicHarness.deviceConnectorId,
          conductorRoles: profile.poweredLogicHarness.conductors?.map((conductor) => conductor.role) || []
        } : null,
        poweredLogicInterfaceSystem: profile.poweredLogicInterfaceSystem ? {
          outputSupplyVoltageV: profile.poweredLogicInterfaceSystem.outputSupplyVoltageV,
          logicSupplyVoltageV: profile.poweredLogicInterfaceSystem.logicSupplyVoltageV,
          continuousCurrentA: profile.poweredLogicInterfaceSystem.continuousCurrentA,
          peakCurrentA: profile.poweredLogicInterfaceSystem.peakCurrentA,
          upstreamPowerResolved: profile.poweredLogicInterfaceSystem.upstreamPowerResolved,
          commonGroundRequired: profile.poweredLogicInterfaceSystem.commonGroundRequired,
          direction: profile.poweredLogicInterfaceSystem.channel?.direction || ""
        } : null,
        exactMatingCableRequirements: (profile.exactMatingCableRequirements || []).map((requirement) => ({
          id: requirement.id,
          connectorId: requirement.connectorId,
          orderedSignals: requirement.orderedSignals,
          routedSignals: requirement.routedSignals,
          unmatedSignals: requirement.unmatedSignals,
          signalStraps: requirement.signalStraps,
          surfaceCapabilities: requirement.surfaceCapabilities || {}
        })),
        exactMatingCable: profile.exactMatingCable ? {
          id: profile.exactMatingCable.id,
          endpointConnectorId: profile.exactMatingCable.endpointConnectorId,
          orderedSignals: profile.exactMatingCable.orderedSignals,
          routedSignals: profile.exactMatingCable.conductors?.map((conductor) => conductor.signal) || [],
          unmatedSignals: profile.exactMatingCable.unmatedSignals
        } : null,
        selectorShuntRequirements: (profile.selectorShuntRequirements || []).map((requirement) => ({
          id: requirement.id,
          connectorId: requirement.connectorId,
          mode: requirement.mode,
          orderedTargetSignals: requirement.orderedTargetSignals
        })),
        selectorShunt: profile.selectorShunt ? {
          id: profile.selectorShunt.id,
          connectorId: profile.selectorShunt.connectorId,
          contactCount: profile.selectorShunt.contactNodeNames?.length || 0,
          internalContinuity: profile.selectorShunt.internalContinuity
        } : null,
        operatingModeContract: profile.operatingModeContract ? {
          id: profile.operatingModeContract.id,
          mode: profile.operatingModeContract.mode,
          bus: profile.operatingModeContract.bus,
          supplyVoltageV: profile.operatingModeContract.supplyVoltageV,
          requiredSignals: profile.operatingModeContract.requiredSignals,
          surfaceCapabilitiesBySignal: profile.operatingModeContract.surfaceCapabilitiesBySignal,
          outputVoltageRangesV: profile.operatingModeContract.outputVoltageRangesV || {},
          controllerMaximumInputVoltageV: profile.operatingModeContract.controllerMaximumInputVoltageV,
          configurationState: profile.operatingModeContract.configurationState
        } : null,
        requiredSignalStraps: (profile.requiredSignalStraps || []).map((strap) => ({
          id: strap.id,
          fromSignal: strap.fromSignal,
          toSignal: strap.toSignal,
          connectionMode: strap.connectionMode,
          terminationMode: strap.terminationMode
        })),
        terminalOccupancyPolicy: profile.terminalOccupancyPolicy || {
          id: "single-external-conductor-per-physical-contact-v1",
          defaultMaximumTerminations: 1,
          sameNetPhysicalReuse: "forbidden-without-explicit-splitter-or-multi-termination-contract",
          configurationStrapDestination: "separate-compatible-surface-contact"
        },
        passiveComponents: (profile.passiveComponents || []).map((component) => ({
          id: component.id,
          componentType: component.componentType,
          resistanceOhms: component.resistanceOhms,
          tolerancePercent: component.tolerancePercent,
          placementMode: component.placementMode,
          sourceNodeNames: component.sourceNodeNames || [],
          bounds: component.bounds || null,
          terminals: (component.terminals || []).map((terminal) => ({
            id: terminal.id,
            nodeName: terminal.nodeName,
            sourceNodeName: terminal.sourceNodeName,
            connectorFamily: terminal.connectorFamily,
            gender: terminal.gender,
            position: terminal.position,
            normal: terminal.normal,
          })),
        })),
        requiredNetTies: structuredClone(profile.requiredNetTies || []),
        includedFactoryHarnesses: (profile.includedFactoryHarnesses || []).map((harness) => ({
          id: harness.id,
          kind: harness.kind,
          signalAssignmentMethod: harness.signalAssignmentMethod,
          renderPolicy: harness.renderPolicy,
          connectorFamily: harness.connectorFamily,
          gender: harness.gender,
          engagementDepthM: harness.engagementDepthM,
          conductors: (harness.conductors || []).map((conductor) => ({
            id: conductor.id,
            signal: conductor.signal,
            usableLengthM: conductor.usableLengthM,
            diameterM: conductor.diameterM,
            minimumBendRadiusM: conductor.minimumBendRadiusM,
            deviceEnd: plannerHarnessEnd(conductor.deviceEnd),
            surfaceEnd: plannerHarnessEnd(conductor.surfaceEnd),
          })),
          continuityRules: harness.continuityRules || [],
          acceptanceRules: harness.acceptanceRules || [],
        })),
        logicalGuideAccessoryRequirements: [
          ...(profile.logicalGuideAccessoryRequirements || []).map((requirement) => ({
            id: requirement.id || "",
            connectionReadiness: requirement.connectionReadiness || "",
            connectionRequirement: requirement.connectionRequirement || "",
            requiredAccessory: requirement.requiredAccessory || "",
            requiredAccessorySku: requirement.requiredAccessorySku || "",
            connectorFamily: requirement.connectorFamily || "",
            connectorGender: requirement.connectorGender || "",
            straightThrough: requirement.straightThrough === true,
            contactOrder: requirement.contactOrder || [],
            unmatedSignals: requirement.unmatedSignals || [],
            sensorConnectorId: requirement.sensorConnectorId || "",
            requiredCarrierAssetId: requirement.requiredCarrierAssetId || "",
            allowedCarrierConnectorIds: requirement.allowedCarrierConnectorIds || [],
            endA: requirement.endA || null,
            endB: requirement.endB || null,
            purchaseDisposition: requirement.purchaseDisposition || "",
            renderPolicy: requirement.renderPolicy || "instruction-only-off-scene-interconnect",
          })),
          ...(part.assemblyAssets || [])
            .filter((asset) => asset.partId === profile.assetId)
            .map((asset) => ({
              connectionReadiness: asset.connectionReadiness || "",
              connectionRequirement: asset.connectionRequirement || "",
              requiredAccessory: asset.requiredAccessory || "",
              renderPolicy: "instruction-only-off-scene-interconnect",
            }))
        ].filter((requirement) => requirement.connectionRequirement || requirement.requiredAccessory),
        analogInputConsumer: profile.analogInputConsumer ? {
          id: profile.analogInputConsumer.id,
          inputMode: profile.analogInputConsumer.inputMode,
          inputSignals: profile.analogInputConsumer.inputSignals,
          minimumSourceCount: profile.analogInputConsumer.minimumSourceCount,
          maximumInputVoltageV: profile.analogInputConsumer.maximumInputVoltageV
        } : null,
        disabledInterfaces: profile.disabledInterfaces || [],
        requiresCarrier: /qwiic|grove/i.test(connectorIntent),
        compilerInjectedAccessoryAssetIds: connectorIntent === "jst_sh_1.0mm_4p_qwiic"
          ? [QWIIC_ADAPTER_ASSET_ID]
          : [],
        compilerInjectedAccessoryContracts: connectorIntent === "jst_sh_1.0mm_4p_qwiic"
          ? [plannerCompilerInjectedAccessoryContract(readyProfiles.get(QWIIC_ADAPTER_ASSET_ID))].filter(Boolean)
          : []
      };
    })
    });
  });
}

function plannerSensorEvidence(sensorSpec) {
  if (!sensorSpec || typeof sensorSpec !== "object") return null;
  return {
    recordId: sensorSpec.recordId || "",
    canonicalName: sensorSpec.canonicalName || "",
    functionalClass: sensorSpec.functionalClass || "",
    containsSensor: sensorSpec.containsSensor === true,
    integratedController: sensorSpec.integratedController === true,
    requiresTransducer: sensorSpec.requiresTransducer === true,
    manufacturer: sensorSpec.manufacturer || "",
    interface: sensorSpec.interface || "",
    supplyVoltage: sensorSpec.supplyVoltage || "",
    sensingRange: sensorSpec.sensingRange || "",
    accuracy: sensorSpec.accuracy || "",
    resolution: sensorSpec.resolution || "",
    manufacturerDimensionsMm: sensorSpec.manufacturerDimensionsMm || null,
    specCompletenessStatus: sensorSpec.specCompletenessStatus || "incomplete",
  };
}

export function oneShotQualificationFailure(part, profile, { profiles = null } = {}) {
  if (!profile) return "Interface profile is missing from the strict one-shot registry.";
  if (profile.ownerDisposition?.state === "deferred_not_selectable") {
    return `Part is deliberately deferred by owner policy: ${profile.ownerDisposition.reason || "owner_deferred_not_selectable"}.`;
  }
  const exactCategory = part.category === profile.coverage?.category;
  const allowedAlias = (part.category === "accessory" && profile.coverage?.category === "carrier")
    || (part.category === "connector" && profile.coverage?.category === "cable");
  if (!exactCategory && !allowedAlias) {
    return `Catalog category ${part.category} conflicts with interface category ${profile.coverage?.category || "missing"}; the planner may not reinterpret the part's role.`;
  }
  if (part.category === "controller") {
    const policy = effectiveControllerConnectionPolicy(profile.assetId, part);
    if (policy.mode === CONNECTION_MODES.DEFERRED_NOT_SELECTABLE) {
      return `Controller is deliberately unavailable: ${policy.readinessBlocker}.`;
    }
    if (policy.readinessBlocker) return `Controller connection contract is not ready: ${policy.readinessBlocker}.`;
    if (connectionModeRequiresCarrier(policy.mode)) {
      const profileValues = profiles instanceof Map ? [...profiles.values()] : (profiles || []);
      const carrier = profileValues.find((candidate) => candidate?.assetId === policy.requiredCarrierAssetId && candidate.state === "ready");
      const compatibleMount = (carrier?.mounts || []).some((mount) => (
        (mount.compatibleAssetIds || []).includes(profile.assetId)
      ));
      if (!carrier || !compatibleMount) {
        return `Required ${policy.mode} contract is unavailable: ${policy.requiredCarrierAssetId}.`;
      }
    }
  }
  if (part.category === "controller" && effectiveControllerConnectionPolicy(profile.assetId, part).mode === CONNECTION_MODES.XIAO_BASE_REQUIRED) {
    const profileValues = profiles instanceof Map ? [...profiles.values()] : (profiles || []);
    const grovePeripheralPresent = profileValues.some((candidate) => (
      candidate?.state === "ready"
      && !["controller", "carrier", "accessory", "connector", "cable"].includes(candidate.coverage?.category)
      && /grove/i.test(candidate.electrical?.connectorIntent || "")
    ));
    if (!grovePeripheralPresent) {
      return "XIAO Grove dependency is incomplete: the controller seats in the Expansion Board Base, but the live one-shot asset set contains no ready Grove peripheral GLB; non-Grove sensors may not be substituted onto that carrier.";
    }
  }
  if (["controller", "accessory", "connector"].includes(part.category)) return "";
  const profileValues = profiles instanceof Map ? [...profiles.values()] : (profiles || []);
  const readyCarriers = profileValues.filter((candidate) => (
    candidate?.state === "ready" && candidate.coverage?.category === "carrier"
  ));
  const requiredSignals = new Set((profile.electrical?.requiredSignals || []).map((signal) => String(signal).toUpperCase()));
  const acceptedInputVoltages = (profile.electrical?.acceptedInputVoltagesV || []).filter(Number.isFinite);
  const requiresFiveVoltCarrierRail = requiredSignals.has("5V")
    || (String(profile.electrical?.preferredEsp32Supply || "").toUpperCase() === "5V"
      && !acceptedInputVoltages.includes(3.3));
  if (requiresFiveVoltCarrierRail && readyCarriers.length > 0 && profile.electrical?.evidenceType !== "user_bench_verified") {
    const connectorIntent = String(profile.electrical?.connectorIntent || "").toLowerCase();
    const grovePeripheral = connectorIntent.includes("grove");
    const connectorCompatibleCarriers = readyCarriers.filter((carrier) => {
      const carrierIsXiaoGrove = carrier.assetId === "seeed-xiao-expansion-base-103030356";
      return grovePeripheral ? carrierIsXiaoGrove : !carrierIsXiaoGrove;
    });
    const carrierProvidesFiveVoltPeripheralRail = connectorCompatibleCarriers.some((carrier) => (
      (carrier.mounts || []).some((mount) => {
        const restrictions = (mount.powerRestrictions || []).map((value) => String(value).toLowerCase());
        return !restrictions.some((restriction) => (
          restriction.includes("no-5v-sensor-rail")
          || restriction.includes("3v3-sensor-rails-only")
          || restriction.includes("grove-3v3-logic")
        ));
      })
    ));
    if (!carrierProvidesFiveVoltPeripheralRail) {
      return "Compulsory carrier power contract is incompatible: this exact part requires a 5V peripheral rail, but no ready connector-compatible carrier permits one.";
    }
  }
  if (profile.electrical?.poweredLogicLoad && !profile.poweredLogicInterfaceSystem) {
    return "Powered-logic contract is incomplete: this part requires a separate power/level interface system that is not present in the live one-shot asset set.";
  }
  const explicitVoltages = profile.electrical?.acceptedInputVoltagesV || [];
  const explicitSupplyPin = requiredSignals.has("3V3") || requiredSignals.has("5V");
  if (!explicitVoltages.length && !explicitSupplyPin) {
    return "Power contract is incomplete: no source-bound accepted input voltage and no explicit 3V3/5V supply pin are encoded.";
  }
  const buses = profile.electrical?.buses || [];
  if (buses.length > 1 && !profile.operatingModeContract
    && !profile.electrical?.ownerVerifiedCarrierPower) {
    return `Operating mode is not locked for the declared ${buses.join("/")} interfaces; one-shot selection would require a guess.`;
  }
  if (profile.analogInputConsumer) {
    const compatibleAnalogSourcePresent = profileValues.some((candidate) => {
      if (candidate?.state !== "ready" || candidate.assetId === profile.assetId) return false;
      const ranges = candidate.operatingModeContract?.outputVoltageRangesV || {};
      return Object.entries(ranges).some(([signal, range]) => (
        candidate.electrical?.surfaceCapabilitiesBySignal?.[signal] === "ADC"
        && Array.isArray(range) && range.length === 2 && range.every(Number.isFinite)
        && range[0] >= 0 && range[1] <= profile.analogInputConsumer.maximumInputVoltageV
      ));
    });
    if (!compatibleAnalogSourcePresent) {
      return "Analog acquisition dependency is incomplete: no ready source-bound analog-output peripheral is available for the ADC input bank.";
    }
  }
  return "";
}

export function unavailableExactCatalogMentions(idea, allParts, plannerParts, interfaceProfiles = []) {
  const normalizedIdea = normalizeCatalogMention(idea);
  const literalIdea = String(idea || "").toLowerCase();
  if (!normalizedIdea) return [];
  const eligibleIds = new Set((plannerParts || []).map((part) => String(part.id)));
  const profilesByAssetId = new Map((interfaceProfiles || []).map((profile) => [profile.assetId, profile]));
  const strongIdentityMatches = (allParts || []).filter((part) => (
    [part.id, part.asin]
      .map(normalizeCatalogMention)
      .filter(Boolean)
      .some((identity) => catalogMentionSpans(normalizedIdea, identity).length > 0)
  ));
  const strongIdentityNames = strongIdentityMatches.flatMap((part) => (
    [part.name, part.listingTitle, ...(part.assemblyAssets || []).map((asset) => asset.name)]
      .map(normalizeCatalogMention)
      .filter(Boolean)
  ));
  // A retired asset alias may be a substring of the longer, active sold-form
  // name on the same catalog row (for example `gy-302-bh1750` inside the
  // exact SHILLEHTEK GY-302 BH1750 listing).  Treat the complete selectable
  // catalog identity as a ready mention as well as the ready asset identity.
  // Otherwise the pre-Sol gate can reject an explicitly named active product
  // merely because its row retains an immutable retired-duplicate record.
  const readyAssetMentions = [...new Set([
    ...(allParts || []).filter((part) => eligibleIds.has(String(part.id))).flatMap((part) => [
      part.id,
      part.asin,
      part.name,
      part.listingTitle,
      ...(part.assemblyAssets || []).flatMap((asset) => (
        asset.ready === true && (!asset.selectionStatus || asset.selectionStatus === "ready")
          ? [asset.partId, asset.name]
          : []
      )),
    ]),
    ...(plannerParts || []).flatMap((part) => part.requestAliases || []),
  ].map(normalizeCatalogMention).filter(Boolean))];
  const retiredAssetMatches = (allParts || []).flatMap((part) => (part.assemblyAssets || []).flatMap((asset) => {
    if (asset.ready === true && (!asset.selectionStatus || asset.selectionStatus === "ready")) return [];
    const exactIds = [asset.partId].map(normalizeCatalogMention).filter(Boolean);
    const exactNames = [asset.name]
      .map(normalizeCatalogMention)
      .filter((value) => value.split(" ").length >= 5);
    const matchedBy = [...exactIds, ...exactNames].find((value) => {
      const spans = catalogMentionSpans(normalizedIdea, value);
      if (!spans.length) return false;
      const longerReadySpans = readyAssetMentions
        .filter((readyMention) => readyMention.length > value.length && readyMention.includes(value))
        .flatMap((readyMention) => catalogMentionSpans(normalizedIdea, readyMention));
      return spans.some((span) => !longerReadySpans.some((readySpan) => (
        readySpan.start <= span.start && readySpan.end >= span.end
      )));
    });
    if (!matchedBy) return [];
    const explicitSeparateAliasRequest = catalogMentionSpans(normalizedIdea, `separate ${matchedBy}`).length > 0
      || catalogMentionSpans(normalizedIdea, `legacy ${matchedBy}`).length > 0;
    const literalRetiredAssetIdRequested = literalCatalogMentionSpans(
      literalIdea,
      String(asset.partId || "").toLowerCase(),
    ).length > 0;
    const sameSoldFormCanonicalAvailable = eligibleIds.has(String(part.id))
      && (part.assemblyAssets || []).some((candidate) => (
        candidate.partId !== asset.partId
        && candidate.ready === true
        && (!candidate.selectionStatus || candidate.selectionStatus === "ready")
      ));
    const canonicalAliasDeclared = eligibleIds.has(String(part.id))
      && (part.assemblyAssets || []).some((candidate) => {
        const profile = profilesByAssetId.get(candidate.partId);
        return profile?.state === "ready"
          && (profile.aliasPolicy?.requestAliases || [])
            .map(normalizeCatalogMention)
            .includes(matchedBy);
      });
    const handledByCanonicalAlias = !explicitSeparateAliasRequest
      && (canonicalAliasDeclared
        || (!literalRetiredAssetIdRequested && sameSoldFormCanonicalAvailable));
    if (handledByCanonicalAlias) return [];
    return [{
      catalogId: part.id,
      asin: part.asin || "",
      name: asset.name || part.name,
      assetIds: [asset.partId],
      reason: asset.blocker || "exact_asset_not_in_one_shot_planner",
      carrierState: part.breakoutResearch?.state || "not_applicable",
      matchedBy,
    }];
  }));
  const unavailableCatalogMatches = (allParts || []).filter((part) => !eligibleIds.has(String(part.id))).flatMap((part) => {
    const strongIds = [part.asin, part.id]
      .map(normalizeCatalogMention)
      .filter(Boolean);
    const normalizedAssetIds = (part.assemblyAssets || []).map((asset) => asset.partId)
      .map(normalizeCatalogMention)
      .filter(Boolean);
    const exactNames = [part.name, ...(part.assemblyAssets || []).map((asset) => asset.name)]
      .map(normalizeCatalogMention)
      .filter((value) => value.split(" ").length >= 5);
    const strongMatchedBy = strongIds.find((value) => catalogMentionSpans(normalizedIdea, value).length > 0);
    const weakMatchedBy = [...normalizedAssetIds, ...exactNames]
      .sort((left, right) => right.length - left.length)
      .find((value) => catalogMentionSpans(normalizedIdea, value).length > 0);
    const weakMatchOwnedByAnotherStrongIdentity = !strongMatchedBy
      && weakMatchedBy
      && strongIdentityMatches.some((strongPart) => String(strongPart.id) !== String(part.id))
      && strongIdentityNames.some((strongName) => (
        strongName.length > weakMatchedBy.length && strongName.includes(weakMatchedBy)
      ));
    const matchedBy = strongMatchedBy || (weakMatchOwnedByAnotherStrongIdentity ? "" : weakMatchedBy);
    if (!matchedBy) return [];
    const assetIds = (part.assemblyAssets || []).map((asset) => asset.partId);
    const directBlockedProfile = assetIds
      .map((assetId) => profilesByAssetId.get(assetId))
      .find((profile) => profile && profile.state !== "ready");
    const directReadyProfile = assetIds
      .map((assetId) => profilesByAssetId.get(assetId))
      .find((profile) => profile?.state === "ready");
    const strictQualificationBlocker = directReadyProfile
      ? oneShotQualificationFailure(part, directReadyProfile, { profiles: profilesByAssetId })
      : "";
    const carrierId = part.breakoutResearch?.id || part.controllerCarrierAssetId || "";
    const carrierProfile = profilesByAssetId.get(carrierId);
    const carrierBlocked = carrierProfile && carrierProfile.state !== "ready";
    const exactCarrierMountPresent = !carrierId || !carrierProfile || part.category !== "controller"
      ? true
      : (carrierProfile.mounts || []).some((mount) => (
        (mount.compatibleAssetIds || []).some((assetId) => assetIds.includes(assetId))
      ));
    const carrierBlocker = carrierBlocked
      ? `required_carrier_not_ready:${carrierId}:${(carrierProfile.blockers || []).join(";")}`
      : "";
    const missingExactMountBlocker = !exactCarrierMountPresent
      ? `exact_controller_carrier_mount_contract_missing:${assetIds.join(",")}:${carrierId}`
      : "";
    const readyControllerProfilePresent = part.category === "controller"
      && assetIds.some((assetId) => profilesByAssetId.get(assetId)?.state === "ready");
    const missingCarrierProfileBlocker = readyControllerProfilePresent && (!carrierId || !carrierProfile)
      ? "exact_compatible_carrier_not_present_in_active_aws_contract"
      : "";
    const specificCarrierFailure = missingExactMountBlocker || carrierBlocker || missingCarrierProfileBlocker;
    const nonRedundantQualificationBlocker = specificCarrierFailure
      && /^Required\s+\S+\s+contract is unavailable:/i.test(strictQualificationBlocker)
      ? ""
      : strictQualificationBlocker;
    const reason = directBlockedProfile?.blockers?.length
      ? directBlockedProfile.blockers.join("; ")
      : nonRedundantQualificationBlocker || missingExactMountBlocker || carrierBlocker || missingCarrierProfileBlocker
        ? [nonRedundantQualificationBlocker, missingExactMountBlocker, carrierBlocker, missingCarrierProfileBlocker].filter(Boolean).join("; ")
        : part.breakoutResearch?.blocker
          || (part.category === "controller"
            ? "exact_compatible_carrier_not_present_in_active_aws_contract"
            : "exact_part_not_in_one_shot_planner");
    return [{
      catalogId: part.id,
      asin: part.asin || "",
      name: part.name,
      assetIds,
      reason,
      carrierState: directBlockedProfile?.state || carrierProfile?.state || part.breakoutResearch?.state || "missing",
      matchedBy,
    }];
  });
  const seen = new Set();
  return [...retiredAssetMatches, ...unavailableCatalogMatches].filter((match) => {
    const key = `${match.catalogId}:${match.assetIds.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function eligibleExactCatalogMentions(idea, allParts, plannerParts) {
  const normalizedIdea = normalizeCatalogMention(idea);
  if (!normalizedIdea) return [];
  const eligibleIds = new Set((plannerParts || []).map((part) => String(part.id)));
  const plannerById = new Map((plannerParts || []).map((part) => [String(part.id), part]));
  const matches = (allParts || []).filter((part) => eligibleIds.has(String(part.id))).flatMap((part) => {
    const selectableAssets = (part.assemblyAssets || []).filter((asset) => (
      asset.ready === true && (!asset.selectionStatus || asset.selectionStatus === "ready")
    ));
    const shortExactIds = [
      part.id,
      part.asin,
      ...selectableAssets.map((asset) => asset.partId),
      ...(plannerById.get(String(part.id))?.requestAliases || []),
    ]
      .map(normalizeCatalogMention)
      .filter(Boolean);
    const exactNames = [part.name, part.listingTitle, ...selectableAssets.map((asset) => asset.name)]
      .map(normalizeCatalogMention)
      .filter((value) => value.split(" ").length >= 5);
    const matchedBy = [...shortExactIds, ...exactNames]
      .sort((left, right) => right.length - left.length)
      .find((value) => catalogMentionSpans(normalizedIdea, value).length > 0);
    return matchedBy ? [{ catalogId: part.id, matchedBy }] : [];
  });
  const seen = new Set();
  return matches.filter((match) => {
    if (seen.has(match.catalogId)) return false;
    seen.add(match.catalogId);
    return true;
  });
}

const REQUEST_QUANTITY_WORDS = Object.freeze(new Map([
  ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
  ["eleven", 11], ["twelve", 12], ["thirteen", 13], ["fourteen", 14],
  ["fifteen", 15], ["sixteen", 16], ["seventeen", 17], ["eighteen", 18],
  ["nineteen", 19], ["twenty", 20],
]));

/**
 * Preserve an explicit physical quantity for an exact selectable catalog
 * identity. The model may describe the copies differently, but it may not
 * collapse them into one BOM row. Controller multiplicity remains owned by
 * the deterministic resource compiler, so callers apply these counts only to
 * non-controller parts.
 */
export function requestedExactCatalogQuantities(idea, allParts, plannerParts) {
  const normalizedIdea = normalizeCatalogMention(idea);
  return eligibleExactCatalogMentions(idea, allParts, plannerParts).map((mention) => {
    const escapedMention = mention.matchedBy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const quantityPattern = new RegExp(
      `(?:^|\\s)(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\\d{1,2})` +
      `(?:\\s+(?:copies?|units?|pieces?|instances?)(?:\\s+of)?)?\\s+${escapedMention}(?=\\s|$)`,
      "g",
    );
    const quantities = [];
    for (const match of normalizedIdea.matchAll(quantityPattern)) {
      const token = match[1];
      const parsed = REQUEST_QUANTITY_WORDS.get(token) || Number.parseInt(token, 10);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 20) quantities.push(parsed);
    }
    return {
      ...mention,
      requestedCount: quantities.length ? quantities.reduce((sum, value) => sum + value, 0) : 1,
    };
  });
}

function catalogMentionSpans(normalizedText, normalizedMention) {
  if (!normalizedText || !normalizedMention) return [];
  const haystack = ` ${normalizedText} `;
  const needle = ` ${normalizedMention} `;
  const spans = [];
  let from = 0;
  while (from < haystack.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    spans.push({ start: index + 1, end: index + 1 + normalizedMention.length });
    from = index + 1;
  }
  return spans;
}

function literalCatalogMentionSpans(text, mention) {
  if (!text || !mention) return [];
  const haystack = ` ${text} `;
  const needle = ` ${mention} `;
  const spans = [];
  let from = 0;
  while (from < haystack.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    spans.push({ start: index + 1, end: index + 1 + mention.length });
    from = index + 1;
  }
  return spans;
}

function assemblyAssetSelectable(asset, readyProfiles) {
  return readyProfiles.has(asset.partId)
    && asset.ready !== false
    && (!asset.selectionStatus || asset.selectionStatus === "ready");
}

function normalizeCatalogMention(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function resolvedAcceptedVoltages(profile) {
  const declared = profile?.electrical?.acceptedInputVoltagesV || [];
  if (declared.length) return declared;
  const required = new Set((profile?.electrical?.requiredSignals || []).map((signal) => String(signal).toUpperCase()));
  if (required.has("3V3")) return [3.3];
  if (required.has("5V")) return [5];
  return [];
}

function resolvedPreferredSupply(profile) {
  if (profile?.electrical?.preferredEsp32Supply) return profile.electrical.preferredEsp32Supply;
  const accepted = resolvedAcceptedVoltages(profile);
  if (accepted.includes(3.3)) return "3V3";
  if (accepted.includes(5)) return "5V";
  return "";
}

function plannerCarrierContract(profile, controllerProfile = null) {
  if (!profile) return null;
  const controllerMounts = (profile.mounts || []).filter((entry) => entry.kind === "controller-carrier");
  const mount = controllerProfile
    ? controllerMounts.find((entry) => (entry.compatibleAssetIds || []).includes(controllerProfile.assetId)) || null
    : controllerMounts[0] || null;
  const rawAllocatableContacts = (profile.contacts || []).filter((contact) => !/^controller-|xiao-controller-socket/.test(contact.connectorId || ""));
  const allocatableContacts = bindCarrierContactsToController(profile, rawAllocatableContacts, controllerProfile);
  const controllerPinFanout = Object.fromEntries(Object.entries(Object.groupBy(
    allocatableContacts.filter((contact) => contact.controllerPin),
    (contact) => contact.controllerPin,
  )).map(([pin, contacts]) => [pin, contacts.length]));
  return {
    assetId: profile.assetId,
    visualEligibility: "ready",
    interfaceEligibility: "ready",
    selectionStatus: "ready",
    immutableSha256: profile.assetSha256,
    mount: mount ? {
      id: mount.id,
      compatibleAssetIds: mount.compatibleAssetIds || [],
      minimumPairedContacts: mount.minimumPairedContacts,
      contactAlignmentToleranceM: mount.contactAlignmentToleranceM,
      orientationRule: mount.orientationRule,
      powerRestrictions: mount.powerRestrictions || [],
    } : null,
    mounts: controllerMounts.map((entry) => ({
      id: entry.id,
      compatibleAssetIds: entry.compatibleAssetIds || [],
      minimumPairedContacts: entry.minimumPairedContacts,
      contactAlignmentToleranceM: entry.contactAlignmentToleranceM,
      orientationRule: entry.orientationRule,
      powerRestrictions: entry.powerRestrictions || [],
    })),
    allocatablePhysicalContactCount: allocatableContacts.length,
    controllerPinFanout,
    contactMap: plannerContactMatrix(allocatableContacts),
    connectorPorts: (profile.connectors || [])
      .filter((connector) => !(mount?.carrierConnectorIds || []).includes(connector.id))
      .map((connector) => ({
        id: connector.id,
        family: connector.family,
        gender: connector.gender,
        contactCount: connector.contactCount,
      })),
  };
}

function bindCarrierContactsToController(carrierProfile, contacts, controllerProfile) {
  if (carrierProfile.assetId !== "seeed-xiao-expansion-base-103030356" || !controllerProfile) return contacts;
  const controllerByBoardSignal = new Map((controllerProfile.contacts || []).flatMap((contact) => [
    [String(contact.signal || "").toUpperCase(), contact],
    [String(contact.physicalLabel || "").toUpperCase(), contact],
  ]));
  return contacts.map((contact) => {
    if (!String(contact.connectorId || "").startsWith("grove-")) return contact;
    const signal = String(contact.signal || "").toUpperCase();
    const boardSignal = ({ SDA: "D4", SCL: "D5", D0: "D0", TX: "D6", RX: "D7", GND: "GND", "3V3": "3V3" })[signal] || "";
    if (!boardSignal) return contact;
    const controllerContact = controllerByBoardSignal.get(boardSignal);
    if (!controllerContact) throw new Error(`xiao_carrier_controller_binding_missing:${controllerProfile.assetId}:${contact.nodeName}:${boardSignal}`);
    return {
      ...contact,
      controllerBoardPin: boardSignal,
      controllerPin: controllerContact.controllerPin || controllerContact.signal,
      capabilities: [...new Set([...(contact.capabilities || []), ...(controllerContact.capabilities || [])])],
      capabilityEvidence: `deterministic-xiao-expansion-base-propagation:${boardSignal}->${controllerContact.controllerPin || controllerContact.signal}`,
    };
  });
}

function plannerCompilerInjectedAccessoryContract(profile) {
  if (!profile) return null;
  return {
    assetId: profile.assetId,
    visualEligibility: "ready",
    interfaceEligibility: "ready",
    selectionStatus: "ready",
    immutableSha256: profile.assetSha256,
    connectorIntent: profile.electrical?.connectorIntent || "",
    requiredSignals: profile.electrical?.requiredSignals || [],
    requiredSignalsCovered: profile.coverage?.requiredSignalsCovered || 0,
    physicalEndpointCount: profile.coverage?.physicalEndpointCount || profile.contacts?.length || 0,
    nodeNamesUnique: profile.coverage?.nodeNamesUnique === true,
    contactPositionsUnique: profile.coverage?.contactPositionsUnique === true,
    connectors: (profile.connectors || []).map((connector) => ({
      id: connector.id,
      family: connector.family,
      gender: connector.gender,
      contactCount: connector.contactCount,
    })),
    contactMap: plannerContactMatrix(profile.contacts || []),
    renderedInLogicalGuide: false,
  };
}

function plannerRequiredCapability(signal, profile) {
  try {
    return sourceCapability(signal, profile);
  } catch {
    // Non-strict diagnostic/test catalogs may intentionally contain an
    // incomplete power contract. Preserve that absence for Sol instead of
    // crashing catalog serialization; the strict production filter and the
    // deterministic compiler still fail it closed before release.
    return "UNRESOLVED";
  }
}

function plannerHarnessEnd(end) {
  if (!end) return null;
  return {
    connectorId: end.connectorId,
    connectorFamily: end.contact?.connectorFamily || "",
    gender: end.contact?.gender || "",
    signal: end.contact?.signal || "",
    contactNodeName: end.contact?.nodeName || "",
    wireExitNodeName: end.wireExit?.nodeName || "",
    engagementDepthM: end.engagementDepthM,
  };
}

function plannerContactMatrix(contacts) {
  return contacts.map((contact) => ({
    nodeName: contact.nodeName,
    connectorId: contact.connectorId,
    connectorFamily: contact.connectorFamily,
    gender: contact.gender,
    signal: contact.signal,
    controllerBoardPin: contact.controllerBoardPin || "",
    controllerPin: contact.controllerPin || "",
    capabilities: contact.capabilities || [],
    position: contact.position,
    normal: contact.normal,
    matingSide: contact.matingSide,
    nonRoutable: contact.nonRoutable === true,
    maxExternalTerminations: Number.isInteger(contact.maxExternalTerminations)
      && contact.maxExternalTerminations > 0 ? contact.maxExternalTerminations : 1,
  }));
}

export async function createPrompt2CircuitArtifacts({
  parts,
  profiles,
  manifest,
  fetchFn = fetch,
  onEvent = async () => {},
  validateRemoteAssets = true,
  presentationPlanner = null,
  connectorGeometryAudit = null
} = {}) {
  const profileByAsset = new Map((profiles || []).map((profile) => [profile.assetId, profile]));
  const manifestByAsset = new Map((manifest?.assets || []).map((asset) => [asset.partId, asset]));
  const resolved = resolvePartInstances(parts || [], profileByAsset, manifestByAsset);
  await onEvent("aws_registry_resolved", {
    assetCount: resolved.instances.length,
    interfaceRegistryProfiles: profiles.length,
    controllerNodeCount: resolved.nodes.length,
  });
  if (connectorGeometryAudit) {
    assertSelectedConnectorGeometry(resolved.instances, profileByAsset, connectorGeometryAudit);
    await onEvent("connector_geometry_audited", { assetCount: resolved.assetRecords.length, failedGroups: 0 });
  }
  const compiledNodes = resolved.nodes.map((node) => {
    const graph = compileElectricalGraph({
      parts: node.instances,
      profiles,
      controllerPartId: node.controllerPartId,
      carrierPartId: node.carrierPartId,
    });
    const placement = placeAndRouteCircuit({
      parts: node.instances,
      profiles,
      electricalGraph: graph,
      routingMode: "logical-guide",
    });
    return { ...node, graph, placement };
  });
  const network = mergePrompt2CircuitNodes(compiledNodes);
  const { graph, placement } = network;
  await onEvent("named_endpoints_resolved", {
    connectionCount: graph.connections.length,
    netCount: graph.nets.length,
    controllerNodeCount: compiledNodes.length,
    wirelessLinkCount: network.wirelessLinks.length,
  });
  if (network.wirelessLinks.length) {
    await onEvent("espnow_network_compiled", {
      topology: "encrypted-unicast-star",
      controllerNodeCount: network.networkNodes.length,
      wirelessLinkCount: network.wirelessLinks.length,
      firmwareSourceGenerated: false,
    });
  }
  await onEvent("assembly_contract_generated", {
    fingerprint: placement.fingerprint,
    partCount: placement.parts.length,
    controllerNodeCount: compiledNodes.length,
  });

  let presentation;
  if (presentationPlanner) {
    try {
      presentation = await presentationPlanner({ placement, graph, resolved });
    } catch (error) {
      if (!isRetryablePresentationFailure(error)) throw error;
      presentation = {
        ...deterministicPresentation(placement),
        model: "deterministic-contract-renderer",
        reasoningEffort: "none",
        serviceTier: "local-failover",
      };
      await onEvent("wiring_presentation_recovered", {
        reason: presentationFailureCode(error),
      });
    }
  } else {
    presentation = deterministicPresentation(placement);
  }
  validatePresentationAcknowledgement(presentation, placement);
  await onEvent("wiring_generated", {
    model: presentation.model || "deterministic-contract-renderer",
    reasoningEffort: presentation.reasoningEffort || "none",
    serviceTier: presentation.serviceTier || "local",
    wireCount: placement.routes.length
  });

  const modelFetches = validateRemoteAssets
    ? await verifyAwsAssets(resolved.assetRecords, fetchFn, onEvent)
    : resolved.assetRecords.map((asset) => ({ assetId: asset.partId, url: asset.url, sha256: asset.sha256, bytes: 0, verification: "test-bypassed" }));
  const assetById = new Map(resolved.assetRecords.map((asset) => [asset.partId, asset]));
  const instanceById = new Map(resolved.instances.map((part) => [part.id, part]));
  const wiringGuide = {
    hiddenCablePartIds: placement.hiddenCablePartIds || [],
    routes: placement.routes
  };
  const connectionById = new Map(graph.connections.map((connection) => [connection.id, connection]));
  const hiddenCablePartIds = new Set(wiringGuide.hiddenCablePartIds);
  const assemblyParts = placement.parts.filter((part) => !hiddenCablePartIds.has(part.id)).map((part) => {
    const instance = instanceById.get(part.id);
    const asset = assetById.get(part.assetId);
    return {
      id: part.id,
      label: instance?.label || asset?.name || part.assetId,
      assetId: part.assetId,
      role: part.role,
      compilerInjected: instance?.compilerInjected === true,
      ...(instance?.catalogPart?.id ? { catalogPartId: instance.catalogPart.id } : {}),
      assetUrl: asset.url,
      sha256: asset.sha256,
      assembledPosition: part.translation,
      rotation: part.rotation,
      scale: part.scale,
      textFace: "up",
      ...(part.hiddenNodeIncludes?.length ? { hiddenNodeIncludes: part.hiddenNodeIncludes } : {}),
      ...(part.nodeTransformRules?.length ? { nodeTransformRules: part.nodeTransformRules } : {}),
      ...(part.harnessGeometryMode ? { harnessGeometryMode: part.harnessGeometryMode } : {}),
      ...(part.mountedToPartId ? { mountedToPartId: part.mountedToPartId, mountId: part.mountId } : {})
    };
  });
  const assemblyWires = wiringGuide.routes.map((route) => {
    const connection = connectionById.get(route.connectionId || route.wireId);
    const fromEndpoint = route.fromEndpoint || connection?.fromEndpoint;
    const toEndpoint = route.toEndpoint || connection?.toEndpoint;
    const signal = connection?.signal || route.signal;
    return {
      id: route.wireId,
      label: signal,
      signal,
      // The routed placement is the final color authority. Recoloring after
      // Sol sees the placement makes its written legend disagree with the
      // rendered guide even when both stages are independently valid.
      color: route.color || connection?.color || "#f2cc3d",
      radiusM: route.radiusM,
      diameterM: route.diameterM,
      minimumBendRadiusM: route.minimumBendRadiusM,
      measuredMinimumBendRadiusM: route.measuredMinimumBendRadiusM,
      connectionMode: "logical-guide-line",
      ...(route.analogInterconnect ? { analogInterconnect: true } : {}),
      ...(route.requiredSignalStrap ? { requiredSignalStrap: true } : {}),
      ...(route.terminalOccupancyAuthorizationId
        ? { terminalOccupancyAuthorizationId: route.terminalOccupancyAuthorizationId }
        : {}),
      ...(route.inputSignal ? { inputSignal: route.inputSignal } : {}),
      ...(route.planarCrossingForbidden ? { planarCrossingForbidden: true } : {}),
      points: route.points,
      from: connection ? endpointLabel(fromEndpoint, route.points[0]) : worldEndpointLabel(fromEndpoint),
      to: connection ? endpointLabel(toEndpoint, route.points.at(-1)) : worldEndpointLabel(toEndpoint),
      loopCount: 0,
      selfIntersectionCount: 0,
      projectedSelfIntersectionCount: route.projectedSelfIntersectionCount || 0,
      projectedCrossingCount: route.projectedCrossingCount || 0
    };
  });
  const guideSteps = createDeterministicGuideSteps({
    parts: assemblyParts,
    wires: assemblyWires,
    wirelessLinks: network.wirelessLinks,
  });
  const requiredAssets = resolved.assetRecords.map((asset) => ({ id: asset.partId, url: asset.url, sha256: asset.sha256 }));
  return {
    assembly: {
      schemaVersion: "MakeablePrompt2CircuitAssemblyV1",
      state: "ready",
      circuitOnly: true,
      presentationMode: "logical-pin-to-pin-wiring-guide",
      cableAccessoryGeometryRendered: false,
      connectorSleeveGeometryRendered: false,
      networkNodes: network.networkNodes,
      wirelessLinks: network.wirelessLinks,
      requiredAssets,
      parts: assemblyParts,
      wires: assemblyWires,
      steps: presentation.assemblySteps.map((step, index) => ({
        id: `step-${index + 1}`,
        title: step.title,
        beginnerInstruction: step.beginnerInstruction
      })),
      // Sol owns friendly prose, but code owns which immutable parts and
      // connections appear in each beginner step. This prevents a prose model
      // from hiding, inventing, or grouping the wrong physical conductors.
      guideSteps,
      electricalGraph: graph,
      subcomponents: placement.subcomponents,
      rigidMates: placement.rigidMates,
      readiness: {
        assetEligibility: { state: "ready", count: requiredAssets.length },
        ...(connectorGeometryAudit ? { connectorGeometryAudited: true } : {}),
        namedNodesResolved: true,
        electricalGraphValidated: true,
        placementCollisionCleared: true,
        nonLoopingRoutesValidated: true,
        rigidMatesResolved: placement.rigidMates.every((mate) => (
          placement.deformableHarnesses.some((harness) => harness.rigidMateIds.includes(mate.id))
        )),
        requiredPhysicalSubassembliesResolved: graph.invariants.requiredPhysicalSubassembliesResolved,
        requiredSignalStrapsResolved: graph.invariants.requiredSignalStrapsResolved,
        externalTerminalOccupancyValid: graph.invariants.externalTerminalOccupancyValid,
        servoSystemsResolved: graph.invariants.servoSystemsResolved,
        servoPowerBudgetValid: graph.invariants.servoPowerBudgetValid,
        servoCommonGroundResolved: graph.invariants.servoCommonGroundResolved,
        poweredLogicSystemsResolved: graph.invariants.poweredLogicSystemsResolved,
        poweredLogicTranslationResolved: graph.invariants.poweredLogicTranslationResolved,
        poweredLogicPowerBudgetValid: graph.invariants.poweredLogicPowerBudgetValid,
        poweredLogicCommonGroundResolved: graph.invariants.poweredLogicCommonGroundResolved,
        exactMatingCableSystemsResolved: graph.invariants.exactMatingCableSystemsResolved,
        exactMatingCableUnmatedSignalsResolved: graph.invariants.exactMatingCableUnmatedSignalsResolved,
        selectorShuntsResolved: graph.invariants.selectorShuntsResolved,
        operatingModesResolved: graph.invariants.operatingModesResolved,
        controllerNodesResolved: network.networkNodes.every((node) => (
          node.controllerPartId && (!node.carrierPartId || node.partIds.includes(node.carrierPartId))
        )),
        espNowRequired: network.wirelessLinks.length > 0,
        espNowTopologyValidated: network.wirelessLinks.length === 0
          || graph.invariants.espNowTopologyValid === true,
        wirelessLinksExcludedFromPhysicalWires: network.wirelessLinks.every((link) => (
          !assemblyWires.some((wire) => wire.id === link.id)
        ))
      },
      contractFingerprint: placement.fingerprint
    },
    wiring: {
      schemaVersion: "MakeablePrompt2CircuitWiringV1",
      wireCount: assemblyWires.length,
      wirelessLinkCount: network.wirelessLinks.length,
      wires: assemblyWires,
      standard: "exact-endpoint-open-arch-collision-cleared-no-loops",
      presentation: presentation.routingPresentation
    },
    delivery: {
      source: "aws-verified-glb-only",
      modelFetches,
      totalModelBytes: modelFetches.reduce((sum, entry) => sum + Number(entry.bytes || 0), 0),
      generatedModelCount: 0,
      localModelRequests: 0,
      localModelBytes: 0
    },
    firmware: network.firmware,
    prompt2circuit: {
      interfaceProfileCount: profiles.length,
      contractFingerprint: placement.fingerprint,
      circuitOnly: true,
      heroGenerated: false,
      stlGenerated: false,
      housingGenerated: false,
      meshGenerated: false,
      controllerNodeCount: network.networkNodes.length,
      espNowTransportContractGenerated: network.wirelessLinks.length > 0
    }
  };
}

function createDeterministicGuideSteps({ parts = [], wires = [], wirelessLinks = [] } = {}) {
  const partById = new Map(parts.map((part) => [part.id, part]));
  const visiblePartIds = parts.map((part) => part.id);
  const steps = [{
    id: "guide-arrange-parts",
    kind: "placement",
    title: "Place the parts",
    beginnerInstruction: "Set every part text-side up in the positions shown. Keep USB power disconnected while you build the circuit.",
    safetyNote: "Leave USB power disconnected until the final check.",
    visibleParts: visiblePartIds,
    activeWires: [],
    cameraView: "isometric",
  }];

  const mountedControllers = parts.filter((part) => (
    part.role === "controller" && typeof part.mountedToPartId === "string" && part.mountedToPartId
  ));
  for (const controller of mountedControllers) {
    const carrier = partById.get(controller.mountedToPartId);
    steps.push({
      id: `guide-seat-${controller.id}`,
      kind: "mount",
      title: `Seat ${guidePartName(controller)}`,
      beginnerInstruction: `Match the polarity and USB orientation shown, then press ${guidePartName(controller)} straight into ${carrier ? guidePartName(carrier) : "its expansion board"}.`,
      safetyNote: "Check both header rows before pressing. Never force a reversed board.",
      visibleParts: [...new Set([controller.id, controller.mountedToPartId])],
      activeWires: [],
      cameraView: "pin-close-up",
    });
  }

  const groups = new Map();
  for (const wire of wires) {
    const endpointParts = [wire.from?.partId, wire.to?.partId]
      .map((id) => partById.get(id))
      .filter(Boolean);
    const peripheral = endpointParts.find((part) => !["carrier", "controller", "power", "power_distribution"].includes(part.role))
      || endpointParts.at(-1)
      || null;
    const key = peripheral?.id || wire.to?.partId || wire.from?.partId || "connections";
    const current = groups.get(key) || { part: peripheral, wires: [] };
    current.wires.push(wire);
    groups.set(key, current);
  }

  for (const [groupId, group] of groups) {
    const label = group.part ? guidePartName(group.part) : "the labeled pins";
    const relatedParts = group.wires.flatMap((wire) => [wire.from?.partId, wire.to?.partId]).filter(Boolean);
    steps.push({
      id: `guide-connect-${groupId}`,
      kind: "connection",
      title: `Connect ${label}`,
      beginnerInstruction: `Follow only the highlighted lines. Match every labeled pin on ${label} to the exact labeled destination shown on the expansion board.`,
      safetyNote: "Power off before connecting. Red is positive power, black is ground, and every other color is a signal.",
      visibleParts: [...new Set([...visiblePartIds, ...relatedParts])],
      activeWires: group.wires.map((wire) => wire.id),
      cameraView: "pin-close-up",
    });
  }

  if (wirelessLinks.length) {
    steps.push({
      id: "guide-pair-wireless-nodes",
      kind: "wireless",
      title: wirelessLinks.length === 1 ? "Pair the two devices" : "Pair the wireless devices",
      beginnerInstruction: "Power each device separately, load the same project firmware, and follow the on-screen pairing check. ESP-NOW carries the updates over radio, so do not connect a wire between the devices.",
      safetyNote: "Keep the devices close together for the first pairing test. A dashed cyan arc represents radio, not a physical cable.",
      visibleParts: visiblePartIds,
      activeWires: [],
      wirelessLinkIds: wirelessLinks.map((link) => link.id),
      cameraView: "isometric",
    });
  }

  steps.push({
    id: "guide-final-check",
    kind: "verification",
    title: wires.length ? "Check every connection" : wirelessLinks.length ? "Test the wireless update" : "Check the controller",
    beginnerInstruction: wires.length
      ? "Trace every colored line from its first labeled pin to its second labeled pin. Confirm that no pin is skipped, shared, or moved to a neighboring contact."
      : wirelessLinks.length
        ? "Change the value on one device and confirm that the other device updates. Repeat in the opposite direction before placing them on separate desks."
        : "Confirm the controller is upright, its USB connector is reachable, and the screen or built-in controls respond after power is connected.",
    safetyNote: wires.length
      ? "Connect USB power only after power, ground, signal labels, and controller orientation all match the guide."
      : "Use a separate USB power connection for each device; the radio link does not carry power.",
    visibleParts: visiblePartIds,
    activeWires: wires.map((wire) => wire.id),
    ...(wirelessLinks.length ? { wirelessLinkIds: wirelessLinks.map((link) => link.id) } : {}),
    cameraView: "isometric",
  });

  return steps;
}

function guidePartName(part) {
  const label = String(part?.label || "the part").replace(/\s+/g, " ").trim();
  const lower = label.toLowerCase();
  const purposeNames = [
    [/soil.{0,12}moisture|moisture.{0,12}soil/, "the soil moisture sensor"],
    [/\bco2\b|carbon dioxide|scd[- ]?4[01]/, "the CO2 sensor"],
    [/light intensity|ambient light|\blux\b|bh1750|tsl2591/, "the light sensor"],
    [/temperature.{0,18}humidity|humidity.{0,18}temperature|sht3[01]|dht(?:11|22)/, "the temperature and humidity sensor"],
    [/barometric|pressure|bme280|bmp280/, "the pressure sensor"],
    [/presence|\bpir\b|motion sensor|radar/, "the presence sensor"],
    [/rotary|encoder|\bknob\b/, "the rotary knob"],
    [/display|screen|lcd|oled|amoled/, "the screen"],
    [/servo|motor/, "the motor"],
    [/buzzer|sounder|speaker/, "the sound module"],
    [/camera/, "the camera"],
    [/gps|gnss|l76k/, "the location sensor"],
  ];
  if (!["controller", "carrier"].includes(part?.role)) {
    const match = purposeNames.find(([pattern]) => pattern.test(lower));
    if (match) return match[1];
  }
  return label.length <= 54 ? label : `${label.slice(0, 51).trimEnd()}…`;
}

export function deterministicLogicalGuideColors(signals = []) {
  const normalized = signals.map(normalizeLogicalGuideSignal);
  const distinctSignals = [...new Set(normalized.filter((signal) => (
    !isLogicalGuideGround(signal) && !isLogicalGuidePower(signal)
  )))].sort();
  const signalColors = new Map(distinctSignals.map((signal, index) => [
    signal,
    LOGICAL_GUIDE_SIGNAL_PALETTE[index]
      || `hsl(${(47 + index * 137.508) % 360} 72% 54%)`
  ]));
  return normalized.map((signal) => {
    if (isLogicalGuideGround(signal)) return "black";
    if (isLogicalGuidePower(signal)) return "red";
    return signalColors.get(signal);
  });
}

function normalizeLogicalGuideSignal(value) {
  return String(value || "SIGNAL").trim().toUpperCase().replace(/\s+/g, "_");
}

function isLogicalGuideGround(signal) {
  return /^GND(?:_[ABC])?$/.test(signal) || signal === "GROUND";
}

function isLogicalGuidePower(signal) {
  return /^(?:3V3[AB]?|5V|VCC(?:_5V)?|VBUS|VSYS|VIN|VDD|POWER|PLUS)$/.test(signal);
}

function profileSelectable(profile, connectorGeometryAudit) {
  if (profile?.state !== "ready") return false;
  if (!connectorGeometryAudit) return true;
  const groups = connectorGeometryAudit.results.filter((result) => result.assetId === profile.assetId);
  return groups.length > 0
    && groups.every((result) => result.assetSha256 === profile.assetSha256)
    && !groups.some((result) => result.status === "fail");
}

function assertSelectedConnectorGeometry(instances, profileByAsset, connectorGeometryAudit) {
  for (const assetId of new Set(instances.map((instance) => instance.assetId))) {
    const profile = profileByAsset.get(assetId);
    const groups = connectorGeometryAudit.results.filter((result) => result.assetId === assetId);
    if (!groups.length) throw new Error(`connector_geometry_audit_missing:${assetId}`);
    if (groups.some((result) => result.assetSha256 !== profile?.assetSha256)) throw new Error(`connector_geometry_audit_stale_hash:${assetId}`);
    const failures = groups.filter((result) => result.status === "fail");
    if (failures.length) throw new Error(`connector_geometry_audit_failed:${assetId}:${failures.map((result) => result.connectorId).join(",")}`);
  }
}

export async function requestSolAssemblyPresentation({ env, fetchFn = fetch, prompt, placement, graph, resolved }) {
  if (!env?.OPENAI_API_KEY) throw new Error("openai_api_key_missing_for_sol_assembly");
  const model = "gpt-5.6-sol";
  const payload = {
    model,
    service_tier: "priority",
    reasoning: { effort: "xhigh" },
    input: [
      { role: "developer", content: String(prompt || "Return the bounded assembly presentation JSON. Do not alter endpoints, nets, parts, or transforms.") },
      { role: "user", content: JSON.stringify({
        immutableContract: {
          fingerprint: placement.fingerprint,
          partIds: placement.parts.map((part) => part.id),
          connections: graph.connections,
          transforms: placement.parts.map((part) => ({ id: part.id, translation: part.translation, rotation: part.rotation })),
          routes: placement.routes,
          networkNodes: placement.networkNodes || [],
          wirelessLinks: placement.wirelessLinks || [],
        },
        selectedCatalogPartIds: resolved.selectedCatalogPartIds
      }) }
    ],
    text: { format: { type: "json_schema", name: "makeable_assembly_presentation", strict: true, schema: presentationSchema() } }
  };
  const endpoint = `${String(env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/$/, "")}/v1/responses`;
  const directOpenAI = new URL(endpoint).hostname === "api.openai.com";
  const { service_tier: _gatewayUnsupportedTier, ...gatewayPayload } = payload;
  const initialPayload = directOpenAI ? payload : gatewayPayload;
  const requestOptions = (body) => ({
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000)
  });
  let response;
  try {
    response = await fetchFn(endpoint, requestOptions(initialPayload));
  } catch (error) {
    if (/^(?:ABORT_ERR|AbortError|TimeoutError)$/.test(String(error?.code || error?.name || error?.cause?.name || ""))) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    response = await fetchFn(endpoint, requestOptions(initialPayload));
  }
  let data = await response.json();
  let serviceTier = directOpenAI ? "priority" : "auto";
  if (directOpenAI && !response.ok && /service[_\s-]*tier|priority.*(?:unavailable|not enabled|not supported)|doesn't support value priority/i.test(String(data?.error?.message || ""))) {
    serviceTier = "default";
    response = await fetchFn(endpoint, {
      ...requestOptions({ ...payload, service_tier: "default" })
    });
    data = await response.json();
  }
  if (directOpenAI && !response.ok && /service[_\s-]*tier|default.*(?:unavailable|not enabled|not supported)|doesn't support value default/i.test(String(data?.error?.message || ""))) {
    serviceTier = "auto";
    const { service_tier: _serviceTier, ...autoTierPayload } = payload;
    response = await fetchFn(endpoint, {
      ...requestOptions(autoTierPayload)
    });
    data = await response.json();
  }
  if (!response.ok) throw new Error(data?.error?.message || `sol_assembly_request_failed:${response.status}`);
  const parsed = JSON.parse(extractOutputText(data));
  const completed = ensureMandatorySolPresentationSteps(parsed, placement);
  return { ...completed, model, reasoningEffort: "xhigh", serviceTier, requestedServiceTier: "priority" };
}

function presentationFailureCode(error) {
  return String(error?.code || error?.cause?.code || error?.name || "presentation_generation_failed");
}

function isRetryablePresentationFailure(error) {
  const code = presentationFailureCode(error);
  const message = `${String(error?.message || "")} ${String(error?.cause?.message || "")}`;
  return /^(?:ABORT_ERR|AbortError|TimeoutError|UND_ERR_BODY_TIMEOUT|UND_ERR_CONNECT_TIMEOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|ETIMEDOUT)$/.test(code)
    || /fetch failed|terminated|body timeout|network.*(?:failed|reset)|socket.*(?:closed|reset)/i.test(message);
}

function ensureMandatorySolPresentationSteps(presentation, placement) {
  if (!(placement?.wirelessLinks || []).length) return presentation;
  const steps = Array.isArray(presentation?.assemblySteps) ? presentation.assemblySteps : [];
  const stepText = steps.map((step) => `${step?.title || ""} ${step?.beginnerInstruction || ""}`).join("\n");
  if (/ESP[- ]?NOW/i.test(stepText)
    && /wireless|radio|no physical wire|without (?:a )?(?:physical )?(?:wire|cable)/i.test(stepText)) return presentation;
  const mandatoryStep = {
    title: "Provision the ESP-NOW wireless nodes",
    beginnerInstruction: "Keep every controller on the contract's shared radio channel, provision its peer identity and encryption keys at deployment, and verify acknowledged telemetry. ESP-NOW is wireless: add no physical wire or cable between controllers.",
  };
  return {
    ...presentation,
    assemblySteps: steps.length < 8
      ? [...steps, mandatoryStep]
      : [...steps.slice(0, 7), mandatoryStep],
  };
}

function resolvePartInstances(parts, profileByAsset, manifestByAsset) {
  const selected = [];
  for (const [index, part] of parts.entries()) {
    const candidates = (part.assemblyAssets || []).filter((asset) => {
      const profile = profileByAsset.get(asset.partId);
      return profile?.state === "ready" && profile.ownerDisposition?.state !== "deferred_not_selectable";
    });
    if (candidates.length !== 1) throw new Error(`selected_part_interface_asset_count_invalid:${part.id}:${candidates.length}`);
    const asset = candidates[0];
    const profile = profileByAsset.get(asset.partId);
    assertManifestIdentity(asset.partId, asset.sha256, manifestByAsset);
    selected.push({
      id: stableInstanceId(part.category || profile.coverage?.category || "part", index, asset.partId),
      label: part.name,
      assetId: asset.partId,
      role: profile.coverage?.category || part.category || "part",
      catalogPart: part,
      compilerInjected: false,
    });
  }
  const controllers = selected.filter((part) => part.role === "controller");
  if (!controllers.length) throw new Error("controller_count_invalid:0");
  const peripherals = selected.filter((part) => ![
    "controller", "carrier", "cable", "part", "power", "power_distribution",
  ].includes(part.role));
  const selectedCarriers = selected.filter((part) => part.role === "carrier");
  const supportParts = selected.filter((part) => ["cable", "part", "power", "power_distribution"].includes(part.role));
  const nodes = controllers.map((controller, index) => ({
    id: `node-${index + 1}`,
    controller,
    peripherals: [],
    supportParts: index === 0 ? supportParts : [],
    preferredCarrier: selectedCarriers[index] || null,
    // When an integrated display/camera controller cannot hold the entire
    // requested external BOM, keep it as the clean coordinator/display node.
    // A carrier-backed ESP32 owns all sensor wiring; ESP-NOW owns the bridge.
    coordinatorOnly: index === 0
      && effectiveControllerConnectionPolicy(controller.assetId, controller.catalogPart).mode
        === CONNECTION_MODES.INTEGRATED_DIRECT_WIRE
      && peripherals.length
        > effectiveControllerConnectionPolicy(controller.assetId, controller.catalogPart).maximumExternalPeripherals,
  }));

  for (const peripheral of peripherals) {
    let assigned = false;
    let lastFailure = null;
    for (const node of nodes) {
      if (node.coordinatorOnly) continue;
      if (!controllerCanHostPeripheral(node.controller, peripheral, profileByAsset)) continue;
      const policy = effectiveControllerConnectionPolicy(node.controller.assetId, node.controller.catalogPart);
      if (node.peripherals.length >= policy.maximumExternalPeripherals) continue;
      try {
        preflightNode({ ...node, peripherals: [...node.peripherals, peripheral] }, nodes.indexOf(node), profileByAsset, manifestByAsset);
        node.peripherals.push(peripheral);
        assigned = true;
        break;
      } catch (error) {
        lastFailure = error;
      }
    }
    if (assigned) continue;
    if (nodes.length >= 8) {
      throw networkAssignmentError("espnow_default_encrypted_node_limit_exceeded", peripheral, lastFailure, {
        nodeCount: nodes.length,
      });
    }
    const auxiliaryController = auxiliaryControllerForPeripheral({
      peripheral,
      nodeIndex: nodes.length,
      controllers,
      profileByAsset,
      manifestByAsset,
    });
    const node = {
      id: `node-${nodes.length + 1}`,
      controller: auxiliaryController,
      peripherals: [peripheral],
      supportParts: [],
      preferredCarrier: null,
    };
    try {
      preflightNode(node, nodes.length, profileByAsset, manifestByAsset);
    } catch (error) {
      throw networkAssignmentError("espnow_peripheral_unassignable", peripheral, error, {
        controllerAssetId: auxiliaryController.assetId,
      });
    }
    nodes.push(node);
  }

  // Explicitly selected controllers remain visible even when the requested
  // peripherals fit on an earlier node. This supports a display coordinator
  // plus one or more sensor nodes without inventing a physical inter-board
  // conductor.
  const resolvedNodes = nodes.map((node, index) => preflightNode(
    node,
    index,
    profileByAsset,
    manifestByAsset,
  ));
  const instances = resolvedNodes.flatMap((node) => node.instances);
  if (new Set(instances.map((part) => part.id)).size !== instances.length) {
    throw new Error("network_part_instance_ids_not_unique");
  }
  const assetIds = [...new Set(instances.map((part) => part.assetId))];
  const controller = resolvedNodes[0];
  return {
    instances,
    nodes: resolvedNodes,
    controllerPartId: controller.controllerPartId,
    carrierPartId: controller.carrierPartId,
    selectedCatalogPartIds: parts.map((part) => part.id),
    controllerConnectionMode: controller.controllerConnectionMode,
    compilerInjectedPartIds: instances.filter((part) => part.compilerInjected).map((part) => part.id),
    assetRecords: assetIds.map((id) => manifestByAsset.get(id))
  };
}

function preflightNode(node, nodeIndex, profileByAsset, manifestByAsset) {
  const controller = node.controller;
  const connectionPolicy = effectiveControllerConnectionPolicy(controller.assetId, controller.catalogPart);
  if (connectionPolicy.mode === CONNECTION_MODES.DEFERRED_NOT_SELECTABLE || connectionPolicy.readinessBlocker) {
    throw new Error(`controller_connection_mode_unavailable:${controller.assetId}:${connectionPolicy.readinessBlocker}`);
  }
  if (node.peripherals.length > connectionPolicy.maximumExternalPeripherals) {
    throw new Error(`controller_external_peripheral_capacity_exceeded:${controller.assetId}:${node.peripherals.length}/${connectionPolicy.maximumExternalPeripherals}`);
  }
  for (const peripheral of node.peripherals) {
    if (!controllerCanHostPeripheral(controller, peripheral, profileByAsset)) {
      throw new Error(`controller_peripheral_connector_family_incompatible:${controller.assetId}:${peripheral.assetId}`);
    }
  }
  const requiresCarrier = connectionModeRequiresCarrier(connectionPolicy.mode);
  let carrier = node.preferredCarrier || null;
  if (requiresCarrier) {
    const carrierAssetId = connectionPolicy.requiredCarrierAssetId;
    if (carrier && carrier.assetId !== carrierAssetId) {
      throw new Error(`selected_carrier_incompatible:${carrier.assetId}:${carrierAssetId}`);
    }
    if (!carrier) {
      const carrierProfile = profileByAsset.get(carrierAssetId);
      if (!carrierAssetId || carrierProfile?.state !== "ready") {
        throw new Error(`required_carrier_interface_not_ready:${carrierAssetId || "unresolved"}`);
      }
      assertManifestIdentity(carrierAssetId, carrierProfile.assetSha256, manifestByAsset);
      carrier = {
        id: nodeIndex === 0 ? "carrier" : `carrier-node-${nodeIndex + 1}`,
        label: controller.catalogPart?.breakoutResearch?.name
          || manifestByAsset.get(carrierAssetId)?.name
          || carrierAssetId,
        assetId: carrierAssetId,
        role: "carrier",
        compilerInjected: true,
      };
    }
  } else if (carrier) {
    throw new Error(`carrier_forbidden_for_connection_mode:${controller.assetId}:${connectionPolicy.mode}`);
  }

  const instances = [controller, ...(carrier ? [carrier] : []), ...node.supportParts, ...node.peripherals];
  let qwiicIndex = 0;
  for (const peripheral of node.peripherals) {
    const intent = connectorIntentForProfile(profileByAsset.get(peripheral.assetId));
    if (intent !== "jst_sh_1.0mm_4p_qwiic") continue;
    const cableProfile = profileByAsset.get(QWIIC_ADAPTER_ASSET_ID);
    if (cableProfile?.state !== "ready") throw new Error(`qwiic_adapter_interface_not_ready:${QWIIC_ADAPTER_ASSET_ID}`);
    assertManifestIdentity(QWIIC_ADAPTER_ASSET_ID, cableProfile.assetSha256, manifestByAsset);
    instances.push({
      id: nodeIndex === 0
        ? `qwiic-adapter-${++qwiicIndex}`
        : `qwiic-adapter-node-${nodeIndex + 1}-${++qwiicIndex}`,
      label: "Qwiic-to-female-socket adapter",
      assetId: QWIIC_ADAPTER_ASSET_ID,
      role: "cable",
      compilerInjected: true,
    });
  }
  const graph = compileElectricalGraph({
    parts: instances,
    profiles: [...profileByAsset.values()],
    controllerPartId: controller.id,
    carrierPartId: carrier?.id || "",
  });
  return {
    id: node.id,
    instances,
    controllerPartId: controller.id,
    carrierPartId: carrier?.id || "",
    peripheralPartIds: node.peripherals.map((part) => part.id),
    controllerConnectionMode: connectionPolicy.mode,
    preflightGraphFingerprint: createHash("sha256").update(JSON.stringify(graph)).digest("hex"),
  };
}

function controllerCanHostPeripheral(controller, peripheral, profileByAsset) {
  const policy = effectiveControllerConnectionPolicy(controller.assetId, controller.catalogPart);
  if (policy.mode === CONNECTION_MODES.DEFERRED_NOT_SELECTABLE || policy.readinessBlocker) return false;
  const grove = /grove/i.test(connectorIntentForProfile(profileByAsset.get(peripheral.assetId)));
  if (policy.mode === CONNECTION_MODES.XIAO_BASE_REQUIRED) return grove;
  return !grove;
}

function auxiliaryControllerForPeripheral({ peripheral, nodeIndex, controllers, profileByAsset, manifestByAsset }) {
  const grove = /grove/i.test(connectorIntentForProfile(profileByAsset.get(peripheral.assetId)));
  // The immutable XIAO ESP32S3 visual currently has its board/header geometry
  // inverted relative to the carrier contact contract. Keep it out of
  // automatic Grove-node injection until that exact GLB is requalified. The
  // reviewed XIAO ESP32C6 model has component-side-up geometry and the same
  // ready 2x7 Expansion Board Base mount contract.
  const preferredAssetId = grove ? "seeed-xiao-esp32c6" : "esp32-s3-devkitc-1-n8r2";
  const preferredProfile = profileByAsset.get(preferredAssetId);
  if (preferredProfile?.state === "ready" && manifestByAsset.has(preferredAssetId)) {
    assertManifestIdentity(preferredAssetId, preferredProfile.assetSha256, manifestByAsset);
    return {
      id: `controller-node-${nodeIndex + 1}-${preferredAssetId}`,
      label: manifestByAsset.get(preferredAssetId)?.name || preferredAssetId,
      assetId: preferredAssetId,
      role: "controller",
      catalogPart: null,
      compilerInjected: true,
    };
  }
  const cloneSource = controllers.find((controller) => controllerCanHostPeripheral(controller, peripheral, profileByAsset));
  if (!cloneSource) {
    throw networkAssignmentError("espnow_auxiliary_controller_unavailable", peripheral, null, {
      preferredAssetId,
    });
  }
  return {
    ...cloneSource,
    id: `controller-node-${nodeIndex + 1}-${cloneSource.assetId}`,
    label: `${cloneSource.label} · ESP-NOW node ${nodeIndex + 1}`,
    compilerInjected: true,
  };
}

function networkAssignmentError(code, peripheral, cause, details = {}) {
  const error = new Error(`${code}:${peripheral.assetId}${cause?.message ? `:${cause.message}` : ""}`);
  error.code = code;
  error.details = {
    peripheralPartId: peripheral.id,
    peripheralAssetId: peripheral.assetId,
    causeCode: cause?.code || String(cause?.message || "").split(":")[0] || "",
    ...details,
  };
  return error;
}

async function verifyAwsAssets(assets, fetchFn, onEvent) {
  await onEvent("aws_models_fetch_started", { count: assets.length });
  const records = [];
  for (const asset of assets) {
    if (!/^https:\/\//.test(asset.url || "")) throw new Error(`aws_glb_url_invalid:${asset.partId}`);
    const response = await fetchFn(asset.url);
    if (!response.ok) throw new Error(`aws_glb_fetch_failed:${asset.partId}:${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== asset.sha256) throw new Error(`aws_glb_sha_mismatch:${asset.partId}`);
    if (bytes.toString("ascii", 0, 4) !== "glTF") throw new Error(`aws_glb_magic_invalid:${asset.partId}`);
    records.push({ assetId: asset.partId, url: asset.url, sha256: digest, bytes: bytes.length, verification: "sha256-and-glb-magic" });
  }
  await onEvent("aws_models_fetch_completed", { count: records.length, bytes: records.reduce((sum, entry) => sum + entry.bytes, 0) });
  return records;
}

function assertManifestIdentity(assetId, expectedSha256, manifestByAsset) {
  const asset = manifestByAsset.get(assetId);
  if (!asset) throw new Error(`aws_manifest_asset_missing:${assetId}`);
  if (!/^[a-f0-9]{64}$/.test(asset.sha256 || "") || asset.sha256 !== expectedSha256) throw new Error(`aws_manifest_sha_mismatch:${assetId}`);
  return asset;
}

function deterministicPresentation(placement) {
  return {
    contractFingerprint: placement.fingerprint,
    acknowledgedPartIds: placement.parts.map((part) => part.id),
    assemblySteps: [
      { title: "Arrange the verified parts", beginnerInstruction: "Place every board text-side up in the shown positions without connecting power." },
      ...(placement.parts.some((part) => part.mountedToPartId)
        ? [{ title: "Seat the controller", beginnerInstruction: "Align the controller to the carrier polarity marking, then press both header rows straight into the matching sockets." }]
        : []),
      { title: "Connect each labeled endpoint", beginnerInstruction: "Follow black ground, red positive power, and yellow signal conductors from each labeled source pin to its labeled destination pin." },
      ...((placement.wirelessLinks || []).length
        ? [{
            title: "Provision the ESP-NOW nodes",
            beginnerInstruction: "Keep the radio link wireless: configure every shown controller on the same explicit Wi-Fi channel, provision each peer identity and encryption key at deployment, and verify one acknowledged telemetry packet per sensor node. Do not add a physical wire between controllers.",
          }]
        : []),
      { title: "Check before power", beginnerInstruction: "Confirm every endpoint, polarity, and connector seating against the diagram before attaching USB power." }
    ],
    routingPresentation: { wireDiameterMm: 1.2, minimumBendRadiusMm: 3, style: "short-open-natural-arch", loopsAllowed: false }
  };
}

function validatePresentationAcknowledgement(presentation, placement) {
  if (presentation?.contractFingerprint !== placement.fingerprint) throw new Error("sol_contract_fingerprint_not_acknowledged");
  const expected = [...placement.parts.map((part) => part.id)].sort();
  const received = [...(presentation.acknowledgedPartIds || [])].sort();
  if (JSON.stringify(expected) !== JSON.stringify(received)) throw new Error("sol_part_set_not_acknowledged");
  if (!Array.isArray(presentation.assemblySteps) || !presentation.assemblySteps.length) throw new Error("sol_assembly_steps_missing");
  const stepsText = presentation.assemblySteps
    .map((step) => `${String(step?.title || "")} ${String(step?.beginnerInstruction || "")}`.trim())
    .join("\n");
  if (presentation.assemblySteps.some((step) => !String(step?.title || "").trim() || !String(step?.beginnerInstruction || "").trim())) {
    throw new Error("sol_assembly_step_text_missing");
  }
  if (/\bblocked\b|\bfail(?:ed|ure)?[\s_-]*closed\b|\bdo\s+not\s+(?:render|assemble|show)\b|\bclear\s+(?:all\s+)?stale\s+(?:assembly|scene)\s+state\b/i.test(stepsText)) {
    throw new Error("sol_ready_presentation_contradiction");
  }
  if ((placement.wirelessLinks || []).length && (
    !/ESP[- ]?NOW/i.test(stepsText)
    || !/wireless|radio|no physical wire|without (?:a )?(?:physical )?(?:wire|cable)/i.test(stepsText)
  )) {
    throw new Error("sol_espnow_wireless_step_not_acknowledged");
  }
  if (!presentation.routingPresentation || presentation.routingPresentation.loopsAllowed !== false) {
    throw new Error("sol_ready_presentation_loops_not_forbidden");
  }
  if (/\b(?:loop|coil|rectangular|manhattan|plumbing|pipe)\b/i.test(String(presentation.routingPresentation.style || ""))) {
    throw new Error("sol_ready_presentation_style_invalid");
  }
}

function presentationSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      contractFingerprint: { type: "string" },
      acknowledgedPartIds: { type: "array", items: { type: "string" } },
      assemblySteps: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, beginnerInstruction: { type: "string" } }, required: ["title", "beginnerInstruction"] } },
      routingPresentation: { type: "object", additionalProperties: false, properties: { wireDiameterMm: { type: "number" }, minimumBendRadiusMm: { type: "number" }, style: { type: "string" }, loopsAllowed: { type: "boolean" } }, required: ["wireDiameterMm", "minimumBendRadiusMm", "style", "loopsAllowed"] }
    },
    required: ["contractFingerprint", "acknowledgedPartIds", "assemblySteps", "routingPresentation"]
  };
}

function extractOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  for (const item of data.output || []) for (const content of item.content || []) if (typeof content.text === "string") return content.text;
  throw new Error("sol_assembly_output_missing");
}

function endpointLabel(endpoint, worldPosition) {
  return {
    partId: endpoint.partId,
    nodeName: endpoint.nodeName,
    label: `${endpoint.partId} · ${endpoint.presentationSignal || endpoint.signal}`,
    position: worldPosition
  };
}

function worldEndpointLabel(endpoint) {
  return {
    partId: endpoint.partId,
    nodeName: endpoint.nodeName,
    label: `${endpoint.partId} · ${endpoint.presentationSignal || endpoint.signal}`,
    position: endpoint.position
  };
}

function effectiveControllerConnectionPolicy(assetId, catalogPart = null) {
  const canonical = controllerConnectionPolicy(assetId);
  if (canonical.mode !== CONNECTION_MODES.DEFERRED_NOT_SELECTABLE
    || canonical.readinessBlocker !== "controller_connection_mode_not_approved") return canonical;

  const explicitMode = String(catalogPart?.controllerConnectionMode || "");
  if (Object.values(CONNECTION_MODES).includes(explicitMode)
    && explicitMode !== CONNECTION_MODES.DEFERRED_NOT_SELECTABLE) {
    return Object.freeze({
      policyVersion: "controller-connection-mode-explicit-catalog-v1",
      mode: explicitMode,
      controllerAssetId: String(assetId || ""),
      requiredCarrierAssetId: connectionModeRequiresCarrier(explicitMode)
        ? String(catalogPart?.breakoutResearch?.id || catalogPart?.controllerCarrierAssetId || "")
        : "",
      maximumExternalPeripherals: Number.isInteger(catalogPart?.maximumExternalPeripherals)
        ? catalogPart.maximumExternalPeripherals
        : (explicitMode === CONNECTION_MODES.INTEGRATED_DIRECT_WIRE ? 2 : 8),
    });
  }

  // Private/custom catalog rows may carry an explicit carrier contract without
  // appearing in Makeable's canonical asset-id allowlist. Keep this fallback
  // deliberately narrow: researched production rows have a state, whereas a
  // state-less breakoutResearch object is a caller-owned explicit contract.
  const breakout = catalogPart?.breakoutResearch;
  if (breakout?.id && !Object.hasOwn(breakout, "state")) {
    return Object.freeze({
      policyVersion: "controller-connection-mode-custom-explicit-v1",
      mode: CONNECTION_MODES.CARRIER_REQUIRED,
      controllerAssetId: String(assetId || ""),
      requiredCarrierAssetId: String(breakout.id),
      maximumExternalPeripherals: 8,
    });
  }
  return canonical;
}

function stableInstanceId(role, index, assetId) {
  return `${String(role || "part").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}-${index + 1}-${assetId.slice(0, 18)}`;
}
