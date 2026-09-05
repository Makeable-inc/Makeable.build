const QUICK_CONNECTOR_INTENTS = new Set(["grove_4p", "jst_sh_1.0mm_4p_qwiic"]);
const GROVE_CARRIER_ASSET_ID = "seeed-xiao-expansion-base-103030356";
const NON_PERIPHERAL_CATEGORIES = new Set(["controller", "carrier", "cable", "part", "power", "power_distribution"]);
const MAX_COMPACT_SURFACE_CLUSTER_SPAN_M = 0.03;
const MAX_HIGH_PIN_COUNT_SURFACE_CLUSTER_SPAN_M = 0.045;
const MIRRORED_POWER_CONTACT_CLASS = "mirrored_controller_power_contact";
const POWERED_LOGIC_HARNESS_ROLES = Object.freeze([
  "DEVICE_POWER",
  "DEVICE_GROUND",
  "DEVICE_SIGNAL_HIGH",
  "SURFACE_GROUND",
  "SURFACE_LOGIC_SUPPLY",
  "SURFACE_SIGNAL_LOW"
]);

export class Prompt2CircuitCompileError extends Error {
  constructor(code, details = {}) {
    super(`${code}${details.assetId ? `:${details.assetId}` : ""}`);
    this.name = "Prompt2CircuitCompileError";
    this.code = code;
    this.details = details;
  }
}

export function compileElectricalGraph({ parts, profiles, controllerPartId = "", carrierPartId = "" } = {}) {
  const profileByAsset = new Map((profiles || []).map((profile) => [profile.assetId, profile]));
  const instances = (parts || []).map((part) => {
    const profile = profileByAsset.get(part.assetId);
    if (!profile) fail("interface_profile_missing", { assetId: part.assetId, partId: part.id });
    if (profile.state !== "ready") fail("interface_profile_not_ready", { assetId: part.assetId, partId: part.id, state: profile.state, blockers: profile.blockers });
    return { ...part, profile, category: part.role || profile.coverage?.category || "part" };
  });
  if (!instances.length) fail("parts_missing");
  if (new Set(instances.map((part) => part.id)).size !== instances.length) fail("part_instance_ids_not_unique");
  const controller = selectSingleton(instances, controllerPartId, "controller", "controller");
  const carrier = selectOptionalSingleton(instances, carrierPartId, "carrier", "carrier");
  const peripherals = instances.filter((part) => !NON_PERIPHERAL_CATEGORIES.has(part.category));
  const i2cAddressClaims = assertI2cAddressCompatibility(peripherals);
  const surface = carrier || controller;
  const surfaceContacts = propagatedSurfaceContacts(surface.profile, controller.profile, Boolean(carrier));
  const usedSurfaceNodes = new Set();
  const usedSurfaceControllerPins = new Map();
  const usedCablePartIds = new Set();
  const usedPoweredLogicSystemPartIds = new Set();
  const usedSelectorShuntPartIds = new Set();
  const nets = [];
  const connections = [];
  const subcomponents = [];

  const analogAcquisitionCompilation = compileAnalogAcquisitionInterfaces({ peripherals });
  nets.push(...analogAcquisitionCompilation.nets);
  connections.push(...analogAcquisitionCompilation.connections);

  const poweredLogicPeripherals = peripherals.filter((peripheral) => peripheral.profile.electrical?.poweredLogicLoad);
  const poweredLogicCompilation = compilePoweredLogicPeripherals({
    peripherals: poweredLogicPeripherals,
    instances,
    surface,
    surfaceContacts,
    usedSurfaceNodes,
    usedSurfaceControllerPins,
    usedCablePartIds,
    usedPoweredLogicSystemPartIds
  });
  nets.push(...poweredLogicCompilation.nets);
  connections.push(...poweredLogicCompilation.connections);

  const exactCablePeripherals = peripherals.filter((peripheral) => (
    (peripheral.profile.exactMatingCableRequirements || []).length > 0
  ));
  const exactCableCompilation = compileExactMatingCablePeripherals({
    peripherals: exactCablePeripherals,
    instances,
    surface,
    surfaceContacts,
    usedSurfaceNodes,
    usedSurfaceControllerPins,
    usedCablePartIds
  });
  nets.push(...exactCableCompilation.nets);
  connections.push(...exactCableCompilation.connections);

  const selectorShuntCompilation = compileSelectorShunts({
    peripherals,
    instances,
    usedSelectorShuntPartIds
  });
  nets.push(...selectorShuntCompilation.nets);
  connections.push(...selectorShuntCompilation.connections);

  const servoPeripherals = peripherals.filter((peripheral) => connectorIntentForProfile(peripheral.profile) === "servo_3p");
  const servoCompilation = compileServoPeripherals({
    servos: servoPeripherals,
    instances,
    surface,
    surfaceContacts,
    usedSurfaceNodes,
    usedSurfaceControllerPins,
    usedCablePartIds
  });
  nets.push(...servoCompilation.nets);
  connections.push(...servoCompilation.connections);

  for (const peripheral of peripherals) {
    const connectorIntent = connectorIntentForProfile(peripheral.profile);
    if (connectorIntent === "servo_3p") continue;
    if (peripheral.profile.electrical?.poweredLogicLoad) continue;
    const claimedSignals = new Set([
      ...(exactCableCompilation.claimedSignalsByPeripheral.get(peripheral.id) || []),
      ...(analogAcquisitionCompilation.claimedSignalsByPeripheral.get(peripheral.id) || [])
    ]);
    const remainingSignals = exactRequiredSignals(peripheral.profile)
      .filter((signal) => !claimedSignals.has(normalizeSignal(signal)));
    if (!remainingSignals.length) continue;
    if (QUICK_CONNECTOR_INTENTS.has(connectorIntent)) {
      if (!carrier) fail("quick_connector_requires_carrier", { assetId: peripheral.assetId, connectorIntent });
      if (connectorIntent === "grove_4p" && carrier.assetId !== GROVE_CARRIER_ASSET_ID) {
        fail("grove_requires_xiao_expansion_base", {
          assetId: peripheral.assetId,
          carrierAssetId: carrier.assetId,
          requiredCarrierAssetId: GROVE_CARRIER_ASSET_ID
        });
      }
      const compiled = compileQuickPeripheral({
        peripheral,
        connectorIntent,
        instances,
        surface,
        surfaceContacts,
        usedSurfaceNodes,
        usedSurfaceControllerPins,
        usedCablePartIds,
        requiredSignals: remainingSignals
      });
      const withPassives = compileRequiredPhysicalSubassemblies(peripheral, compiled);
      const complete = compileRequiredSignalStraps(
        peripheral,
        withPassives,
        exactCableCompilation.handledStrapIdsByPeripheral.get(peripheral.id),
        { surface, surfaceContacts, usedSurfaceNodes, usedSurfaceControllerPins }
      );
      nets.push(...complete.nets);
      connections.push(...complete.connections);
      subcomponents.push(...complete.subcomponents);
      continue;
    }
    const compiled = compileDirectPeripheral({
      peripheral,
      surface,
      surfaceContacts,
      usedSurfaceNodes,
      usedSurfaceControllerPins,
      // Integrated display/camera controllers commonly expose one supply,
      // one ground, and one I2C pair for their small external header. Their
      // direct-wire policy permits at most two peripherals, so those exact
      // bus/rail contacts may fan out while every ordinary signal remains
      // exclusive. Carrier rows continue to use distinct physical contacts.
      allowSharedDirectPower: !carrier,
      requiredSignals: remainingSignals
    });
    const withPassives = compileRequiredPhysicalSubassemblies(peripheral, compiled);
    const complete = compileRequiredSignalStraps(
      peripheral,
      withPassives,
      exactCableCompilation.handledStrapIdsByPeripheral.get(peripheral.id),
      { surface, surfaceContacts, usedSurfaceNodes, usedSurfaceControllerPins }
    );
    nets.push(...complete.nets);
    connections.push(...complete.connections);
    subcomponents.push(...complete.subcomponents);
  }

  const terminalOccupancy = analyzeExternalTerminalOccupancy(connections);
  const graph = {
    schemaVersion: "MakeableElectricalGraphV1",
    state: "ready",
    controllerPartId: controller.id,
    carrierPartId: carrier?.id || null,
    peripheralPartIds: peripherals.map((part) => part.id),
    nets,
    connections,
    subcomponents,
    i2cAddressClaims,
    terminalOccupancy,
    invariants: {
      interfaceProfilesReady: true,
      uniquePhysicalSurfaceContacts: usedSurfaceNodes.size === connections.filter((connection) => connection.surfaceEndpoint).length,
      uniqueOrPolicySharedSurfaceContacts: usedSurfaceNodes.size
        === connections.filter((connection) => connection.surfaceEndpoint).length
          - connections.filter((connection) => connection.sharedSurfaceEndpoint).length,
      sharedSurfaceContactsPolicyValid: connections.filter((connection) => connection.sharedSurfaceEndpoint).every((connection) => (
        ["GND", "3V3", "5V"].includes(connection.controllerCapability)
        && connection.terminationMode === "policy-approved-shared-crimp-y-harness"
      )),
      sharedControllerBusPolicyValid: connections.filter((connection) => connection.sharedControllerBus).every((connection) => (
        ["I2C_SDA", "I2C_SCL"].includes(connection.controllerCapability)
        && connection.surfaceEndpoint?.nodeName
        && connection.surfaceEndpoint?.controllerPin
      )),
      canonicalControllerPinCapabilitiesValid: canonicalControllerPinCapabilitiesValid(connections),
      requiredPhysicalSubassembliesResolved: subcomponents.length
        === peripherals.reduce((sum, peripheral) => sum + (peripheral.profile.passiveComponents || []).length, 0)
        && connections.filter((connection) => connection.physicalSubassembly).length
          === peripherals.reduce((sum, peripheral) => sum + (peripheral.profile.requiredNetTies || [])
            .flatMap((tie) => tie.terminalBindings || []).length, 0),
      requiredSignalStrapsResolved: connections.filter((connection) => connection.requiredSignalStrap).length
        === peripherals.reduce((sum, peripheral) => sum + (peripheral.profile.requiredSignalStraps || []).length, 0),
      externalTerminalOccupancyValid: terminalOccupancy.overCapacity.length === 0,
      includedFactoryHarnessesResolved: connections.filter((connection) => connection.factoryHarnessConductor).length
        === peripherals.reduce((sum, peripheral) => sum + (peripheral.profile.includedFactoryHarnesses || [])
          .flatMap((harness) => harness.conductors || []).length, 0)
        && connections.filter((connection) => connection.factoryHarnessRigidMate).length
          === peripherals.reduce((sum, peripheral) => sum + (peripheral.profile.includedFactoryHarnesses || [])
            .flatMap((harness) => harness.conductors || []).length * 2, 0),
      servoSystemsResolved: servoPeripherals.length === servoCompilation.resolvedServoPartCount
        && servoCompilation.expectedServoChannelCount === servoCompilation.resolvedServoChannelCount
        && (servoCompilation.routeMode === "owner-bench-verified-distinct-gvs-trio-guide"
          ? connections.filter((connection) => connection.ownerVerifiedServoGuide).length
              === servoCompilation.expectedServoChannelCount * 3
          : connections.filter((connection) => connection.servoHarnessConductor).length
              === servoCompilation.expectedServoChannelCount * 3
            && connections.filter((connection) => connection.servoHarnessRigidMate).length
              === servoCompilation.expectedServoChannelCount * 6
            && connections.filter((connection) => connection.servoCommonGroundBond).length
              === (servoPeripherals.length ? 1 : 0)),
      servoPowerBudgetValid: servoCompilation.powerBudgetValid,
      servoCommonGroundResolved: servoCompilation.commonGroundResolved,
      poweredLogicSystemsResolved: poweredLogicPeripherals.length === poweredLogicCompilation.resolvedPeripheralCount
        && connections.filter((connection) => connection.poweredLogicHarnessConductor).length
          === poweredLogicCompilation.expectedConductorCount
        && connections.filter((connection) => connection.poweredLogicHarnessRigidMate).length
          === poweredLogicCompilation.expectedConductorCount * 2,
      poweredLogicTranslationResolved: poweredLogicCompilation.translationResolved,
      poweredLogicPowerBudgetValid: poweredLogicCompilation.powerBudgetValid,
      poweredLogicCommonGroundResolved: poweredLogicCompilation.commonGroundResolved,
      exactMatingCableSystemsResolved: exactCablePeripherals.length === exactCableCompilation.resolvedPeripheralCount
        && connections.filter((connection) => connection.exactMatingCableConductor).length
          === exactCableCompilation.expectedConductorCount
        && connections.filter((connection) => connection.exactMatingCableRigidMate).length
          === exactCableCompilation.expectedConductorCount * 2,
      exactMatingCableUnmatedSignalsResolved: exactCableCompilation.unmatedSignalsResolved,
      selectorShuntsResolved: selectorShuntCompilation.expectedRequirementCount
        === selectorShuntCompilation.resolvedRequirementCount
        && connections.filter((connection) => connection.selectorShuntRigidMate).length
          === selectorShuntCompilation.expectedRequirementCount * 2,
      operatingModesResolved: peripherals.every((peripheral) => operatingModeResolved(peripheral.profile)),
      i2cAddressConflictsAbsent: true,
      analogAcquisitionInterfacesResolved: analogAcquisitionCompilation.resolvedConsumerCount
        === analogAcquisitionCompilation.expectedConsumerCount,
      breadboardIncluded: instances.some((part) => /breadboard/i.test(`${part.id} ${part.assetId}`)),
      quickConnectorsDirectToController: connections.some((connection) => connection.quickConnector && connection.toPartId === controller.id)
    }
  };
  if (graph.invariants.breadboardIncluded) fail("breadboard_forbidden");
  if (graph.invariants.quickConnectorsDirectToController) fail("quick_connector_direct_to_controller_forbidden");
  if (!graph.invariants.uniqueOrPolicySharedSurfaceContacts || !graph.invariants.sharedSurfaceContactsPolicyValid) {
    fail("surface_contact_reuse_policy_invalid");
  }
  if (!graph.invariants.sharedControllerBusPolicyValid) fail("shared_controller_bus_policy_invalid");
  if (!graph.invariants.canonicalControllerPinCapabilitiesValid) fail("canonical_controller_pin_capability_conflict");
  if (!graph.invariants.requiredPhysicalSubassembliesResolved) fail("required_physical_subassembly_unresolved");
  if (!graph.invariants.requiredSignalStrapsResolved) fail("required_signal_strap_unresolved");
  if (!graph.invariants.externalTerminalOccupancyValid) {
    fail("physical_terminal_occupancy_exceeded", terminalOccupancy.overCapacity[0]);
  }
  if (!graph.invariants.includedFactoryHarnessesResolved) fail("included_factory_harness_unresolved");
  if (!graph.invariants.servoSystemsResolved) fail("servo_system_unresolved");
  if (!graph.invariants.servoPowerBudgetValid) fail("servo_power_budget_invalid");
  if (!graph.invariants.servoCommonGroundResolved) fail("servo_common_ground_unresolved");
  if (!graph.invariants.poweredLogicSystemsResolved) fail("powered_logic_system_unresolved");
  if (!graph.invariants.poweredLogicTranslationResolved) fail("powered_logic_translation_unresolved");
  if (!graph.invariants.poweredLogicPowerBudgetValid) fail("powered_logic_power_budget_invalid");
  if (!graph.invariants.poweredLogicCommonGroundResolved) fail("powered_logic_common_ground_unresolved");
  if (!graph.invariants.exactMatingCableSystemsResolved) fail("exact_mating_cable_system_unresolved");
  if (!graph.invariants.exactMatingCableUnmatedSignalsResolved) fail("exact_mating_cable_unmated_signal_invalid");
  if (!graph.invariants.selectorShuntsResolved) fail("selector_shunt_unresolved");
  if (!graph.invariants.operatingModesResolved) fail("operating_mode_unresolved");
  if (!graph.invariants.i2cAddressConflictsAbsent) fail("i2c_address_conflict");
  if (!graph.invariants.analogAcquisitionInterfacesResolved) fail("analog_acquisition_interface_unresolved");
  return graph;
}

function assertI2cAddressCompatibility(peripherals) {
  const i2cPeripherals = peripherals.filter((peripheral) => profileUsesI2c(peripheral.profile));
  const byConfiguredAddress = new Map();
  const byUnresolvedAsset = new Map();
  const claims = [];
  for (const peripheral of i2cPeripherals) {
    const configuredAddress = configuredI2cAddress(peripheral.profile);
    if (configuredAddress) {
      const prior = byConfiguredAddress.get(configuredAddress);
      if (prior) {
        fail("i2c_address_conflict", {
          assetId: peripheral.assetId,
          address7Bit: configuredAddress,
          conflictingAssetId: prior.assetId,
          conflictingPartId: prior.id,
          partId: peripheral.id,
        });
      }
      byConfiguredAddress.set(configuredAddress, peripheral);
      claims.push({
        partId: peripheral.id,
        assetId: peripheral.assetId,
        address7Bit: configuredAddress,
        state: "configured",
        source: peripheral.profile.i2cAddressContract
          ? "interface-profile-i2c-address-contract"
          : "resolved-operating-mode-contract",
      });
      continue;
    }

    // Two physical copies of one I2C product have the same unresolved address
    // contract unless the profile explicitly proves otherwise. Never place
    // them on one controller bus and hope that firmware, a hidden mux, or an
    // unmodeled address strap will repair the collision. The network resource
    // compiler may put the second copy on another ESP32 node instead.
    const prior = byUnresolvedAsset.get(peripheral.assetId);
    if (prior) {
      fail("i2c_address_conflict_unresolved_duplicate_asset", {
        assetId: peripheral.assetId,
        conflictingPartId: prior.id,
        partId: peripheral.id,
      });
    }
    byUnresolvedAsset.set(peripheral.assetId, peripheral);
    claims.push({
      partId: peripheral.id,
      assetId: peripheral.assetId,
      address7Bit: null,
      state: "unresolved-single-device-on-bus",
      source: "conservative-single-instance-policy",
    });
  }
  return claims;
}

