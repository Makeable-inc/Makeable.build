import assert from "node:assert/strict";
import test from "node:test";

import handler from "../netlify/functions/api.mjs";

const productionOrigin = "https://makeable.build";
const backendOrigin = "https://api.makeable.test";

function installEnvironment(t, overrides = {}) {
  const previousNetlify = globalThis.Netlify;
  const previousFetch = globalThis.fetch;
  const values = {
    MAKEABLE_API_BASE_URL: backendOrigin,
    COGNITO_DOMAIN: "https://auth.makeable.test",
    COGNITO_CLIENT_ID: "client-id",
    COGNITO_REDIRECT_URI: `${productionOrigin}/pilot`,
    GOOGLE_CLIENT_ID: "google-client-id",
    ...overrides,
  };
  globalThis.Netlify = {
    env: {
      get(key) {
        return values[key] || "";
      },
    },
  };
  t.after(() => {
    globalThis.Netlify = previousNetlify;
    globalThis.fetch = previousFetch;
  });
}

test("Netlify proxies protected API requests to the metered backend", async (t) => {
  installEnvironment(t);
  let upstream;
  globalThis.fetch = async (url, options) => {
    upstream = { url: String(url), options };
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  };

  const response = await handler(
    new Request(`${productionOrigin}/api/openai/responses`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
        "X-Makeable-Generation-Id": "generation-123",
      },
      body: JSON.stringify({ input: "test" }),
    }),
  );

  assert.equal(upstream.url, `${backendOrigin}/api/openai/responses`);
  assert.equal(upstream.options.headers.get("Authorization"), "Bearer test-token");
  assert.equal(upstream.options.headers.get("X-Makeable-Generation-Id"), "generation-123");
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Authentication required" });
});

test("production config keeps the pilot callback while using backend capabilities", async (t) => {
  installEnvironment(t);
  globalThis.fetch = async (url) => {
    assert.equal(String(url), `${backendOrigin}/api/config`);
    return Response.json({
      hasAccounts: true,
      hasVoice: true,
      firmwareCompileSupported: true,
      cognitoRedirectUri: `${productionOrigin}/`,
      supportedBoards: [{ id: "esp32", label: "ESP32" }],
    });
  };

  const response = await handler(new Request(`${productionOrigin}/api/config`));
  const config = await response.json();

  assert.equal(response.status, 200);
  assert.equal(config.apiBaseUrl, backendOrigin);
  assert.equal(config.cognitoRedirectUri, `${productionOrigin}/pilot`);
  assert.equal(config.googleClientId, "google-client-id");
  assert.equal(config.hasGoogleSignIn, true);
  assert.equal(config.hasAccounts, true);
  assert.equal(config.firmwareCompileSupported, true);
  assert.deepEqual(config.supportedBoards, [{ id: "esp32", label: "ESP32" }]);
});

test("landing acquisition routes are reserved locally instead of reaching the AWS proxy", async (t) => {
  installEnvironment(t, { GOOGLE_CLIENT_ID: "" });
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("The AWS proxy should not be called");
  };

  const waitlistResponse = await handler(
    new Request(`${productionOrigin}/api/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    }),
  );
  const googleResponse = await handler(
    new Request(`${productionOrigin}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: "test", intent: "waitlist" }),
    }),
  );
  const statusResponse = await handler(
    new Request(`${productionOrigin}/api/waitlist/status`, { method: "GET" }),
    { deploy: { context: "production" } },
  );

  assert.equal(waitlistResponse.status, 410);
  assert.deepEqual(await waitlistResponse.json(), {
    error: "Email-only waitlist signup is disabled.",
  });
  assert.equal(googleResponse.status, 503);
  assert.deepEqual(await googleResponse.json(), { error: "Google sign-in is not configured." });
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), { joined: false });
  assert.equal(statusResponse.headers.get("Cache-Control"), "no-store");
  assert.equal(fetchCalls, 0);
});

