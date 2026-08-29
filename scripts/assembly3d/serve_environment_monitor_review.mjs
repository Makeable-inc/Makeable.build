#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const port = Number(process.argv[2] || 8901);
const root = process.cwd();
const threeRoot = path.resolve(root, "apps/landing/node_modules/three");
const viewerRoot = path.resolve(root, "artifacts/environment-monitor-c3/2026-08-28/viewer");
const artifactRoot = path.resolve(root, "artifacts/environment-monitor-c3/2026-08-28");

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
  [".png", "image/png"],
  [".glb", "model/gltf-binary"],
  [".stl", "model/stl"],
  [".ino", "text/plain; charset=utf-8"],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    let file;
    if (url.pathname === "/" || url.pathname === "/index.html") file = path.join(viewerRoot, "index.html");
    else if (url.pathname.startsWith("/three/")) file = safeJoin(threeRoot, decodeURIComponent(url.pathname.slice(7)));
    else if (url.pathname.startsWith("/environment-monitor/")) file = safeJoin(artifactRoot, decodeURIComponent(url.pathname.slice(21)));
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
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Environment monitor review listening on http://127.0.0.1:${port}/`);
});
