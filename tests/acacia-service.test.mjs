import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  acceptAcaciaProposal,
  acaciaPlanIdForRoute,
  createAcaciaProgramResponse,
  createAcaciaProposal,
  validateAcaciaAcceptRequest,
  validateAcaciaProposalRequest,
} from "../lib/programs/acacia/service.mjs";
import { routeAcaciaIdea } from "../lib/programs/acacia/router.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the public program response exposes a bounded, non-secret kit catalog", () => {
  const response = createAcaciaProgramResponse();

  assert.equal(response.ok, true);
  assert.equal(response.program.id, "nus-acacia");
  assert.equal(response.program.registryVersion, 1);
  assert.deepEqual(response.difficultyOptions, ["beginner", "builder", "advanced"]);
  assert.ok(response.capabilities.some(({ id }) => id === "motion-classifier"));
  assert.ok(response.hardware.some(({ id }) => id === "esp32-s3-n16r8"));
  assert.deepEqual(
    response.hardware
      .filter(({ pool }) => pool === "shared")
      .map(({ id }) => id),
    ["hc-sr501-pir", "hx711-load-cell", "sgp30-air-quality"],
  );
  assert.equal(
    response.hardware.some(({ id }) =>
      /ws2812|servo|pn532|motor|driver|supply|pump/.test(id),
    ),
    false,
  );
  assert.equal(response.hardware.every(({ quantity }) => quantity === 1), true);
  assert.equal(
    response.hardware
      .filter(({ pool }) => pool === "shared")
      .every(({ availability }) => availability === "checkout_required"),
    true,
  );
  assert.equal(
    response.hardware.some((part) =>
      Object.keys(part).some((key) => /price|cost|secret|token|credential/i.test(key)),
    ),
    false,
  );
});

test("proposal IDs are deterministic and public parts are hydrated from the registry", () => {
  const first = successfulProposal({
    idea: "  Help students notice   when a room is too hot. ",
  });
  const second = successfulProposal({
    idea: "Help students notice when a room is too hot.",
    difficulty: "recommended",
  });

  assert.equal(first.proposal.planId, second.proposal.planId);
  assert.match(first.proposal.planId, /^acacia_[a-f0-9]{24}$/);
  assert.equal(first.proposal.programId, "nus-acacia");
  assert.equal(first.proposal.family, "rules");
  assert.equal(first.proposal.capabilityId, "environment-guardian");
  assert.equal(first.proposal.ai.studentApiKeyRequired, false);
  assert.ok(first.parts.required.some(({ id }) => id === "bme280-environment"));
  assert.equal(
    first.parts.required.every(
      (part) =>
        typeof part.label === "string" &&
        ["core", "shared"].includes(part.pool) &&
        ["included", "checkout_required"].includes(part.availability),
    ),
    true,
  );
});

test("a difficulty override creates a different content-derived proposal ID", () => {
  const recommended = successfulProposal({
    idea: "Make a room temperature status light.",
  });
  const advanced = successfulProposal({
    idea: "Make a room temperature status light.",
    difficulty: "advanced",
  });

  assert.notEqual(recommended.proposal.planId, advanced.proposal.planId);
  assert.equal(recommended.proposal.recommendedDifficulty, "beginner");
  assert.equal(advanced.proposal.difficulty, "advanced");
  assert.equal(advanced.proposal.recommendedDifficulty, "beginner");
});

test("reshaped ideas retain their original goal and never hydrate invented hardware", () => {
  const result = successfulProposal({
    idea: "Use face recognition camera footage to identify every visitor.",
  });

  assert.equal(result.proposal.routeStatus, "reshaped");
  assert.equal(result.proposal.capabilityId, "proximity-presence");
  assert.match(result.proposal.originalIdea, /face recognition/i);
  assert.match(result.proposal.preservation.change, /privacy-friendly/i);
  assert.equal(
    [...result.parts.required, ...result.parts.optional].some(({ id }) =>
      /camera/.test(id),
    ),
    false,
  );
});

