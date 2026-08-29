import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const assembly = await readFile(new URL("../assembly.md", import.meta.url), "utf8");
const wiring = await readFile(new URL("../wiring.md", import.meta.url), "utf8");

test("wiring.md preserves the finalized assembly prompt", () => {
  assert.equal(wiring, assembly);
});

test("assembly routing prompt forbids guessed and USB-C endpoints", () => {
  assert.match(assembly, /named GLB pin node/i);
  assert.match(assembly, /USB-C.*forbidden wire endpoint/i);
  assert.match(assembly, /never.*guessed world coordinate/i);
  assert.match(assembly, /descendant of the declared source part/i);
});

test("assembly routing prompt requires visible pin-to-sleeve continuity", () => {
  assert.match(assembly, /individual female Dupont sleeve/i);
  assert.match(assembly, /overlap the physical male-pin shank/i);
  assert.match(assembly, /wire must emerge from the rear center of that sleeve/i);
  assert.match(assembly, /first and last route segments/i);
});

test("assembly prompt distinguishes a carrier from a solderless breadboard", () => {
  assert.match(assembly, /Do not use “breadboard” as a generic name for an expansion carrier/i);
  assert.match(assembly, /connectionSurfaceKind/i);
  assert.match(assembly, /all sensor leads originate on the carrier's named breakout pins/i);
  assert.match(assembly, /no wire may target a breadboard row or rail/i);
});

test("assembly prompt deterministically classifies top versus underside sensor pins", () => {
  assert.match(assembly, /physical male-pin mesh and the physical PCB\/core mesh/i);
  assert.match(assembly, /topExposure = max\(0, pinMax - pcbTop\)/i);
  assert.match(assembly, /undersideExposure = max\(0, pcbBottom - pinMin\)/i);
  assert.match(assembly, /winning exposure is below 1\.5 mm/i);
  assert.match(assembly, /Sol never selects, overrides, or visually guesses the mating side/i);
  assert.match(assembly, /microphone-style upward headers must resolve top/i);
});

test("assembly prompt keeps sensor text top-facing without moving physical geometry", () => {
  assert.match(assembly, /Treat readable silkscreen as an annotation layer/i);
  assert.match(assembly, /text normal `\+boardNormal`/i);
  assert.match(assembly, /Never flip, mirror, rotate, or relocate the PCB/i);
  assert.match(assembly, /affectsPhysicalGeometry: false/i);
  assert.match(assembly, /locked title and pinout strings on the PCB top face/i);
});
