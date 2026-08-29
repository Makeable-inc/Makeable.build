const READY = "ready";

export const CONTROLLER_FAMILY_POLICIES = Object.freeze({
  xiao: Object.freeze({
    id: "xiao",
    controllerAsins: Object.freeze(["B0DRNSV5CS", "B0DRNVH8MQ", "B0DRNW9LJM", "B0GWPZR8C6"]),
    exactCarrierAssetId: "seeed-xiao-expansion-base-103030356",
    directSensorMaximum: 2,
    carrierSensorMinimum: 3,
    controllerDirectTerminations: Object.freeze(["individual_factory_housed_female_socket"]),
    carrierTerminations: Object.freeze(["grove_2.0mm_4p_i2c", "verified_male_breakout_pin"]),
    quickConnectorFamilies: Object.freeze(["grove_2.0mm_4p_i2c"]),
  }),
  c3SuperMini: Object.freeze({
    id: "c3SuperMini",
    controllerAsins: Object.freeze(["B0DD3ZB5XV", "B0GR8WYC8C"]),
    exactCarrierAssetId: "aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1",
    directSensorMaximum: 2,
    carrierSensorMinimum: 3,
    controllerDirectTerminations: Object.freeze(["individual_factory_housed_female_socket"]),
    carrierTerminations: Object.freeze(["individual_factory_housed_female_socket", "verified_screw_terminal", "verified_male_breakout_pin"]),
    quickConnectorFamilies: Object.freeze([]),
    carrierMountContract: Object.freeze({
      socketRows: 2,
      pinsPerRow: 8,
      orientation: "usb_c_toward_power_block",
    }),
    carrierPowerContract: Object.freeze({
      controllerPowerSource: "controller_usb_c",
      peripheralVoltage: "3.3V",
      externalCarrierPowerConnected: false,
      batteryConnected: false,
      railModified: false,
    }),
  }),
  esp32S3Devkit44: Object.freeze({
    id: "esp32S3Devkit44",
    controllerAsins: Object.freeze(["B0GVF97WTY", "B0BVVGNBB3"]),
    exactCarrierAssetId: "aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx",
    directSensorMaximum: 2,
    carrierSensorMinimum: 3,
    controllerDirectTerminations: Object.freeze(["individual_factory_housed_female_socket"]),
    carrierTerminations: Object.freeze(["individual_factory_housed_female_socket", "verified_screw_terminal", "verified_male_breakout_pin"]),
    quickConnectorFamilies: Object.freeze([]),
    carrierMountContract: Object.freeze({
      socketRows: 2,
      pinsPerRow: 22,
      orientation: "usb_c_aligned_with_carrier_arrow",
    }),
    carrierPowerContract: Object.freeze({
      controllerPowerSource: "controller_usb_c",
      peripheralVoltage: "3.3V",
      externalCarrierPowerConnected: false,
      dcBarrelConnected: false,
      fiveVoltPeripheralRailUsed: false,
    }),
  }),
});

const FAMILY_BY_ASIN = new Map(
  Object.values(CONTROLLER_FAMILY_POLICIES)
    .flatMap((policy) => policy.controllerAsins.map((asin) => [asin, policy.id])),
);

export function controllerFamilyFor(value = {}) {
  const explicit = String(value.family || value.footprintFamily || "");
  if (CONTROLLER_FAMILY_POLICIES[explicit]) return explicit;
  const asin = String(value.asin || value.catalogKey || "").toUpperCase();
  return FAMILY_BY_ASIN.get(asin) || null;
}

export function validateControllerFamilyAssembly({
  controller,
  sensorCount,
  carrier = null,
  connections = [],
  mountContract = null,
  powerContract = null,
  production = true,
} = {}) {
  const family = controllerFamilyFor(controller);
  if (!family) return blocked("controller_family_unrecognized");
  const policy = CONTROLLER_FAMILY_POLICIES[family];
  const count = Number(sensorCount);
  if (!Number.isInteger(count) || count < 1) return blocked("sensor_count_invalid", family);

  if (count >= policy.carrierSensorMinimum && !carrier) {
    return blocked(`exact_carrier_required:${policy.exactCarrierAssetId}`, family);
  }
  if (carrier && carrier.assetId !== policy.exactCarrierAssetId && carrier.id !== policy.exactCarrierAssetId) {
    return blocked(`carrier_family_mismatch:${policy.exactCarrierAssetId}`, family);
  }
  if (carrier && production) {
    const interfaceState = String(carrier.interfaceEligibility?.state || carrier.interfaceEligibility || "missing");
    const selectionState = String(carrier.selectionStatus || carrier.state || "missing");
    if (interfaceState !== READY || selectionState !== READY) {
      return blocked(`carrier_not_production_ready:${interfaceState}:${selectionState}`, family);
    }
    if (!carrier.awsGlb?.url || !/^[a-f0-9]{64}$/.test(carrier.awsGlb?.sha256 || "")) {
      return blocked("carrier_immutable_aws_glb_missing", family);
    }
    const mountMismatch = contractMismatch(policy.carrierMountContract, mountContract);
    if (mountMismatch) return blocked(`carrier_mount_contract_mismatch:${mountMismatch}`, family);
    const powerMismatch = contractMismatch(policy.carrierPowerContract, powerContract);
    if (powerMismatch) return blocked(`carrier_power_contract_mismatch:${powerMismatch}`, family);
  }

  const allowedTerminations = new Set(carrier ? policy.carrierTerminations : policy.controllerDirectTerminations);
  const quickFamilies = new Set(policy.quickConnectorFamilies);
  for (const connection of connections) {
    const termination = String(connection.controllerTermination || connection.sourceTermination || "");
    if (!allowedTerminations.has(termination)) {
      return blocked(`termination_not_allowed_for_${family}:${termination || "missing"}`, family);
    }
    const connectorFamily = String(connection.controllerConnectorFamily || connection.sourceConnectorFamily || "");
    const quick = Boolean(connection.quickConnector || /qwiic|stemma|grove/i.test(connectorFamily));
    if (quick && !quickFamilies.has(connectorFamily)) {
      return blocked(`quick_connector_not_available_for_${family}:${connectorFamily || "missing"}`, family);
    }
  }

  return {
    state: READY,
    family,
    policyId: `controller-family-${family}-v1`,
    exactCarrierAssetId: carrier ? policy.exactCarrierAssetId : null,
    quickConnectorFamilies: [...policy.quickConnectorFamilies],
    mountContractId: policy.carrierMountContract ? `controller-family-${family}-mount-v1` : null,
    powerContractId: policy.carrierPowerContract ? `controller-family-${family}-restricted-power-v1` : null,
    production,
  };
}

function contractMismatch(expected, actual) {
  if (!expected) return null;
  if (!actual || typeof actual !== "object") return "missing";
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) return `${key}:${String(actual[key])}`;
  }
  return null;
}

function blocked(reason, family = null) {
  return { state: "blocked", family, reason };
}