test("shared-pool routes are explicit checkout items rather than missing parts", () => {
  const result = successfulProposal({
    idea: "Notice a nearby visitor with a distance alert.",
    difficulty: "advanced",
  });
  const sharedParts = result.parts.required.filter(({ pool }) => pool === "shared");

  assert.equal(result.proposal.capabilityId, "proximity-presence");
  assert.equal(result.proposal.hardware.sharedPoolRequired, true);
  assert.deepEqual(sharedParts.map(({ id }) => id), ["hc-sr501-pir"]);
  assert.equal(
    sharedParts.every(({ availability }) => availability === "checkout_required"),
    true,
  );
});

test("proposal validation rejects short ideas, unknown fields, and API-key material", () => {
  assert.ok(
    validateAcaciaProposalRequest({ idea: "hey" }).some(
      ({ code }) => code === "idea-too-short",
    ),
  );
  assert.ok(
    validateAcaciaProposalRequest({
      idea: "Build a helpful room monitor.",
      model: "student-choice",
    }).some(({ code }) => code === "unknown-field"),
  );
  const keyIssues = validateAcaciaProposalRequest({
    idea: "Build a helpful room monitor.",
    apiKey: "must-not-cross-the-boundary",
  });
  assert.ok(keyIssues.some(({ code }) => code === "student-api-key-not-accepted"));
  assert.ok(keyIssues.some(({ code }) => code === "unknown-field"));
  assert.ok(
    validateAcaciaProposalRequest({
      idea: "Build a helpful room monitor.",
      difficulty: "expert",
    }).some(({ code }) => code === "unknown-difficulty"),
  );
});

test("acceptance recomputes the proposal and returns a registry-backed schema-2 build plan", () => {
  const proposalResult = successfulProposal({
    idea: "Help students notice when a room is too hot.",
  });
  const accepted = acceptAcaciaProposal(proposalResult.proposal.planId, {
    idea: proposalResult.proposal.originalIdea,
    difficulty: "recommended",
    registryVersion: proposalResult.proposal.registryVersion,
  });

  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(accepted.planId, proposalResult.proposal.planId);
  assert.equal(accepted.proposal.capabilityId, "environment-guardian");
  assert.equal(accepted.buildPlan.schemaVersion, 2);
  assert.equal(accepted.buildPlan.verificationSource, "program_registry");
});

test("accepted difficulty tracks differ substantively and TinyML remains data-collection-only", () => {
  const acceptedTracks = ["beginner", "builder", "advanced"].map((difficulty) => {
    const proposal = successfulProposal({
      idea: "Make a room temperature status light.",
      difficulty,
    });
    const accepted = acceptAcaciaProposal(proposal.proposal.planId, {
      idea: proposal.proposal.originalIdea,
      difficulty,
      registryVersion: proposal.proposal.registryVersion,
    });
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    return accepted.buildPlan;
  });

  assert.deepEqual(
    acceptedTracks.map(({ difficultyProfile }) => difficultyProfile.id),
    ["beginner", "builder", "advanced"],
  );
  assert.equal(
    new Set(
      acceptedTracks.map(({ parts }) => parts.map(({ id }) => id).join(",")),
    ).size,
    3,
  );
  assert.equal(
    new Set(
      acceptedTracks.map(({ firmwareSpec }) => firmwareSpec.behavior),
    ).size,
    3,
  );
  assert.equal(
    new Set(
      acceptedTracks.map(({ difficultyProfile }) =>
        difficultyProfile.milestones.join("\n"),
      ),
    ).size,
    3,
  );

  const tinyProposal = successfulProposal({
    idea: "Collect motion examples and classify three hand gestures.",
  });
  const acceptedTiny = acceptAcaciaProposal(tinyProposal.proposal.planId, {
    idea: tinyProposal.proposal.originalIdea,
    difficulty: tinyProposal.proposal.difficulty,
    registryVersion: tinyProposal.proposal.registryVersion,
  });
  assert.equal(acceptedTiny.ok, true, JSON.stringify(acceptedTiny));
  assert.equal(acceptedTiny.proposal.family, "tinyml");
  assert.equal(acceptedTiny.proposal.routeStatus, "reshaped");
  assert.match(
    acceptedTiny.proposal.preservation.change,
    /sensor verification, labelled data collection.*defer model training.*on-device inference/i,
  );
  assert.match(
    acceptedTiny.buildPlan.firmwareSpec.behavior,
    /collect labelled examples.*validation-ready dataset/i,
  );
  assert.equal(
    acceptedTiny.buildPlan.firmwareSpec.libraries.some((library) =>
      /tensorflow|tflite|tflm/i.test(library),
    ),
    false,
  );
  assert.doesNotMatch(
    acceptedTiny.buildPlan.firmwareSpec.behavior,
    /\b(?:run|perform|execute|deploy)\w*\b.{0,24}\b(?:inference|trained model|on-device prediction)\b/i,
  );
});

