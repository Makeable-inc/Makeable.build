import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildLambdaBundle } from "../scripts/build-lambda-bundle.mjs";

test("the Lambda bundle holds the code and every file the pipeline reads from disk, and nothing else big", async () => {
  const out = mkdtempSync(path.join(tmpdir(), "lambda-bundle-"));
  try {
    const { release } = await buildLambdaBundle(out);
    for (const file of [
      "package.json",
      "package-lock.json",
      "aws/functions/api.mjs",
      "netlify/functions/api.mjs",
      "lib/production-build-pipeline.mjs",
      "prompts/production/manifest.json",
      `artifacts/aws-assembly-release/${release}/connector-geometry-audit.json`,
    ]) {
      assert.ok(existsSync(path.join(out, file)), `missing ${file}`);
    }
    for (const dir of ["apps", "release-dist", "node_modules", "tests", ".env"]) {
      assert.equal(existsSync(path.join(out, dir)), false, `should not ship ${dir}`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