function profileUsesI2c(profile) {
  const required = new Set((profile?.electrical?.requiredSignals || []).map(normalizeSignal));
  return (required.has("SDA") && required.has("SCL"))
    || String(profile?.operatingModeContract?.bus || "").toUpperCase() === "I2C";
}

function configuredI2cAddress(profile) {
  const explicit = profile?.i2cAddressContract?.address7Bit
    || profile?.operatingModeContract?.i2cAddress7Bit;
  if (explicit) return normalizeI2cAddress(explicit, profile.assetId);
  const identity = String(profile?.operatingModeContract?.id || "");
  const matches = [...identity.matchAll(/(?:address|default)[^0-9a-f]*(0x[0-7][0-9a-f])/gi)]
    .map((match) => normalizeI2cAddress(match[1], profile.assetId));
  return new Set(matches).size === 1 ? matches[0] : "";
}

function normalizeI2cAddress(value, assetId) {
  const match = String(value || "").trim().match(/^0x([0-7][0-9a-f])$/i);
  if (!match) fail("i2c_address_contract_invalid", { assetId, address7Bit: value });
  return `0x${match[1].toUpperCase()}`;
}

function compileAnalogAcquisitionInterfaces({ peripherals }) {
  const consumers = peripherals.filter((peripheral) => peripheral.profile.analogInputConsumer);
  const sources = peripherals.flatMap((peripheral) => analogOutputCandidates(peripheral));
  const claimedSources = new Set();
  const claimedSignalsByPeripheral = new Map();
  const nets = [];
  const connections = [];
  let resolvedConsumerCount = 0;

  for (const consumer of consumers) {
    const contract = consumer.profile.analogInputConsumer;
    const availableSources = sources.filter((source) => (
      source.peripheral.id !== consumer.id
      && !claimedSources.has(`${source.peripheral.id}:${normalizeSignal(source.signal)}`)
      && source.rangeV[0] >= 0
      && source.rangeV[1] <= contract.maximumInputVoltageV
    ));
    if (availableSources.length < contract.minimumSourceCount) {
      fail("analog_input_source_required", {
        assetId: consumer.assetId,
        minimumSourceCount: contract.minimumSourceCount,
        compatibleSourceCount: availableSources.length,
        maximumInputVoltageV: contract.maximumInputVoltageV
      });
    }
    const assignments = availableSources.slice(0, contract.inputSignals.length);
    for (const [index, source] of assignments.entries()) {
      const inputSignal = contract.inputSignals[index];
      const sourceContact = findSignalContact(source.peripheral.profile.contacts, source.signal);
      const inputContact = findSignalContact(consumer.profile.contacts, inputSignal);
      if (!sourceContact || !inputContact) {
        fail("analog_interconnect_endpoint_unresolved", {
          assetId: consumer.assetId,
          sourceAssetId: source.peripheral.assetId,
          sourceSignal: source.signal,
          inputSignal
        });
      }
      const sourceKey = `${source.peripheral.id}:${normalizeSignal(source.signal)}`;
      claimedSources.add(sourceKey);
      if (!claimedSignalsByPeripheral.has(source.peripheral.id)) claimedSignalsByPeripheral.set(source.peripheral.id, new Set());
      claimedSignalsByPeripheral.get(source.peripheral.id).add(normalizeSignal(source.signal));
      const netId = `${consumer.id}:${normalizeSignal(inputSignal).toLowerCase()}:analog-input`;
      nets.push({
        id: netId,
        signal: inputSignal,
        analogAcquisitionInterfaceId: contract.id,
        sourceSignal: source.signal,
        voltageRangeV: source.rangeV,
        endpoints: [endpoint(source.peripheral, sourceContact), endpoint(consumer, inputContact)]
      });
      connections.push({
        id: `${netId}:guide`,
        netId,
        signal: source.signal,
        inputSignal,
        connectionMode: "logical-guide",
        quickConnector: false,
        analogInterconnect: true,
        analogAcquisitionInterfaceId: contract.id,
        fromPartId: source.peripheral.id,
        toPartId: consumer.id,
        fromEndpoint: endpoint(source.peripheral, sourceContact),
        toEndpoint: endpoint(consumer, inputContact),
        color: colorForSignal(source.signal)
      });
    }
    resolvedConsumerCount += 1;
  }
  return {
    nets,
    connections,
    claimedSignalsByPeripheral,
    expectedConsumerCount: consumers.length,
    resolvedConsumerCount
  };
}

function analogOutputCandidates(peripheral) {
  const requiredSignals = new Set((peripheral.profile.electrical?.requiredSignals || []).map(normalizeSignal));
  const operatingRanges = peripheral.profile.operatingModeContract?.outputVoltageRangesV || {};
  return (peripheral.profile.contacts || []).flatMap((contact) => {
    const signal = normalizeSignal(contact.signal);
    if (!requiredSignals.has(signal)) return [];
    const capability = peripheral.profile.electrical?.surfaceCapabilitiesBySignal?.[contact.signal]
      || peripheral.profile.electrical?.surfaceCapabilitiesBySignal?.[signal]
      || "";
    const domain = peripheral.profile.electrical?.signalDomains?.[contact.signal]
      || peripheral.profile.electrical?.signalDomains?.[signal]
      || "";
    const explicitRange = operatingRanges[contact.signal] || operatingRanges[signal];
    const domainMatch = String(domain).toUpperCase().match(/^([0-9.]+)_TO_([0-9.]+|3V3)_ANALOG_OUTPUT$/);
    const rangeV = Array.isArray(explicitRange)
      ? explicitRange
      : domainMatch
        ? [Number(domainMatch[1]), domainMatch[2] === "3V3" ? 3.3 : Number(domainMatch[2])]
        : null;
    if (String(capability).toUpperCase() !== "ADC" || !rangeV || rangeV.length !== 2 || !rangeV.every(Number.isFinite)) return [];
    return [{ peripheral, signal: contact.signal, rangeV }];
  });
}

export function connectorIntentForProfile(profile) {
  const declared = profile?.electrical?.connectorIntent || "unclassified";
  const physicalFamilies = new Set((profile?.connectors || []).map((connector) => String(connector.family || connector.connectorFamily || "").toLowerCase()));
  for (const contact of profile?.contacts || []) physicalFamilies.add(String(contact.connectorFamily || "").toLowerCase());
  const derived = new Set();
  if ([...physicalFamilies].some((family) => family.includes("qwiic") || family.includes("jst_sh_1.0mm_4p"))) {
    derived.add("jst_sh_1.0mm_4p_qwiic");
  }
  if ([...physicalFamilies].some((family) => family.includes("grove"))) derived.add("grove_4p");
  if (QUICK_CONNECTOR_INTENTS.has(declared)) derived.add(declared);
  if (derived.size > 1) fail("quick_connector_family_ambiguous", { connectorIntent: declared, families: [...physicalFamilies].sort() });
  return [...derived][0] || declared;
}

