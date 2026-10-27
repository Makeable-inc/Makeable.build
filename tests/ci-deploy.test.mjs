import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Runs scripts/ci-deploy.sh with fake `sam` and `node` that only record their
// arguments, so the order of steps can be checked without AWS.
function runDeploy({ order, smokeFailures = 0 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "ci-deploy-"));
  const log = path.join(dir, "calls.log").split(path.sep).join("/");
  const fake = (name) => {
    const file = path.join(dir, name);
    writeFileSync(file, [
      "#!/usr/bin/env bash",
      `echo "${name} $*" >> "${log}"`,
      'if [[ "$*" == *aws-smoke-build* ]]; then',
      `  n=$(grep -c aws-smoke-build "${log}")`,
      `  [ "$n" -le ${smokeFailures} ] && exit 1`,
      "fi",
      "exit 0",
      "",
    ].join("\n"));
    chmodSync(file, 0o755);
  };
  fake("sam");
  fake("node");
  const result = spawnSync("bash", ["scripts/ci-deploy.sh"], {
    env: {
      ...process.env,
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      AWS_CFN_EXECUTION_ROLE_ARN: "arn:aws:iam::1:role/x",
      AMPLIFY_APP_ID: "app1",
      AMPLIFY_SITE_URL: "https://main.app1.amplifyapp.com",
      ...(order ? { DEPLOY_ORDER: order } : {}),
    },
    encoding: "utf8",
  });
  let calls = [];
  try {
    calls = readFileSync(log, "utf8").trim().split("\n").map((line) => {
      if (line.startsWith("sam deploy")) return "backend";
      if (line.includes("deploy-site")) return "site";
      if (line.includes("aws-smoke-build")) return "smoke";
      return null;
    }).filter(Boolean);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { status: result.status, calls };
}

test("a deploy goes backend, then website, then smoke build", () => {
  assert.deepEqual(runDeploy(), { status: 0, calls: ["backend", "site", "smoke"] });
});

test("a rollback goes website first, so the site is never newer than the backend", () => {
  assert.deepEqual(runDeploy({ order: "site-first" }), { status: 0, calls: ["site", "backend", "smoke"] });
});

test("one failed smoke build is retried; two failures fail the deploy", () => {
  assert.deepEqual(runDeploy({ smokeFailures: 1 }), { status: 0, calls: ["backend", "site", "smoke", "smoke"] });
  assert.equal(runDeploy({ smokeFailures: 2 }).status, 1);
});
