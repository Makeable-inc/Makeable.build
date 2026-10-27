import assert from "node:assert/strict";
import { test } from "node:test";

process.env.MAKEABLE_STORAGE_BACKEND = "memory";

for (const name of ["api", "pipeline", "cleanup", "social-refresh", "social-link"]) {
  test(`aws/functions/${name}.mjs exports a Lambda handler`, async () => {
    const entry = await import(`../aws/functions/${name}.mjs`);
    assert.equal(typeof entry.handler, "function");
  });
}

test("api entry answers GET /api/health", async () => {
  const { handler } = await import("../aws/functions/api.mjs");
  const result = await handler({
    version: "2.0",
    rawPath: "/api/health",
    rawQueryString: "",
    headers: { host: "staging.makeable.build" },
    requestContext: { http: { method: "GET", sourceIp: "203.0.113.7" } },
    isBase64Encoded: false,
  });
  assert.equal(result.statusCode, 200);
});