function compileSelectorShunts({ peripherals, instances, usedSelectorShuntPartIds }) {
  const nets = [];
  const connections = [];
  const requirements = peripherals.flatMap((peripheral) => (
    (peripheral.profile.selectorShuntRequirements || []).map((requirement) => ({ peripheral, requirement }))
  ));
  for (const { peripheral, requirement } of requirements) {
    const targetConnector = (peripheral.profile.connectors || []).find((connector) => connector.id === requirement.connectorId);
    const targetContacts = requirement.orderedTargetSignals.map((signal) => (
      (peripheral.profile.contacts || []).find((contact) => (
        contact.connectorId === requirement.connectorId && normalizeSignal(contact.signal) === normalizeSignal(signal)
      ))
    ));
    if (!targetConnector || targetContacts.some((contact) => !contact)) {
      fail("selector_shunt_target_contract_missing", { assetId: peripheral.assetId, requirementId: requirement.id });
    }
    const candidates = instances.filter((part) => !usedSelectorShuntPartIds.has(part.id) && part.profile.selectorShunt)
      .map((part) => {
        try {
          return { part, contract: validatedSelectorShunt(part.profile, targetConnector) };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((left, right) => left.part.id.localeCompare(right.part.id));
    if (!candidates.length) {
      fail("selector_shunt_required", { assetId: peripheral.assetId, requirementId: requirement.id, mode: requirement.mode });
    }
    const { part: shunt, contract } = candidates[0];
    usedSelectorShuntPartIds.add(shunt.id);
    const shuntContacts = contract.contactNodeNames.map((nodeName) => (
      shunt.profile.contacts.find((contact) => contact.nodeName === nodeName)
    ));
    const netId = `${peripheral.id}:${requirement.id}:selector-state`;
    nets.push({
      id: netId,
      signal: `MODE_${String(requirement.mode).toUpperCase()}`,
      selectorRequirementId: requirement.id,
      endpoints: [
        endpoint(peripheral, targetContacts[0]),
        endpoint(shunt, shuntContacts[0]),
        endpoint(shunt, shuntContacts[1]),
        endpoint(peripheral, targetContacts[1])
      ]
    });
    for (let index = 0; index < 2; index += 1) {
      if (!connectorsMate(shuntContacts[index], targetContacts[index])) {
        fail("selector_shunt_mate_incompatible", {
          assetId: peripheral.assetId,
          shuntAssetId: shunt.assetId,
          requirementId: requirement.id,
          contactIndex: index
        });
      }
      connections.push({
        id: `${peripheral.id}:${requirement.id}:mate-${index + 1}`,
        netId,
        signal: requirement.orderedTargetSignals[index],
        connectionMode: "rigid-mate",
        selectorShuntId: contract.id,
        selectorShuntRequirementId: requirement.id,
        selectorShuntRigidMate: true,
        engagementDepthM: contract.engagementDepthM,
        fromPartId: shunt.id,
        toPartId: peripheral.id,
        fromEndpoint: endpoint(shunt, shuntContacts[index]),
        toEndpoint: endpoint(peripheral, targetContacts[index])
      });
    }
  }
  return {
    nets,
    connections,
    expectedRequirementCount: requirements.length,
    resolvedRequirementCount: requirements.length
  };
}

function validatedSelectorShunt(profile, targetConnector) {
  const contract = profile?.selectorShunt;
  if (!contract?.id || !contract.connectorId || contract.internalContinuity !== true
    || !Array.isArray(contract.contactNodeNames) || contract.contactNodeNames.length !== 2
    || !Number.isFinite(contract.engagementDepthM) || contract.engagementDepthM < 0) {
    fail("selector_shunt_contract_invalid", { assetId: profile?.assetId || "unknown" });
  }
  const connector = (profile.connectors || []).find((entry) => entry.id === contract.connectorId);
  const contacts = contract.contactNodeNames.map((nodeName) => (
    (profile.contacts || []).find((contact) => contact.nodeName === nodeName)
  ));
  if (!connector || contacts.some((contact) => !contact) || !connectorsMate(connector, targetConnector)) {
    fail("selector_shunt_connector_incompatible", { assetId: profile.assetId });
  }
  return structuredClone(contract);
}

function compileExactMatingCablePeripherals({
  peripherals,
  instances,
  surface,
  surfaceContacts,
  usedSurfaceNodes,
  usedSurfaceControllerPins,
  usedCablePartIds
}) {
  if (!peripherals.length) {
    return {
      nets: [],
      connections: [],
      resolvedPeripheralCount: 0,
      expectedConductorCount: 0,
      unmatedSignalsResolved: true,
      claimedSignalsByPeripheral: new Map(),
      handledStrapIdsByPeripheral: new Map()
    };
  }
  const nets = [];
  const connections = [];
  let expectedConductorCount = 0;
  let unmatedSignalsResolved = true;
  const claimedSignalsByPeripheral = new Map();
  const handledStrapIdsByPeripheral = new Map();

  for (const peripheral of peripherals) {
    const requirements = peripheral.profile.exactMatingCableRequirements || [];
    const claimedSignals = new Set();
    const handledStrapIds = new Set();
    for (const requirement of requirements) {
      const candidates = [];
      for (const cable of instances.filter((part) => part.category === "cable" && !usedCablePartIds.has(part.id))) {
        try {
          candidates.push({ cable, contract: validatedExactMatingCable(cable.profile, peripheral.profile, requirement) });
        } catch {
          // A non-matching cable is normal catalog search, not a compiler failure.
        }
      }
      if (!candidates.length) {
        fail("exact_mating_cable_required", {
          assetId: peripheral.assetId,
          connectorRequirement: requirement.id
        });
      }
      candidates.sort((left, right) => (
        left.contract.conductors.length - right.contract.conductors.length
        || left.cable.id.localeCompare(right.cable.id)
      ));
      const { cable, contract } = candidates[0];
      usedCablePartIds.add(cable.id);
      expectedConductorCount += contract.conductors.length;
      const strapsBySource = new Map((requirement.signalStraps || []).map((strap) => [normalizeSignal(strap.fromSignal), strap]));
      const usedPeripheralNodes = new Set();

      for (const conductor of contract.conductors) {
      const deviceSignal = normalizeSignal(conductor.signal);
      if (claimedSignals.has(deviceSignal)) {
        fail("physical_signal_edge_duplicated", { assetId: peripheral.assetId, signal: deviceSignal });
      }
      claimedSignals.add(deviceSignal);
      const strap = strapsBySource.get(deviceSignal);
      if (strap) handledStrapIds.add(strap.id);
      const netSignal = normalizeSignal(strap?.toSignal || conductor.surfaceSignal || deviceSignal);
      const deviceContact = takeContact(
        peripheral.profile.contacts.filter((contact) => contact.connectorId === requirement.connectorId),
        deviceSignal,
        usedPeripheralNodes,
        "exact_mating_cable_device_contact_missing",
        peripheral.assetId,
        true
      );
      if (!connectorsMate(conductor.fromContact, deviceContact)) {
        fail("exact_mating_cable_device_mate_incompatible", {
          assetId: peripheral.assetId,
          cableAssetId: cable.assetId,
          signal: deviceSignal
        });
      }
      if (!strap) assertSignalDomainCompatible(peripheral.profile, deviceSignal, peripheral.assetId);
      const capability = requirement.surfaceCapabilities?.[deviceSignal]
        || requirement.surfaceCapabilities?.[conductor.signal]
        || sourceCapability(netSignal, peripheral.profile);
      assertSurfacePowerPolicy(surface.profile, capability, peripheral.assetId);
      const surfaceContact = takeMatingSurfaceContact(
        surfaceContacts,
        capability,
        conductor.toContact,
        usedSurfaceNodes,
        usedSurfaceControllerPins,
        surface.assetId
      );
      const cableDeviceEndpoint = endpoint(cable, conductor.fromContact);
      const cableSurfaceEndpoint = endpoint(cable, conductor.toContact);
      const deviceEndpoint = endpoint(peripheral, deviceContact);
      const surfaceEndpoint = endpoint(surface, surfaceContact);
      const netId = `${peripheral.id}:${netSignal.toLowerCase()}:${deviceSignal.toLowerCase()}`;
      const conductorId = `${peripheral.id}:${cable.id}:${conductor.id}`;
      nets.push({
        id: netId,
        signal: netSignal,
        deviceSignal,
        endpoints: [surfaceEndpoint, cableSurfaceEndpoint, cableDeviceEndpoint, deviceEndpoint]
      });
      connections.push({
        id: `${conductorId}:device-mate`,
        netId,
        signal: deviceSignal,
        connectionMode: "rigid-mate",
        exactMatingCableId: contract.id,
        exactMatingCableConductorId: conductor.id,
        exactMatingCableRigidMate: true,
        exactMatingCableEnd: "from",
        exactMatingCableTransformGroup: conductor.fromTransformGroup,
        engagementDepthM: Number(conductor.fromEngagementDepthM || 0),
        fromPartId: cable.id,
        toPartId: peripheral.id,
        fromEndpoint: cableDeviceEndpoint,
        toEndpoint: deviceEndpoint
      });
      connections.push({
        id: `${conductorId}:conductor`,
        netId,
        signal: netSignal,
        deviceSignal,
        connectionMode: "deformable-exact-mating-cable",
        exactMatingCableId: contract.id,
        exactMatingCableConductorId: conductor.id,
        exactMatingCableConductor: true,
        fromPartId: cable.id,
        toPartId: cable.id,
        fromEndpoint: cableDeviceEndpoint,
        toEndpoint: cableSurfaceEndpoint,
        fromWireExitAnchorNodeName: conductor.fromWireExitAnchorNodeName,
        toWireExitAnchorNodeName: conductor.toWireExitAnchorNodeName,
        fromNodePrefix: conductor.fromNodePrefix,
        toNodePrefix: conductor.toNodePrefix,
        bundleId: `${peripheral.id}:${cable.id}`,
        color: colorForSignal(netSignal),
        maximumCableLengthM: conductor.maximumCableLengthM,
        diameterM: conductor.diameterM,
        minimumBendRadiusM: conductor.minimumBendRadiusM,
        ...(strap ? {
          requiredSignalStrap: true,
          requiredStrapId: strap.id,
          strapSourceSignal: deviceSignal,
          terminationMode: strap.terminationMode
        } : {})
      });
      connections.push({
        id: `${conductorId}:surface-mate`,
        netId,
        signal: netSignal,
        connectionMode: "rigid-mate",
        exactMatingCableId: contract.id,
        exactMatingCableConductorId: conductor.id,
        exactMatingCableRigidMate: true,
        exactMatingCableEnd: "to",
        exactMatingCableTransformGroup: conductor.toTransformGroup,
        engagementDepthM: Number(conductor.toEngagementDepthM || 0),
        fromPartId: cable.id,
        toPartId: surface.id,
        fromEndpoint: cableSurfaceEndpoint,
        toEndpoint: surfaceEndpoint,
        surfaceEndpoint
      });
      }
      const requiredUnmated = [...new Set(requirement.unmatedSignals.map(normalizeSignal))].sort();
      const cableUnmated = [...new Set(contract.unmatedSignals.map(normalizeSignal))].sort();
      for (const signal of requiredUnmated) {
        if (claimedSignals.has(signal)) {
          fail("physical_signal_edge_duplicated", { assetId: peripheral.assetId, signal });
        }
        claimedSignals.add(signal);
      }
      if (JSON.stringify(requiredUnmated) !== JSON.stringify(cableUnmated)
        || connections.some((connection) => (
          connection.exactMatingCableId === contract.id
          && requiredUnmated.includes(normalizeSignal(connection.deviceSignal || connection.signal))
        ))) {
        unmatedSignalsResolved = false;
      }
    }
    claimedSignalsByPeripheral.set(peripheral.id, claimedSignals);
    handledStrapIdsByPeripheral.set(peripheral.id, handledStrapIds);
  }
  return {
    nets,
    connections,
    resolvedPeripheralCount: peripherals.length,
    expectedConductorCount,
    unmatedSignalsResolved,
    claimedSignalsByPeripheral,
    handledStrapIdsByPeripheral
  };
}

function validatedExactMatingCable(profile, peripheralProfile, requirement) {
  const contract = profile?.exactMatingCable;
  if (!contract?.id || !contract.endpointConnectorId || !Array.isArray(contract.orderedSignals)
    || !Array.isArray(contract.conductors) || !contract.conductors.length
    || !Array.isArray(contract.unmatedSignals) || !Array.isArray(contract.unmatedContacts)
    || contract.unmatedContacts.length !== contract.unmatedSignals.length) {
    fail("exact_mating_cable_contract_invalid", { assetId: profile?.assetId || "unknown" });
  }
  const ordered = contract.orderedSignals.map(normalizeSignal);
  if (JSON.stringify(ordered) !== JSON.stringify(requirement.orderedSignals.map(normalizeSignal))) {
    fail("exact_mating_cable_contact_order_mismatch", { assetId: profile.assetId, requirementId: requirement.id });
  }
  const cableConnector = (profile.connectors || []).find((entry) => entry.id === contract.endpointConnectorId);
  const deviceConnector = (peripheralProfile.connectors || []).find((entry) => entry.id === requirement.connectorId);
  if (!cableConnector || !deviceConnector || !connectorsMate(cableConnector, deviceConnector)) {
    fail("exact_mating_cable_connector_mismatch", { assetId: profile.assetId, requirementId: requirement.id });
  }
  const contacts = new Map((profile.contacts || []).map((contact) => [contact.nodeName, contact]));
  const anchors = new Map((profile.routingAnchors || []).map((anchor) => [anchor.nodeName, anchor]));
  const conductors = [];
  for (const conductor of contract.conductors) {
    const fromContact = contacts.get(conductor.fromContactNodeName);
    const toContact = contacts.get(conductor.toContactNodeName);
    if (!conductor.id || !fromContact || !toContact
      || fromContact.connectorId !== contract.endpointConnectorId
      || normalizeSignal(fromContact.signal) !== normalizeSignal(conductor.signal)
      || !anchors.has(conductor.fromWireExitAnchorNodeName) || !anchors.has(conductor.toWireExitAnchorNodeName)
      || !conductor.fromNodePrefix || !conductor.toNodePrefix
      || !conductor.fromTransformGroup || !conductor.toTransformGroup
      || !Number.isFinite(conductor.maximumCableLengthM) || conductor.maximumCableLengthM <= 0
      || !Number.isFinite(conductor.diameterM) || conductor.diameterM <= 0
      || !Number.isFinite(conductor.minimumBendRadiusM) || conductor.minimumBendRadiusM < conductor.diameterM) {
      fail("exact_mating_cable_conductor_invalid", { assetId: profile.assetId, conductorId: conductor?.id || "unknown" });
    }
    conductors.push({ ...structuredClone(conductor), fromContact, toContact });
  }
  const routed = new Set(requirement.routedSignals.map(normalizeSignal));
  if (conductors.length !== routed.size || conductors.some((conductor) => !routed.has(normalizeSignal(conductor.signal)))) {
    fail("exact_mating_cable_signal_coverage_invalid", { assetId: profile.assetId, requirementId: requirement.id });
  }
  for (const signal of contract.unmatedSignals) {
    const declared = contract.unmatedContacts.find((entry) => normalizeSignal(entry?.signal) === normalizeSignal(signal));
    const endpointContact = contacts.get(declared?.endpointContactNodeName);
    const farContact = contacts.get(declared?.farContactNodeName);
    if (!declared || !endpointContact || !farContact
      || endpointContact.connectorId !== contract.endpointConnectorId
      || normalizeSignal(endpointContact.signal) !== normalizeSignal(signal)
      || normalizeSignal(farContact.signal) !== normalizeSignal(signal)) {
      fail("exact_mating_cable_unmated_contact_invalid", { assetId: profile.assetId, signal });
    }
  }
  return { ...structuredClone(contract), conductors };
}

function compilePoweredLogicPeripherals({
  peripherals,
  instances,
  surface,
  surfaceContacts,
  usedSurfaceNodes,
  usedSurfaceControllerPins,
  usedCablePartIds,
  usedPoweredLogicSystemPartIds
}) {
  if (!peripherals.length) {
    return {
      nets: [],
      connections: [],
      resolvedPeripheralCount: 0,
      expectedConductorCount: 0,
      translationResolved: true,
      powerBudgetValid: true,
      commonGroundResolved: true
    };
  }
  const nets = [];
  const connections = [];
  let expectedConductorCount = 0;
  let translationResolved = true;
  let powerBudgetValid = true;
  let commonGroundResolved = true;

  for (const peripheral of peripherals) {
    const load = validatedPoweredLogicLoad(peripheral.profile);
    const devicePort = poweredLogicDevicePort(peripheral.profile, load);
    const availableSystems = instances
      .filter((part) => !usedPoweredLogicSystemPartIds.has(part.id) && part.profile.poweredLogicInterfaceSystem)
      .map((part) => ({ part, contract: validatedPoweredLogicInterfaceSystem(part.profile) }));
    const compatibleSystems = availableSystems.filter(({ contract }) => poweredLogicSystemSupportsLoad(contract, load))
      .sort((left, right) => (
        left.contract.continuousCurrentA - right.contract.continuousCurrentA
        || left.contract.peakCurrentA - right.contract.peakCurrentA
        || left.part.id.localeCompare(right.part.id)
      ));
    if (!compatibleSystems.length) {
      if (availableSystems.length) {
        fail("powered_logic_interface_incompatible", {
          assetId: peripheral.assetId,
          supplyVoltageRangeV: load.acceptedSupplyVoltageRangeV,
          continuousCurrentA: load.continuousCurrentA,
          peakCurrentA: load.peakCurrentA,
          deviceSignal: load.logicSignal.deviceSignal
        });
      }
      fail("powered_logic_interface_system_required", {
        assetId: peripheral.assetId,
        required: ["regulated_power", "proven_level_translation", "common_ground", "intact_device_mate", "controller_safe_logic"]
      });
    }
    const { part: system, contract: systemContract } = compatibleSystems[0];
    usedPoweredLogicSystemPartIds.add(system.id);

    const harness = findUnusedCable(instances, usedCablePartIds, (profile) => (
      poweredLogicHarnessContract(profile, devicePort, load, system.profile)
    ));
    if (!harness) {
      fail("powered_logic_intact_harness_required", {
        assetId: peripheral.assetId,
        interfaceSystemAssetId: system.assetId
      });
    }
    usedCablePartIds.add(harness.id);
    const harnessContract = validatedPoweredLogicHarness(harness.profile, devicePort, load, system.profile);
    const channel = systemContract.channel;
    const deviceContacts = {
      DEVICE_POWER: findSignalContact(devicePort.contacts, load.powerSignal),
      DEVICE_GROUND: findSignalContact(devicePort.contacts, load.groundSignal),
      DEVICE_SIGNAL_HIGH: findSignalContact(devicePort.contacts, load.logicSignal.deviceSignal)
    };
    const systemContacts = {
      DEVICE_POWER: contactByNodeName(system.profile, channel.devicePowerOutputNodeName, "powered_logic_power_output_contact_missing"),
      DEVICE_GROUND: contactByNodeName(system.profile, channel.deviceGroundOutputNodeName, "powered_logic_device_ground_contact_missing"),
      DEVICE_SIGNAL_HIGH: contactByNodeName(system.profile, channel.highSideSignalInputNodeName, "powered_logic_high_side_contact_missing"),
      SURFACE_GROUND: contactByNodeName(system.profile, channel.surfaceGroundNodeName, "powered_logic_surface_ground_contact_missing"),
      SURFACE_LOGIC_SUPPLY: contactByNodeName(system.profile, channel.logicSupplyInputNodeName, "powered_logic_supply_input_contact_missing"),
      SURFACE_SIGNAL_LOW: contactByNodeName(system.profile, channel.lowSideSignalOutputNodeName, "powered_logic_low_side_contact_missing")
    };
    if (Object.values(deviceContacts).some((contact) => !contact)) {
      fail("powered_logic_device_contact_contract_incomplete", { assetId: peripheral.assetId });
    }

    const harnessByRole = new Map(harnessContract.conductors.map((conductor) => [conductor.role, conductor]));
    const surfaceTargets = {};
    for (const [role, capability] of [
      ["SURFACE_GROUND", "GND"],
      ["SURFACE_LOGIC_SUPPLY", "3V3"],
      ["SURFACE_SIGNAL_LOW", load.logicSignal.controllerCapability]
    ]) {
      const conductor = harnessByRole.get(role);
      surfaceTargets[role] = takeMatingSurfaceContact(
        surfaceContacts,
        capability,
        conductor.toContact,
        usedSurfaceNodes,
        usedSurfaceControllerPins,
        surface.assetId
      );
    }

    const targets = {
      DEVICE_POWER: [{ part: peripheral, contact: deviceContacts.DEVICE_POWER }, { part: system, contact: systemContacts.DEVICE_POWER }],
      DEVICE_GROUND: [{ part: peripheral, contact: deviceContacts.DEVICE_GROUND }, { part: system, contact: systemContacts.DEVICE_GROUND }],
      DEVICE_SIGNAL_HIGH: [{ part: peripheral, contact: deviceContacts.DEVICE_SIGNAL_HIGH }, { part: system, contact: systemContacts.DEVICE_SIGNAL_HIGH }],
      SURFACE_GROUND: [{ part: system, contact: systemContacts.SURFACE_GROUND }, { part: surface, contact: surfaceTargets.SURFACE_GROUND }],
      SURFACE_LOGIC_SUPPLY: [{ part: system, contact: systemContacts.SURFACE_LOGIC_SUPPLY }, { part: surface, contact: surfaceTargets.SURFACE_LOGIC_SUPPLY }],
      SURFACE_SIGNAL_LOW: [{ part: system, contact: systemContacts.SURFACE_SIGNAL_LOW }, { part: surface, contact: surfaceTargets.SURFACE_SIGNAL_LOW }]
    };
    const groundNet = {
      id: `${peripheral.id}:powered-logic-common-ground`,
      signal: "GND",
      endpoints: []
    };
    const groundEndpointKeys = new Set();
    for (const conductor of harnessContract.conductors) {
      const [fromTarget, toTarget] = targets[conductor.role];
      if (!connectorsMate(conductor.fromContact, fromTarget.contact)
        || !connectorsMate(conductor.toContact, toTarget.contact)) {
        fail("powered_logic_harness_mate_incompatible", {
          assetId: harness.assetId,
          peripheralAssetId: peripheral.assetId,
          role: conductor.role
        });
      }
      const signal = poweredLogicNetSignal(conductor.role, load.logicSignal.deviceSignal);
      const net = ["DEVICE_GROUND", "SURFACE_GROUND"].includes(conductor.role)
        ? groundNet
        : { id: `${peripheral.id}:${conductor.role.toLowerCase().replaceAll("_", "-")}`, signal, endpoints: [] };
      const netEndpoints = [
        endpoint(fromTarget.part, fromTarget.contact),
        endpoint(harness, conductor.fromContact),
        endpoint(harness, conductor.toContact),
        endpoint(toTarget.part, toTarget.contact)
      ];
      for (const entry of netEndpoints) {
        const key = `${entry.partId}:${entry.nodeName}`;
        if (net === groundNet && groundEndpointKeys.has(key)) continue;
        net.endpoints.push(entry);
        if (net === groundNet) groundEndpointKeys.add(key);
      }
      if (net !== groundNet) nets.push(net);
      const prefix = `${peripheral.id}:${harnessContract.id}:${conductor.id}`;
      connections.push({
        id: `${prefix}:from-mate`,
        netId: net.id,
        signal,
        connectionMode: "rigid-mate",
        poweredLogicHarnessId: harnessContract.id,
        poweredLogicHarnessConductorId: conductor.id,
        poweredLogicHarnessRigidMate: true,
        poweredLogicHarnessEnd: "from",
        poweredLogicHarnessTransformGroup: conductor.fromTransformGroup,
        fromPartId: harness.id,
        toPartId: fromTarget.part.id,
        fromEndpoint: endpoint(harness, conductor.fromContact),
        toEndpoint: endpoint(fromTarget.part, fromTarget.contact)
      });
      connections.push({
        id: `${prefix}:conductor`,
        netId: net.id,
        signal,
        connectionMode: "deformable-powered-logic-harness",
        poweredLogicHarnessId: harnessContract.id,
        poweredLogicHarnessConductorId: conductor.id,
        poweredLogicHarnessConductor: true,
        fromPartId: harness.id,
        toPartId: harness.id,
        fromEndpoint: endpoint(harness, conductor.fromContact),
        toEndpoint: endpoint(harness, conductor.toContact),
        bundleId: `${harness.id}:${harnessContract.id}`,
        color: poweredLogicColor(conductor.role),
        maximumCableLengthM: conductor.maximumCableLengthM,
        diameterM: conductor.diameterM,
        minimumBendRadiusM: conductor.minimumBendRadiusM,
        fromWireExitAnchorNodeName: conductor.fromWireExitAnchorNodeName,
        toWireExitAnchorNodeName: conductor.toWireExitAnchorNodeName,
        fromNodePrefix: conductor.fromNodePrefix,
        toNodePrefix: conductor.toNodePrefix
      });
      connections.push({
        id: `${prefix}:to-mate`,
        netId: net.id,
        signal,
        connectionMode: "rigid-mate",
        poweredLogicHarnessId: harnessContract.id,
        poweredLogicHarnessConductorId: conductor.id,
        poweredLogicHarnessRigidMate: true,
        poweredLogicHarnessEnd: "to",
        poweredLogicHarnessTransformGroup: conductor.toTransformGroup,
        fromPartId: harness.id,
        toPartId: toTarget.part.id,
        fromEndpoint: endpoint(harness, conductor.toContact),
        toEndpoint: endpoint(toTarget.part, toTarget.contact),
        ...(["SURFACE_GROUND", "SURFACE_LOGIC_SUPPLY", "SURFACE_SIGNAL_LOW"].includes(conductor.role)
          ? { surfaceEndpoint: endpoint(surface, toTarget.contact) }
          : {})
      });
    }
    nets.push(groundNet);
    expectedConductorCount += harnessContract.conductors.length;
    translationResolved &&= channel.thresholdsProven === true
      && channel.direction === load.logicSignal.direction
      && channel.outputVoltageRangeV[1] <= load.logicSignal.controllerAcceptedVoltageRangeV[1] + 1e-9;
    powerBudgetValid &&= systemContract.continuousCurrentA + 1e-9 >= load.continuousCurrentA
      && systemContract.peakCurrentA + 1e-9 >= load.peakCurrentA;
    commonGroundResolved &&= systemContract.commonGroundRequired === true
      && systemContacts.DEVICE_GROUND.nodeName !== systemContacts.SURFACE_GROUND.nodeName
      && groundNet.endpoints.some((entry) => entry.partId === peripheral.id)
      && groundNet.endpoints.some((entry) => entry.partId === surface.id);
  }
  return {
    nets,
    connections,
    resolvedPeripheralCount: peripherals.length,
    expectedConductorCount,
    translationResolved,
    powerBudgetValid,
    commonGroundResolved
  };
}

function validatedPoweredLogicLoad(profile) {
  const load = profile?.electrical?.poweredLogicLoad;
  if (!load || !Array.isArray(load.acceptedSupplyVoltageRangeV) || load.acceptedSupplyVoltageRangeV.length !== 2
    || !load.acceptedSupplyVoltageRangeV.every(Number.isFinite)
    || load.acceptedSupplyVoltageRangeV[0] <= 0
    || load.acceptedSupplyVoltageRangeV[1] < load.acceptedSupplyVoltageRangeV[0]
    || !Number.isFinite(load.continuousCurrentA) || load.continuousCurrentA <= 0
    || !Number.isFinite(load.peakCurrentA) || load.peakCurrentA < load.continuousCurrentA
    || typeof load.deviceConnectorId !== "string" || !load.deviceConnectorId
    || typeof load.powerSignal !== "string" || !load.powerSignal
    || typeof load.groundSignal !== "string" || !load.groundSignal
    || !load.logicSignal || typeof load.logicSignal.deviceSignal !== "string"
    || load.logicSignal.direction !== "device-to-controller"
    || load.logicSignal.controllerCapability !== "DIGITAL_INPUT"
    || load.logicSignal.translationRequired !== true
    || !Array.isArray(load.logicSignal.deviceVoltageRangeV) || load.logicSignal.deviceVoltageRangeV.length !== 2
    || !load.logicSignal.deviceVoltageRangeV.every(Number.isFinite)
    || !Array.isArray(load.logicSignal.controllerAcceptedVoltageRangeV)
    || load.logicSignal.controllerAcceptedVoltageRangeV.length !== 2
    || !load.logicSignal.controllerAcceptedVoltageRangeV.every(Number.isFinite)
    || !Number.isFinite(load.logicSignal.maximumFrequencyHz) || load.logicSignal.maximumFrequencyHz <= 0) {
    fail("powered_logic_load_contract_missing", { assetId: profile?.assetId || "unknown" });
  }
  return structuredClone(load);
}

function poweredLogicDevicePort(profile, load) {
  const connector = (profile.connectors || []).find((entry) => entry.id === load.deviceConnectorId);
  const contacts = (profile.contacts || []).filter((contact) => contact.connectorId === load.deviceConnectorId);
  const required = [load.powerSignal, load.groundSignal, load.logicSignal.deviceSignal];
  if (!connector || contacts.length < required.length
    || required.some((signal) => !contacts.some((contact) => normalizeSignal(contact.signal) === normalizeSignal(signal)))) {
    fail("powered_logic_device_connector_contract_missing", { assetId: profile.assetId, connectorId: load.deviceConnectorId });
  }
  return { connector, contacts };
}

function validatedPoweredLogicInterfaceSystem(profile) {
  const contract = profile?.poweredLogicInterfaceSystem;
  const channel = contract?.channel;
  const nodeFields = [
    "devicePowerOutputNodeName",
    "deviceGroundOutputNodeName",
    "highSideSignalInputNodeName",
    "surfaceGroundNodeName",
    "logicSupplyInputNodeName",
    "lowSideSignalOutputNodeName"
  ];
  if (!contract || contract.upstreamPowerResolved !== true || contract.commonGroundRequired !== true
    || !Number.isFinite(contract.outputSupplyVoltageV) || contract.outputSupplyVoltageV <= 0
    || !Number.isFinite(contract.logicSupplyVoltageV) || contract.logicSupplyVoltageV <= 0
    || !Number.isFinite(contract.continuousCurrentA) || contract.continuousCurrentA <= 0
    || !Number.isFinite(contract.peakCurrentA) || contract.peakCurrentA < contract.continuousCurrentA
    || !channel || channel.direction !== "device-to-controller" || channel.thresholdsProven !== true
    || !Array.isArray(channel.inputVoltageRangeV) || channel.inputVoltageRangeV.length !== 2
    || !channel.inputVoltageRangeV.every(Number.isFinite)
    || !Array.isArray(channel.outputVoltageRangeV) || channel.outputVoltageRangeV.length !== 2
    || !channel.outputVoltageRangeV.every(Number.isFinite)
    || !Number.isFinite(channel.maximumFrequencyHz) || channel.maximumFrequencyHz <= 0
    || nodeFields.some((field) => typeof channel[field] !== "string" || !channel[field])) {
    fail("powered_logic_interface_system_contract_invalid", { assetId: profile?.assetId || "unknown" });
  }
  const nodes = new Set(nodeFields.map((field) => channel[field]));
  if (nodes.size !== nodeFields.length
    || [...nodes].some((nodeName) => !(profile.contacts || []).some((contact) => contact.nodeName === nodeName))) {
    fail("powered_logic_interface_system_contacts_invalid", { assetId: profile.assetId });
  }
  return structuredClone(contract);
}

function poweredLogicSystemSupportsLoad(contract, load) {
  const channel = contract.channel;
  return contract.outputSupplyVoltageV + 1e-9 >= load.acceptedSupplyVoltageRangeV[0]
    && contract.outputSupplyVoltageV - 1e-9 <= load.acceptedSupplyVoltageRangeV[1]
    && contract.continuousCurrentA + 1e-9 >= load.continuousCurrentA
    && contract.peakCurrentA + 1e-9 >= load.peakCurrentA
    && contract.logicSupplyVoltageV <= load.logicSignal.controllerAcceptedVoltageRangeV[1] + 1e-9
    && channel.direction === load.logicSignal.direction
    && channel.thresholdsProven === true
    && channel.inputVoltageRangeV[0] <= load.logicSignal.deviceVoltageRangeV[0] + 1e-9
    && channel.inputVoltageRangeV[1] + 1e-9 >= load.logicSignal.deviceVoltageRangeV[1]
    && channel.outputVoltageRangeV[0] + 1e-9 >= load.logicSignal.controllerAcceptedVoltageRangeV[0]
    && channel.outputVoltageRangeV[1] <= load.logicSignal.controllerAcceptedVoltageRangeV[1] + 1e-9
    && channel.maximumFrequencyHz + 1e-9 >= load.logicSignal.maximumFrequencyHz;
}

function poweredLogicHarnessContract(profile, devicePort, load, systemProfile) {
  try {
    validatedPoweredLogicHarness(profile, devicePort, load, systemProfile);
    return true;
  } catch {
    return false;
  }
}

function validatedPoweredLogicHarness(profile, devicePort, load, systemProfile) {
  const contract = profile?.poweredLogicHarness;
  if (!contract || !contract.id || contract.deviceConnectorId === undefined
    || !Array.isArray(contract.conductors) || contract.conductors.length !== POWERED_LOGIC_HARNESS_ROLES.length) {
    fail("powered_logic_harness_contract_invalid", { assetId: profile?.assetId || "unknown" });
  }
  const roles = contract.conductors.map((conductor) => conductor.role);
  if (new Set(roles).size !== POWERED_LOGIC_HARNESS_ROLES.length
    || POWERED_LOGIC_HARNESS_ROLES.some((role) => !roles.includes(role))) {
    fail("powered_logic_harness_roles_invalid", { assetId: profile.assetId });
  }
  const harnessDeviceConnector = (profile.connectors || []).find((connector) => connector.id === contract.deviceConnectorId);
  if (!harnessDeviceConnector || !connectorsMate(harnessDeviceConnector, devicePort.connector)) {
    fail("powered_logic_harness_device_mate_invalid", { assetId: profile.assetId });
  }
  const contactsByNode = new Map((profile.contacts || []).map((contact) => [contact.nodeName, contact]));
  const anchorsByNode = new Map((profile.routingAnchors || []).map((anchor) => [anchor.nodeName, anchor]));
  const output = [];
  for (const conductor of contract.conductors) {
    const fromContact = contactsByNode.get(conductor.fromContactNodeName);
    const toContact = contactsByNode.get(conductor.toContactNodeName);
    const fromAnchor = anchorsByNode.get(conductor.fromWireExitAnchorNodeName);
    const toAnchor = anchorsByNode.get(conductor.toWireExitAnchorNodeName);
    if (!conductor.id || !fromContact || !toContact || !fromAnchor || !toAnchor
      || !conductor.fromNodePrefix || !conductor.toNodePrefix
      || !conductor.fromTransformGroup || !conductor.toTransformGroup
      || !Number.isFinite(conductor.maximumCableLengthM) || conductor.maximumCableLengthM <= 0
      || !Number.isFinite(conductor.diameterM) || conductor.diameterM <= 0
      || !Number.isFinite(conductor.minimumBendRadiusM) || conductor.minimumBendRadiusM < conductor.diameterM) {
      fail("powered_logic_harness_conductor_invalid", { assetId: profile.assetId, conductorId: conductor?.id || "unknown" });
    }
    if (["DEVICE_POWER", "DEVICE_GROUND", "DEVICE_SIGNAL_HIGH"].includes(conductor.role)
      && fromContact.connectorId !== contract.deviceConnectorId) {
      fail("powered_logic_harness_device_connector_split", { assetId: profile.assetId, role: conductor.role });
    }
    output.push({ ...structuredClone(conductor), fromContact, toContact, fromAnchor, toAnchor });
  }
  const systemNodes = new Set((systemProfile.contacts || []).map((contact) => contact.nodeName));
  if (!systemNodes.size || !load.logicSignal.translationRequired) {
    fail("powered_logic_harness_system_contract_missing", { assetId: profile.assetId });
  }
  return { ...structuredClone(contract), conductors: output };
}

function poweredLogicNetSignal(role, deviceSignal) {
  if (["DEVICE_GROUND", "SURFACE_GROUND"].includes(role)) return "GND";
  if (role === "DEVICE_POWER") return "5V";
  if (role === "SURFACE_LOGIC_SUPPLY") return "3V3";
  if (role === "DEVICE_SIGNAL_HIGH") return `${normalizeSignal(deviceSignal)}_HIGH`;
  return `${normalizeSignal(deviceSignal)}_LOW`;
}

function poweredLogicColor(role) {
  if (role.includes("GROUND")) return "black";
  if (role.includes("POWER") || role.includes("SUPPLY")) return "red";
  return "yellow";
}

function compileServoPeripherals({ servos, instances, surface, surfaceContacts, usedSurfaceNodes, usedSurfaceControllerPins, usedCablePartIds }) {
  if (!servos.length) {
    return {
      nets: [],
      connections: [],
      resolvedServoPartCount: 0,
      expectedServoChannelCount: 0,
      resolvedServoChannelCount: 0,
      routeMode: "none",
      powerBudgetValid: true,
      commonGroundResolved: true
    };
  }

  const loads = servos.flatMap((servo) => {
    const load = validatedServoLoad(servo.profile);
    const ports = servoPortsForProfile(servo.profile, load.channelCount, "servo_connector_contract_missing");
    return ports.map((servoPort, channelIndex) => ({ servo, load, servoPort, channelIndex }));
  });
  const ownerVerifiedRules = loads.map(({ servo }) => servo.profile.electrical?.ownerVerifiedCarrierPower || null);
  if (ownerVerifiedRules.every(Boolean)) {
    return compileOwnerVerifiedCarrierServoGuides({
      loads,
      instances,
      surface,
      surfaceContacts,
      usedSurfaceNodes,
      usedSurfaceControllerPins
    });
  }
  const requiredContinuousCurrentA = loads.reduce((sum, entry) => sum + entry.load.continuousCurrentA, 0);
  const requiredPeakCurrentA = loads.reduce((sum, entry) => sum + entry.load.peakCurrentA, 0);
  const availablePowerSystems = instances
    .filter((part) => ["power", "power_distribution"].includes(part.category) && part.profile.servoPowerSystem)
    .map((part) => ({ part, contract: validatedServoPowerSystem(part.profile) }));
  const powerCandidates = availablePowerSystems
    .filter(({ contract }) => contract.outputs.length >= loads.length
      && contract.continuousCurrentA + 1e-9 >= requiredContinuousCurrentA
      && contract.peakCurrentA + 1e-9 >= requiredPeakCurrentA
      && loads.every(({ load }) => contract.outputVoltageV + 1e-9 >= load.acceptedVoltageRangeV[0]
        && contract.outputVoltageV - 1e-9 <= load.acceptedVoltageRangeV[1]))
    .sort((left, right) => (
      left.contract.outputs.length - right.contract.outputs.length
      || left.contract.continuousCurrentA - right.contract.continuousCurrentA
      || left.part.id.localeCompare(right.part.id)
    ));
  if (!powerCandidates.length) {
    if (availablePowerSystems.length) {
      fail("servo_power_capacity_or_voltage_insufficient", {
        assetId: servos[0].assetId,
        servoCount: loads.length,
        requiredContinuousCurrentA,
        requiredPeakCurrentA,
        acceptedVoltageRangesV: loads.map(({ load }) => load.acceptedVoltageRangeV),
        availableSystems: availablePowerSystems.map(({ part, contract }) => ({
          partId: part.id,
          outputVoltageV: contract.outputVoltageV,
          continuousCurrentA: contract.continuousCurrentA,
          peakCurrentA: contract.peakCurrentA,
          outputCount: contract.outputs.length
        }))
      });
    }
    fail("servo_intact_plug_power_and_mating_path_required", {
      assetId: servos[0].assetId,
      required: ["compatible_three_pin_mate", "regulated_4v8_to_6v_supply", "common_ground", "legal_pwm_contact"],
      servoCount: loads.length,
      requiredContinuousCurrentA,
      requiredPeakCurrentA
    });
  }
  const { part: power, contract: powerContract } = powerCandidates[0];
  const commonGroundInput = contactByNodeName(power.profile, powerContract.commonGroundInputNodeName, "servo_power_common_ground_input_missing");
  const commonGroundSurface = takeSurfaceContact(
    surfaceContacts,
    "GND",
    usedSurfaceNodes,
    surface.assetId,
    false,
    usedSurfaceControllerPins
  );
  assertLooseJumperEndpoint(commonGroundSurface, surface.assetId, "servo_common_ground_surface_contact_incompatible");
  assertLooseJumperEndpoint(commonGroundInput, power.assetId, "servo_common_ground_power_contact_incompatible");

  const groundNet = {
    id: `${power.id}:servo-common-ground`,
    signal: "GND",
    endpoints: [endpoint(surface, commonGroundSurface), endpoint(power, commonGroundInput)]
  };
  const nets = [groundNet];
  const connections = [{
    id: `${groundNet.id}:bond`,
    netId: groundNet.id,
    signal: "GND",
    connectionMode: "routed-conductor",
    quickConnector: false,
    servoCommonGroundBond: true,
    fromPartId: surface.id,
    toPartId: power.id,
    fromEndpoint: endpoint(surface, commonGroundSurface),
    toEndpoint: endpoint(power, commonGroundInput),
    surfaceEndpoint: endpoint(surface, commonGroundSurface),
    bundleId: `${power.id}:common-ground`,
    terminationMode: "female-socket-to-female-socket",
    color: "black"
  }];

  for (const [index, { servo, load, servoPort, channelIndex }] of loads.entries()) {
    const harness = findUnusedCable(instances, usedCablePartIds, (profile) => servoHarnessContract(profile, servo.profile, servoPort));
    if (!harness) {
      fail("servo_intact_plug_power_and_mating_path_required", {
        assetId: servo.assetId,
        required: ["compatible_three_pin_mate", "regulated_4v8_to_6v_supply", "common_ground", "legal_pwm_contact"],
        missing: "compatible_three_pin_mate"
      });
    }
    usedCablePartIds.add(harness.id);
    const harnessContract = validatedServoHarness(harness.profile, servo.profile, servoPort);
    const harnessServoPort = connectorPorts(harness.profile, "servo_2.54mm_3p")
      .find((port) => port.connector.id === harnessContract.servoConnectorId);
    if (!harnessServoPort || !connectorsMate(harnessServoPort.connector, servoPort.connector)) {
      fail("servo_connector_gender_mismatch", { assetId: harness.assetId, servoAssetId: servo.assetId });
    }
    const output = powerContract.outputs[index];
    const powerOutput = contactByNodeName(power.profile, output.powerNodeName, "servo_power_output_contact_missing");
    const groundOutput = contactByNodeName(power.profile, output.groundNodeName, "servo_ground_output_contact_missing");
    const pwmSurface = takeMatingSurfaceContact(
      surfaceContacts,
      "PWM",
      harnessContract.sourceContacts.PWM,
      usedSurfaceNodes,
      usedSurfaceControllerPins,
      surface.assetId
    );
    const targets = {
      GND: { part: power, contact: groundOutput },
      POWER: { part: power, contact: powerOutput },
      PWM: { part: surface, contact: pwmSurface }
    };
    for (const signal of ["GND", "POWER", "PWM"]) {
      const servoContact = signal === "POWER"
        ? findServoPowerContact(servoPort.contacts)
        : findSignalContact(servoPort.contacts, signal);
      const harnessServoContact = findSignalContact(harnessServoPort.contacts, signal);
      const harnessSourceContact = harnessContract.sourceContacts[signal];
      const target = targets[signal];
      if (!servoContact || !harnessServoContact || !harnessSourceContact) {
        fail("servo_harness_contact_contract_incomplete", { assetId: harness.assetId, signal });
      }
      if (!connectorsMate(harnessServoContact, servoContact) || !connectorsMate(harnessSourceContact, target.contact)) {
        fail("servo_connector_gender_mismatch", { assetId: harness.assetId, servoAssetId: servo.assetId, signal });
      }
      const channelKey = load.channelCount === 1 ? servo.id : `${servo.id}:channel-${channelIndex + 1}`;
      const net = signal === "GND" ? groundNet : {
        id: `${channelKey}:${signal.toLowerCase()}`,
        signal,
        endpoints: []
      };
      net.endpoints.push(
        endpoint(target.part, target.contact),
        endpoint(harness, harnessSourceContact),
        endpoint(harness, harnessServoContact),
        endpoint(servo, servoContact)
      );
      if (signal !== "GND") nets.push(net);
      const prefix = `${channelKey}:${signal.toLowerCase()}`;
      connections.push({
        id: `${prefix}:servo-mate`,
        netId: net.id,
        signal,
        connectionMode: "rigid-mate",
        servoHarnessId: harnessContract.id,
        servoHarnessConductorId: signal.toLowerCase(),
        servoHarnessRigidMate: true,
        engagementDepthM: harnessContract.engagementDepthM,
        fromPartId: harness.id,
        toPartId: servo.id,
        fromEndpoint: endpoint(harness, harnessServoContact),
        toEndpoint: endpoint(servo, servoContact)
      });
      connections.push({
        id: `${prefix}:harness-conductor`,
        netId: net.id,
        signal,
        connectionMode: "deformable-servo-harness",
        servoHarnessId: harnessContract.id,
        servoHarnessConductorId: signal.toLowerCase(),
        servoHarnessConductor: true,
        fromPartId: harness.id,
        toPartId: harness.id,
        fromEndpoint: endpoint(harness, harnessServoContact),
        toEndpoint: endpoint(harness, harnessSourceContact),
        bundleId: `${harness.id}:${harnessContract.id}`,
        color: colorForSignal(signal),
        maximumCableLengthM: harnessContract.maximumCableLengthM,
        diameterM: harnessContract.diameterM,
        minimumBendRadiusM: harnessContract.minimumBendRadiusM
      });
      connections.push({
        id: `${prefix}:source-mate`,
        netId: net.id,
        signal,
        connectionMode: "rigid-mate",
        servoHarnessId: harnessContract.id,
        servoHarnessConductorId: signal.toLowerCase(),
        servoHarnessRigidMate: true,
        fromPartId: harness.id,
        toPartId: target.part.id,
        fromEndpoint: endpoint(harness, harnessSourceContact),
        toEndpoint: endpoint(target.part, target.contact),
        ...(signal === "PWM" ? { surfaceEndpoint: endpoint(surface, pwmSurface) } : {})
      });
    }
    load.allocatedPowerOutputId = output.id;
  }
  return {
    nets,
    connections,
    resolvedServoPartCount: servos.length,
    expectedServoChannelCount: loads.length,
    resolvedServoChannelCount: loads.length,
    routeMode: "regulated-power-and-intact-harness",
    powerBudgetValid: powerContract.continuousCurrentA + 1e-9 >= requiredContinuousCurrentA
      && powerContract.peakCurrentA + 1e-9 >= requiredPeakCurrentA,
    commonGroundResolved: Boolean(commonGroundInput && commonGroundSurface)
  };
}

function compileOwnerVerifiedCarrierServoGuides({
  loads,
  instances,
  surface,
  surfaceContacts,
  usedSurfaceNodes,
  usedSurfaceControllerPins
}) {
  const rules = loads.map(({ servo }) => servo.profile.electrical.ownerVerifiedCarrierPower);
  const ruleIds = new Set(rules.map((rule) => rule.ruleId));
  const requiredCarrierIds = new Set(rules.map((rule) => rule.requiredCarrierAssetId));
  const maximumChannels = Math.min(...rules.map((rule) => rule.maximumServoChannels));
  const controller = instances.find((part) => part.category === "controller");
  if (ruleIds.size !== 1 || requiredCarrierIds.size !== 1
    || surface.category !== "carrier" || !requiredCarrierIds.has(surface.assetId)
    || !controller || !rules.every((rule) => rule.allowedControllerAssetIds.includes(controller.assetId))) {
    fail("owner_verified_servo_route_scope_mismatch", {
      carrierAssetId: surface.assetId,
      controllerAssetId: controller?.assetId || "missing",
      ruleIds: [...ruleIds],
      requiredCarrierIds: [...requiredCarrierIds]
    });
  }
  if (!Number.isInteger(maximumChannels) || loads.length > maximumChannels) {
    fail("owner_verified_servo_channel_capacity_exceeded", {
      channelCount: loads.length,
      maximumChannels
    });
  }

  const nets = [];
  const connections = [];
  if (!rules.every((rule) => (
    rule.physicalContactReuse === "forbidden"
    && rule.physicalPowerContactMode === "matching_gvs_row"
    && rule.supplySignal === "3V3"
    && Number(rule.minimumDistinctPowerContacts) >= loads.length
    && Number(rule.minimumDistinctGroundContacts) >= loads.length
  ))) {
    fail("owner_verified_servo_distinct_contact_policy_missing", {
      ruleId: rules[0].ruleId,
      channelCount: loads.length
    });
  }
  for (const [loadIndex, { servo, load, servoPort, channelIndex }] of loads.entries()) {
    const channelKey = load.channelCount === 1 ? servo.id : `${servo.id}:channel-${channelIndex + 1}`;
    // Placement assigns the first paired kit to the left of the carrier and
    // the second to the right. Allocate its ground and PWM contacts from the
    // matching carrier bank so guides approach the centre from their nearest
    // side instead of criss-crossing over the mounted controller.
    const preferredCarrierBank = loadIndex < Math.ceil(loads.length / 2)
      ? "left-breakout"
      : "right-breakout";
    const pwmContact = takeOrderedCarrierPwmContact(
      surfaceContacts,
      preferredCarrierBank,
      usedSurfaceNodes,
      surface.assetId,
      usedSurfaceControllerPins,
      channelIndex,
      load.channelCount
    );
    const powerContact = takeMatchingCarrierRowSupply(
      surfaceContacts,
      pwmContact,
      rules[0].supplySignal,
      usedSurfaceNodes,
      surface.assetId,
      usedSurfaceControllerPins
    );
    const targets = {
      GND: takeMatchingCarrierRowGround(
        surfaceContacts,
        pwmContact,
        usedSurfaceNodes,
        surface.assetId,
        usedSurfaceControllerPins
      ),
      POWER: powerContact,
      PWM: pwmContact
    };
    for (const role of ["GND", "POWER", "PWM"]) {
      const deviceContact = role === "POWER"
        ? findServoPowerContact(servoPort.contacts)
        : findSignalContact(servoPort.contacts, role);
      if (!deviceContact) fail("servo_connector_contract_missing", { assetId: servo.assetId, role });
      const surfaceContact = targets[role];
      const signal = role === "POWER" ? rules[0].supplySignal : role;
      // The carrier rail is electrically common, but a wiring guide is a
      // physical connection contract. Every channel therefore owns a unique
      // route and a unique carrier contact; no net identity can waive that.
      const netId = `${channelKey}:${signal.toLowerCase()}`;
      const surfacePoint = endpoint(surface, surfaceContact);
      const devicePoint = endpoint(servo, deviceContact);
      // Preserve the source contact's exact electrical signal for the net,
      // while giving the beginner-facing guide a non-contradictory label.
      // The exact owner route intentionally lands the red servo supply lead
      // on the selected row's 3V3 contact, so rendering "5V -> 3V3" would look
      // like an unvalidated voltage mismatch even though the rule is scoped.
      const presentationDevicePoint = role === "POWER"
        ? { ...devicePoint, presentationSignal: "POSITIVE SUPPLY" }
        : devicePoint;
      nets.push({
        id: netId,
        signal,
        railGroupId: role === "POWER" ? `${surface.id}:3v3-gvs-common-rail` : undefined,
        ownerVerifiedCarrierPowerRuleId: rules[0].ruleId,
        endpoints: [surfacePoint, devicePoint]
      });
      connections.push({
        id: `${netId}:owner-verified-guide`,
        netId,
        signal,
        connectionMode: "routed-conductor",
        quickConnector: false,
        ownerVerifiedServoGuide: true,
        ownerVerifiedCarrierPowerRuleId: rules[0].ruleId,
        fromPartId: surface.id,
        toPartId: servo.id,
        fromEndpoint: surfacePoint,
        toEndpoint: presentationDevicePoint,
        surfaceEndpoint: surfacePoint,
        controllerCapability: role === "POWER" ? rules[0].supplySignal : role,
        bundleId: channelKey,
        // Keep the three conductors for one physical servo together. A paired
        // kit contains two spatially separated servos, so treating all six
        // conductors as one visual bundle lets the channels swap sides and
        // cross even though their electrical identities are distinct.
        visualBundleId: channelKey,
        terminationMode: "owner-bench-verified-distinct-carrier-contact-guide",
        // The product owner asked for fixed beginner-facing semantics for this
        // route: black ground, red positive power, yellow PWM signal.
        color: role === "GND" ? "black" : role === "POWER" ? "red" : "yellow"
      });
    }
  }
  return {
    nets,
    connections,
    resolvedServoPartCount: new Set(loads.map(({ servo }) => servo.id)).size,
    expectedServoChannelCount: loads.length,
    resolvedServoChannelCount: loads.length,
    routeMode: "owner-bench-verified-distinct-gvs-trio-guide",
    powerBudgetValid: true,
    commonGroundResolved: connections.filter((connection) => connection.signal === "GND").length === loads.length,
    ownerVerifiedCarrierPowerRuleId: rules[0].ruleId
  };
}

function takeMatchingCarrierRowSupply(
  contacts,
  signalContact,
  supplySignal,
  usedNodes,
  assetId,
  usedControllerPins
) {
  const candidates = contacts.filter((contact) => (
    !usedNodes.has(contact.nodeName)
    && contactSupports(contact, supplySignal)
    && contact.breakoutLaneRole === "supply"
    && contact.breakoutBank === signalContact.breakoutBank
    && contact.breakoutRowSignal === signalContact.breakoutRowSignal
  ));
  if (!candidates.length) {
    fail("owner_verified_servo_matching_power_contact_unavailable", {
      assetId,
      supplySignal,
      signalNodeName: signalContact.nodeName,
      breakoutBank: signalContact.breakoutBank,
      breakoutRowSignal: signalContact.breakoutRowSignal
    });
  }
  const selected = candidates.sort((left, right) => compareSurfaceContacts(left, right, supplySignal))[0];
  usedNodes.add(selected.nodeName);
  recordControllerPinAllocation(usedControllerPins, surfaceControllerPinKey(selected), supplySignal);
  return selected;
}

function takeMatchingCarrierRowGround(contacts, signalContact, usedNodes, assetId, usedControllerPins) {
  const candidates = contacts.filter((contact) => (
    !usedNodes.has(contact.nodeName)
    && contactSupports(contact, "GND")
    && contact.breakoutLaneRole === "ground"
    && contact.breakoutBank === signalContact.breakoutBank
    && contact.breakoutRowSignal === signalContact.breakoutRowSignal
  ));
  if (!candidates.length) {
    fail("owner_verified_servo_matching_ground_contact_unavailable", {
      assetId,
      signalNodeName: signalContact.nodeName,
      breakoutBank: signalContact.breakoutBank,
      breakoutRowSignal: signalContact.breakoutRowSignal
    });
  }
  const selected = candidates.sort((left, right) => compareSurfaceContacts(left, right, "GND"))[0];
  usedNodes.add(selected.nodeName);
  recordControllerPinAllocation(usedControllerPins, surfaceControllerPinKey(selected), "GND");
  return selected;
}

function takeOrderedCarrierPwmContact(
  contacts,
  preferredBank,
  usedNodes,
  assetId,
  usedControllerPins,
  channelIndex = 0,
  channelCount = 1
) {
  const channelIsLowerHalf = channelCount > 1 && channelIndex >= Math.ceil(channelCount / 2);
  // The right GVS bank runs GND->S in the opposite X direction from the left
  // bank. Contact-frame alignment therefore mirrors a paired kit and reverses
  // its A/B vertical order. Mirror the row choice with it so the two servo
  // channels never swap sides after placement.
  const preferLowerRow = String(preferredBank).startsWith("right")
    ? !channelIsLowerHalf
    : channelIsLowerHalf;
  const candidates = contacts.filter((contact) => (
    String(contact.nodeName || "").includes(preferredBank)
    && !usedNodes.has(contact.nodeName)
    && controllerPinAllocationAllowed(usedControllerPins, surfaceControllerPinKey(contact), "PWM")
    && contactSupports(contact, "PWM")
    && contact.breakoutLaneRole === "signal"
  )).sort((left, right) => (
    // A paired-wheel GLB places channel A above the carrier centre and channel
    // B below it. Give A the highest available row and B the lowest available
    // row on the matching carrier bank. Consuming the top two rows for A/B
    // reverses channel B spatially and creates an avoidable X.
    (preferLowerRow ? 1 : -1)
      * (Number(left.position?.[1] || 0) - Number(right.position?.[1] || 0))
      || compareSurfaceContacts(left, right, "PWM")
  ));
  if (!candidates.length) {
    fail("legal_surface_contact_unavailable", { assetId, capability: "PWM", preferredBank });
  }
  const selected = candidates[0];
  usedNodes.add(selected.nodeName);
  recordControllerPinAllocation(usedControllerPins, surfaceControllerPinKey(selected), "PWM");
  return selected;
}

function validatedServoLoad(profile) {
  const load = profile?.electrical?.servoLoad;
  if (!load || !Array.isArray(load.acceptedVoltageRangeV) || load.acceptedVoltageRangeV.length !== 2
    || !load.acceptedVoltageRangeV.every(Number.isFinite)
    || load.acceptedVoltageRangeV[0] <= 0 || load.acceptedVoltageRangeV[1] < load.acceptedVoltageRangeV[0]
    || !Number.isFinite(load.continuousCurrentA) || load.continuousCurrentA <= 0
    || !Number.isFinite(load.peakCurrentA) || load.peakCurrentA < load.continuousCurrentA) {
    fail("servo_load_contract_missing", { assetId: profile?.assetId || "unknown" });
  }
  const channelCount = load.channelCount === undefined ? 1 : load.channelCount;
  if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 16) {
    fail("servo_load_channel_count_invalid", { assetId: profile?.assetId || "unknown", channelCount });
  }
  return { ...structuredClone(load), channelCount };
}

function validatedServoPowerSystem(profile) {
  const contract = profile?.servoPowerSystem;
  if (!contract || !Number.isFinite(contract.outputVoltageV) || contract.outputVoltageV <= 0
    || !Number.isFinite(contract.continuousCurrentA) || contract.continuousCurrentA <= 0
    || !Number.isFinite(contract.peakCurrentA) || contract.peakCurrentA < contract.continuousCurrentA
    || contract.commonGroundRequired !== true || contract.upstreamPowerResolved !== true
    || typeof contract.commonGroundInputNodeName !== "string" || !contract.commonGroundInputNodeName
    || !Array.isArray(contract.outputs) || !contract.outputs.length) {
    fail("servo_power_system_contract_invalid", { assetId: profile?.assetId || "unknown" });
  }
  const ids = new Set();
  for (const output of contract.outputs) {
    if (!output?.id || ids.has(output.id) || !output.powerNodeName || !output.groundNodeName
      || output.powerNodeName === output.groundNodeName) {
      fail("servo_power_output_contract_invalid", { assetId: profile.assetId, outputId: output?.id || "unknown" });
    }
    ids.add(output.id);
    contactByNodeName(profile, output.powerNodeName, "servo_power_output_contact_missing");
    contactByNodeName(profile, output.groundNodeName, "servo_ground_output_contact_missing");
  }
  contactByNodeName(profile, contract.commonGroundInputNodeName, "servo_power_common_ground_input_missing");
  return structuredClone(contract);
}

function servoHarnessContract(profile, servoProfile, servoPort) {
  if (!profile?.servoHarness) return false;
  try {
    validatedServoHarness(profile, servoProfile, servoPort);
    return true;
  } catch (error) {
    if (error instanceof Prompt2CircuitCompileError) return false;
    throw error;
  }
}

function validatedServoHarness(profile, servoProfile, targetServoPort = null) {
  const contract = profile?.servoHarness;
  if (!contract || !contract.id || !contract.servoConnectorId
    || !contract.sourceConnectorIds || !["GND", "POWER", "PWM"].every((signal) => contract.sourceConnectorIds[signal])
    || !Number.isFinite(contract.maximumCableLengthM) || contract.maximumCableLengthM <= 0
    || !Number.isFinite(contract.diameterM) || contract.diameterM <= 0
    || !Number.isFinite(contract.minimumBendRadiusM) || contract.minimumBendRadiusM < contract.diameterM
    || !Number.isFinite(contract.engagementDepthM) || contract.engagementDepthM < 0) {
    fail("servo_harness_contract_invalid", { assetId: profile?.assetId || "unknown" });
  }
  const servoPort = connectorPorts(profile, "servo_2.54mm_3p").find((port) => port.connector.id === contract.servoConnectorId);
  const selectedTargetServoPort = targetServoPort || servoPortsForProfile(servoProfile, 1, "servo_connector_contract_missing")[0];
  if (!servoPort || !findSignalContact(servoPort.contacts, "GND") || !findSignalContact(servoPort.contacts, "PWM")
    || !findServoPowerContact(servoPort.contacts)
    || !connectorsMate(servoPort.connector, selectedTargetServoPort.connector)) {
    fail("servo_connector_gender_mismatch", { assetId: profile.assetId, servoAssetId: servoProfile.assetId });
  }
  const sourceContacts = {};
  for (const signal of ["GND", "POWER", "PWM"]) {
    const connectorId = contract.sourceConnectorIds[signal];
    const contact = (profile.contacts || []).find((entry) => entry.connectorId === connectorId && normalizeSignal(entry.signal) === signal);
    if (!contact) fail("servo_harness_source_contact_missing", { assetId: profile.assetId, signal });
    sourceContacts[signal] = contact;
  }
  return { ...structuredClone(contract), sourceContacts };
}

function servoPortsForProfile(profile, expectedCount, errorCode) {
  const candidates = connectorPorts(profile, "servo_2.54mm_3p").filter((port) => (
    findSignalContact(port.contacts, "GND")
    && findSignalContact(port.contacts, "PWM")
    && findServoPowerContact(port.contacts)
  ));
  if (candidates.length !== expectedCount) fail(errorCode, { assetId: profile.assetId, candidateCount: candidates.length, expectedCount });
  return candidates.sort((left, right) => String(left.connector.id).localeCompare(String(right.connector.id)));
}

function findServoPowerContact(contacts) {
  return contacts.find((contact) => ["POWER", "5V", "VCC", "VIN", "VDD"].includes(normalizeSignal(contact.signal)));
}

function contactByNodeName(profile, nodeName, errorCode) {
  const contact = (profile.contacts || []).find((entry) => entry.nodeName === nodeName);
  if (!contact) fail(errorCode, { assetId: profile.assetId, nodeName });
  return contact;
}

function assertLooseJumperEndpoint(contact, assetId, errorCode) {
  const family = String(contact?.connectorFamily || "").toLowerCase();
  const gender = String(contact?.gender || "").toLowerCase();
  if (!family.includes("2.54mm") || !/male/.test(gender) || /female/.test(gender)) {
    fail(errorCode, { assetId, nodeName: contact?.nodeName || "unknown", connectorFamily: contact?.connectorFamily, gender: contact?.gender });
  }
}

function compileQuickPeripheral({ peripheral, connectorIntent, instances, surface, surfaceContacts, usedSurfaceNodes, usedSurfaceControllerPins, usedCablePartIds, requiredSignals = exactRequiredSignals(peripheral.profile) }) {
  if (connectorIntent === "grove_4p") {
    if (surface.category !== "carrier" || surface.assetId !== GROVE_CARRIER_ASSET_ID) {
      fail("grove_requires_xiao_expansion_base", {
        assetId: peripheral.assetId,
        carrierAssetId: surface.assetId,
        requiredCarrierAssetId: GROVE_CARRIER_ASSET_ID
      });
    }
    const peripheralPort = selectConnectorPort(peripheral.profile, "grove", requiredSignals, new Set(), "compatible_grove_sensor_port_missing");
    const surfacePort = selectGroveSurfacePort(surface.profile, requiredSignals, usedSurfaceNodes, "compatible_grove_carrier_port_missing");
    const cable = findUnusedCable(instances, usedCablePartIds, (profile) => hasTwoCompatibleConnectorEnds(profile, "grove"));
    if (!cable) {
      const logicalCable = validatedLogicalGroveCableRequirement(peripheral.profile, requiredSignals, peripheralPort, surfacePort);
      const nets = [];
      const connections = [];
      for (const signal of requiredSignals) {
        const peripheralContact = findSignalContact(peripheralPort.contacts, signal);
        const surfaceContact = findSignalContact(surfacePort.contacts, groveSurfaceSignal(signal));
        usedSurfaceNodes.add(surfaceContact.nodeName);
        const netId = `${peripheral.id}:${signal.toLowerCase()}`;
        nets.push({
          id: netId,
          signal,
          instructionOnlyAccessory: logicalCable,
          endpoints: [endpoint(surface, surfaceContact), endpoint(peripheral, peripheralContact)]
        });
        connections.push({
          id: `${netId}:logical-grove-guide`,
          netId,
          signal,
          connectionMode: "routed-conductor",
          quickConnector: true,
          connectorIntent: "grove_4p",
          instructionOnlyAccessory: logicalCable,
          fromPartId: surface.id,
          toPartId: peripheral.id,
          fromEndpoint: endpoint(surface, surfaceContact),
          toEndpoint: endpoint(peripheral, peripheralContact),
          surfaceEndpoint: endpoint(surface, surfaceContact),
          controllerCapability: sourceCapability(signal, peripheral.profile),
          bundleId: peripheral.id,
          terminationMode: "exact-grove-cable-instruction-only",
          color: colorForSignal(signal)
        });
      }
      return { nets, connections };
    }
    const cablePorts = connectorPorts(cable.profile, "grove").filter((port) => requiredSignals.every((signal) => findSignalContact(port.contacts, signal)));
    if (cablePorts.length < 2) fail("grove_cable_contact_contract_incomplete", { assetId: cable.assetId });
    if (!connectorsMate(cablePorts[0].connector, peripheralPort.connector)
      || !connectorsMate(cablePorts[1].connector, surfacePort.connector)) {
      fail("grove_connector_gender_mismatch", { assetId: cable.assetId });
    }
    usedCablePartIds.add(cable.id);
    const nets = [];
    const connections = [];
    for (const signal of requiredSignals) {
      const peripheralContact = findSignalContact(peripheralPort.contacts, signal);
      const sensorCableContact = findSignalContact(cablePorts[0].contacts, signal);
      const carrierCableContact = findSignalContact(cablePorts[1].contacts, signal);
      const surfaceContact = findSignalContact(surfacePort.contacts, groveSurfaceSignal(signal));
      usedSurfaceNodes.add(surfaceContact.nodeName);
      const netId = `${peripheral.id}:${signal.toLowerCase()}`;
      nets.push({
        id: netId,
        signal,
        endpoints: [endpoint(peripheral, peripheralContact), endpoint(cable, sensorCableContact), endpoint(cable, carrierCableContact), endpoint(surface, surfaceContact)]
      });
      connections.push({
        id: `${netId}:sensor-grove-mate`,
        netId,
        signal,
        connectionMode: "rigid-mate",
        quickConnector: true,
        fromPartId: cable.id,
        toPartId: peripheral.id,
        fromEndpoint: endpoint(cable, sensorCableContact),
        toEndpoint: endpoint(peripheral, peripheralContact)
      });
      connections.push({
        id: `${netId}:carrier-grove-mate`,
        netId,
        signal,
        connectionMode: "rigid-mate",
        quickConnector: true,
        fromPartId: cable.id,
        toPartId: surface.id,
        fromEndpoint: endpoint(cable, carrierCableContact),
        toEndpoint: endpoint(surface, surfaceContact),
        surfaceEndpoint: endpoint(surface, surfaceContact)
      });
    }
    return { nets, connections };
  }

  const cable = findUnusedCable(instances, usedCablePartIds, (profile) => (
    profile.contacts.some((contact) => contact.connectorId === "qwiic-plug")
    && profile.contacts.some((contact) => contact.connectorId === "individual-socket")
  ));
  if (!cable) fail("qwiic_adapter_cable_required", { assetId: peripheral.assetId });
  usedCablePartIds.add(cable.id);
  const surfaceAssignments = selectCompactSurfaceCluster(
    surfaceContacts,
    requiredSignals,
    usedSurfaceNodes,
    usedSurfaceControllerPins,
    surface.assetId,
    peripheral.assetId,
    peripheral.profile,
    surface.category === "controller" ? 0.08 : null
  );
  const nets = [];
  const connections = [];
  for (const signal of requiredSignals) {
    const peripheralContact = takeContact(peripheral.profile.contacts, signal, new Set(), "peripheral_contact_missing", peripheral.assetId, false);
    const plugContact = takeContact(cable.profile.contacts.filter((contact) => contact.connectorId === "qwiic-plug"), signal, new Set(), "qwiic_plug_contact_missing", cable.assetId, false);
    const socketContact = takeContact(cable.profile.contacts.filter((contact) => contact.connectorId === "individual-socket"), signal, new Set(), "qwiic_socket_contact_missing", cable.assetId, false);
    const surfaceContact = surfaceAssignments.get(normalizeSignal(signal));
    const netId = `${peripheral.id}:${signal.toLowerCase()}`;
    nets.push({ id: netId, signal, endpoints: [endpoint(peripheral, peripheralContact), endpoint(cable, plugContact), endpoint(cable, socketContact), endpoint(surface, surfaceContact)] });
    connections.push({
      id: `${netId}:sensor-plug`,
      netId,
      signal,
      connectionMode: "rigid-mate",
      quickConnector: true,
      fromPartId: cable.id,
      toPartId: peripheral.id,
      fromEndpoint: endpoint(cable, plugContact),
      toEndpoint: endpoint(peripheral, peripheralContact)
    });
    connections.push({
      id: `${netId}:carrier-socket`,
      netId,
      signal,
      connectionMode: "rigid-mate",
      quickConnector: false,
      fromPartId: cable.id,
      toPartId: surface.id,
      fromEndpoint: endpoint(cable, socketContact),
      toEndpoint: endpoint(surface, surfaceContact),
      surfaceEndpoint: endpoint(surface, surfaceContact),
      controllerCapability: sourceCapability(signal, peripheral.profile),
      sharedControllerBus: Boolean(surfaceContact.policySharedControllerBus)
    });
  }
  return { nets, connections };
}

function validatedLogicalGroveCableRequirement(profile, requiredSignals, peripheralPort, surfacePort) {
  const contracts = profile.logicalGuideAccessoryRequirements || [];
  const candidates = contracts.filter((contract) => (
    contract?.renderPolicy === "instruction-only-off-scene-interconnect"
    && connectorFamiliesMate(contract.connectorFamily, "grove_2.0mm_4p")
    && /male|plug/i.test(String(contract.connectorGender || ""))
    && contract.straightThrough === true
    && typeof contract.requiredAccessorySku === "string"
    && contract.requiredAccessorySku.trim()
    && typeof contract.requiredAccessory === "string"
    && contract.requiredAccessory.trim()
  ));
  if (candidates.length !== 1) {
    fail("grove_instruction_only_cable_contract_missing", {
      assetId: profile.assetId,
      candidateCount: candidates.length
    });
  }
  const contract = candidates[0];
  const declaredSignals = (contract.contactOrder || []).map(normalizeSignal);
  const normalizedRequired = requiredSignals.map(normalizeSignal);
  const unmatedSignals = (contract.unmatedSignals || []).map(normalizeSignal);
  const expectedPhysicalSignals = [...new Set([...normalizedRequired, ...unmatedSignals])];
  if (unmatedSignals.some((signal) => normalizedRequired.includes(signal))
    || declaredSignals.length !== expectedPhysicalSignals.length
    || expectedPhysicalSignals.some((signal) => !declaredSignals.includes(signal))) {
    fail("grove_instruction_only_contact_order_incomplete", {
      assetId: profile.assetId,
      requiredSignals: normalizedRequired,
      unmatedSignals,
      declaredSignals
    });
  }
  const peripheralOrder = peripheralPort.contacts.map((contact) => normalizeSignal(contact.signal));
  if (JSON.stringify(declaredSignals) !== JSON.stringify(peripheralOrder)) {
    fail("grove_instruction_only_contact_order_mismatch", {
      assetId: profile.assetId,
      declaredSignals,
      peripheralOrder
    });
  }
  if (declaredSignals.some((signal) => !findSignalContact(surfacePort.contacts, groveSurfaceSignal(signal)))) {
    fail("grove_instruction_only_surface_contact_missing", {
      assetId: profile.assetId,
      carrierAssetId: surfacePort.assetId,
      declaredSignals
    });
  }
  const plug = { family: contract.connectorFamily, gender: contract.connectorGender };
  if (!connectorsMate(plug, peripheralPort.connector) || !connectorsMate(plug, surfacePort.connector)) {
    fail("grove_instruction_only_connector_mismatch", { assetId: profile.assetId });
  }
  return {
    id: contract.id,
    requiredAccessory: contract.requiredAccessory,
    requiredAccessorySku: contract.requiredAccessorySku,
    connectorFamily: contract.connectorFamily,
    contactOrder: [...contract.contactOrder],
    unmatedSignals: [...(contract.unmatedSignals || [])],
    purchaseDisposition: contract.purchaseDisposition || "required_physical_bom_item",
    renderPolicy: contract.renderPolicy
  };
}

function compileDirectPeripheral({ peripheral, surface, surfaceContacts, usedSurfaceNodes, usedSurfaceControllerPins, allowSharedDirectPower = false, requiredSignals = exactRequiredSignals(peripheral.profile) }) {
  if (!requiredSignals.length) fail("peripheral_required_signals_missing", { assetId: peripheral.assetId });
  if ((peripheral.profile.includedFactoryHarnesses || []).length) {
    return compileIncludedFactoryHarnessPeripheral({
      peripheral,
      surface,
      surfaceContacts,
      usedSurfaceNodes,
      usedSurfaceControllerPins,
      requiredSignals
    });
  }
  const usedPeripheralNodes = new Set();
  const nets = [];
  const connections = [];
  const routedSignals = requiredSignals.map(normalizeSignal).filter((signal) => signal !== "NC");
  // Preserve the compiler's most specific safety failures before attempting a
  // geometric allocation. A voltage-domain or carrier-power violation must be
  // reported as such, not obscured by a later "no legal contact" result.
  for (const signal of routedSignals) {
    assertSignalDomainCompatible(peripheral.profile, signal, peripheral.assetId);
    assertSurfacePowerPolicy(surface.profile, sourceCapability(signal, peripheral.profile), peripheral.assetId);
  }
  // Allocate every loose-wire peripheral as one compact carrier-side cluster.
  // Selecting each contact independently can scatter one device across both
  // carrier banks (for example GND on the left and I2C on the right), which is
  // electrically valid but produces crossed, hard-to-follow wiring guides.
  // The cluster gate keeps one device on the nearest legal carrier side while
  // preserving capability, canonical-pin, and unique-contact constraints.
  const surfaceAssignments = selectCompactSurfaceCluster(
    surfaceContacts,
    routedSignals,
    usedSurfaceNodes,
    usedSurfaceControllerPins,
    surface.assetId,
    peripheral.assetId,
    peripheral.profile,
    // An integrated controller's exposed headers can legitimately span the
    // full board width. The compact 20 mm carrier-bank rule is only suitable
    // for replicated carrier rows; applying it to a display/camera controller
    // rejected otherwise legal direct-wire guides whose power and signal pins
    // live on opposite header banks.
    surface.category === "controller"
      || (peripheral.profile.ownerDisposition?.evidenceType === "user_bench_verified"
        && peripheral.profile.ownerDisposition?.requiredCarrierAssetId === surface.assetId)
      ? 0.08
      : null,
    allowSharedDirectPower
  );
  for (const signal of requiredSignals) {
    if (signal === "NC") continue;
    const targetContact = takeContact(peripheral.profile.contacts, signal, usedPeripheralNodes, "peripheral_contact_missing", peripheral.assetId, true);
    const capability = sourceCapability(signal, peripheral.profile);
    const sourceContact = surfaceAssignments.get(normalizeSignal(signal));
    if (!sourceContact) fail("compact_surface_assignment_missing", { assetId: surface.assetId, peripheralAssetId: peripheral.assetId, signal });
    const netId = `${peripheral.id}:${signal.toLowerCase()}`;
    nets.push({ id: netId, signal, endpoints: [endpoint(surface, sourceContact), endpoint(peripheral, targetContact)] });
    connections.push({
      id: `${netId}:wire`,
      netId,
      signal,
      connectionMode: "routed-conductor",
      quickConnector: false,
      fromPartId: surface.id,
      toPartId: peripheral.id,
      fromEndpoint: endpoint(surface, sourceContact),
      toEndpoint: endpoint(peripheral, targetContact),
      surfaceEndpoint: endpoint(surface, sourceContact),
      sharedSurfaceEndpoint: Boolean(sourceContact.policyShared),
      sharedControllerBus: Boolean(sourceContact.policySharedControllerBus),
      controllerCapability: capability,
      ...(sourceContact.powerSourceClass === MIRRORED_POWER_CONTACT_CLASS
        ? { mirroredPowerAuthorizationId: peripheral.profile.ownerDisposition.mirroredPowerAuthorization.authorizationId }
        : {}),
      // A logical bundle belongs to one peripheral, never the entire carrier.
      // This prevents unrelated devices from being treated as one permissive
      // trunk and makes cross-device route clearance enforceable.
      bundleId: peripheral.id,
      terminationMode: sourceContact.policyShared ? "policy-approved-shared-crimp-y-harness" : "single-contact",
      color: colorForSignal(signal)
    });
  }
  return { nets, connections };
}

function compileIncludedFactoryHarnessPeripheral({ peripheral, surface, surfaceContacts, usedSurfaceNodes, usedSurfaceControllerPins, requiredSignals }) {
  const required = requiredSignals.map(normalizeSignal).filter((signal) => signal !== "NC");
  const candidates = (peripheral.profile.includedFactoryHarnesses || []).filter((harness) => {
    const signals = new Set((harness.conductors || []).map((conductor) => normalizeSignal(conductor.signal)));
    return required.every((signal) => signals.has(signal));
  });
  if (candidates.length !== 1) {
    fail("included_factory_harness_selection_invalid", { assetId: peripheral.assetId, candidateCount: candidates.length, requiredSignals: required });
  }
  const harness = candidates[0];
  const primaryNodes = new Set();
  const nets = [];
  const connections = [];
  for (const signal of required) {
    const conductor = harness.conductors.find((entry) => normalizeSignal(entry.signal) === signal);
    const primaryContact = takeContact(peripheral.profile.contacts, signal, primaryNodes, "peripheral_contact_missing", peripheral.assetId, true);
    assertSignalDomainCompatible(peripheral.profile, signal, peripheral.assetId);
    const capability = sourceCapability(signal, peripheral.profile);
    assertSurfacePowerPolicy(surface.profile, capability, peripheral.assetId);
    const surfaceContact = takeMatingSurfaceContact(
      surfaceContacts,
      capability,
      conductor.surfaceEnd.contact,
      usedSurfaceNodes,
      usedSurfaceControllerPins,
      surface.assetId
    );
    if (!connectorsMate(conductor.deviceEnd.contact, primaryContact)) {
      fail("included_factory_harness_device_mate_incompatible", { assetId: peripheral.assetId, harnessId: harness.id, signal });
    }
    const deviceSocket = endpoint(peripheral, conductor.deviceEnd.contact);
    const surfaceSocket = endpoint(peripheral, conductor.surfaceEnd.contact);
    const devicePin = endpoint(peripheral, primaryContact);
    const surfacePin = endpoint(surface, surfaceContact);
    const netId = `${peripheral.id}:${signal.toLowerCase()}`;
    const conductorId = `${peripheral.id}:${harness.id}:${conductor.id}`;
    nets.push({ id: netId, signal, endpoints: [surfacePin, surfaceSocket, deviceSocket, devicePin] });
    connections.push({
      id: `${conductorId}:device-mate`,
      netId,
      signal,
      connectionMode: "rigid-mate",
      factoryHarnessId: harness.id,
      factoryHarnessConductorId: conductor.id,
      factoryHarnessRigidMate: true,
      engagementDepthM: conductor.deviceEnd.engagementDepthM,
      fromPartId: peripheral.id,
      toPartId: peripheral.id,
      fromEndpoint: deviceSocket,
      toEndpoint: devicePin
    });
    connections.push({
      id: `${conductorId}:conductor`,
      netId,
      signal,
      connectionMode: "deformable-factory-harness",
      factoryHarnessId: harness.id,
      factoryHarnessConductorId: conductor.id,
      factoryHarnessConductor: true,
      fromPartId: peripheral.id,
      toPartId: peripheral.id,
      fromEndpoint: deviceSocket,
      toEndpoint: surfaceSocket,
      bundleId: `${peripheral.id}:${harness.id}`,
      color: colorForSignal(signal),
      maximumCableLengthM: conductor.usableLengthM,
      diameterM: conductor.diameterM,
      minimumBendRadiusM: conductor.minimumBendRadiusM
    });
    connections.push({
      id: `${conductorId}:surface-mate`,
      netId,
      signal,
      connectionMode: "rigid-mate",
      factoryHarnessId: harness.id,
      factoryHarnessConductorId: conductor.id,
      factoryHarnessRigidMate: true,
      engagementDepthM: conductor.surfaceEnd.engagementDepthM,
      fromPartId: peripheral.id,
      toPartId: surface.id,
      fromEndpoint: surfaceSocket,
      toEndpoint: surfacePin,
      surfaceEndpoint: surfacePin
    });
  }
  return { nets, connections };
}

function compileRequiredPhysicalSubassemblies(peripheral, compiled) {
  const components = peripheral.profile.passiveComponents || [];
  const ties = peripheral.profile.requiredNetTies || [];
  if (!components.length && !ties.length) return { ...compiled, subcomponents: [] };
  const componentById = new Map(components.map((component) => [component.id, component]));
  const subcomponents = components.map((component) => ({
    id: `${peripheral.id}:${component.id}`,
    localId: component.id,
    parentPartId: peripheral.id,
    assetId: peripheral.assetId,
    componentType: component.componentType,
    resistanceOhms: component.resistanceOhms,
    tolerancePercent: component.tolerancePercent,
    placementMode: component.placementMode,
    sourceNodeNames: [...component.sourceNodeNames],
    bounds: structuredClone(component.bounds),
    terminals: component.terminals.map((terminal) => endpoint(peripheral, {
      ...terminal,
      subcomponentId: component.id,
      terminalId: terminal.id
    }))
  }));
  for (const tie of ties) {
    const component = componentById.get(tie.componentId);
    if (!component) fail("required_physical_component_missing", { assetId: peripheral.assetId, componentId: tie.componentId });
    for (const binding of tie.terminalBindings || []) {
      const terminal = component.terminals.find((candidate) => candidate.id === binding.terminalId);
      const targetContact = findSignalContact(peripheral.profile.contacts, binding.targetSignal);
      const net = compiled.nets.find((candidate) => normalizeSignal(candidate.signal) === normalizeSignal(binding.targetSignal));
      if (!terminal || !targetContact || !net) {
        fail("required_physical_net_tie_unresolved", {
          assetId: peripheral.assetId,
          tieId: tie.id,
          terminalId: binding.terminalId,
          targetSignal: binding.targetSignal
        });
      }
      const passiveEndpoint = endpoint(peripheral, {
        ...terminal,
        subcomponentId: component.id,
        terminalId: terminal.id
      });
      if (!net.endpoints.some((candidate) => candidate.subcomponentId === component.id && candidate.terminalId === terminal.id)) {
        net.endpoints.push(passiveEndpoint);
      }
      const feederConnection = compiled.connections.find((candidate) => (
        candidate.netId === net.id && candidate.surfaceEndpoint
      ));
      compiled.connections.push({
        id: `${peripheral.id}:${tie.id}:${terminal.id}:wire`,
        netId: net.id,
        signal: binding.targetSignal,
        connectionMode: binding.connectionMode,
        quickConnector: false,
        fromPartId: peripheral.id,
        toPartId: peripheral.id,
        fromEndpoint: endpoint(peripheral, targetContact),
        toEndpoint: passiveEndpoint,
        // The branch is a deliberate continuation of the same harness/net and
        // shares the main lead's splice point at the peripheral contact.
        bundleId: feederConnection?.bundleId || feederConnection?.fromPartId || peripheral.id,
        terminationMode: binding.spliceMode,
        physicalSubassembly: true,
        passiveComponentId: component.id,
        requiredTieId: tie.id,
        color: colorForSignal(binding.targetSignal)
      });
    }
  }
  return { ...compiled, subcomponents };
}

function compileRequiredSignalStraps(
  peripheral,
  compiled,
  handledStrapIds = new Set(),
  { surface, surfaceContacts, usedSurfaceNodes, usedSurfaceControllerPins } = {}
) {
  const straps = (peripheral.profile.requiredSignalStraps || []).filter((strap) => !handledStrapIds?.has(strap.id));
  if (!straps.length) return compiled;
  for (const strap of straps) {
    if (strap.terminationMode !== "separate-surface-contact-strap") {
      fail("required_signal_strap_physical_endpoint_unresolved", {
        assetId: peripheral.assetId,
        strapId: strap.id,
        terminationMode: strap.terminationMode
      });
    }
    const fromContact = findSignalContact(peripheral.profile.contacts, strap.fromSignal);
    const targetNet = compiled.nets.find((candidate) => normalizeSignal(candidate.signal) === normalizeSignal(strap.toSignal));
    if (!fromContact || !targetNet || !surface || !surfaceContacts || !usedSurfaceNodes || !usedSurfaceControllerPins) {
      fail("required_signal_strap_endpoint_unresolved", {
        assetId: peripheral.assetId,
        strapId: strap.id,
        fromSignal: strap.fromSignal,
        toSignal: strap.toSignal
      });
    }
    const capability = sourceCapability(strap.toSignal, peripheral.profile);
    assertSurfacePowerPolicy(surface.profile, capability, peripheral.assetId);
    const surfaceContact = takeSurfaceContact(
      surfaceContacts,
      capability,
      usedSurfaceNodes,
      surface.assetId,
      false,
      usedSurfaceControllerPins
    );
    const surfaceEndpoint = endpoint(surface, surfaceContact);
    const strapEndpoint = endpoint(peripheral, fromContact);
    for (const candidate of [surfaceEndpoint, strapEndpoint]) {
      if (!targetNet.endpoints.some((existing) => (
        existing.nodeName === candidate.nodeName && existing.partId === candidate.partId
      ))) targetNet.endpoints.push(candidate);
    }
    const feederConnection = compiled.connections.find((candidate) => candidate.netId === targetNet.id && candidate.surfaceEndpoint);
    compiled.connections.push({
      id: `${peripheral.id}:${strap.id}:wire`,
      netId: targetNet.id,
      signal: strap.toSignal,
      strapSourceSignal: strap.fromSignal,
      connectionMode: strap.connectionMode,
      quickConnector: false,
      fromPartId: surface.id,
      toPartId: peripheral.id,
      fromEndpoint: surfaceEndpoint,
      toEndpoint: strapEndpoint,
      surfaceEndpoint,
      controllerCapability: capability,
      bundleId: feederConnection?.bundleId || feederConnection?.fromPartId || peripheral.id,
      terminationMode: strap.terminationMode,
      requiredSignalStrap: true,
      requiredStrapId: strap.id,
      color: colorForSignal(strap.toSignal)
    });
  }
  return compiled;
}

function analyzeExternalTerminalOccupancy(connections) {
  const byTerminal = new Map();
  const externalConnections = connections.filter((connection) => (
    connection.connectionMode !== "rigid-mate"
    && connection.physicalSubassembly !== true
    && connection.fromEndpoint?.partId
    && connection.fromEndpoint?.nodeName
    && connection.toEndpoint?.partId
    && connection.toEndpoint?.nodeName
  ));
  for (const connection of externalConnections) {
    for (const endpoint of [connection.fromEndpoint, connection.toEndpoint]) {
      const key = `${endpoint.partId}\u0000${endpoint.nodeName}`;
      const entries = byTerminal.get(key) || [];
      entries.push({ connection, endpoint });
      byTerminal.set(key, entries);
    }
  }

  let authorizedSharedContactCount = 0;
  const overCapacity = [];
  for (const [key, entries] of byTerminal) {
    const maximumTerminations = Math.min(...entries.map(({ endpoint }) => (
      Number.isInteger(endpoint.maxExternalTerminations) && endpoint.maxExternalTerminations > 0
        ? endpoint.maxExternalTerminations
        : 1
    )));
    if (entries.length <= maximumTerminations) continue;
    const uniqueConnections = [...new Set(entries.map(({ connection }) => connection))];
    const explicitSharedCrimp = entries.length === uniqueConnections.length
      && uniqueConnections.filter((connection) => connection.sharedSurfaceEndpoint !== true).length === 1
      && uniqueConnections.filter((connection) => connection.sharedSurfaceEndpoint === true).every((connection) => (
        connection.terminationMode === "policy-approved-shared-crimp-y-harness"
      ));
    if (explicitSharedCrimp) {
      const authorizationId = `terminal-share:${key.replace("\u0000", ":")}`;
      for (const connection of uniqueConnections) connection.terminalOccupancyAuthorizationId = authorizationId;
      authorizedSharedContactCount += 1;
      continue;
    }
    overCapacity.push({
      partId: entries[0].endpoint.partId,
      nodeName: entries[0].endpoint.nodeName,
      maximumTerminations,
      requestedTerminations: entries.length,
      connectionIds: uniqueConnections.map((connection) => connection.id).sort()
    });
  }
  return {
    policyVersion: "single-external-conductor-per-physical-contact-v1",
    defaultMaximumTerminations: 1,
    occupiedContactCount: byTerminal.size,
    authorizedSharedContactCount,
    overCapacity
  };
}

function assertSignalDomainCompatible(profile, signal, assetId) {
  if (/^(?:GND|3V3|5V|VCC|VIN|VDD|POWER)$/i.test(signal)) return;
  const domains = profile?.electrical?.signalDomains || {};
  const domain = domains[signal] || domains[String(signal).toUpperCase()] || "";
  if (/5V_LOGIC|LEVEL_SHIFT/i.test(String(domain))) {
    fail("level_shifter_required_for_esp32_logic", { assetId, signal, domain });
  }
}

function propagatedSurfaceContacts(surfaceProfile, controllerProfile, carrierMounted) {
  const controllerBySignal = new Map();
  for (const contact of controllerProfile.contacts || []) {
    const normalized = normalizeSignal(contact.signal);
    const existing = controllerBySignal.get(normalized) || [];
    existing.push(contact);
    controllerBySignal.set(normalized, existing);
  }
  return (surfaceProfile.contacts || [])
    .filter((contact) => !carrierMounted || !/^controller-|xiao-controller-socket/.test(contact.connectorId || ""))
    .map((contact) => {
      const controllerContact = controllerBySignal.get(normalizeSignal(contact.signal))?.[0];
      return {
        ...contact,
        surfaceAssetId: surfaceProfile.assetId,
        surfaceAssetSha256: surfaceProfile.assetSha256,
        capabilities: [...new Set([
          ...capabilitiesForContact(contact),
          ...(controllerContact?.capabilities || []),
          ...capabilitiesForContact(controllerContact || {})
        ])]
      };
    });
}

function takeSurfaceContact(contacts, capability, usedNodes, assetId, allowReuse = false, usedControllerPins = new Map()) {
  const candidates = contacts.filter((contact) => !usedNodes.has(contact.nodeName)
    && controllerPinAllocationAllowed(usedControllerPins, surfaceControllerPinKey(contact), capability)
    && contactSupports(contact, capability));
  if (!candidates.length && allowReuse) {
    const shared = contacts.filter((contact) => usedNodes.has(contact.nodeName) && contactSupports(contact, capability))
      .sort((left, right) => compareSurfaceContacts(left, right, capability))[0];
    if (shared) return { ...shared, policyShared: true };
  }
  if (!candidates.length) fail("legal_surface_contact_unavailable", { assetId, capability });
  // Allocate the least-flexible legal contact first. Otherwise an early
  // generic DIGITAL net can consume the only remaining ADC/I2C/UART contact
  // and make an otherwise valid graph fail later in the same one-shot build.
  const selected = candidates.sort((left, right) => compareSurfaceContacts(left, right, capability))[0];
  const policySharedControllerBus = controllerPinMayShareBus(capability)
    && usedControllerPins.has(surfaceControllerPinKey(selected));
  usedNodes.add(selected.nodeName);
  const controllerPinKey = surfaceControllerPinKey(selected);
  recordControllerPinAllocation(usedControllerPins, controllerPinKey, capability);
  return policySharedControllerBus ? { ...selected, policySharedControllerBus: true } : selected;
}

function takePreferredSurfaceContact(contacts, capability, preferredBank, usedNodes, assetId, usedControllerPins) {
  const preferred = contacts.filter((contact) => String(contact.nodeName || "").includes(preferredBank));
  const preferredHasLegalContact = preferred.some((contact) => (
    !usedNodes.has(contact.nodeName)
    && controllerPinAllocationAllowed(usedControllerPins, surfaceControllerPinKey(contact), capability)
    && contactSupports(contact, capability)
  ));
  return takeSurfaceContact(
    preferredHasLegalContact ? preferred : contacts,
    capability,
    usedNodes,
    assetId,
    false,
    usedControllerPins
  );
}

function takeMatingSurfaceContact(contacts, capability, mateContact, usedNodes, usedControllerPins, assetId) {
  const candidates = contacts.filter((contact) => !usedNodes.has(contact.nodeName)
    && !usedControllerPins.has(surfaceControllerPinKey(contact))
    && contactSupports(contact, capability)
    && connectorsMate(mateContact, contact));
  if (!candidates.length) {
    fail("compatible_surface_contact_unavailable", {
      assetId,
      capability,
      connectorFamily: mateContact.connectorFamily,
      gender: mateContact.gender
    });
  }
  const selected = candidates.sort((left, right) => compareSurfaceContacts(left, right, capability))[0];
  usedNodes.add(selected.nodeName);
  const controllerPinKey = surfaceControllerPinKey(selected);
  recordControllerPinAllocation(usedControllerPins, controllerPinKey, capability);
  return selected;
}

function selectCompactSurfaceCluster(contacts, signals, usedNodes, usedControllerPins, assetId, peripheralAssetId, peripheralProfile = null, maximumSpanOverrideM = null, allowSharedSurfaceContacts = false) {
  const requests = signals.map((signal) => ({ signal: normalizeSignal(signal), capability: sourceCapability(signal, peripheralProfile) }));
  const maximumSpanM = Number.isFinite(maximumSpanOverrideM)
    ? maximumSpanOverrideM
    : requests.length > 4
      ? MAX_HIGH_PIN_COUNT_SURFACE_CLUSTER_SPAN_M
      : MAX_COMPACT_SURFACE_CLUSTER_SPAN_M;
  const candidatesBySignal = new Map(requests.map(({ signal, capability }) => [signal, contacts
    .filter((contact) => {
      const alreadyUsed = usedNodes.has(contact.nodeName);
      const reusable = allowSharedSurfaceContacts && surfaceCapabilityMayFanOut(capability);
      return (!alreadyUsed || reusable)
        && controllerPinAllocationAllowed(usedControllerPins, surfaceControllerPinKey(contact), capability)
        && contactSupports(contact, capability, peripheralProfile);
    })
    .map((contact) => {
      if (!usedNodes.has(contact.nodeName)) return contact;
      return {
        ...contact,
        policyShared: true,
        ...(controllerPinMayShareBus(capability) ? { policySharedControllerBus: true } : {})
      };
    })
    .sort((left, right) => compareSurfaceContacts(left, right, capability))]));
  for (const { signal } of requests) {
    if (!candidatesBySignal.get(signal)?.length) fail("legal_surface_contact_unavailable", { assetId, capability: sourceCapability(signal, peripheralProfile) });
  }
  const ordered = [...requests].sort((left, right) => (
    candidatesBySignal.get(left.signal).length - candidatesBySignal.get(right.signal).length
    || left.signal.localeCompare(right.signal)
  ));
  // Seed the exact search with a deterministic compact assignment. Without a
  // feasible upper bound, an eight-signal display can force the old solver to
  // enumerate millions of interchangeable replicated carrier pins before it
  // learns that most branches are worse. Trying every legal contact as a
  // geometric anchor gives a strong, side-local upper bound in linear time.
  let best = greedyCompactSurfaceCluster({
    ordered,
    candidatesBySignal,
    usedControllerPins
  });
  const estimatedCombinationCount = ordered.reduce((product, request) => (
    Math.min(1_000_001, product * candidatesBySignal.get(request.signal).length)
  ), 1);
  const visit = (index, selected, selectedNodes, selectedPins, selectedContacts) => {
    if (index === ordered.length) {
      const entries = [...selected.entries()];
      const score = surfaceClusterScore(selectedContacts);
      const tie = entries.sort(([left], [right]) => left.localeCompare(right))
        .map(([signal, contact]) => `${signal}:${contact.nodeName}`).join("|");
      if (!best || score < best.score - 1e-12 || (Math.abs(score - best.score) <= 1e-12 && tie < best.tie)) {
        best = { score, tie, selected: new Map(selected) };
      }
      return;
    }
    const request = ordered[index];
    for (const contact of candidatesBySignal.get(request.signal)) {
      const pinKey = surfaceControllerPinKey(contact);
      if (selectedNodes.has(contact.nodeName) || (pinKey && selectedPins.has(pinKey))) continue;
      const nextContacts = [...selectedContacts, contact];
      const partialSpanM = surfaceClusterSpan(nextContacts);
      // A partial cluster can only stay the same size or grow as more
      // contacts are added. Reject already-worse branches now instead of
      // enumerating every GPIO permutation. The existing final span gate
      // remains authoritative and preserves its actionable error code.
      if (best && partialSpanM > best.score + 1e-12) continue;
      selected.set(request.signal, usedControllerPins.has(pinKey) && controllerPinMayShareBus(request.capability)
        ? { ...contact, policySharedControllerBus: true }
        : contact);
      selectedNodes.add(contact.nodeName);
      if (pinKey) selectedPins.add(pinKey);
      visit(index + 1, selected, selectedNodes, selectedPins, nextContacts);
      selected.delete(request.signal);
      selectedNodes.delete(contact.nodeName);
      if (pinKey) selectedPins.delete(pinKey);
    }
  };
  // Small search spaces retain exhaustive optimal scoring. Large replicated
  // carrier surfaces use the seeded deterministic solution: exhaustive search
  // adds no electrical safety and previously made valid display builds appear
  // hung in production smoke tests.
  if (estimatedCombinationCount <= 1_000_000) {
    visit(0, new Map(), new Set(), new Set(), []);
  }
  if (!best) fail("compact_surface_cluster_unavailable", { assetId, peripheralAssetId });
  const selectedSpanM = surfaceClusterSpan([...best.selected.values()]);
  if (selectedSpanM > maximumSpanM + 1e-12) {
    fail("compact_surface_cluster_span_exceeded", { assetId, peripheralAssetId, selectedSpanM, maximumSpanM });
  }
  for (const [signal, contact] of best.selected.entries()) {
    usedNodes.add(contact.nodeName);
    const pinKey = surfaceControllerPinKey(contact);
    recordControllerPinAllocation(usedControllerPins, pinKey, sourceCapability(signal, peripheralProfile));
  }
  return best.selected;
}

function greedyCompactSurfaceCluster({ ordered, candidatesBySignal, usedControllerPins }) {
  const anchors = [...new Map(ordered
    .flatMap((request) => candidatesBySignal.get(request.signal))
    .map((contact) => [contact.nodeName, contact])).values()]
    .sort((left, right) => String(left.nodeName).localeCompare(String(right.nodeName)));
  let best = null;
  for (const anchor of anchors) {
    const selected = new Map();
    const selectedNodes = new Set();
    const selectedPins = new Set();
    const selectedContacts = [];
    for (const request of ordered) {
      const contact = [...candidatesBySignal.get(request.signal)]
        .filter((candidate) => {
          const pinKey = surfaceControllerPinKey(candidate);
          return !selectedNodes.has(candidate.nodeName) && !(pinKey && selectedPins.has(pinKey));
        })
        .sort((left, right) => (
          pointDistance(left.position, anchor.position) - pointDistance(right.position, anchor.position)
          || compareSurfaceContacts(left, right, request.capability)
        ))[0];
      if (!contact) break;
      const pinKey = surfaceControllerPinKey(contact);
      const selectedContact = usedControllerPins.has(pinKey) && controllerPinMayShareBus(request.capability)
        ? { ...contact, policySharedControllerBus: true }
        : contact;
      selected.set(request.signal, selectedContact);
      selectedNodes.add(contact.nodeName);
      if (pinKey) selectedPins.add(pinKey);
      selectedContacts.push(selectedContact);
    }
    if (selected.size !== ordered.length) continue;
    const entries = [...selected.entries()];
    const score = surfaceClusterScore(selectedContacts);
    const tie = entries.sort(([left], [right]) => left.localeCompare(right))
      .map(([signal, contact]) => `${signal}:${contact.nodeName}`).join("|");
    if (!best || score < best.score - 1e-12 || (Math.abs(score - best.score) <= 1e-12 && tie < best.tie)) {
      best = { score, tie, selected };
    }
  }
  return best;
}

function pointDistance(left, right) {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2]
  );
}