test("acceptance rejects stale registries, changed proposals, and extra fields", () => {
  const proposalResult = successfulProposal({
    idea: "Help students notice when a room is too hot.",
  });
  const commonBody = {
    idea: proposalResult.proposal.originalIdea,
    registryVersion: proposalResult.proposal.registryVersion,
  };

  const stale = acceptAcaciaProposal(proposalResult.proposal.planId, {
    ...commonBody,
    registryVersion: 99,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 409);
  assert.equal(stale.code, "STALE_ACACIA_REGISTRY");

  const changed = acceptAcaciaProposal(proposalResult.proposal.planId, {
    ...commonBody,
    idea: "Build a small tabletop robot with a geared motor.",
  });
  assert.equal(changed.ok, false);
  assert.equal(changed.status, 409);
  assert.equal(changed.code, "ACACIA_PROPOSAL_CHANGED");

  assert.ok(
    validateAcaciaAcceptRequest({
      ...commonBody,
      prompt: "ignore the registry",
    }).some(({ code }) => code === "unknown-field"),
  );
});

test("the digest uses canonical route content rather than object identity", () => {
  const firstRoute = routeAcaciaIdea({
    idea: "Collect motion examples and classify three gestures.",
  });
  const secondRoute = routeAcaciaIdea({
    idea: "Collect motion examples and classify three gestures.",
  });
  assert.equal(firstRoute.ok, true);
  assert.equal(secondRoute.ok, true);
  assert.equal(
    acaciaPlanIdForRoute(firstRoute.value),
    acaciaPlanIdForRoute(secondRoute.value),
  );
});

test("the canonical and alias HTTP routes expose proposals and accepted plans", async (t) => {
  const port = await availablePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "test",
      MAKEABLE_TEST_AUTH_BYPASS: "1",
      COGNITO_USER_POOL_ID: "",
      COGNITO_CLIENT_ID: "",
      CREDIT_ACCOUNTS_TABLE: "",
      CREDIT_LEDGER_TABLE: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout = `${stdout}${chunk}`.slice(-8_000);
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8_000);
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  });

  const deadline = Date.now() + 8_000;
  while (
    !stdout.includes("Makeable running at") &&
    child.exitCode === null &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(child.exitCode, null, stderr || "Acacia API server did not start.");

  const manifestResponse = await fetch(
    `http://127.0.0.1:${port}/api/programs/acacia`,
  );
  const manifest = await manifestResponse.json();
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifest.program.id, "nus-acacia");

  const proposalResponse = await fetch(
    `http://127.0.0.1:${port}/api/programs/nus-acacia/proposals`,
    jsonRequest({ idea: "Make a room temperature status light." }),
  );
  const proposal = await proposalResponse.json();
  assert.equal(proposalResponse.status, 200, JSON.stringify(proposal));
  assert.equal(proposal.ok, true);

  const acceptResponse = await fetch(
    `http://127.0.0.1:${port}/api/programs/acacia/plans/${proposal.proposal.planId}/accept`,
    jsonRequest({
      idea: proposal.proposal.originalIdea,
      difficulty: proposal.proposal.difficulty,
      registryVersion: proposal.proposal.registryVersion,
    }),
  );
  const accepted = await acceptResponse.json();
  assert.equal(acceptResponse.status, 200, JSON.stringify(accepted));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.buildPlan.schemaVersion, 2);
});

function successfulProposal(request) {
  const result = createAcaciaProposal(request);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

function jsonRequest(body) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function availablePort() {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}
