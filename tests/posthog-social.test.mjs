import assert from "node:assert/strict";
import test from "node:test";

import { readSocialWebsiteSessions } from "../lib/posthog-social.mjs";

test("PostHog attribution stays disconnected without server credentials", async () => {
  // Given: neither private PostHog credential is configured.
  let calls = 0;

  // When: the dashboard requests social attribution.
  const result = await readSocialWebsiteSessions({
    personalApiKey: "",
    projectId: "",
    fetchImpl: async () => {
      calls += 1;
    },
  });

  // Then: no external request is attempted.
  assert.deepEqual(result, { status: "not_connected", daily: [] });
  assert.equal(calls, 0);
});

test("PostHog attribution returns only normalized daily session aggregates", async () => {
  // Given: a valid PostHog query response containing one aggregate row.
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return Response.json({
      results: [["2026-08-26", "instagram", "makeable_zak", 3]],
    });
  };

  // When: the server reads website-session attribution.
  const result = await readSocialWebsiteSessions({
    personalApiKey: "phx_test_secret",
    projectId: "12345",
    fetchImpl,
  });

  // Then: the request is bounded and the response exposes only normalized aggregates.
  assert.equal(request.url, "https://us.posthog.com/api/projects/12345/query/");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer phx_test_secret");
  assert.equal(request.options.headers["Content-Type"], "application/json");
  const body = JSON.parse(request.options.body);
  assert.equal(body.query.kind, "HogQLQuery");
  assert.match(body.query.query, /event = 'social_landing_view'/);
  assert.match(body.query.query, /uniqExact\(properties\['\$session_id'\]\)/);
  assert.deepEqual(result, {
    status: "connected",
    daily: [{
      date: "2026-08-26",
      platform: "instagram",
      accountKey: "makeable_zak",
      websiteSessions: 3,
    }],
  });
});

test("PostHog attribution rejects unsafe project identifiers without fetching", async () => {
  // Given: a project identifier that could alter the request path.
  let calls = 0;

  // When: the server attempts to construct the PostHog request.
  const result = await readSocialWebsiteSessions({
    personalApiKey: "phx_test_secret",
    projectId: "12345/../../capture",
    fetchImpl: async () => {
      calls += 1;
    },
  });

  // Then: the boundary fails closed before making a request.
  assert.deepEqual(result, { status: "unavailable", daily: [] });
  assert.equal(calls, 0);
});

test("PostHog attribution rejects incomplete paginated aggregates", async () => {
  // Given: PostHog reports that more aggregate rows are available.
  const fetchImpl = async () => Response.json({
    results: [["2026-08-26", "instagram", "makeable_zak", 3]],
    hasMore: true,
  });

  // When: the server reads the first incomplete result page.
  const result = await readSocialWebsiteSessions({
    personalApiKey: "phx_test_secret",
    projectId: "12345",
    fetchImpl,
  });

  // Then: partial aggregates are never presented as a connected result.
  assert.deepEqual(result, { status: "unavailable", daily: [] });
});

test("PostHog attribution aborts a stalled request within its timeout", async () => {
  // Given: an upstream request that settles only when its signal is aborted.
  let requestSignal;
  const fetchImpl = async (_url, options) => new Promise((resolve, reject) => {
    requestSignal = options.signal;
    requestSignal?.addEventListener("abort", () => reject(requestSignal.reason), {
      once: true,
    });
  });

  // When: the configured request timeout expires.
  const result = await Promise.race([
    readSocialWebsiteSessions({
      personalApiKey: "phx_test_secret",
      projectId: "12345",
      fetchImpl,
      timeoutMs: 5,
    }),
    new Promise((resolve) => setTimeout(() => resolve("request remained pending"), 100)),
  ]);

  // Then: the service fails closed without exposing the abort error.
  assert.deepEqual(result, { status: "unavailable", daily: [] });
  assert.equal(requestSignal instanceof AbortSignal, true);
  assert.equal(requestSignal.aborted, true);
});

test("PostHog attribution hides network, HTTP, and schema failures", async (t) => {
  const cases = [
    {
      name: "network failure",
      fetchImpl: async () => {
        throw new Error("request included phx_private_value");
      },
    },
    {
      name: "HTTP failure",
      fetchImpl: async () => new Response("upstream error", { status: 503 }),
    },
    {
      name: "invalid response object",
      fetchImpl: async () => Response.json({ results: "not rows" }),
    },
    {
      name: "invalid JSON",
      fetchImpl: async () => new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    },
    {
      name: "invalid aggregate date",
      fetchImpl: async () => Response.json({
        results: [["2026-02-30", "instagram", "makeable_zak", 1]],
      }),
    },
    {
      name: "unsupported aggregate platform",
      fetchImpl: async () => Response.json({
        results: [["2026-08-26", "email", "makeable_zak", 1]],
      }),
    },
    {
      name: "invalid aggregate account key",
      fetchImpl: async () => Response.json({
        results: [["2026-08-26", "instagram", "../../secret", 1]],
      }),
    },
    {
      name: "invalid aggregate session count",
      fetchImpl: async () => Response.json({
        results: [["2026-08-26", "instagram", "makeable_zak", -1]],
      }),
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      // Given: a configured integration and one failing upstream boundary.
      // When: the server reads attribution.
      const result = await readSocialWebsiteSessions({
        personalApiKey: "phx_private_value",
        projectId: "12345",
        fetchImpl: fixture.fetchImpl,
      });

      // Then: no upstream detail or credential reaches the report.
      assert.deepEqual(result, { status: "unavailable", daily: [] });
      assert.doesNotMatch(JSON.stringify(result), /phx_private_value/);
    });
  }
});
