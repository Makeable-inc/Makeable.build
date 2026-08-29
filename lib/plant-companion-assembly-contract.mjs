import { assertDirectWiring, BREADBOARD_POLICY } from "./assembly-policy.mjs";

const ASSET_ORIGIN = "https://dvy6bet209exg.cloudfront.net";
const PLANT_PREFIX = `${ASSET_ORIGIN}/v1/assembly-assets-v1.1.0/plant-companion-v1`;
const CATALOG_PREFIX = `${ASSET_ORIGIN}/v1/approved-visual-catalog-v1/objects/sha256`;

const placements = Object.freeze({
  base: [0, 0, 0],
  controller: [-0.025, 0.018, 0.018],
  scd41: [0.013, 0.016, 0.019],
  tsl2591: [0.013, -0.01, 0.019],
  soil: [0.052, -0.005, 0.018],
  lid: [0, -0.075, 0.006],
});

const requiredAssets = Object.freeze([
  catalogAsset("thing-plus-esp32", "2f9b9c61add8c775687259a17d97425a5cd56122004dc51023ebf7acfc3f11f1", "thing-plus-esp32-wrl-20168-presoldered-visual-v1.0.0"),
  catalogAsset("adafruit-scd41-co2-breakout-5190", "88879d11bbda0246a1ebd5e0975bd05905a74228b5191dd1931c557607b10821", "adafruit-missing-batch-02-eagle-photo-v1.1.0"),
  catalogAsset("adafruit-tsl2591-hdr-light-breakout-1980", "385794ce8ce0889c07df1cd0abb6c1752d22afcf80c7f2742fec134afefb8450", "adafruit-missing-batch-02-eagle-photo-v1.1.0"),
  catalogAsset("diyables-capacitive-soil-moisture-tlc555i", "08cd3eca63228c25600bd50d435d07cfd6a5d2b8acd632b9f7bda541651cb893", "diyables-b0dydn9rg4-exact-visual-v1.0.0"),
  plantAsset("makeable-assembly-enclosure-base", "makeable-assembly-enclosure-base.glb", "050a599cca07cca29d8136bd223ec3cb02939f3e311af9d4357ccb780daa5e73"),
  plantAsset("makeable-assembly-enclosure-lid", "makeable-assembly-enclosure-lid.glb", "2583589d87af579a3a5a515e253905d19504332af25e99c376995676011d2831"),
]);

const assetsById = new Map(requiredAssets.map((entry) => [entry.id, entry]));
const parts = Object.freeze([
  part("enclosure-base", "Enclosure base", "makeable-assembly-enclosure-base", placements.base),
  part("controller", "SparkFun Thing Plus ESP32 WROOM (WRL-20168)", "thing-plus-esp32", placements.controller),
  part("scd41", "Adafruit SCD-41 CO2 / temperature / humidity #5190", "adafruit-scd41-co2-breakout-5190", placements.scd41),
  part("tsl2591", "Adafruit TSL2591 light sensor #1980", "adafruit-tsl2591-hdr-light-breakout-1980", placements.tsl2591),
  part("soil", "DIYables TLC555I soil-moisture sensor", "diyables-capacitive-soil-moisture-tlc555i", placements.soil),
  part("enclosure-lid", "Enclosure lid", "makeable-assembly-enclosure-lid", placements.lid),
]);

const qwiicSignals = Object.freeze([
  { signal: "GND", color: "#171717", offset: -0.0015 },
  { signal: "3V3", color: "#dc3b35", offset: -0.0005 },
  { signal: "SDA", color: "#2673d9", offset: 0.0005 },
  { signal: "SCL", color: "#e0aa16", offset: 0.0015 },
]);

const controllerQwiic = [
  [-0.03405, -0.004455, 0.01955],
  [-0.03405, -0.003455, 0.01955],
  [-0.03405, -0.002455, 0.01955],
  [-0.03405, -0.001455, 0.01955],
];

const wires = Object.freeze([
  ...qwiicSignals.map((entry, index) => wire(
    `wire-qwiic-controller-tsl-${entry.signal.toLowerCase()}`,
    `${entry.signal} · controller to TSL2591`,
    entry.signal,
    entry.color,
    1,
    connector("controller", `Qwiic contact ${index + 1} / ${entry.signal}`, controllerQwiic[index]),
    connector("tsl2591", `CONN4 STEMMA QT / ${entry.signal}`, [0.005442, -0.01 + entry.offset, 0.0209]),
  )),
  ...qwiicSignals.map((entry) => wire(
    `wire-qwiic-tsl-scd-${entry.signal.toLowerCase()}`,
    `${entry.signal} · TSL2591 to SCD-41`,
    entry.signal,
    entry.color,
    1,
    connector("tsl2591", `CONN3 STEMMA QT / ${entry.signal}`, [0.020558, -0.01 + entry.offset, 0.0209]),
    connector("scd41", `CONN4 STEMMA QT / ${entry.signal}`, [0.005315, 0.016 + entry.offset, 0.0209]),
  )),
  wire("wire-soil-3v3", "3V3 · soil probe", "3V3", "#dc3b35", 2,
    pin("controller", "3V3", [-0.01484, 0.004665, 0.01305]), pin("soil", "VCC", [0.052, 0.0358, 0.0207])),
  wire("wire-soil-gnd", "GND · soil probe", "GND", "#171717", 2,
    pin("controller", "GND", [-0.01484, 0.009745, 0.01305]), pin("soil", "GND", [0.04946, 0.0358, 0.0207])),
  wire("wire-soil-aout", "AOUT · soil probe", "AOUT", "#2d9b55", 2,
    pin("controller", "A0 / GPIO26 / ADC", [-0.01484, 0.012285, 0.01305]), pin("soil", "AOUT", [0.05454, 0.0358, 0.0207])),
]);

