import assert from "node:assert/strict";
import { test } from "node:test";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { builderSessionStoreNameForFunctionContext, createBuilderSession } from "../lib/builder-session.mjs";
import { verifyBackgroundBuildSignature } from "../lib/build-jobs.mjs";
import { openStore } from "../lib/storage/index.mjs";

const awsEnv = {
  MAKEABLE_STORAGE_BACKEND: "memory",
  MAKEABLE_DEPLOY_CONTEXT: "staging",
  MAKEABLE_PUBLIC_ORIGIN: "https://staging.makeable.build",
  MAKEABLE_DRAFT_COOKIE_SECRET: "d".repeat(32),
  MAKEABLE_BACKGROUND_SECRET: "b".repeat(32),
  MAKEABLE_TRUSTED_PROXY_HOPS: "0",
  MAKEABLE_BUILD_DISPATCH: "lambda",
  MAKEABLE_PIPELINE_FUNCTION: "makeable-pipeline-staging",
};
Object.assign(process.env, awsEnv);

function urlEvent(overrides = {}) {
  return {
    version: "2.0",
    rawPath: "/api/health",
    rawQueryString: "",
    headers: { host: "abc123.lambda-url.us-east-1.on.aws" },
    requestContext: { http: { method: "GET", sourceIp: "203.0.113.7" } },
    isBase64Encoded: false,
    ...overrides,
  };
}

for (const name of ["api", "pipeline", "cleanup", "social-refresh"]) {
  test(`aws/functions/${name}.mjs exports a Lambda handler`, async () => {
    const entry = await import(`../aws/functions/${name}.mjs`);
    assert.equal(typeof entry.handler, "function");
  });
}

test("api entry answers GET /api/health", async () => {
  const { handler } = await import("../aws/functions/api.mjs");
  const result = await handler(urlEvent());
  assert.equal(result.statusCode, 200);
});

test("a signed-in build start through the api entry invokes the pipeline Lambda with a valid signature", async () => {
  const invokes = [];
  const realSend = LambdaClient.prototype.send;
  LambdaClient.prototype.send = async function send(command) {
    invokes.push(command.input);
    return { StatusCode: 202 };
  };
  try {
    const sessionStore = openStore({
      name: builderSessionStoreNameForFunctionContext({ deploy: { context: "staging" } }),
    });
    const session = await createBuilderSession(sessionStore, {
      sub: "aws-entry-test-user",
      email: "aws-entry-test@example.com",
      name: "AWS Entry Test",
    });
    const { handler } = await import("../aws/functions/api.mjs");
    const result = await handler(urlEvent({
      rawPath: "/api/build-jobs",
      headers: {
        host: "abc123.lambda-url.us-east-1.on.aws",
        origin: "https://staging.makeable.build",
        "content-type": "application/json",
      },
      cookies: [session.cookie.split(";")[0]],
      requestContext: { http: { method: "POST", sourceIp: "203.0.113.7" } },
      body: JSON.stringify({
        idea: "A desk thermometer that shows room temperature and humidity on a small OLED screen",
        requestId: "req_awsentrytest0000000001",
      }),
    }));
    assert.equal(result.statusCode, 202, result.body);
    assert.equal(invokes.length, 1);
    assert.equal(invokes[0].FunctionName, "makeable-pipeline-staging");
    assert.equal(invokes[0].InvocationType, "Event");
    const payload = JSON.parse(Buffer.from(invokes[0].Payload).toString("utf8"));
    assert.equal(JSON.parse(result.body).job.id, payload.jobId);
    assert.equal(verifyBackgroundBuildSignature(awsEnv, payload.jobId, payload.timestamp, payload.signature), true);
  } finally {
    LambdaClient.prototype.send = realSend;
  }
});