test("Ember checkout is handled locally and creates a Stripe Checkout session", async (t) => {
  installEnvironment(t, { STRIPE_SECRET_KEY: "sk_test_local" });
  let stripeRequest;
  globalThis.fetch = async (url, options) => {
    stripeRequest = { url: String(url), options };
    return Response.json({ url: "https://checkout.stripe.test/session" });
  };

  const response = await handler(
    new Request(`${productionOrigin}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ termsAccepted: true, quantity: 2 }),
    }),
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(result, { url: "https://checkout.stripe.test/session" });
  assert.equal(stripeRequest.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(stripeRequest.options.headers.Authorization, "Bearer sk_test_local");
  assert.equal(stripeRequest.options.body.get("line_items[0][price_data][currency]"), "usd");
  assert.equal(stripeRequest.options.body.get("line_items[0][price_data][unit_amount]"), "3499");
  assert.equal(
    stripeRequest.options.body.get("line_items[0][price_data][product_data][name]"),
    "Makeable Ember — Beige",
  );
  assert.equal(
    stripeRequest.options.body.get("line_items[0][price_data][product_data][description]"),
    "Token-burner desk pet. Easy-to-assemble kit, USB-C cable included.",
  );
  assert.equal(stripeRequest.options.body.get("line_items[0][quantity]"), "2");
  assert.equal(stripeRequest.options.body.get("metadata[quantity]"), "2");
  assert.equal(stripeRequest.options.body.get("metadata[terms_accepted]"), "true");
  assert.equal(stripeRequest.options.body.get("metadata[privacy_acknowledged]"), "true");
  assert.equal(stripeRequest.options.body.get("metadata[marketing_consent]"), "false");
  assert.equal(stripeRequest.options.body.get("metadata[consent_source]"), "makeable_web_preorder");
  assert.match(stripeRequest.options.body.get("metadata[consent_recorded_at]"), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(stripeRequest.options.body.get("payment_intent_data[metadata][terms_accepted]"), "true");
  assert.equal(stripeRequest.options.body.get("payment_intent_data[metadata][privacy_acknowledged]"), "true");
  assert.equal(stripeRequest.options.body.get("payment_intent_data[metadata][marketing_consent]"), "false");
  assert.equal(stripeRequest.options.body.get("payment_intent_data[metadata][consent_source]"), "makeable_web_preorder");
  assert.equal(stripeRequest.options.body.get("shipping_options[0][shipping_rate_data][fixed_amount][amount]"), "0");
  assert.equal(stripeRequest.options.body.get("shipping_options[0][shipping_rate_data][fixed_amount][currency]"), "usd");
  assert.equal(stripeRequest.options.body.get("shipping_options[0][shipping_rate_data][display_name]"), "Free shipping");
  assert.equal(
    stripeRequest.options.body.get("custom_text[shipping_address][message]"),
    "Pre-orders are expected to ship in October 2026.",
  );
  assert.equal(stripeRequest.options.body.get("customer_creation"), "always");
  assert.equal(stripeRequest.options.body.get("billing_address_collection"), "required");
  assert.deepEqual(
    stripeRequest.options.body.getAll("shipping_address_collection[allowed_countries][]"),
    ["US", "SG"],
  );
  assert.equal(stripeRequest.options.body.get("phone_number_collection[enabled]"), "true");
  assert.equal(stripeRequest.options.body.get("name_collection[individual][enabled]"), "true");
  assert.equal(
    stripeRequest.options.body.get("success_url"),
    `${productionOrigin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
  );
});

test("Ember checkout completion is verified with Stripe before confirming payment", async (t) => {
  installEnvironment(t, { STRIPE_SECRET_KEY: "sk_test_local" });
  const sessionId = "cs_test_1234567890abcdefghijkl";
  let stripeRequest;
  globalThis.fetch = async (url, options) => {
    stripeRequest = { url: String(url), options };
    return Response.json({
      id: sessionId,
      status: "complete",
      payment_status: "paid",
      metadata: { ember_color: "bone", market: "US" },
    });
  };

  const response = await handler(
    new Request(`${productionOrigin}/api/checkout/status?session_id=${sessionId}`),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { paid: true });
  assert.equal(
    stripeRequest.url,
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
  );
  assert.equal(stripeRequest.options.headers.Authorization, "Bearer sk_test_local");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("Ember checkout completion rejects invalid session identifiers without calling Stripe", async (t) => {
  installEnvironment(t, { STRIPE_SECRET_KEY: "sk_test_local" });
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Stripe should not be called");
  };

  const response = await handler(
    new Request(`${productionOrigin}/api/checkout/status?session_id=not-a-session`),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid checkout session." });
  assert.equal(fetchCalls, 0);
});

test("Ember checkout uses fixed Singapore pricing for Singapore orders", async (t) => {
  installEnvironment(t, { STRIPE_SECRET_KEY: "sk_test_local" });
  let stripeRequest;
  globalThis.fetch = async (url, options) => {
    stripeRequest = { url: String(url), options };
    return Response.json({ url: "https://checkout.stripe.test/session" });
  };

  const response = await handler(
    new Request(`${productionOrigin}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        color: "sage",
        market: "SG",
        quantity: 4,
        termsAccepted: true,
        marketingConsent: true,
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(stripeRequest.options.body.get("line_items[0][price_data][currency]"), "sgd");
  assert.equal(stripeRequest.options.body.get("line_items[0][price_data][unit_amount]"), "4499");
  assert.equal(stripeRequest.options.body.get("line_items[0][quantity]"), "4");
  assert.equal(stripeRequest.options.body.get("metadata[market]"), "SG");
  assert.equal(stripeRequest.options.body.get("metadata[marketing_consent]"), "true");
  assert.equal(stripeRequest.options.body.get("payment_intent_data[metadata][marketing_consent]"), "true");
  assert.equal(stripeRequest.options.body.get("shipping_options[0][shipping_rate_data][fixed_amount][currency]"), "sgd");
  assert.deepEqual(
    stripeRequest.options.body.getAll("shipping_address_collection[allowed_countries][]"),
    ["US", "SG"],
  );
});

test("Ember checkout requires legal consent and validates order quantity before Stripe", async (t) => {
  installEnvironment(t, { STRIPE_SECRET_KEY: "sk_test_local" });
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Stripe should not be called");
  };

  const missingConsent = await handler(
    new Request(`${productionOrigin}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: 2 }),
    }),
  );
  const invalidQuantity = await handler(
    new Request(`${productionOrigin}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: 11, termsAccepted: true }),
    }),
  );

  assert.equal(missingConsent.status, 400);
  assert.deepEqual(await missingConsent.json(), {
    error: "Agree to the Terms and acknowledge the Privacy Policy to continue.",
  });
  assert.equal(invalidQuantity.status, 400);
  assert.deepEqual(await invalidQuantity.json(), {
    error: "Choose a quantity between 1 and 10.",
  });
  assert.equal(fetchCalls, 0);
});

test("Make a Build interest endpoint validates email before durable storage", async (t) => {
  installEnvironment(t);
  const malformed = await handler(
    new Request(`${productionOrigin}/api/build-interest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    }),
  );
  const unsupported = await handler(
    new Request(`${productionOrigin}/api/build-interest`, { method: "GET" }),
  );

  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "Enter a valid email address." });
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get("Allow"), "POST");
});

