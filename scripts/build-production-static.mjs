import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextExport = path.join(root, "apps", "landing", "out");
const output = path.join(root, "release-dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(nextExport, output, { recursive: true });

for (const directory of [
  "assets",
  "styles",
  "ember",
  "pilot",
  "dashboard",
  "hologram",
]) {
  await cp(path.join(root, directory), path.join(output, directory), { recursive: true });
}

for (const file of ["robots.txt", "sitemap.xml"]) {
  await cp(path.join(root, file), path.join(output, file));
}

await cp(path.join(root, "pilot", "index.html"), path.join(output, "pilot-app.html"));
await rm(path.join(output, "pilot", "index.html"));

// The saved-project guide is a real GLB renderer, not an optional preview.
// Keep its pinned runtime in every regular production build.
const studio = path.join(output, "circuit-studio");
await cp(path.join(root, "apps", "circuit-lab"), studio, { recursive: true });
const three = path.join(root, "node_modules", "three");
await mkdir(path.join(studio, "vendor"), { recursive: true });
for (const file of ["three.module.js", "three.core.js"]) {
  await cp(path.join(three, "build", file), path.join(studio, "vendor", file));
}
for (const file of ["controls/OrbitControls.js", "loaders/GLTFLoader.js", "utils/BufferGeometryUtils.js", "utils/SkeletonUtils.js"]) {
  const target = path.join(studio, "vendor", "addons", file);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(three, "examples", "jsm", file), target);
}