function controllerPinMayShareBus(capability) {
  return capability === "I2C_SDA" || capability === "I2C_SCL";
}

function surfaceCapabilityMayFanOut(capability) {
  return ["GND", "3V3", "5V", "I2C_SDA", "I2C_SCL"].includes(capability);
}

function controllerPinAllocationAllowed(usedControllerPins, pinKey, capability) {
  if (!pinKey || !usedControllerPins.has(pinKey)) return true;
  return controllerPinMayShareBus(capability) && usedControllerPins.get(pinKey) === capability;
}

function recordControllerPinAllocation(usedControllerPins, pinKey, capability) {
  if (!pinKey) return;
  const existing = usedControllerPins.get(pinKey);
  if (existing && existing !== capability) {
    fail("canonical_controller_pin_capability_conflict", { controllerPin: pinKey, existingCapability: existing, requestedCapability: capability });
  }
  usedControllerPins.set(pinKey, capability);
}

function canonicalControllerPinCapabilitiesValid(connections) {
  const byPin = new Map();
  for (const connection of connections) {
    const pin = surfaceControllerPinKey(connection.surfaceEndpoint);
    const capability = connection.controllerCapability;
    if (!pin || !capability) continue;
    const capabilities = byPin.get(pin) || new Set();
    capabilities.add(capability);
    byPin.set(pin, capabilities);
  }
  return [...byPin.values()].every((capabilities) => capabilities.size === 1);
}