const qwiicWires = wires.filter((entry) => entry.stepIndex === 1).map((entry) => entry.id);
const soilWires = wires.filter((entry) => entry.stepIndex === 2).map((entry) => entry.id);
const allWires = wires.map((entry) => entry.id);

const steps = Object.freeze([
  step("place-direct-connect-parts", "Place the direct-connect parts", "Place the Thing Plus, SCD-41, and TSL2591 on the enclosure supports. Keep USB-C, both sensor apertures, and the Qwiic sockets accessible.", "Leave USB and battery power disconnected.", ["enclosure-base", "controller", "scd41", "tsl2591"], [], [2.8, 2.2, 3.8], [0, 0, 0.12]),
  step("connect-keyed-i2c-chain", "Connect the keyed I2C chain", "Plug one four-conductor Qwiic cable from the Thing Plus directly into TSL2591 CONN4, then a second from TSL2591 CONN3 directly into SCD-41 CONN4.", "The keyed 3.3 V connectors carry GND, 3V3, SDA, and SCL; never force a reversed plug.", ["enclosure-base", "controller", "tsl2591", "scd41"], qwiicWires, [2.6, 2.0, 3.2], [0, 0, 0.18]),
  step("connect-soil-probe-directly", "Connect the soil probe directly", "Run the probe's factory-terminated VCC, GND, and AOUT leads directly to the Thing Plus 3V3, GND, and A0 pins. Keep the blade outside the dry electronics cavity.", "Only the sensing blade enters soil; verify polarity before power.", ["enclosure-base", "controller", "tsl2591", "scd41", "soil"], soilWires, [2.8, 1.8, 3.4], [0.2, 0, 0.12]),
  step("final-direct-wiring-check", "Final direct-wiring check", "Confirm both keyed Qwiic plugs are fully seated and all three soil leads terminate at the labeled physical pins. The assembly contains no breadboard or hidden rail.", "Reconnect USB only after continuity and polarity checks.", ["enclosure-base", "controller", "tsl2591", "scd41", "soil", "enclosure-lid"], allWires, [3.0, 2.2, 3.9], [0, 0, 0.1]),
]);

export function createPlantCompanionAssemblyContract() {
  return structuredClone(assertDirectWiring({
    schemaVersion: "MakeableAssemblyContractV1",
    buildId: "plant-companion-v1",
    contractRevision: "plant-companion-v1-direct-qwiic-no-breadboard-v2",
    state: "ready",
    coordinateSystem: "right-handed-z-up-metres",
    sceneScale: 14,
    requiredAssets,
    parts,
    wires,
    steps,
    policy: BREADBOARD_POLICY,
    evidence: {
      source: "Reviewed AWS GLBs plus exact manufacturer Qwiic/STEMMA and marketplace connector evidence",
      placementBasis: "locked GLB mesh-contact centers transformed into world-space part placements",
      electricalAuthority: "direct keyed 3.3 V I2C chain plus dedicated 3V3, GND, and A0 soil-probe pins",
    },
    missingEvidence: [],
    blockedReasons: [],
  }));
}

function catalogAsset(id, sha256, revision) {
  return { id, name: id, revision, url: `${CATALOG_PREFIX}/${sha256}.glb`, sha256, eligibility: "ready" };
}

function plantAsset(id, file, sha256) {
  return { id, name: id, revision: "assembly-assets-v1.1.0", url: `${PLANT_PREFIX}/${file}`, sha256, eligibility: "ready" };
}

function part(id, label, assetId, assembledPosition) {
  return {
    id,
    label,
    assetId,
    assetUrl: assetsById.get(assetId)?.url || "",
    assembledPosition,
    explodedPosition: [assembledPosition[0], assembledPosition[1], assembledPosition[2] + 0.035],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

function pin(partId, label, position) {
  return { partId, label, position, kind: "verified-part-pin" };
}

function connector(partId, label, position) {
  return { partId, label, position, kind: "verified-keyed-connector-contact" };
}

function wire(id, label, signal, color, stepIndex, from, to) {
  return { id, label, signal, color, gauge: "Qwiic 28 AWG or factory probe lead", stepIndex, from, to };
}

function step(id, title, beginnerInstruction, safetyNote, visibleParts, activeWires, position, target) {
  return { id, title, beginnerInstruction, safetyNote, visibleParts, activeWires, camera: { position, target, fov: 38 } };
}
