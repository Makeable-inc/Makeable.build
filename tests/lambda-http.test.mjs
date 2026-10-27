import assert from "node:assert/strict";
import { test } from "node:test";
import { toLambdaHandler, toScheduledHandler } from "../lib/aws/lambda-http.mjs";

// A Lambda Function URL event (payload format 2.0).
function urlEvent(overrides = {}) {
  return {
    version: "2.0",
    rawPath: "/api/health",
    rawQueryString: "",
    headers: { host: "staging.makeable.build" },
    requestContext: { http: { method: "GET", sourceIp: "203.0.113.7" } },
    isBase64Encoded: false,
    ...overrides,
  };
}

function capture(response = new Response("ok")) {
  const seen = {};
  const handler = async (request, context) => {
    seen.request = request;
    seen.context = context;
    seen.body = await request.text();
    return response;
  };
  return { seen, handler };
}

test("GET path and query reach the handler", async () => {
  const { seen, handler } = capture();
  const result = await toLambdaHandler(handler)(
    urlEvent({ rawPath: "/api/build-jobs/abc", rawQueryString: "x=1&y=two" }),
  );
  assert.equal(seen.request.method, "GET");
  assert.equal(seen.request.url, "https://staging.makeable.build/api/build-jobs/abc?x=1&y=two");
  assert.equal(result.statusCode, 200);
  assert.equal(result.body, "ok");
});

test("POST JSON body with emoji arrives intact", async () => {
  const { seen, handler } = capture();
  const body = JSON.stringify({ idea: "温度计 🌡️" });
  await toLambdaHandler(handler)(urlEvent({
    rawPath: "/api/build-jobs",
    headers: { host: "staging.makeable.build", "content-type": "application/json" },
    requestContext: { http: { method: "POST", sourceIp: "203.0.113.7" } },
    body,
  }));
  assert.equal(seen.request.method, "POST");
  assert.equal(seen.body, body);
});

test("base64 request body is decoded", async () => {
  const { seen, handler } = capture();
  await toLambdaHandler(handler)(urlEvent({
    requestContext: { http: { method: "POST", sourceIp: "203.0.113.7" } },
    body: Buffer.from("hello 🌱").toString("base64"),
    isBase64Encoded: true,
  }));
  assert.equal(seen.body, "hello 🌱");
});

test("event cookies become one Cookie header", async () => {
  const { seen, handler } = capture();
  await toLambdaHandler(handler)(urlEvent({ cookies: ["a=1", "makeable_builder=v1.x.y"] }));
  assert.equal(seen.request.headers.get("cookie"), "a=1; makeable_builder=v1.x.y");
});

test("two Set-Cookie headers come back as two cookies", async () => {
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", "a=1; Path=/; HttpOnly");
  headers.append("set-cookie", "b=2; Path=/; Secure");
  const { handler } = capture(new Response("{}", { headers }));
  const result = await toLambdaHandler(handler)(urlEvent());
  assert.deepEqual(result.cookies, ["a=1; Path=/; HttpOnly", "b=2; Path=/; Secure"]);
  assert.equal(result.headers["content-type"], "application/json");
  assert.equal(result.headers["set-cookie"], undefined);
});

test("PNG response is base64 and byte-exact", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0a, 0x80]);
  const { handler } = capture(new Response(png, { headers: { "content-type": "image/png" } }));
  const result = await toLambdaHandler(handler)(urlEvent());
  assert.equal(result.isBase64Encoded, true);
  assert.deepEqual(new Uint8Array(Buffer.from(result.body, "base64")), png);
});

test("spoofed client IP headers are replaced by the connection's source IP", async () => {
  const { seen, handler } = capture();
  await toLambdaHandler(handler)(urlEvent({
    headers: {
      host: "staging.makeable.build",
      "x-nf-client-connection-ip": "1.1.1.1",
      "cf-connecting-ip": "2.2.2.2",
      "x-real-ip": "3.3.3.3",
      "x-forwarded-for": "4.4.4.4",
    },
  }));
  const headers = seen.request.headers;
  assert.equal(headers.get("x-nf-client-connection-ip"), "203.0.113.7");
  assert.equal(headers.get("cf-connecting-ip"), null);
  assert.equal(headers.get("x-real-ip"), null);
});

test("behind trusted proxies, the client IP is counted from the right of x-forwarded-for", async () => {
  const { seen, handler } = capture();
  await toLambdaHandler(handler, { trustedProxyHops: 1 })(urlEvent({
    headers: { host: "staging.makeable.build", "x-forwarded-for": "1.1.1.1, 198.51.100.9" },
  }));
  assert.equal(seen.request.headers.get("x-nf-client-connection-ip"), "198.51.100.9");
});

test("waitUntil work finishes before the handler returns", async () => {
  let finished = false;
  const handler = async (_request, context) => {
    context.waitUntil(new Promise((resolve) => setTimeout(() => { finished = true; resolve(); }, 20)));
    return new Response("ok");
  };
  await toLambdaHandler(handler)(urlEvent());
  assert.equal(finished, true);
});

test("context.deploy.context comes from deployContext", async () => {
  const { seen, handler } = capture();
  await toLambdaHandler(handler, { deployContext: "production" })(urlEvent());
  assert.equal(seen.context.deploy.context, "production");
});

test("scheduled event calls the handler with a POST request and deploy context", async () => {
  const { seen, handler } = capture();
  await toScheduledHandler(handler, { deployContext: "production" })({
    source: "aws.scheduler",
    "detail-type": "Scheduled Event",
  });
  assert.equal(seen.request.method, "POST");
  assert.equal(seen.context.deploy.context, "production");
});