function surfaceClusterScore(contacts) {
  const spread = surfaceClusterSpan(contacts);
  const flexibilityPenalty = contacts.reduce((sum, contact) => sum + capabilitiesForContact(contact).length, 0) * 1e-8;
  return spread + flexibilityPenalty;
}

function surfaceClusterSpan(contacts) {
  const ranges = [0, 1, 2].map((axis) => {
    const values = contacts.map((contact) => contact.position[axis]);
    return Math.max(...values) - Math.min(...values);
  });
  return Math.hypot(...ranges);
}

function surfaceControllerPinKey(contact) {
  const signal = normalizeSignal(contact?.controllerPin || contact?.signal);
  return /^GPIO\d+$/.test(signal) ? signal : "";
}

function compareSurfaceContacts(left, right, capability) {
  const leftExact = normalizeSignal(left.signal) === capability ? 0 : 1;
  const rightExact = normalizeSignal(right.signal) === capability ? 0 : 1;
  if (leftExact !== rightExact) return leftExact - rightExact;
  const leftCapabilityCount = new Set([...(capabilitiesForContact(left) || []), ...(left.capabilities || [])]).size;
  const rightCapabilityCount = new Set([...(capabilitiesForContact(right) || []), ...(right.capabilities || [])]).size;
  if (leftCapabilityCount !== rightCapabilityCount) return leftCapabilityCount - rightCapabilityCount;
  return String(left.nodeName).localeCompare(String(right.nodeName));
}

