import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { unzipSync, strFromU8 } from "fflate";
import { runningJobId, siteZip } from "../scripts/deploy-site.mjs";

test("the site zip holds every built file at its path plus customHttp.yml at the root", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "site-"));
  try {
    mkdirSync(path.join(dir, "app"));
    writeFileSync(path.join(dir, "index.html"), "<h1>home</h1>");
    writeFileSync(path.join(dir, "app", "index.html"), "<h1>app</h1>");
    writeFileSync(path.join(dir, "logo.png"), Buffer.from([0x89, 0x50, 0x00, 0xff]));
    const files = unzipSync(siteZip(dir, "customHeaders:\n"));
    assert.deepEqual(Object.keys(files).sort(), ["app/index.html", "customHttp.yml", "index.html", "logo.png"]);
    assert.equal(strFromU8(files["app/index.html"]), "<h1>app</h1>");
    assert.deepEqual([...files["logo.png"]], [0x89, 0x50, 0x00, 0xff]);
    assert.equal(strFromU8(files["customHttp.yml"]), "customHeaders:\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a deployment already running on the branch is found, so a new one waits instead of failing", () => {
  assert.equal(runningJobId([]), "");
  assert.equal(runningJobId([{ jobId: "3", status: "SUCCEED" }, { jobId: "2", status: "FAILED" }]), "");
  assert.equal(runningJobId([{ jobId: "5", status: "RUNNING" }, { jobId: "4", status: "SUCCEED" }]), "5");
  assert.equal(runningJobId([{ jobId: "6", status: "PENDING" }]), "6");
});
