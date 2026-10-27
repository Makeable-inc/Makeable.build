import assert from "node:assert/strict";
import { test } from "node:test";
import { backgroundDispatchFetch, createLambdaInvokeFetch } from "../lib/aws/background-invoke.mjs";
import { toBackgroundEventHandler } from "../lib/aws/lambda-http.mjs";
import { verifyBackgroundBuildSignature } from "../lib/build-jobs.mjs";
import { invokeBackgroundBuildJob } from "../netlify/functions/api.mjs";

const JOB_ID = "job_1234567890123456789012";
const lambdaEnv = {
  MAKEABLE_BACKGROUND_SECRET: "x".repeat(32),
  MAKEABLE_BUILD_DISPATCH: "lambda",
  MAKEABLE_PIPELINE_FUNCTION: "pipeline-fn",
};

function fakeLambdaClient(reply = { StatusCode: 202 }) {
  const sent = [];
  return {
    sent,
    async send(command) {
      sent.push(command);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

test("lambda dispatch invokes the pipeline once with InvocationType Event", async () => {
  const client = fakeLambdaClient();
  const fetchFn = createLambdaInvokeFetch({ client, functionName: "pipeline-fn" });
  const response = await fetchFn(new URL("https://staging.makeable.build/.netlify/functions/build-background"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Makeable-Background-Timestamp": "2026-10-27T00:00:00.000Z",
      "X-Makeable-Background-Signature": "sig",
    },
    body: JSON.stringify({ jobId: "job_abc" }),
  });
  assert.equal(response.status, 202);
  assert.equal(client.sent.length, 1);
  const { input } = client.sent[0];
  assert.equal(input.FunctionName, "pipeline-fn");
  assert.equal(input.InvocationType, "Event");
  assert.deepEqual(JSON.parse(Buffer.from(input.Payload).toString("utf8")), {
    jobId: "job_abc",
    timestamp: "2026-10-27T00:00:00.000Z",
    signature: "sig",
  });
});

test("with MAKEABLE_BUILD_DISPATCH=lambda the API hands the build to the pipeline Lambda with a valid signature", async () => {
  const lambdaClient = fakeLambdaClient();
  const result = await invokeBackgroundBuildJob(
    new Request("https://staging.makeable.build/api/build-jobs"),
    lambdaEnv,
    JOB_ID,
    backgroundDispatchFetch(lambdaEnv, { lambdaClient }),
  );
  assert.equal(result.ok, true);
  const { input } = lambdaClient.sent[0];
  assert.equal(input.FunctionName, "pipeline-fn");
  const payload = JSON.parse(Buffer.from(input.Payload).toString("utf8"));
  assert.equal(verifyBackgroundBuildSignature(lambdaEnv, payload.jobId, payload.timestamp, payload.signature), true);
});

test("a failed Lambda invoke is reported, not swallowed", async () => {
  for (const reply of [new Error("AccessDenied"), { StatusCode: 500 }]) {
    const result = await invokeBackgroundBuildJob(
      new Request("https://staging.makeable.build/api/build-jobs"),
      lambdaEnv,
      JOB_ID,
      backgroundDispatchFetch(lambdaEnv, { lambdaClient: fakeLambdaClient(reply) }),
    );
    assert.equal(result.ok, false);
    assert.ok(result.error);
  }
});

test("without MAKEABLE_BUILD_DISPATCH the API keeps using fetch (Netlify)", () => {
  assert.equal(backgroundDispatchFetch({}), globalThis.fetch);
});

test("background event reaches the handler as a signed request that verifies", async () => {
  const lambdaClient = fakeLambdaClient();
  await invokeBackgroundBuildJob(
    new Request("https://staging.makeable.build/api/build-jobs"),
    lambdaEnv,
    JOB_ID,
    backgroundDispatchFetch(lambdaEnv, { lambdaClient }),
  );
  const event = JSON.parse(Buffer.from(lambdaClient.sent[0].input.Payload).toString("utf8"));
  let seen;
  await toBackgroundEventHandler(async (request, context) => {
    seen = { request, body: await request.json(), context };
    return new Response("{}", { status: 200 });
  }, { deployContext: "staging" })(event);
  assert.equal(seen.request.method, "POST");
  assert.equal(seen.body.jobId, JOB_ID);
  assert.equal(seen.context.deploy.context, "staging");
  assert.equal(verifyBackgroundBuildSignature(
    lambdaEnv,
    seen.body.jobId,
    seen.request.headers.get("x-makeable-background-timestamp"),
    seen.request.headers.get("x-makeable-background-signature"),
  ), true);
});

test("background event with a bad signature is rejected by the real pipeline handler", async () => {
  const { default: buildBackground } = await import("../netlify/functions/build-background.mjs");
  const result = await toBackgroundEventHandler(buildBackground)({
    jobId: JOB_ID,
    timestamp: new Date().toISOString(),
    signature: "forged",
  });
  assert.equal(result.statusCode, 401);
});