function takeContact(contacts, signal, usedNodes, code, assetId, consume) {
  const selected = contacts.find((contact) => !usedNodes.has(contact.nodeName) && normalizeSignal(contact.signal) === normalizeSignal(signal));
  if (!selected) fail(code, { assetId, signal });
  if (consume) usedNodes.add(selected.nodeName);
  return selected;
}

function exactRequiredSignals(profile) {
  const required = profile.electrical?.requiredSignals || [];
  if (profile.electrical?.inferenceState === "catalog_electrical_only") fail("physical_signal_contract_missing", { assetId: profile.assetId });
  return required;
}

function operatingModeResolved(profile) {
  const contract = profile.operatingModeContract;
  if (!contract) return true;
  const required = (profile.electrical?.requiredSignals || []).map(normalizeSignal);
  const declared = (contract.requiredSignals || []).map(normalizeSignal);
  if (!contract.id || !contract.mode || !contract.bus || contract.configurationState?.resolved !== true
    || required.length !== declared.length || declared.some((signal) => !required.includes(signal))) return false;
  return declared.every((signal) => {
    const capability = contract.surfaceCapabilitiesBySignal?.[signal]
      || contract.surfaceCapabilitiesBySignal?.[(contract.requiredSignals || []).find((entry) => normalizeSignal(entry) === signal)];
    return typeof capability === "string" && capability
      && (profile.contacts || []).some((contact) => normalizeSignal(contact.signal) === signal);
  });
}

