import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAtomicBuildManifest,
  bindAtomicBuildManifest,
  createBuildRequestIdentity,
} from "../lib/build-manifest.mjs";

test("atomic manifest binds one request, job, build, hero, BOM, and wiring artifact", () => {
  const identity = createBuildRequestIdentity({
    requestId: "req_1234567890",
    jobId: "job_1234567890123456789012",
    buildId: "build_comfort_station_123",
    prompt: "Build an indoor temperature and humidity comfort station",
    accountHash: "account-hash",
    catalogRevision: "ready79",
    promptPackageRevision: "2026-09-02.3",
  });
  const completed = bindAtomicBuildManifest({
    id: identity.buildId,
    idea: identity.normalizedPrompt,
    title: "Indoor Comfort Station",
    summary: "Measures room temperature and humidity.",
    behavior: "Shows the current comfort readings.",
    image: {
      url: "data:image/png;base64,aGVsbG8=",
      source: "openai",
      model: "gpt-image-1.5",
      buildId: identity.buildId,
      requestFingerprint: identity.requestFingerprint,
    },
    parts: [
      { id: "esp32", name: "ESP32 controller", assemblyAssets: [{ partId: "esp32-glb" }] },
      { id: "bme280", name: "BME280 sensor", assemblyAssets: [{ partId: "bme280-glb" }] },
    ],
    semanticFulfillment: {
      ok: true,
      coveragePercent: 100,
      requestedCapabilities: ["temperature", "humidity"],
      providedCapabilities: ["temperature", "humidity"],
      missingCapabilities: [],
      unrelatedParts: [],
      planUnrequestedCapabilities: [],
    },
    artifacts: {
      lineage: {
        buildId: identity.buildId,
        requestFingerprint: identity.requestFingerprint,
      },
      assembly: {
        state: "ready",
        schemaVersion: "MakeableAssemblyV1",
        contractFingerprint: "assembly-fingerprint",
        requiredAssets: [{ id: "esp32-glb", sha256: "a".repeat(64) }],
        wires: [{ id: "wire-1" }],
        guideSteps: [{ id: "step-1" }],
      },
    },
  }, identity);

  assert.equal(completed.status, "Ready");
  assert.equal(completed.artifactStates.parts.state, "ready");
  assert.equal(completed.artifactStates.wiring.state, "ready");
  assert.equal(completed.artifactStates.enclosure.reason, "Not generated for this circuit-only build.");
  assert.equal(assertAtomicBuildManifest(completed, identity), true);

  completed.manifest.project.title = "Door Chime";
  assert.throws(() => assertAtomicBuildManifest(completed, identity), /(?:project|hash)_mismatch/);
});
