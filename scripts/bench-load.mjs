#!/usr/bin/env node
// Times the requests a visitor's browser makes at each step of the app, so a
// speed change can be measured before and after. Read-only GETs only.
//
//   node scripts/bench-load.mjs https://makeable.build https://main.<id>.amplifyapp.com [--runs 10]
//
// API calls get a unique ?bench= query so no cache answers them ("first visit");
// the image is also timed without it ("repeat visit", what caching gives).
const args = process.argv.slice(2);
const runs = Number(args.includes("--runs") ? args[args.indexOf("--runs") + 1] : 10);
const sites = args.filter((arg, i) => arg.startsWith("http") && args[i - 1] !== "--runs");

async function time(url) {
  const started = performance.now();
  const response = await fetch(url, { headers: { "Accept-Encoding": "gzip, br" } });
  const body = new Uint8Array(await response.arrayBuffer());
  return { ms: performance.now() - started, bytes: body.length, status: response.status };
}

function stats(samples) {
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { median: Math.round(pick(0.5)), p90: Math.round(pick(0.9)), kb: Math.round(samples[0].bytes / 1024), status: samples[0].status };
}

const bust = () => `bench=${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

// Every app page: the HTML, then every same-site script, style and image it
// references, fetched together like a browser's first visit (no cache).
const APPS = ["/", "/app/", "/ember", "/pilot", "/hologram", "/circuit-studio/", "/dashboard"];

async function appVisit(base, pagePath) {
  const started = performance.now();
  const page = await fetch(`${base}${pagePath}`);
  const html = await page.text();
  const pageUrl = new URL(page.url);
  const refs = new Set();
  for (const [, ref] of html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)) {
    let url;
    try { url = new URL(ref.replace(/&amp;/g, "&"), pageUrl); } catch { continue; }
    if (url.origin !== pageUrl.origin) continue;
    if (!/\.(js|mjs|css|png|jpe?g|webp|gif|svg|avif|woff2?|glb|wasm|json)$/i.test(url.pathname)) continue;
    url.searchParams.set("bench", bust());
    refs.add(url.href);
  }
  const files = await Promise.all([...refs].map((url) => time(url)));
  return {
    ms: performance.now() - started,
    files: files.length,
    mb: (html.length + files.reduce((sum, file) => sum + file.bytes, 0)) / 1048576,
    failed: files.filter((file) => file.status >= 400).length,
  };
}

for (const site of sites) {
  const base = site.replace(/\/$/, "");
  const gallery = await (await fetch(`${base}/api/builds?${bust()}`)).json();
  const build = (gallery.builds || [])[Math.min(5, (gallery.builds || []).length - 1)];
  const steps = [
    ["1 homepage HTML", () => `${base}/`],
    ["2 /api/config", () => `${base}/api/config?${bust()}`],
    ["3 gallery list /api/builds", () => `${base}/api/builds?${bust()}`],
    ["4 one build /api/builds/:id", () => build && `${base}/api/builds/${build.id}?${bust()}`],
    ["5a image, first visit", () => build && `${base}/api/builds/${build.id}/image?${bust()}`],
    ["5b image, repeat visit", () => build && `${base}/api/builds/${build.id}/image`],
    ["6 project page HTML /app/", () => `${base}/app/`],
  ];
  // A first visit to the homepage: page, config and gallery list together,
  // then the first 12 card images together (what a browser fetches first).
  const visits = [];
  for (let i = 0; i < Math.min(runs, 5); i += 1) {
    const started = performance.now();
    const [, , list] = await Promise.all([
      time(`${base}/`),
      time(`${base}/api/config?${bust()}`),
      fetch(`${base}/api/builds?${bust()}`).then((r) => r.json()),
    ]);
    const listMs = performance.now() - started;
    const cards = (list.builds || []).slice(0, 12);
    const images = await Promise.all(cards.map((b) => time(`${base}/api/builds/${b.id}/image?${bust()}`)));
    visits.push({
      listMs,
      totalMs: performance.now() - started,
      mb: images.reduce((sum, image) => sum + image.bytes, 0) / 1048576,
    });
  }
  const median = (key) => visits.map((v) => v[key]).sort((a, b) => a - b)[Math.floor(visits.length / 2)];
  console.log(`\n${base}  (${runs} runs, ${(gallery.builds || []).length} gallery builds)`);
  console.log(`HOMEPAGE FIRST VISIT (median of ${visits.length}): gallery list ready ${Math.round(median("listMs"))} ms, `
    + `12 card images done ${Math.round(median("totalMs"))} ms, ${median("mb").toFixed(1)} MB of images`);
  console.log("app page + its files (median of 5)".padEnd(36), "time".padStart(8), "files".padStart(6), "size".padStart(9), " failed");
  for (const appPath of APPS) {
    const visits = [];
    for (let i = 0; i < 5; i += 1) visits.push(await appVisit(base, appPath));
    visits.sort((a, b) => a.ms - b.ms);
    const v = visits[2];
    console.log(`  ${appPath}`.padEnd(36), `${Math.round(v.ms)} ms`.padStart(8), String(v.files).padStart(6), `${v.mb.toFixed(1)} MB`.padStart(9), ` ${v.failed}`);
  }
  console.log("step".padEnd(32), "median".padStart(8), "p90".padStart(8), "size".padStart(9), " status");
  for (const [name, url] of steps) {
    if (!url()) continue;
    const samples = [];
    for (let i = 0; i < runs; i += 1) samples.push(await time(url()));
    const s = stats(samples);
    console.log(name.padEnd(32), `${s.median} ms`.padStart(8), `${s.p90} ms`.padStart(8), `${s.kb} KB`.padStart(9), ` ${s.status}`);
  }
}
