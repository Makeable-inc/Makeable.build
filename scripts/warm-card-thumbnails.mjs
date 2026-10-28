#!/usr/bin/env node
// Asks the site for every public build's card image once, so each thumbnail
// is made and stored before a visitor needs it (~0.4 s each the first time).
// Read-only from the outside: plain GETs, safe to rerun.
//
//   node scripts/warm-card-thumbnails.mjs https://main.<id>.amplifyapp.com
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) {
  console.error("usage: node scripts/warm-card-thumbnails.mjs <site url>");
  process.exit(1);
}

const builds = ((await (await fetch(`${base}/api/builds`)).json()).builds || [])
  .filter((build) => /^\/api\/builds\/[^/?]+\/image$/.test(build.image?.url || ""));
let done = 0;
let failed = 0;
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < builds.length) {
    const build = builds[next++];
    const response = await fetch(`${base}${build.image.url}?size=card`).catch(() => null);
    if (response?.ok && response.headers.get("content-type") === "image/jpeg") done += 1;
    else failed += 1;
    await response?.arrayBuffer().catch(() => {});
  }
}));
console.log(`card thumbnails ready: ${done}, failed: ${failed}, of ${builds.length} builds`);
if (failed) process.exit(1);
