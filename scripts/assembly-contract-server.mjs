#!/usr/bin/env node

import { createServer } from "node:http";

import { createPlantCompanionAssemblyContract } from "../lib/plant-companion-assembly-contract.mjs";

const port = Math.max(1, Number(process.env.MAKEABLE_ASSEMBLY_CONTRACT_PORT || 8788));

createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type");
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  const url = new URL(request.url || "/", `http://${request.headers.host || `127.0.0.1:${port}`}`);
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, { ok: true, buildId: "plant-companion-v1", modelStorage: "aws-only" });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/builds/plant-companion-v1/assembly") {
    sendJson(response, createPlantCompanionAssemblyContract());
    return;
  }
  sendJson(response, { error: "Not found" }, 404);
}).listen(port, "127.0.0.1", () => {
  console.log(`Recovered assembly contract API listening at http://127.0.0.1:${port}`);
});

function sendJson(response, value, status = 200) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}