export function sourceCapability(signal, peripheralProfile = null) {
  const normalized = normalizeSignal(signal);
  const declaredCapability = peripheralProfile?.electrical?.surfaceCapabilitiesBySignal?.[normalized]
    || peripheralProfile?.electrical?.surfaceCapabilitiesBySignal?.[signal];
  if (typeof declaredCapability === "string" && declaredCapability) return declaredCapability;
  if (["GND", "3V3", "5V"].includes(normalized)) return normalized;
  if (normalized === "VCC_5V") return "5V";
  if (["VCC", "VIN", "VDD", "POWER"].includes(normalized)) return preferredPowerCapability(peripheralProfile);
  if (normalized === "PLUS") return preferredPowerCapability(peripheralProfile);
  if (normalized === "SDA") return "I2C_SDA";
  if (normalized === "SCL") return "I2C_SCL";
  if (["AOUT", "VRY", "VRX"].includes(normalized)) return "ADC";
  if (normalized === "PWM") return "PWM";
  if (normalized === "TX") return "UART_RX";
  if (normalized === "RX") return "UART_TX";
  if (normalized === "UART_TX") return "UART_RX";
  if (normalized === "UART_RX") return "UART_TX";
  if (normalized === "MOSI") return "SPI_MOSI";
  if (normalized === "MISO") return "SPI_MISO";
  if (["SCK", "SCLK"].includes(normalized)) return "SPI_SCK";
  if (normalized === "GPIO") return "DIGITAL";
  // DIGITAL means an evidence-backed bidirectional GPIO. Input-only contacts
  // expose DIGITAL_INPUT but not DIGITAL, so mapping a peripheral's direction
  // to DIGITAL is conservative in both directions and never promotes an
  // input-only controller pin into an output.
  if ([
    "OUT", "DOUT", "ECHO", "SW", "CLK", "DT", "RO", "PPS", "INT",
    "IN", "IO", "DI", "DE", "RE", "TRIG", "RST", "RES", "DC", "CS",
    "GPIO1", "XSHUT", "DAT", "RED", "YELLOW", "GREEN", "R", "G", "B", "SIG"
  ].includes(normalized)) return "DIGITAL";
  if (["BL", "BLK"].includes(normalized)) return "PWM";
  return normalized;
}

