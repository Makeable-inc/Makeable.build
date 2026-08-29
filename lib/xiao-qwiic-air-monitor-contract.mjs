import { readFileSync } from "node:fs";

export const XIAO_QWIIC_BUILD_ID = "xiao-qwiic-co2-beacon-api-v3-2026-08-28";
export const XIAO_QWIIC_PRODUCT_DESIGN = Object.freeze(JSON.parse(
  readFileSync(new URL("../config/xiao-qwiic-product-design.json", import.meta.url), "utf8"),
));

export const XIAO_QWIIC_PARTS = Object.freeze([
  Object.freeze({
    id: "controller",
    catalogId: "b0drnsv5cs-12",
    asin: "B0DRNSV5CS",
    assetId: "seeed-xiao-esp32c3",
    label: "Seeed Studio XIAO ESP32C3 (Pre-Soldered)",
    sha256: "e056047db5252c27fdfdc4ad29cf1b296d1fa652c7007d34bc64989f025937a7",
    assetUrl: "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/objects/sha256/e056047db5252c27fdfdc4ad29cf1b296d1fa652c7007d34bc64989f025937a7.glb",
    revision: "seeed-xiao-esp32c3-presoldered-exact-candidate-v1",
    connectionType: "factory_male_header",
    selectionStatus: "ready",
    assembledPosition: metres(XIAO_QWIIC_PRODUCT_DESIGN.placements.controller),
  }),
  Object.freeze({
    id: "sensor",
    catalogId: "b0dyvcttcd-83",
    asin: "B0DYVCTTCD",
    assetId: "adafruit-scd41-co2-breakout-5190",
    label: "Adafruit SCD-41 CO2 / temperature / humidity breakout #5190",
    sha256: "88879d11bbda0246a1ebd5e0975bd05905a74228b5191dd1931c557607b10821",
    assetUrl: "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/objects/sha256/88879d11bbda0246a1ebd5e0975bd05905a74228b5191dd1931c557607b10821.glb",
    revision: "adafruit-missing-batch-02-eagle-photo-v1.1.0",
    connectionType: "factory_qwiic",
    selectionStatus: "ready",
    assembledPosition: metres(XIAO_QWIIC_PRODUCT_DESIGN.placements.sensor),
  }),
]);

export const XIAO_QWIIC_CABLE = Object.freeze({
  id: "cable",
  catalogId: "b09wlrbkwt-96",
  asin: "B09WLRBKWT",
  assetId: "adafruit-4397-qwiic-to-female-sockets",
  assetUrl: "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/objects/sha256/6428dfc118538bb9d634889a7754668f421f6f4389fe681c88fc8a0b6cfbcf99.glb",
  sha256: "6428dfc118538bb9d634889a7754668f421f6f4389fe681c88fc8a0b6cfbcf99",
  revision: "adafruit-4397-interface-v1.1.0",
  manufacturerSku: "4397",
  label: "Adafruit STEMMA QT / Qwiic cable to premium female sockets #4397",
  connectorFamily: "jst_sh_1.0mm_4p_qwiic",
  controllerTermination: "four_individual_factory_housed_female_sockets",
  sensorTermination: "factory_keyed_jst_sh_1.0mm_4p_plug",
  nominalLengthMm: 150,
  requiresSoldering: false,
  renderedAs: "aws_rigid_terminations_plus_deterministic_flexible_harness",
  selectionStatus: "ready",
  requiredNodes: Object.freeze([
    "connector:qwiic-jst-sh-1.0mm-4p:plug-body",
    "connector:qwiic-jst-sh-1.0mm-4p:rear-boot",
    "anchor:cable:split",
    "anchor:socket:gnd:pin-entry",
    "anchor:socket:3v3:pin-entry",
    "anchor:socket:sda:pin-entry",
    "anchor:socket:scl:pin-entry",
  ]),
});

export const XIAO_QWIIC_ASSETS = Object.freeze([...XIAO_QWIIC_PARTS, XIAO_QWIIC_CABLE]);

const controllerPart = XIAO_QWIIC_PARTS[0];
const sensorPart = XIAO_QWIIC_PARTS[1];

