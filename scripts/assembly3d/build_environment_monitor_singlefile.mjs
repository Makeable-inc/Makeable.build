#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "../../apps/landing/node_modules/esbuild/lib/main.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const artifactRoot = path.join(root, "artifacts/environment-monitor-c3/2026-08-28");
const sourcePath = path.join(artifactRoot, "viewer/index.html");
const outputPath = path.join(artifactRoot, "viewer/environment-monitor-review.html");
const threeRoot = path.join(root, "apps/landing/node_modules/three");

let html = await readFile(sourcePath, "utf8");
const moduleMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!moduleMatch) throw new Error("Viewer module script was not found.");

const heroPath = path.join(artifactRoot, "hero/environment-monitor-hero-v1.png");
const enclosurePath = path.join(artifactRoot, "enclosure/environment-monitor-enclosure.glb");
const heroData = `data:image/png;base64,${(await readFile(heroPath)).toString("base64")}`;
const enclosureData = `data:model/gltf-binary;base64,${(await readFile(enclosurePath)).toString("base64")}`;

let source = moduleMatch[1]
  .replace('from "three"', `from ${JSON.stringify(path.join(threeRoot, "build/three.module.js"))}`)
  .replace('from "/three/examples/jsm/loaders/GLTFLoader.js"', `from ${JSON.stringify(path.join(threeRoot, "examples/jsm/loaders/GLTFLoader.js"))}`)
  .replace('from "/three/examples/jsm/controls/OrbitControls.js"', `from ${JSON.stringify(path.join(threeRoot, "examples/jsm/controls/OrbitControls.js"))}`)
  .replace('"/environment-monitor/enclosure/environment-monitor-enclosure.glb"', JSON.stringify(enclosureData))
  .replace("await loadAll();", 'loadAll().catch((error) => { console.error(error); const loading = document.querySelector("#loading"); if (loading) loading.textContent = "REVIEW FAILED: " + error.message; });');

const build = await esbuild.build({
  stdin: { contents: source, loader: "js", resolveDir: path.dirname(sourcePath), sourcefile: "environment-monitor-review.mjs" },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  minify: true,
  write: false,
  nodePaths: [path.join(root, "apps/landing/node_modules")],
});
const bundle = build.outputFiles[0].text;

html = html
  .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, "")
  .replace(moduleMatch[0], `<script>${bundle}</script>`)
  .replace("/environment-monitor/hero/environment-monitor-hero-v1.png", heroData);

for (const relative of [
  "enclosure/environment-monitor-base.stl",
  "enclosure/environment-monitor-lid.stl",
  "enclosure/environment-monitor-tray.stl",
  "enclosure/environment-monitor-enclosure.glb",
  "firmware/environment_monitor_c3.ino",
]) {
  html = html.replace(`/environment-monitor/${relative}`, pathToFileURL(path.join(artifactRoot, relative)).href);
}

await writeFile(outputPath, html);
console.log(JSON.stringify({ outputPath, bytes: Buffer.byteLength(html), heroEmbedded: true, enclosureEmbedded: true, awsPartGlbsEmbedded: false }, null, 2));
