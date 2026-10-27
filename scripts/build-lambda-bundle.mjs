#!/usr/bin/env node
// Copies what the Lambdas need into one folder for `sam build`: the backend
// code, package files, and the files the build pipeline reads from disk
// (netlify.toml included_files did this on Netlify).
//
//   node scripts/build-lambda-bundle.mjs [outDir]   (default .aws-sam-src)
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildLambdaBundle(outDir = path.join(ROOT, ".aws-sam-src")) {
  const release = pipelineRelease();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const entry of [
    "package.json",
    "package-lock.json",
    "lib",
    "aws/functions",
    "netlify/functions",
    "prompts/production",
    `artifacts/aws-assembly-release/${release}`,
  ]) {
    cpSync(path.join(ROOT, entry), path.join(outDir, entry), { recursive: true });
  }
  return { outDir, release };
}

// The release folder the pipeline loads, read from the pipeline itself so the
// two can't drift apart.
function pipelineRelease() {
  const source = readFileSync(path.join(ROOT, "lib/production-build-pipeline.mjs"), "utf8");
  const match = source.match(/^const RELEASE = "([^"]+)";/m);
  if (!match) throw new Error("RELEASE not found in lib/production-build-pipeline.mjs");
  return match[1];
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const { outDir, release } = await buildLambdaBundle(process.argv[2]);
  console.log(`Lambda bundle in ${outDir} (release ${release})`);
}