test("Ember checkout fails closed when Stripe is unavailable or the method is unsupported", async (t) => {
  installEnvironment(t, { STRIPE_SECRET_KEY: "" });
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Stripe should not be called");
  };

  const unavailable = await handler(
    new Request(`${productionOrigin}/api/checkout`, { method: "POST" }),
  );
  const unsupported = await handler(
    new Request(`${productionOrigin}/api/checkout`, { method: "GET" }),
  );

  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: "Pre-orders are opening soon." });
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get("Allow"), "POST");
  assert.equal(fetchCalls, 0);
});

test("waitlist browser confirmation routes are private, resettable, and never proxied", async (t) => {
  installEnvironment(t);
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("The AWS proxy should not be called");
  };

  const malformed = await handler(
    new Request(`${productionOrigin}/api/waitlist/status`, {
      headers: { Cookie: "__Host-makeable_waitlist=malformed" },
    }),
    { deploy: { context: "production" } },
  );
  assert.deepEqual(await malformed.json(), { joined: false });
  assert.match(malformed.headers.get("Set-Cookie"), /Max-Age=0/);

  const reset = await handler(
    new Request(`${productionOrigin}/api/waitlist/status`, { method: "DELETE" }),
    { deploy: { context: "production" } },
  );
  assert.deepEqual(await reset.json(), { ok: true });
  assert.match(reset.headers.get("Set-Cookie"), /HttpOnly/);

  const unsupported = await handler(
    new Request(`${productionOrigin}/api/waitlist/status`, { method: "POST" }),
  );
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get("Allow"), "GET, DELETE");
  assert.equal(fetchCalls, 0);
});