const nets = Object.freeze([
  Object.freeze({
    id: "qwiic-gnd", signal: "GND", color: "#15191d", stepIndex: 2,
    controllerNode: "interface:seeed-xiao-esp32c3:right:02:gnd",
    controllerPin: "GND", controllerLocal: [0.00762, 0.0050165, -0.010125],
    sensorNode: "component:CONN4:contact-tip:0", sensorContact: 1,
    sensorLocal: [-0.00802, 0.0015, 0.00185],
  }),
  Object.freeze({
    id: "qwiic-3v3", signal: "3V3", color: "#ef5b58", stepIndex: 3,
    controllerNode: "interface:seeed-xiao-esp32c3:right:03:3v3",
    controllerPin: "3V3", controllerLocal: [0.00762, 0.0024765, -0.010125],
    sensorNode: "component:CONN4:contact-tip:1", sensorContact: 2,
    sensorLocal: [-0.00802, 0.0005, 0.00185],
  }),
  Object.freeze({
    id: "qwiic-sda", signal: "SDA", color: "#45a9ff", stepIndex: 4,
    controllerNode: "interface:seeed-xiao-esp32c3:left:05:d4",
    controllerPin: "D4 / SDA", controllerLocal: [-0.00762, -0.0026035, -0.010125],
    sensorNode: "component:CONN4:contact-tip:2", sensorContact: 3,
    sensorLocal: [-0.00802, -0.0005, 0.00185],
  }),
  Object.freeze({
    id: "qwiic-scl", signal: "SCL", color: "#f2c84b", stepIndex: 5,
    controllerNode: "interface:seeed-xiao-esp32c3:left:06:d5",
    controllerPin: "D5 / SCL", controllerLocal: [-0.00762, -0.0051435, -0.010125],
    sensorNode: "component:CONN4:contact-tip:3", sensorContact: 4,
    sensorLocal: [-0.00802, -0.0015, 0.00185],
  }),
]);

export const XIAO_QWIIC_CONNECTIONS = Object.freeze(nets.map((net) => Object.freeze({
  id: net.id,
  label: `${net.signal} · XIAO to SCD-41`,
  signal: net.signal,
  color: net.color,
  stepIndex: net.stepIndex,
  connectorFamily: XIAO_QWIIC_CABLE.connectorFamily,
  from: Object.freeze({
    partId: controllerPart.id,
    assetId: controllerPart.assetId,
    nodeName: net.controllerNode,
    physicalPinLabel: net.controllerPin,
    connectorFamily: "2.54mm_male_header",
    connectorGender: "male",
    mate: "factory_housed_female_socket",
    position: world(controllerPart.assembledPosition, net.controllerLocal),
    localPosition: net.controllerLocal,
    normal: [0, 0, -1],
    matingSide: "underside",
  }),
  to: Object.freeze({
    partId: sensorPart.id,
    assetId: sensorPart.assetId,
    nodeName: net.sensorNode,
    connectorNodeName: "anchor:CONN4_STEMMA_QT",
    physicalPinLabel: `CONN4 contact ${net.sensorContact} / ${net.signal}`,
    connectorFamily: XIAO_QWIIC_CABLE.connectorFamily,
    connectorGender: "female_receptacle",
    mate: "factory_keyed_male_plug",
    position: world(sensorPart.assembledPosition, net.sensorLocal),
    localPosition: net.sensorLocal,
    normal: [-1, 0, 0],
    matingSide: "side_entry_keyed",
  }),
})));

