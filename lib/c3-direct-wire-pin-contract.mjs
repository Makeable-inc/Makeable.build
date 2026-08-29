const CARRIER_UPWARD_MALE = Object.freeze({ sourceConnectorGender: "male", sourceNormal: Object.freeze([0, 0, 1]) });
const SENSOR_PHYSICAL_MALE = Object.freeze({ targetConnectorGender: "male", targetMatingSidePolicy: "auto-from-exposed-shank" });

export const C3_DIRECT_WIRE_PIN_ROUTES = Object.freeze([
  {
    ...CARRIER_UPWARD_MALE, ...SENSOR_PHYSICAL_MALE,
    id: "bme-3v3", signal: "3V3", color: "#ef5b58", step: 3,
    sourcePartId: "carrier", sourceConnectorId: "gpio-breakout", sourceNodeName: "connector:right-breakout:3V3:pin:1", sourcePinLabel: "3V3 lane 1",
    targetPartId: "bme280", targetBoardNodeName: "mesh:gy-bme280:fiberglass-core-with-real-holes", targetNodeName: "mesh:gy-bme280:male-pin:J1:01:VCC", targetPinLabel: "VCC",
  },
  {
    ...CARRIER_UPWARD_MALE, ...SENSOR_PHYSICAL_MALE,
    id: "bme-gnd", signal: "GND", color: "#15191d", step: 3,
    sourcePartId: "carrier", sourceConnectorId: "gpio-breakout", sourceNodeName: "connector:right-breakout:GND:pin:1", sourcePinLabel: "GND lane 1",
    targetPartId: "bme280", targetBoardNodeName: "mesh:gy-bme280:fiberglass-core-with-real-holes", targetNodeName: "mesh:gy-bme280:male-pin:J1:02:GND", targetPinLabel: "GND",
  },
  {
    ...CARRIER_UPWARD_MALE, ...SENSOR_PHYSICAL_MALE,
    id: "bh-3v3", signal: "3V3", color: "#ef5b58", step: 3,
    sourcePartId: "carrier", sourceConnectorId: "gpio-breakout", sourceNodeName: "connector:right-breakout:3V3:pin:2", sourcePinLabel: "3V3 lane 2",
    targetPartId: "bh1750", targetBoardNodeName: "mesh:gy-302-bh1750:fiberglass-core-with-real-holes", targetNodeName: "mesh:gy-302-bh1750:male-pin:J1:01:VCC", targetPinLabel: "VCC",
  },
  {
    ...CARRIER_UPWARD_MALE, ...SENSOR_PHYSICAL_MALE,
    id: "bh-gnd", signal: "GND", color: "#15191d", step: 3,
    sourcePartId: "carrier", sourceConnectorId: "gpio-breakout", sourceNodeName: "connector:right-breakout:GND:pin:2", sourcePinLabel: "GND lane 2",
    targetPartId: "bh1750", targetBoardNodeName: "mesh:gy-302-bh1750:fiberglass-core-with-real-holes", targetNodeName: "mesh:gy-302-bh1750:male-pin:J1:02:GND", targetPinLabel: "GND",
  },
  {
    ...CARRIER_UPWARD_MALE, ...SENSOR_PHYSICAL_MALE,
    id: "mic-3v3", signal: "3V3", color: "#ef5b58", step: 3,
    sourcePartId: "carrier", sourceConnectorId: "gpio-breakout", sourceNodeName: "connector:right-breakout:3V3:pin:3", sourcePinLabel: "3V3 lane 3",
    targetPartId: "microphone", targetBoardNodeName: "pcb:shillehtek-b0cn583k69-ky037", targetNodeName: "sound-j1:pin:02:VCC:metal", targetPinLabel: "VCC",
  },
  {
    ...CARRIER_UPWARD_MALE, ...SENSOR_PHYSICAL_MALE,
    id: "mic-gnd", signal: "GND", color: "#15191d", step: 3,
    sourcePartId: "carrier", sourceConnectorId: "gpio-breakout", sourceNodeName: "connector:right-breakout:GND:pin:3", sourcePinLabel: "GND lane 3",
    targetPartId: "microphone", targetBoardNodeName: "pcb:shillehtek-b0cn583k69-ky037", targetNodeName: "sound-j1:pin:03:GND:metal", targetPinLabel: "GND",
  },
  {
    ...CARRIER_UPWARD_MALE, ...SENSOR_PHYSICAL_MALE,
    id: "bme-sda", signal: "SDA", color: "#45a9ff", step: 4,
    sourcePartId: "carrier", sourceConnectorId: "gpio-breakout", sourceNodeName: "connector:left-breakout:GPIO8:pin:1", sourcePinLabel: "GPIO8 lane 1",
    targetPartId: "bme280", targetBoardNodeName: "mesh:gy-bme280:fiberglass-core-with-real-holes", targetNodeName: "mesh:gy-bme280:male-pin:J1:04:SDA", targetPinLabel: "SDA",
  },
  {
    ...CARRIER_UPWARD_MALE, ...SENSOR_PHYSICAL_MALE,
    id: "bme-scl", signal: "SCL", color: "#f2c84b", step: 4,
    sourcePartId: "carrier", sourceConnectorId: "gpio-breakout", sourceNodeName: "connector:left-breakout:GPIO9:pin:1", sourcePinLabel: "GPIO9 lane 1",
    targetPartId: "bme280", targetBoardNodeName: "mesh:gy-bme280:fiberglass-core-with-real-holes", targetNodeName: "mesh:gy-bme280:male-pin:J1:03:SCL", targetPinLabel: "SCL",
  },
  {
    ...CARRIER_UPWARD_MALE, ...SENSOR_PHYSICAL_MALE,
    id: "bh-sda", signal: "SDA", color: "#45a9ff", step: 4,
    sourcePartId: "carrier", sourceConnectorId: "gpio-breakout", sourceNodeName: "connector:left-breakout:GPIO8:pin:2", sourcePinLabel: "GPIO8 lane 2",
    targetPartId: "bh1750", targetBoardNodeName: "mesh:gy-302-bh1750:fiberglass-core-with-real-holes", targetNodeName: "mesh:gy-302-bh1750:male-pin:J1:04:SDA", targetPinLabel: "SDA",
  },
  {
    ...CARRIER_UPWARD_MALE, ...SENSOR_PHYSICAL_MALE,
    id: "bh-scl", signal: "SCL", color: "#f2c84b", step: 4,
    sourcePartId: "carrier", sourceConnectorId: "gpio-breakout", sourceNodeName: "connector:left-breakout:GPIO9:pin:2", sourcePinLabel: "GPIO9 lane 2",
    targetPartId: "bh1750", targetBoardNodeName: "mesh:gy-302-bh1750:fiberglass-core-with-real-holes", targetNodeName: "mesh:gy-302-bh1750:male-pin:J1:03:SCL", targetPinLabel: "SCL",
  },
  {
    ...CARRIER_UPWARD_MALE, ...SENSOR_PHYSICAL_MALE,
    id: "mic-ao", signal: "AO", color: "#45c883", step: 5,
    sourcePartId: "carrier", sourceConnectorId: "gpio-breakout", sourceNodeName: "connector:right-breakout:GPIO4:pin:3", sourcePinLabel: "GPIO4 lane 3",
    targetPartId: "microphone", targetBoardNodeName: "pcb:shillehtek-b0cn583k69-ky037", targetNodeName: "sound-j1:pin:04:AOUT:metal", targetPinLabel: "AO",
  },
]);