test("landing acquisition rejects oversized request bodies", async (t) => {
  installEnvironment(t);
  const response = await handler(
    new Request(`${productionOrigin}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: "a".repeat(21 * 1024), intent: "waitlist" }),
    }),
  );
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "Request body is too large." });
});

test("dashboard routes stay private and issue signed owner sessions", async (t) => {
  const dashboardAccessKey = "neuraldrive";
  installEnvironment(t, {
    DASHBOARD_ACCESS_KEY: dashboardAccessKey,
    DASHBOARD_SESSION_SECRET:
      "dashboard-session-secret-with-at-least-32-characters",
  });
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Dashboard routes must never reach the AWS proxy");
  };

  const unauthorized = await handler(
    new Request(`${productionOrigin}/api/dashboard`),
  );
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), {
    error: "Dashboard authentication required.",
  });

  const wrongKey = await handler(
    new Request(`${productionOrigin}/api/dashboard/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessKey: `${dashboardAccessKey}-wrong` }),
    }),
  );
  assert.equal(wrongKey.status, 401);

  const login = await handler(
    new Request(`${productionOrigin}/api/dashboard/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessKey: dashboardAccessKey }),
    }),
  );
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { authenticated: true });
  const cookie = login.headers.get("Set-Cookie");
  assert.match(cookie, /^__Host-makeable_dashboard=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);

  const status = await handler(
    new Request(`${productionOrigin}/api/dashboard/session`, {
      headers: { Cookie: cookie.split(";")[0] },
    }),
  );
  assert.deepEqual(await status.json(), { authenticated: true });

  const exportWithoutSession = await handler(
    new Request(`${productionOrigin}/api/dashboard/export`),
  );
  assert.equal(exportWithoutSession.status, 401);

  const logout = await handler(
    new Request(`${productionOrigin}/api/dashboard/session`, {
      method: "DELETE",
      headers: { Cookie: cookie.split(";")[0] },
    }),
  );
  assert.deepEqual(await logout.json(), { ok: true });
  assert.match(logout.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.equal(fetchCalls, 0);
});

test("dashboard routes fail closed when private access is not configured", async (t) => {
  installEnvironment(t, {
    DASHBOARD_ACCESS_KEY: "",
    DASHBOARD_SESSION_SECRET: "",
  });
  const response = await handler(
    new Request(`${productionOrigin}/api/dashboard/session`),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Dashboard access is not configured.",
  });
});

test("Google acquisition rejects null bodies and unsupported methods without proxying", async (t) => {
  installEnvironment(t);
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("The AWS proxy should not be called");
  };

  const nullResponse = await handler(
    new Request(`${productionOrigin}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    }),
  );
  const getResponse = await handler(
    new Request(`${productionOrigin}/api/auth/google`, { method: "GET" }),
  );
  const manualGetResponse = await handler(
    new Request(`${productionOrigin}/api/waitlist`, { method: "GET" }),
  );

  assert.equal(nullResponse.status, 400);
  assert.deepEqual(await nullResponse.json(), {
    error: "Google sign-in request is invalid.",
  });
  assert.equal(getResponse.status, 405);
  assert.equal(getResponse.headers.get("Allow"), "POST");
  assert.equal(manualGetResponse.status, 410);
  assert.equal(fetchCalls, 0);
});

test("acquisition route variants cannot fall through to the AWS proxy", async (t) => {
  installEnvironment(t);
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("The AWS proxy should not be called");
  };

  for (const pathname of [
    "/api/waitlist/",
    "/api/waitlist.html",
    "/api/waitlist/status/",
    "/api/waitlist/status.html",
    "/api/auth/google/",
    "/api/auth/google.html",
  ]) {
    const response = await handler(
      new Request(`${productionOrigin}${pathname}`, { method: "GET" }),
    );
    assert.equal(
      response.status,
      pathname.includes("waitlist/status")
        ? 200
        : pathname.includes("auth/google")
          ? 405
          : 410,
    );
  }
  assert.equal(fetchCalls, 0);
});

test("Netlify passes CORS preflights through without adding a body to 204 responses", async (t) => {
  installEnvironment(t);
  let upstream;
  globalThis.fetch = async (url, options) => {
    upstream = { url: String(url), options };
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": productionOrigin,
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Makeable-Generation-Id",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        Vary: "Origin",
      },
    });
  };

  const response = await handler(
    new Request(`${productionOrigin}/api/openai/responses`, {
      method: "OPTIONS",
      headers: {
        Origin: productionOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers":
          "authorization,content-type,x-makeable-generation-id",
      },
    }),
  );

  assert.equal(upstream.url, `${backendOrigin}/api/openai/responses`);
  assert.equal(upstream.options.headers.get("Origin"), productionOrigin);
  assert.equal(upstream.options.headers.get("Access-Control-Request-Method"), "POST");
  assert.equal(
    upstream.options.headers.get("Access-Control-Request-Headers"),
    "authorization,content-type,x-makeable-generation-id",
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), productionOrigin);
  assert.equal(await response.text(), "");
});
