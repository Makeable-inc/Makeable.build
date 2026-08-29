import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const viewer = await readFile(
  new URL("../artifacts/environment-monitor-c3/2026-08-28-direct-wire-v2/viewer/index.html", import.meta.url),
  "utf8",
);

test("viewer resolves immutable named GLB pin nodes", () => {
  assert.match(viewer, /C3_DIRECT_WIRE_PIN_ROUTES/);
  assert.match(viewer, /PropertyBinding\.sanitizeNodeName/);
  assert.match(viewer, /endpointMode:"named-glb-male-pin-meshes"/);
  assert.doesNotMatch(viewer, /new THREE\.Vector3\(lane,-\.011,\.017\)/);
});

test("viewer renders pin-normal terminations and a pin-detail camera", () => {
  assert.match(viewer, /routeMode:"pin-normal-comb-arch"/);
  assert.match(viewer, /data-view="pins">CARRIER PINS/);
  assert.match(viewer, /data-view="sensorpins">SENSOR PINS/);
  assert.match(viewer, /data-view="mictop">MIC TOP/);
  assert.match(viewer, /if\(view==="pins"\)/);
  assert.match(viewer, /view==="sensorpins"/);
  assert.match(viewer, /overlapMm/);
});

test("viewer automatically classifies sensor pin mating side from GLB geometry", () => {
  assert.match(viewer, /classifyPinMatingSide/);
  assert.match(viewer, /pinBounds:boxRecord\(pinBox\),boardBounds:boxRecord\(boardBox\)/);
  assert.match(viewer, /classification\.pinTipCoordinate/);
  assert.match(viewer, /classification\.connectorNormal/);
  assert.match(viewer, /pinSurface:"male-pin"/);
  assert.match(viewer, /classificationMethod:classification\.method/);
  assert.doesNotMatch(viewer, /route\.targetMountSide|route\.targetNormal/);
});

test("viewer propagates final part placement before resolving pin world transforms", () => {
  assert.match(
    viewer,
    /root\.position\.add\([\s\S]*?root\.updateMatrixWorld\(true\);root\.traverse/,
  );
});

test("viewer renders only title and pinout text on sensor top faces", () => {
  assert.match(viewer, /data-view="silkscreen">TOP TEXT/);
  assert.match(viewer, /function addTopFacingSensorText\(\)/);
  assert.match(viewer, /nativeTitle:"GY-BME280"/);
  assert.match(viewer, /nativeTitle:"GY-302 \/ BH1750"/);
  assert.match(viewer, /pinout:"VCC  GND  SCL  SDA  CSB  SDO"/);
  assert.match(viewer, /pinout:"VCC  GND  SCL  SDA  ADDR"/);
  assert.match(viewer, /textNormal:\[0,0,1\]/);
  assert.match(viewer, /textUp:\[0,1,0\]/);
  assert.match(viewer, /surface:"pcb-top"/);
  assert.match(viewer, /affectsPhysicalGeometry:false/);
  assert.match(viewer, /layer:"native-title"/);
  assert.match(viewer, /partId:"microphone",layer:"native-title-and-pinout"/);
});