function preferredPowerCapability(profile) {
  if (["3V3", "5V"].includes(profile?.electrical?.preferredEsp32Supply)) return profile.electrical.preferredEsp32Supply;
  const text = `${profile?.electrical?.voltageEvidence || ""} ${profile?.electrical?.powerEvidence || ""}`.toLowerCase();
  if (/3\.3v|3v3/.test(text)) return "3V3";
  if (/\b5v\b|dc\s*5v/.test(text)) return "5V";
  fail("peripheral_power_domain_ambiguous", { assetId: profile?.assetId || "unknown" });
}

function assertSurfacePowerPolicy(surfaceProfile, capability, peripheralAssetId) {
  if (capability !== "5V") return;
  const restrictions = (surfaceProfile.mounts || []).flatMap((mount) => mount.powerRestrictions || []);
  if (restrictions.some((restriction) => /no-5v-sensor-rail|3v3-sensor-rails-only/i.test(restriction))) {
    fail("carrier_5v_sensor_rail_forbidden", { assetId: peripheralAssetId, carrierAssetId: surfaceProfile.assetId });
  }
}

function contactSupports(contact, capability, peripheralProfile = null) {
  if (contact.powerSourceClass === MIRRORED_POWER_CONTACT_CLASS
    && !mirroredPowerContactAuthorized(contact, peripheralProfile)) return false;
  if (normalizeSignal(contact.signal) === capability) return true;
  const capabilities = [...new Set([...capabilitiesForContact(contact), ...(contact.capabilities || [])])];
  // DIGITAL is an evidence-backed bidirectional GPIO capability. Contracts
  // may ask for the direction-specific input or output form; either is legal
  // only when the contact explicitly owns the generic bidirectional capability.
  if (["DIGITAL_INPUT", "DIGITAL_OUTPUT"].includes(capability) && capabilities.includes("DIGITAL")) return true;
  return capabilities.includes(capability);
}

function mirroredPowerContactAuthorized(contact, peripheralProfile) {
  const disposition = peripheralProfile?.ownerDisposition;
  const authorization = disposition?.mirroredPowerAuthorization;
  const scope = contact?.mirroredPowerAuthorizationScope;
  return Array.isArray(disposition?.allowedSurfacePowerContactClasses)
    && disposition.allowedSurfacePowerContactClasses.includes(MIRRORED_POWER_CONTACT_CLASS)
    && authorization?.schemaVersion === "MakeableMirroredPowerAuthorizationV1"
    && authorization?.peripheralAssetId === peripheralProfile?.assetId
    && authorization?.peripheralAssetSha256 === peripheralProfile?.assetSha256
    && authorization?.carrierAssetId === contact?.surfaceAssetId
    && authorization?.carrierAssetSha256 === contact?.surfaceAssetSha256
    && authorization?.carrierAssetId === scope?.carrierAssetId
    && authorization?.carrierAssetSha256 === scope?.carrierAssetSha256
    && authorization?.contactNodeName === contact?.nodeName
    && authorization?.contactNodeName === scope?.contactNodeName
    && authorization?.maximumConnections === 1
    && authorization?.maximumConnections === scope?.maximumConnections
    && authorization?.physicalContactReuse === "forbidden"
    && authorization?.physicalContactReuse === scope?.physicalContactReuse;
}

function capabilitiesForContact(contact) {
  // A controller profile's evidence-backed capability array is authoritative,
  // including an intentionally empty array for reserved, strapping, USB, or
  // onboard-conflicted GPIOs. Never re-enable such a pin merely because its
  // silkscreen label starts with GPIO.
  if (contact?.capabilityEvidence && Array.isArray(contact.capabilities)) return contact.capabilities;
  const signal = normalizeSignal(contact?.signal);
  if (["GND", "3V3", "5V"].includes(signal)) return [signal];
  if (signal === "SDA") return ["I2C_SDA"];
  if (signal === "SCL") return ["I2C_SCL"];
  if (signal === "TX") return ["UART_TX"];
  if (signal === "RX") return ["UART_RX"];
  if (/^(?:GPIO|D)\d+$/.test(signal)) return ["DIGITAL"];
  return [];
}

function findUnusedCable(instances, used, predicate) {
  return instances.find((part) => part.category === "cable" && !used.has(part.id) && predicate(part.profile));
}

function hasTwoCompatibleConnectorEnds(profile, familyFragment) {
  return profile.connectors.filter((connector) => String(connector.family || "").toLowerCase().includes(familyFragment)).length >= 2;
}

function connectorPorts(profile, familyFragment) {
  return (profile.connectors || [])
    .filter((connector) => String(connector.family || "").toLowerCase().includes(familyFragment))
    .map((connector) => ({
      connector,
      contacts: (profile.contacts || []).filter((contact) => contact.connectorId === connector.id)
    }));
}

function selectConnectorPort(profile, familyFragment, requiredSignals, usedNodes, errorCode) {
  const candidates = connectorPorts(profile, familyFragment).filter((port) => requiredSignals.every((signal) => {
    const contact = findSignalContact(port.contacts, signal);
    return contact && !usedNodes.has(contact.nodeName);
  }));
  if (!candidates.length) fail(errorCode, { assetId: profile.assetId, requiredSignals });
  return candidates.sort((left, right) => String(left.connector.id).localeCompare(String(right.connector.id)))[0];
}

function selectGroveSurfacePort(profile, requiredSignals, usedNodes, errorCode) {
  const candidates = connectorPorts(profile, "grove").filter((port) => requiredSignals.every((signal) => {
    const contact = findSignalContact(port.contacts, groveSurfaceSignal(signal));
    return contact && !usedNodes.has(contact.nodeName);
  }));
  if (!candidates.length) fail(errorCode, { assetId: profile.assetId, requiredSignals });
  return candidates.sort((left, right) => String(left.connector.id).localeCompare(String(right.connector.id)))[0];
}

function groveSurfaceSignal(signal) {
  const normalized = normalizeSignal(signal);
  if (["SIG", "AOUT"].includes(normalized)) return "D0";
  return normalized;
}

function findSignalContact(contacts, signal) {
  return contacts.find((contact) => normalizeSignal(contact.signal) === normalizeSignal(signal));
}

function connectorsMate(left, right) {
  if (!connectorFamiliesMate(left?.family || left?.connectorFamily, right?.family || right?.connectorFamily)) return false;
  const leftGender = String(left?.gender || "").toLowerCase();
  const rightGender = String(right?.gender || "").toLowerCase();
  if (!leftGender || !rightGender || leftGender === "unclassified" || rightGender === "unclassified") return false;
  const leftMale = /male|\bplug\b|plated-ring|contact-pad/.test(leftGender) && !/female/.test(leftGender);
  const rightMale = /male|\bplug\b|plated-ring|contact-pad/.test(rightGender) && !/female/.test(rightGender);
  const leftFemale = /female|receptacle|socket|hook|jaw|clip/.test(leftGender);
  const rightFemale = /female|receptacle|socket|hook|jaw|clip/.test(rightGender);
  return (leftMale && rightFemale) || (rightMale && leftFemale);
}

function connectorFamiliesMate(leftValue, rightValue) {
  const normalize = (value) => {
    const text = String(value || "").toLowerCase();
    if (text.includes("qwiic") || text.includes("jst_sh_1.0mm_4p")) return "jst_sh_1.0mm_4p_qwiic";
    if (text.includes("grove")) return "grove_2.0mm_4p";
    if (text.includes("ic_hook") || text.includes("hook_ring") || text.includes("plated_through_hole")) return "ic_hook_plated_contact";
    if (text.includes("2.54mm") && (
      text.includes("header")
      || text.includes("socket")
      || text.includes("individual")
      || text.includes("breakout")
      || text.includes("pin")
    )) {
      return "2.54mm_individual_contact";
    }
    return text;
  };
  const left = normalize(leftValue);
  const right = normalize(rightValue);
  return Boolean(left && right && left === right);
}

function endpoint(part, contact) {
  return {
    partId: part.id,
    assetId: part.assetId,
    nodeName: contact.nodeName,
    signal: contact.signal,
    position: contact.position,
    normal: contact.normal,
    matingSide: contact.matingSide,
    connectorId: contact.connectorId,
    connectorFamily: contact.connectorFamily,
    gender: contact.gender,
    maxExternalTerminations: Number.isInteger(contact.maxExternalTerminations)
      && contact.maxExternalTerminations > 0 ? contact.maxExternalTerminations : 1,
    ...(contact.breakoutBank ? { breakoutBank: contact.breakoutBank } : {}),
    ...(contact.breakoutRowSignal ? { breakoutRowSignal: contact.breakoutRowSignal } : {}),
    ...(contact.breakoutLaneRole ? { breakoutLaneRole: contact.breakoutLaneRole } : {}),
    ...(contact.physicalColor ? { physicalColor: contact.physicalColor } : {}),
    ...(contact.physicalLabel ? { physicalLabel: contact.physicalLabel } : {}),
    ...(contact.voltageDomain ? { voltageDomain: contact.voltageDomain } : {}),
    ...(contact.electricalUsageRole ? { electricalUsageRole: contact.electricalUsageRole } : {}),
    ...(contact.powerSourceClass ? { powerSourceClass: contact.powerSourceClass } : {}),
    ...(contact.mirroredControllerPowerPin === true ? { mirroredControllerPowerPin: true } : {}),
    ...(contact.mirroredPowerAuthorizationScope
      ? { mirroredPowerAuthorizationScope: structuredClone(contact.mirroredPowerAuthorizationScope) }
      : {}),
    ...(contact.wireColorRole ? { wireColorRole: contact.wireColorRole } : {}),
    ...(contact.controllerPin ? { controllerPin: contact.controllerPin } : {}),
    ...(contact.subcomponentId ? { subcomponentId: contact.subcomponentId } : {}),
    ...(contact.terminalId ? { terminalId: contact.terminalId } : {})
  };
}

function selectSingleton(parts, explicitId, category, label) {
  const matches = explicitId ? parts.filter((part) => part.id === explicitId) : parts.filter((part) => part.category === category);
  if (matches.length !== 1) fail(`${label}_count_invalid`, { count: matches.length });
  return matches[0];
}

function selectOptionalSingleton(parts, explicitId, category, label) {
  const matches = explicitId ? parts.filter((part) => part.id === explicitId) : parts.filter((part) => part.category === category);
  if (matches.length > 1) fail(`${label}_count_invalid`, { count: matches.length });
  return matches[0] || null;
}

function normalizeSignal(value) {
  const text = String(value || "").toUpperCase();
  if (/^GND(?:-[ABC])?$/.test(text)) return "GND";
  if (/^3V3[AB]?$/.test(text)) return "3V3";
  const gpio = text.match(/^(?:GP|IO|GPIO)(\d+)$/);
  if (gpio) return `GPIO${gpio[1]}`;
  return text;
}

function colorForSignal(signal) {
  const normalized = normalizeSignal(signal);
  if (normalized === "GND") return "black";
  if (["3V3", "5V", "VCC", "VCC_5V", "VBUS", "VSYS", "VIN", "POWER", "PLUS"].includes(normalized)) return "red";
  if (["SDA", "MOSI", "DIN"].includes(normalized)) return "#35c77a";
  if (["SCL", "SCK", "CLK", "ECHO"].includes(normalized)) return "#3f8cff";
  if (["RX", "UART_RX", "MISO"].includes(normalized)) return "#a66cff";
  if (["TX", "UART_TX", "PWM"].includes(normalized)) return "#ff9f43";
  if (["AOUT", "ADC", "SIG", "SIGNAL", "TRIG"].includes(normalized)) return "#f2cc3d";
  const palette = ["#f2cc3d", "#3f8cff", "#35c77a", "#a66cff", "#ff9f43", "#25c4c9"];
  let hash = 0;
  for (const char of normalized) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function fail(code, details = {}) {
  throw new Prompt2CircuitCompileError(code, details);
}