export function assertC3DirectWirePinContract() {
  if (C3_DIRECT_WIRE_PIN_ROUTES.length !== 11) throw new Error("Expected eleven physical pin routes.");
  const ids = new Set();
  const sources = new Set();
  for (const route of C3_DIRECT_WIRE_PIN_ROUTES) {
    if (!route.id || ids.has(route.id)) throw new Error(`Duplicate or missing wire id ${route.id || "unknown"}.`);
    ids.add(route.id);
    if (route.sourcePartId !== "carrier" || route.sourceConnectorId !== "gpio-breakout") throw new Error(`${route.id} does not originate on the carrier GPIO breakout.`);
    if (!/^connector:(left|right)-breakout:(3V3|GND|GPIO4|GPIO8|GPIO9):pin:[123]$/.test(route.sourceNodeName)) throw new Error(`${route.id} has a non-pin source node.`);
    if (/usb|type.?c|controller/i.test(route.sourceNodeName)) throw new Error(`${route.id} illegally targets the controller/USB-C area.`);
    if (sources.has(route.sourceNodeName)) throw new Error(`${route.id} reuses physical carrier pin ${route.sourceNodeName}.`);
    sources.add(route.sourceNodeName);
    if (!/^(mesh:(gy-bme280|gy-302-bh1750):male-pin:J1:\d{2}:|sound-j1:pin:\d{2}:(VCC|GND|AOUT):metal$)/.test(route.targetNodeName)) throw new Error(`${route.id} has a non-male-pin target node.`);
    if (route.targetConnectorGender !== "male" || route.targetMatingSidePolicy !== "auto-from-exposed-shank" || !route.targetBoardNodeName) throw new Error(`${route.id} cannot deterministically classify its sensor mating side.`);
    if ("targetMountSide" in route || "targetNormal" in route) throw new Error(`${route.id} hard-codes a sensor mating side instead of deriving it from geometry.`);
    if (route.sourceConnectorGender !== "male" || JSON.stringify(route.sourceNormal) !== "[0,0,1]") throw new Error(`${route.id} has an invalid carrier pin normal.`);
  }
  return { routeCount: C3_DIRECT_WIRE_PIN_ROUTES.length, uniqueCarrierPins: sources.size, usbEndpointCount: 0 };
}
