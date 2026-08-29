#!/usr/bin/env node

const apiOrigin = process.env.MAKEABLE_SIMULATION_API_ORIGIN || "http://127.0.0.1:8790";
const idea = process.argv.slice(2).join(" ").trim();

if (!idea) {
  console.error("Usage: node scripts/run-production-aws-simulation.mjs <project idea>");
  process.exit(2);
}

const response = await fetch(`${apiOrigin}/api/production-simulations`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ idea }),
  signal: AbortSignal.timeout(10 * 60_000),
});
const body = await response.json();
if (!response.ok) {
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

const build = body.build;
console.log(JSON.stringify({
  id: build.id,
  title: build.title,
  parts: build.parts.map((part) => ({
    id: part.id,
    name: part.name,
    assemblyAssets: part.assemblyAssets?.map((asset) => asset.partId) || [],
  })),
  metrics: build.artifacts.pipeline.metrics,
  registry: build.artifacts.registry,
  selection: build.artifacts.selection,
  delivery: {
    mode: build.artifacts.delivery.mode,
    modelOrigin: build.artifacts.delivery.modelOrigin,
    modelCount: build.artifacts.delivery.modelFetches.length,
    totalBytes: build.artifacts.delivery.totalModelBytes,
    localModelRequests: build.artifacts.delivery.localModelRequests,
    localModelBytes: build.artifacts.delivery.localModelBytes,
    generatedModelCount: build.artifacts.delivery.generatedModelCount,
    visualReviewCount: build.artifacts.delivery.visualReviewCount,
  },
  assembly: {
    state: build.artifacts.assembly.state,
    parts: build.artifacts.assembly.parts.length,
    wires: build.artifacts.assembly.wires.length,
    steps: build.artifacts.assembly.steps.length,
  },
  image: {
    source: build.image.source,
    model: build.image.model,
    urlType: build.image.url.startsWith("data:image/") ? "inline-image-api-result" : "remote-url",
  },
  timeline: build.artifacts.pipeline.timeline,
}, null, 2));
