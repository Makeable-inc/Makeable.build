#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [validatorRoot, input, output] = process.argv.slice(2);
if (!validatorRoot || !input || !output) {
  throw new Error("Usage: validate_gltf_khronos.mjs <gltf-validator-package-root> <input.glb> <report.json>");
}
const validator = await import(pathToFileURL(path.resolve(validatorRoot, "module.mjs")));
const report = await validator.validateBytes(new Uint8Array(await readFile(input)), {
  uri: path.basename(input),
  maxIssues: 1000,
});
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
if ((report.issues?.numErrors || 0) > 0) process.exitCode = 1;
