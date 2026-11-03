// Prints the compiler's wires for a set of parts as JSON, in millimetres. Usage: node wires.mjs <controller id> <other id>...
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const { compileElectricalGraph } = await import(pathToFileURL(join(root, "lib/prompt2circuit-electrical-compiler.mjs")));
const release = join(root, "artifacts/aws-assembly-release/prompt2circuit-production-ready79-speech-capture-20260904-v1");
const raw = JSON.parse(readFileSync(join(release, "profiles.json"), "utf8")).profiles;
const profiles = Array.isArray(raw) ? raw : Object.values(raw);

const [controller, ...others] = process.argv.slice(2);
const parts = [{ id: "ctrl", assetId: controller, role: "controller" }, ...others.map((assetId, i) => ({ id: `p${i}`, assetId, role: "peripheral" }))];
const graph = compileElectricalGraph({ parts, profiles, controllerPartId: "ctrl", carrierPartId: "" });
const end = (e) => ({
  part_id: e.assetId,
  signal: e.signal,
  label: e.physicalLabel,
  connector: e.connectorId,
  family: e.connectorFamily,
  position: e.position.map((v) => +(v * 1000).toFixed(3)),
  normal: e.normal,
});
console.log(JSON.stringify(graph.connections.map((w) => ({ net: w.netId, mode: w.connectionMode, color: w.color, from: end(w.fromEndpoint), to: end(w.toEndpoint) })), null, 1));
