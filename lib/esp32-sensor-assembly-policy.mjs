import { BREADBOARD_POLICY, isBreadboardLike } from "./assembly-policy.mjs";
import { validateControllerFamilyAssembly } from "./controller-family-assembly-policy.mjs";

export const ESP32_SENSOR_CONNECTION_POLICY = Object.freeze({
  id: "esp32-sensor-count-v1",
  directSensorMaximum: 2,
  breakoutSensorMinimum: 3,
  breadboardPolicyId: BREADBOARD_POLICY.id,
  directRule: "One or two sensors may connect directly to verified controller pins or keyed contacts.",
  breakoutRule: "Three or more sensors require the exact controller-footprint expansion board.",
});

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function normalizedVoltage(sensor) {
  return Number(sensor.requiredVoltageV ?? sensor.voltageV);
}

function compatibleRail(controller, sensor) {
  const voltage = normalizedVoltage(sensor);
  return (controller?.powerRails || []).find((rail) => (
    finitePositive(voltage)
    && finitePositive(Number(rail.voltageV))
    && Math.abs(Number(rail.voltageV) - voltage) <= 0.05
  ));
}

function validateSignalClaims(sensors) {
  const exclusive = new Map();
  for (const sensor of sensors) {
    const bus = String(sensor.bus || "gpio").toLowerCase();
    for (const pin of sensor.signalPins || []) {
      if (bus === "i2c") continue;
      if (exclusive.has(pin)) return `signal_pin_conflict:${pin}`;
      exclusive.set(pin, sensor.id || sensor.name || "sensor");
    }
  }
  const i2cAddresses = new Map();
  for (const sensor of sensors.filter((item) => String(item.bus || "").toLowerCase() === "i2c")) {
    const address = String(sensor.i2cAddress || "").toLowerCase();
    if (!address) return `missing_i2c_address:${sensor.id || sensor.name || "sensor"}`;
    if (i2cAddresses.has(address)) return `i2c_address_conflict:${address}`;
    i2cAddresses.set(address, sensor.id || sensor.name || "sensor");
  }
  return null;
}

function blocked(reason, sensorCount) {
  return {
    policyId: ESP32_SENSOR_CONNECTION_POLICY.id,
    state: "blocked",
    strategy: "blocked",
    sensorCount,
    reason,
    breadboardsAllowed: false,
  };
}

export function planEsp32SensorConnections({ controller, sensors = [], breakout = null, production = true } = {}) {
  if (isBreadboardLike(controller) || isBreadboardLike(breakout) || sensors.some(isBreadboardLike)) {
    throw new Error(`Assembly violates ${BREADBOARD_POLICY.id}`);
  }
  if (!controller?.id && !controller?.asin) return blocked("controller_identity_missing", sensors.length);
  if (!Array.isArray(sensors) || sensors.length === 0) return blocked("at_least_one_sensor_required", 0);

  const sensorCount = sensors.length;
  if (sensorCount <= ESP32_SENSOR_CONNECTION_POLICY.directSensorMaximum) {
    const signalConflict = validateSignalClaims(sensors);
    if (signalConflict) return blocked(signalConflict, sensorCount);

    const railAssignments = [];
    for (const sensor of sensors) {
      const rail = compatibleRail(controller, sensor);
      if (!rail) return blocked(`compatible_power_rail_missing:${sensor.id || sensor.name || "sensor"}`, sensorCount);
      const currentMa = Number(sensor.currentMa || 0);
      if (!Number.isFinite(currentMa) || currentMa < 0) return blocked(`sensor_current_invalid:${sensor.id || sensor.name || "sensor"}`, sensorCount);
      railAssignments.push({ sensorId: sensor.id || sensor.name, railId: rail.id, voltageV: rail.voltageV, currentMa });
    }
    for (const rail of controller.powerRails || []) {
      const draw = railAssignments.filter((item) => item.railId === rail.id).reduce((sum, item) => sum + item.currentMa, 0);
      if (finitePositive(Number(rail.maxCurrentMa)) && draw > Number(rail.maxCurrentMa)) {
        return blocked(`power_budget_exceeded:${rail.id}`, sensorCount);
      }
    }
    const groundPins = [...(controller.groundPins || [])];
    if (!groundPins.length) return blocked("verified_ground_pin_missing", sensorCount);
    return {
      policyId: ESP32_SENSOR_CONNECTION_POLICY.id,
      state: "ready",
      strategy: "direct-pin-to-pin",
      sensorCount,
      breakoutRequired: false,
      breadboardsAllowed: false,
      railAssignments,
      groundPlan: groundPins.length >= sensorCount
        ? { strategy: "separate-controller-grounds", pins: groundPins.slice(0, sensorCount) }
        : { strategy: "shared-controller-ground", pins: [groundPins[0]], requiresVerifiedMultiWireTermination: true },
      powerSharing: sensorCount === 2 && new Set(railAssignments.map((item) => item.railId)).size === 1,
      requirements: [
        "Every signal endpoint must be a verified controller pin or keyed contact.",
        "Shared power or ground requires a physically modeled, verified multi-wire termination.",
      ],
    };
  }

  const expectedFamily = controller.breakoutResearch?.footprintFamily || controller.footprintFamily;
  if (!expectedFamily) return blocked("controller_footprint_family_missing", sensorCount);
  if (!breakout) return blocked(`exact_breakout_required:${expectedFamily}`, sensorCount);
  if (breakout.footprintFamily !== expectedFamily) return blocked(`breakout_footprint_mismatch:${expectedFamily}`, sensorCount);
  const interfaceState = String(breakout.interfaceEligibility?.state || breakout.interfaceEligibility || breakout.state || "missing");
  const selectionState = String(breakout.selectionStatus || breakout.state || "missing");
  if (production) {
    if (!breakout.awsGlb?.url || !/^[a-f0-9]{64}$/.test(breakout.awsGlb.sha256 || "")) {
      return blocked("breakout_immutable_aws_glb_missing", sensorCount);
    }
    if (interfaceState !== "ready" || selectionState !== "ready") {
      return blocked(`breakout_not_production_ready:${interfaceState}:${selectionState}`, sensorCount);
    }
    const familyGate = validateControllerFamilyAssembly({
      controller,
      sensorCount,
      carrier: breakout,
      mountContract: breakout.mountContract,
      powerContract: breakout.powerContract,
      production: true,
    });
    if (familyGate.state !== "ready") return blocked(`controller_family_gate:${familyGate.reason}`, sensorCount);
  } else if (!breakout.localGlb?.path || !/^[a-f0-9]{64}$/.test(breakout.localGlb.sha256 || "")) {
    return blocked("breakout_hash_bound_glb_missing", sensorCount);
  }

  return {
    policyId: ESP32_SENSOR_CONNECTION_POLICY.id,
    state: production ? "ready" : breakout.state,
    strategy: "exact-expansion-board",
    sensorCount,
    breakoutRequired: true,
    breadboardsAllowed: false,
    footprintFamily: expectedFamily,
    breakoutId: breakout.id,
    ...(production ? { awsGlb: structuredClone(breakout.awsGlb) } : { localGlb: structuredClone(breakout.localGlb) }),
    reason: production || breakout.state === "ready" ? null : "exact_local_candidate_requires_release_review_and_aws_publication",
  };
}
