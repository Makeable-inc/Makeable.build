#!/usr/bin/env node
// Real-browser page speed: runs Lighthouse (headless Chrome, desktop settings,
// no cache) on the same pages of each site several times and prints the median
// of what a visitor sees. Signed out.
//
//   node scripts/bench-browser.mjs https://makeable.build https://main.<id>.amplifyapp.com [--runs 3]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const runs = Number(args.includes("--runs") ? args[args.indexOf("--runs") + 1] : 3);
const sites = args.filter((arg, i) => arg.startsWith("http") && args[i - 1] !== "--runs");
const PAGES = ["/", "/app/", "/ember"];
const METRICS = [
  ["first-contentful-paint", "first paint"],
  ["largest-contentful-paint", "main content"],
  ["speed-index", "speed index"],
  ["interactive", "usable"],
];

const dir = mkdtempSync(path.join(tmpdir(), "lighthouse-"));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

try {
  for (const site of sites) {
    console.log(`\n${site}  (median of ${runs} Lighthouse runs, desktop, signed out)`);
    console.log("page".padEnd(10), ...METRICS.map(([, label]) => label.padStart(14)), "downloaded".padStart(12), "requests".padStart(9));
    for (const page of PAGES) {
      const results = [];
      for (let i = 0; i < runs; i += 1) {
        const out = path.join(dir, `run-${i}.json`);
        execFileSync("npx", [
          "-y", "lighthouse@12.2.1", `${site.replace(/\/$/, "")}${page}`,
          "--quiet", "--preset=desktop", "--only-categories=performance",
          "--chrome-flags=--headless=new --no-first-run", "--output=json", `--output-path=${out}`,
        ], { stdio: "ignore", shell: process.platform === "win32" });
        const report = JSON.parse(readFileSync(out, "utf8"));
        results.push({
          metrics: Object.fromEntries(METRICS.map(([id]) => [id, report.audits[id]?.numericValue ?? NaN])),
          bytes: report.audits["total-byte-weight"]?.numericValue ?? NaN,
          requests: report.audits["network-requests"]?.details?.items?.length ?? NaN,
        });
      }
      console.log(
        page.padEnd(10),
        ...METRICS.map(([id]) => `${(median(results.map((r) => r.metrics[id])) / 1000).toFixed(2)} s`.padStart(14)),
        `${(median(results.map((r) => r.bytes)) / 1048576).toFixed(1)} MB`.padStart(12),
        String(median(results.map((r) => r.requests))).padStart(9),
      );
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
