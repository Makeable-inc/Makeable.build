#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const assemblyPath = path.join(root, "lib/assembly-asset-catalog.csv");
const verifiedPath = path.join(root, "lib/verified-parts-catalog.csv");

let assembly = await readFile(assemblyPath, "utf8");
const assemblyLines = assembly.split("\n");
updateCatalogLine(assemblyLines, "B0FBGFWFB1", [
  ["candidate_review,B0FBGFWFB1,verified_catalog,factory_socket_terminal_and_male_breakout_pins,candidate_review,clone_electrical_schematic_and_current_limits_unpublished", "visual_ready,B0FBGFWFB1,verified_catalog,factory_socket_terminal_and_male_breakout_pins,ready,"],
  ["Use only with the exact 16-pin ESP32-C3 SuperMini footprint; validate the clone rail/current behavior before power.", "Use only with the exact 16-pin ESP32-C3 SuperMini footprint; require the immutable 2x8 USB-C-toward-power-block mount contract and controller-USB-C/3.3V-only restricted power contract."],
  ["Validate rail selection, polarity, current limits, and the exact clone pin map before powering sensors; GPIO is 3.3V logic and must not source sensor loads.", "Controller USB-C power and factory-default 3.3V peripheral rails only; no external carrier power, battery connection, rail modification, or GPIO-sourced sensor load."],
]);
updateCatalogLine(assemblyLines, "B0H336QRXX", [
  ["candidate_review,B0H336QRXX,verified_catalog,factory_dual_socket_and_male_breakout_pins,candidate_review,marketplace_clone_ecad_and_exact_electrical_schematic_unpublished", "visual_ready,B0H336QRXX,verified_catalog,factory_dual_socket_and_male_breakout_pins,ready,"],
  ["Use only with the exact 44-pin ESP32-S3 DevKitC footprint; validate the V2775 rail/current behavior before power.", "Use only with the exact 44-pin ESP32-S3 DevKitC footprint; require the immutable 2x22 USB-C-aligned-with-carrier-arrow mount contract and controller-USB-C/3.3V-only restricted power contract."],
  ["Validate the V2775 rail jumper/input behavior, polarity, current limits, and exact 44-pin board mapping before power; never infer compatibility from the ESP32-S3 chip name alone.", "Controller USB-C power and 3.3V peripheral rows only; no external carrier power, DC barrel input, 5V peripheral rail, or family substitution."],
]);
assembly = assemblyLines.join("\n");
await writeFile(assemblyPath, assembly);
await writeFile(path.join(root, "lib/assembly-asset-catalog-data.mjs"), `export default ${JSON.stringify(assembly)};\n`);

let verified = await readFile(verifiedPath, "utf8");
const verifiedLines = verified.split("\n");
updateCatalogLine(verifiedLines, "B0FBGFWFB1", [
  ["retained as candidate review until the documented electrical limitations are cleared", "production selectable only under its deterministic mount and restricted-power contracts"],
  ["candidate_review_not_auto_selectable,visual_PASS,visual_PASS_electrical_candidate_REVIEW_factory_socket_terminal_and_male_breakout_pins_aws_glb_bound", "restricted_ready_requires_contract,visual_PASS,visual_PASS_restricted_READY_factory_socket_terminal_and_male_breakout_pins_aws_glb_bound"],
  ["Markings, pins, connectors, outline, scale, and populated-board form passed in the hash-bound AWS review; electrical eligibility remains blocked.", "Markings, pins, connectors, outline, scale, and populated assembly passed; selection requires the exact 2x8 mount and controller-USB-C/3.3V-only power contracts."],
  ["Visual gate passed; published as candidate_review and not auto-selectable until the electrical selection blocker is cleared.", "Restricted-ready: exact C3 family, 2x8 seating, controller USB-C power, factory-default 3.3V rails, no battery, and no rail modification."],
  ["approved-visual-catalog-20260828-esp32-breakout-silkscreen-v2", "approved-visual-catalog-20260829-breakout-restricted-power-v6"],
  ["exact ASIN/SKU to AWS candidate asset id", "exact ASIN/SKU to AWS restricted-ready asset id"],
]);
updateCatalogLine(verifiedLines, "B0H336QRXX", [
  ["retained as candidate review until the documented electrical limitations are cleared", "production selectable only under its deterministic mount and restricted-power contracts"],
  ["candidate_review_not_auto_selectable,visual_PASS,visual_PASS_electrical_candidate_REVIEW_factory_dual_socket_and_male_breakout_pins_aws_glb_bound", "restricted_ready_requires_contract,visual_PASS,visual_PASS_restricted_READY_factory_dual_socket_and_male_breakout_pins_aws_glb_bound"],
  ["Markings, pins, connectors, outline, scale, and populated-board form passed in the hash-bound AWS review; electrical eligibility remains blocked.", "Markings, pins, connectors, outline, scale, and populated assembly passed; selection requires the exact 2x22 mount and controller-USB-C/3.3V-only power contracts."],
  ["Visual gate passed; published as candidate_review and not auto-selectable until the electrical selection blocker is cleared.", "Restricted-ready: exact 44-pin S3 family, 2x22 seating, controller USB-C power, 3.3V sensor rows, no DC barrel, and no 5V sensor rail."],
  ["approved-visual-catalog-20260828-esp32-breakout-silkscreen-v2", "approved-visual-catalog-20260829-breakout-restricted-power-v6"],
  ["exact ASIN/SKU to AWS candidate asset id", "exact ASIN/SKU to AWS restricted-ready asset id"],
]);
verified = verifiedLines.join("\n");
await writeFile(verifiedPath, verified);
await writeFile(path.join(root, "lib/verified-parts-catalog-data.mjs"), `export default ${JSON.stringify(verified)};\n`);

console.log(JSON.stringify({ assemblyCatalog: assemblyPath, verifiedCatalog: verifiedPath, promoted: ["B0FBGFWFB1", "B0H336QRXX"] }, null, 2));

function replaceOnce(source, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Expected source fragment is missing: ${before.slice(0, 100)}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Source fragment is not unique: ${before.slice(0, 100)}`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function replaceOnceOrAlready(source, before, after) {
  if (source.includes(before)) return replaceOnce(source, before, after);
  if (source.includes(after)) return source;
  throw new Error(`Neither source nor promoted fragment exists: ${before.slice(0, 100)}`);
}

function updateCatalogLine(lines, asin, replacements) {
  const indexes = lines.map((line, index) => line.includes(`,${asin},`) ? index : -1).filter((index) => index >= 0);
  if (indexes.length !== 1) throw new Error(`Expected exactly one verified catalog row for ${asin}, received ${indexes.length}`);
  let line = lines[indexes[0]];
  for (const [before, after] of replacements) line = replaceOnceOrAlready(line, before, after);
  lines[indexes[0]] = line;
}
