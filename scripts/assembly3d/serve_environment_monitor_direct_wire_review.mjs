#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] || 8902);
const root = process.cwd();
const threeRoot = path.resolve(root, "apps/landing/node_modules/three");
const libRoot = path.resolve(root, "lib");
const artifactRoot = path.resolve(root, "artifacts/environment-monitor-c3/2026-08-28-direct-wire-v2");
const viewerRoot = path.join(artifactRoot, "viewer");

function safeJoin(base, requestPath) {
  const resolved = path.resolve(base, requestPath.replace(/^\/+/, ""));
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw new Error("path escape");
  return resolved;
}

const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".png", "image/png"],
  [".glb", "model/gltf-binary"],
  [".stl", "model/stl"],
  [".txt", "text/plain; charset=utf-8"],
]);

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    let file;
    if (url.pathname === "/" || url.pathname === "/index.html") file = path.join(viewerRoot, "index.html");
    else if (url.pathname.startsWith("/three/")) file = safeJoin(threeRoot, decodeURIComponent(url.pathname.slice(7)));
    else if (url.pathname.startsWith("/repo-lib/")) file = safeJoin(libRoot, decodeURIComponent(url.pathname.slice(10)));
    else if (url.pathname.startsWith("/build/")) file = safeJoin(artifactRoot, decodeURIComponent(url.pathname.slice(7)));
    else throw new Error("not found");
    await stat(file);
    response.setHeader("Content-Type", mime.get(path.extname(file)) || "application/octet-stream");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Direct-wire environment monitor review listening on http://127.0.0.1:${port}/`);
});
