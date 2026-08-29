#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const [modelDirectory, outputDirectory, threeRoot] = process.argv.slice(2);
if (!modelDirectory || !outputDirectory || !threeRoot) {
  throw new Error("Usage: render_glb_review.mjs <model-dir> <output-dir> <three-package-root>");
}

const absoluteModels = path.resolve(modelDirectory);
const absoluteOutput = path.resolve(outputDirectory);
const absoluteThree = path.resolve(threeRoot);
const { mkdir, readdir } = await import("node:fs/promises");
await mkdir(absoluteOutput, { recursive: true });

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f5f1e8}canvas{display:block}
</style><script type="importmap">{"imports":{"three":"/three/build/three.module.js"}}</script></head>
<body><script type="module">
import * as THREE from "three";
import { GLTFLoader } from "/three/examples/jsm/loaders/GLTFLoader.js";
const params=new URLSearchParams(location.search);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
renderer.setPixelRatio(1); renderer.setSize(innerWidth,innerHeight); renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.setClearColor(0xf5f1e8,1); renderer.shadowMap.enabled=true; document.body.append(renderer.domElement);
const scene=new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff,0x8b94a1,2.0));
const key=new THREE.DirectionalLight(0xffffff,3.2); key.position.set(3,-4,6); key.castShadow=true; scene.add(key);
const fill=new THREE.DirectionalLight(0xbcd7ff,1.5); fill.position.set(-4,2,3); scene.add(fill);
const camera=new THREE.PerspectiveCamera(30,innerWidth/innerHeight,0.00001,1000);
const gltf=await new GLTFLoader().loadAsync('/model/'+encodeURIComponent(params.get('model')));
const root=gltf.scene; scene.add(root);
const box=new THREE.Box3().setFromObject(root); const center=box.getCenter(new THREE.Vector3()); const size=box.getSize(new THREE.Vector3());
root.position.sub(center); const radius=Math.max(size.x,size.y,size.z)*2.05;
const directions=[[0,0,1],[1.3,-1.5,1.1],[-1.35,1.35,0.9],[0,-1.7,0.28]];
window.setReviewView=(index)=>{ const d=new THREE.Vector3(...directions[index]).normalize(); camera.position.copy(d.multiplyScalar(radius)); camera.up.set(0,0,1); if(index===0) camera.up.set(0,1,0); camera.lookAt(0,0,0); camera.updateProjectionMatrix(); renderer.render(scene,camera); };
window.setReviewView(0); window.reviewReady=true;
</script></body></html>`;

function safeJoin(root, requestPath) {
  const resolved = path.resolve(root, requestPath.replace(/^\/+/, ""));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error("path escape");
  return resolved;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html);
      return;
    }
    let file;
    if (url.pathname.startsWith("/model/")) file = safeJoin(absoluteModels, decodeURIComponent(url.pathname.slice(7)));
    else if (url.pathname.startsWith("/three/")) file = safeJoin(absoluteThree, decodeURIComponent(url.pathname.slice(7)));
    else throw new Error("not found");
    await stat(file);
    response.setHeader("Content-Type", file.endsWith(".glb") ? "model/gltf-binary" : "text/javascript; charset=utf-8");
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end("not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MAKEABLE_BROWSER_EXECUTABLE
    ? { executablePath: process.env.MAKEABLE_BROWSER_EXECUTABLE }
    : {}),
});
try {
  for (const filename of (await readdir(absoluteModels)).filter((name) => name.endsWith(".glb")).sort()) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) console.error(`[review ${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => console.error(`[review pageerror] ${error.message}`));
    page.on("response", (response) => {
      if (response.status() >= 400) console.error(`[review http ${response.status()}] ${response.url()}`);
    });
    await page.goto(`http://127.0.0.1:${port}/?model=${encodeURIComponent(filename)}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.reviewReady === true, null, { timeout: 60_000 });
    const frames = [];
    for (let index = 0; index < 4; index += 1) {
      await page.evaluate((view) => window.setReviewView(view), index);
      const frame = path.join(absoluteOutput, `${filename.slice(0, -4)}-${index + 1}.png`);
      await page.screenshot({ path: frame });
      frames.push(frame);
    }
    await page.close();
    const sheet = path.join(absoluteOutput, `${filename.slice(0, -4)}-four-angle.png`);
    const montage = spawnSync(
      "magick",
      ["(", frames[0], frames[1], "+append", ")", "(", frames[2], frames[3], "+append", ")", "-append", sheet],
      { encoding: "utf8" },
    );
    if (montage.status !== 0) throw new Error(montage.stderr || `magick montage failed for ${filename}`);
    console.log(sheet);
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
