import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

let sharedLambdaClient;

// Netlify starts background builds over HTTP; on AWS the API invokes the
// pipeline Lambda directly (MAKEABLE_BUILD_DISPATCH=lambda).
export function backgroundDispatchFetch(env, { lambdaClient } = {}) {
  if (env.MAKEABLE_BUILD_DISPATCH !== "lambda") return globalThis.fetch;
  const client = lambdaClient || (sharedLambdaClient ??= new LambdaClient({}));
  return createLambdaInvokeFetch({ client, functionName: env.MAKEABLE_PIPELINE_FUNCTION });
}

// A fetch-shaped function that starts the pipeline Lambda without waiting for
// it, so invokeBackgroundBuildJob keeps its signed-request logic unchanged.
export function createLambdaInvokeFetch({ client, functionName }) {
  return async (_url, init = {}) => {
    const headers = new Headers(init.headers);
    const { jobId } = JSON.parse(init.body || "{}");
    const result = await client.send(new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify({
        jobId,
        timestamp: headers.get("x-makeable-background-timestamp") || "",
        signature: headers.get("x-makeable-background-signature") || "",
      })),
    }));
    return new Response(null, { status: result.StatusCode || 500 });
  };
}
