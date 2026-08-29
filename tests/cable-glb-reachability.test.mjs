import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../artifacts/high-fidelity-glb/2026-08-28/adafruit-4397-qwiic-to-female-sockets/", import.meta.url);

test("every required #4397 cable node is reachable from the active glTF scene", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  const glb = await readFile(new URL(manifest.glb.path, root));
  assert.equal(glb.toString("ascii", 0, 4), "glTF");
  assert.equal(glb.readUInt32LE(8), glb.length);
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8"));
  const reachable = new Set();
  const visit = (index) => {
    if (reachable.has(index)) return;
    reachable.add(index);
    for (const child of gltf.nodes[index].children || []) visit(child);
  };
  for (const rootIndex of gltf.scenes[gltf.scene || 0].nodes || []) visit(rootIndex);
  for (const name of manifest.requiredNodes) {
    const matches = gltf.nodes.map((node, index) => ({ node, index })).filter(({ node }) => node.name === name);
    assert.equal(matches.length, 1, `${name} must be unique`);
    assert.equal(reachable.has(matches[0].index), true, `${name} must be scene-reachable`);
  }
});