export const XIAO_QWIIC_STEPS = Object.freeze([
  Object.freeze({ id: "place", title: "Place the exact parts", description: "Place the pre-soldered XIAO ESP32C3 and the SCD-41 on the enclosure tray with USB-C and the SCD-41 airflow path unobstructed.", visibleParts: ["controller", "sensor"], activeWires: [] }),
  Object.freeze({ id: "sensor-end", title: "Seat the keyed Qwiic plug", description: "With USB disconnected, insert the JST-SH 1.0 mm four-pin plug into SCD-41 CONN4 in the keyed direction. Do not force or reverse it.", visibleParts: ["controller", "sensor"], activeWires: [] }),
  Object.freeze({ id: "controller-gnd", title: "Connect black to GND", description: "Push the black individual female socket onto the XIAO underside GND male-pin shank until the housing covers the exposed pin.", visibleParts: ["controller", "sensor"], activeWires: ["qwiic-gnd"] }),
  Object.freeze({ id: "controller-3v3", title: "Connect red to 3V3", description: "Push the red individual female socket onto the XIAO underside 3V3 male-pin shank. Do not use 5V.", visibleParts: ["controller", "sensor"], activeWires: ["qwiic-3v3"] }),
  Object.freeze({ id: "controller-sda", title: "Connect blue to D4 / SDA", description: "Push the blue individual female socket onto the XIAO underside D4 / SDA male-pin shank.", visibleParts: ["controller", "sensor"], activeWires: ["qwiic-sda"] }),
  Object.freeze({ id: "controller-scl", title: "Connect yellow to D5 / SCL", description: "Push the yellow individual female socket onto the XIAO underside D5 / SCL male-pin shank.", visibleParts: ["controller", "sensor"], activeWires: ["qwiic-scl"] }),
  Object.freeze({ id: "route-cable", title: "Lay a natural open bend", description: "Guide the four conductors together in one shallow open bend. Never coil, circle, overlap, knot, or cross the cable; keep it clear of USB-C and the SCD-41 airflow region.", visibleParts: ["controller", "sensor"], activeWires: XIAO_QWIIC_CONNECTIONS.map((wire) => wire.id) }),
  Object.freeze({ id: "check", title: "Check before power", description: "Confirm all four controller sockets cover real pin shanks, the Qwiic plug is fully seated, USB-C has no sensor lead, and the airflow grille is clear before reconnecting USB.", visibleParts: ["controller", "sensor"], activeWires: XIAO_QWIIC_CONNECTIONS.map((wire) => wire.id) }),
]);

export const XIAO_QWIIC_POLICY = Object.freeze({
  state: "ready",
  breadboardAllowed: false,
  breakoutBoardRequired: false,
  breakoutReason: "One sensor connects directly through one exact factory cable; no distribution carrier is needed.",
  qwiicConnectorFamily: "jst_sh_1.0mm_4p_qwiic",
  groveAllowedAsQwiic: false,
  usbCAllowedAsSensorEndpoint: false,
  cableLoopsAllowed: false,
  visualPasses: 0,
  heroAttempts: 1,
  awsPublication: "not_requested",
});

export function assertXiaoQwiicContract() {
  if (XIAO_QWIIC_PARTS.length !== 2) throw new Error("Expected two immutable AWS electronics parts.");
  if (XIAO_QWIIC_CONNECTIONS.length !== 4) throw new Error("Expected four Qwiic conductors.");
  if (XIAO_QWIIC_CONNECTIONS.some((wire) => wire.connectorFamily !== "jst_sh_1.0mm_4p_qwiic")) throw new Error("Non-Qwiic connector family found.");
  if (XIAO_QWIIC_CONNECTIONS.some((wire) => /usb/i.test(`${wire.from.nodeName} ${wire.to.nodeName}`))) throw new Error("USB endpoint found.");
  if (XIAO_QWIIC_POLICY.breadboardAllowed || XIAO_QWIIC_POLICY.groveAllowedAsQwiic) throw new Error("Connector policy violated.");
  if (XIAO_QWIIC_CABLE.nominalLengthMm !== 150 || XIAO_QWIIC_CABLE.selectionStatus !== "ready") throw new Error("Exact cable asset is not ready.");
  if (!XIAO_QWIIC_CABLE.assetUrl.startsWith("https://dvy6bet209exg.cloudfront.net/") || !/^[a-f0-9]{64}$/.test(XIAO_QWIIC_CABLE.sha256)) throw new Error("Exact cable AWS binding is invalid.");
  if (XIAO_QWIIC_PRODUCT_DESIGN.runtimeVisualPasses !== 0) throw new Error("Production design enables visual passes.");
  const nodes = XIAO_QWIIC_CONNECTIONS.flatMap((wire) => [wire.from.nodeName, wire.to.nodeName]);
  if (new Set(nodes).size !== nodes.length) throw new Error("A physical contact was reused.");
  return { partCount: 2, wireCount: 4, stepCount: XIAO_QWIIC_STEPS.length };
}

function world(offset, local) {
  return local.map((value, index) => Number((value + offset[index]).toFixed(7)));
}

function metres(mm) {
  return mm.map((value) => Number((value / 1000).toFixed(7)));
}
