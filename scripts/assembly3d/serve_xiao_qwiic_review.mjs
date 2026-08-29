#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const artifactRoot = path.join(root, "artifacts/xiao-qwiic-co2/2026-08-28-api-only-v3");
const vendorRoot = path.join(root, "apps/landing/node_modules/three");
const port = Number(process.argv[2] || 8913);
const contentTypes = new Map([[".html","text/html; charset=utf-8"],[".json","application/json; charset=utf-8"],[".md","text/markdown; charset=utf-8"],[".png","image/png"],[".stl","model/stl"],[".glb","model/gltf-binary"],[".ino","text/plain; charset=utf-8"],[".js","text/javascript; charset=utf-8"]]);

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || `127.0.0.1:${port}`}`);
    if (url.pathname === "/favicon.ico") {
      response.statusCode = 204;
      return response.end();
    }
    let file;
    if (url.pathname === "/" || url.pathname === "/index.html") file = path.join(artifactRoot, "viewer/index.html");
    else if (url.pathname.startsWith("/build/")) file = safeJoin(artifactRoot, url.pathname.slice(7));
    else if (url.pathname === "/vendor/three.module.js") file = path.join(vendorRoot, "build/three.module.js");
    else if (url.pathname === "/vendor/three.core.js") file = path.join(vendorRoot, "build/three.core.js");
    else if (url.pathname === "/vendor/GLTFLoader.js") file = path.join(vendorRoot, "examples/jsm/loaders/GLTFLoader.js");
    else if (url.pathname === "/vendor/OrbitControls.js") file = path.join(vendorRoot, "examples/jsm/controls/OrbitControls.js");
    else if (url.pathname === "/utils/BufferGeometryUtils.js") file = path.join(vendorRoot, "examples/jsm/utils/BufferGeometryUtils.js");
    else if (url.pathname === "/utils/SkeletonUtils.js") file = path.join(vendorRoot, "examples/jsm/utils/SkeletonUtils.js");
    else return send(response, 404, "Not found");
    await stat(file);
    const body = await readFile(file);
    response.statusCode = 200;
    response.setHeader("Content-Type", contentTypes.get(path.extname(file)) || "application/octet-stream");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Length", body.length);
    response.end(body);
  } catch (error) {
    send(response, 404, String(error?.message || error));
  }
}).listen(port, "127.0.0.1", () => console.log(`XIAO Qwiic production review: http://127.0.0.1:${port}/`));

function safeJoin(base, relative) {
  const candidate = path.resolve(base, decodeURIComponent(relative));
  if (candidate !== base && !candidate.startsWith(`${base}${path.sep}`)) throw new Error("Invalid path");
  return candidate;
}
function send(response, status, body) { response.statusCode = status; response.setHeader("Content-Type", "text/plain; charset=utf-8"); response.end(body); }
