import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const GENERATOR = path.join(ROOT, "scripts/assembly3d/generate_benchmark_interface_assets.py");
const REPO_MANIFEST = path.join(
  ROOT,
  "apps/landing/public/assembly-assets/benchmark-interface-v2/manifest.json",
);

test("legacy benchmark generation fails closed when it reaches a breadboard", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "makeable-breadboard-ban-"));
  try {
    await assert.rejects(
      execFileAsync(process.env.MAKEABLE_WORKSPACE_PYTHON || "/usr/bin/python3", [
        GENERATOR,
        "--output",
        outputDir,
      ], {
        cwd: ROOT,
        maxBuffer: 20 * 1024 * 1024,
      }),
      (error) => {
        assert.match(String(error.stderr || error), /policy_breadboard_banned/);
        return true;
      },
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("the legacy breadboard benchmark manifest is not shipped", async () => {
  await assert.rejects(access(REPO_MANIFEST), (error) => error?.code === "ENOENT");
});
