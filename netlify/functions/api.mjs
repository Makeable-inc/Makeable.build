import { getStore } from "@netlify/blobs";
import { OAuth2Client } from "google-auth-library";
import { createHash } from "node:crypto";
import { createGoogleWaitlistResult } from "../../lib/acquisition.mjs";
import {
  clearDashboardSessionCookie,
  createDashboardSessionCookie,
  dashboardAccessConfigured,
  dashboardSessionState,
  verifyDashboardAccessKey,
} from "../../lib/dashboard-auth.mjs";
import {
  persistVerifiedWaitlistRecord,
  waitlistStoreNameForFunctionContext,
} from "../../lib/waitlist-storage.mjs";
import {
  readVerifiedWaitlist,
  waitlistCsv,
} from "../../lib/waitlist-report.mjs";
import {
  clearWaitlistSessionCookie,
  createWaitlistSession,
  forgetWaitlistSession,
  resolveWaitlistSession,
  waitlistSessionCookieState,
  waitlistSessionStoreNameForFunctionContext,
} from "../../lib/waitlist-session.mjs";

const googleVerifiers = new Map();

export default async function handler(req, context = {}) {
  try {
    const url = new URL(req.url);
    const env = getEnv();
    const localApiPath = normalizedLocalApiPath(url.pathname);

    if (url.pathname === "/config.local.js") {
      return textResponse(publicConfigScript(env), "text/javascript; charset=utf-8");
    }

    if (url.pathname === "/api/config") {
      return jsonResponse(await resolvedPublicConfig(env));
    }

    if (localApiPath === "/api/checkout") {
      return await createEmberCheckout(req, env);
    }

    if (localApiPath === "/api/checkout/status") {
      return await emberCheckoutStatus(req, env);
    }

    if (localApiPath === "/api/build-interest") {
      return await saveBuildInterest(req, context);
    }

    if (localApiPath === "/api/dashboard/session") {
      return await dashboardSession(req, env);
    }

    if (localApiPath === "/api/dashboard/export") {
      return await dashboardExport(req, env, context);
    }

    if (localApiPath === "/api/dashboard") {
      return await dashboardData(req, env, context);
    }

    if (localApiPath === "/api/waitlist/status") {
      if (!new Set(["GET", "DELETE"]).has(req.method)) {
        return jsonResponse({ error: "Method not allowed" }, 405, {
          Allow: "GET, DELETE",
          "Cache-Control": "no-store",
        });
      }
      if (req.method === "DELETE") return await forgetBrowserConfirmation(req, context);
      return await waitlistStatus(req, context);
    }

    if (localApiPath === "/api/waitlist") {
      return jsonResponse({ error: "Email-only waitlist signup is disabled." }, 410, {
        "Cache-Control": "no-store",
      });
    }

    if (localApiPath === "/api/auth/google") {
      if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405, {
          Allow: "POST",
          "Cache-Control": "no-store",
        });
      }
      return await completeGoogleWaitlist(req, env, context);
    }

    if (url.pathname.startsWith("/api/")) {
      return await proxyMakeableApi(req, env);
    }

    return jsonResponse({ error: "Not found" }, 404);
  } catch (error) {
    const status =
      Number.isInteger(error?.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 500;
    if (status === 500) console.error(error);
    return jsonResponse(
      {
        error:
          status === 500
            ? "The Makeable server could not complete the request."
            : String(error.message || error),
      },
      status,
    );
  }
}

export const config = {
  path: ["/config.local.js", "/api/*"],
};

const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";
const DEFAULT_OPENAI_REASONING_EFFORT = "xhigh";
const DEFAULT_OPENAI_SERVICE_TIER = "priority";

function getEnv() {
  const keys = [
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "OPENAI_REASONING_MODEL",
    "OPENAI_REASONING_EFFORT",
    "OPENAI_SERVICE_TIER",
    "GITHUB_TOKEN",
    "GITHUB_OWNER",
    "MAKEABLE_API_BASE_URL",
    "COGNITO_DOMAIN",
    "COGNITO_CLIENT_ID",
    "COGNITO_REDIRECT_URI",
    "GOOGLE_CLIENT_ID",
    "WAITLIST_WEBHOOK_URL",
    "WAITLIST_WEBHOOK_SECRET",
    "DASHBOARD_ACCESS_KEY",
    "DASHBOARD_SESSION_SECRET",
    "STRIPE_SECRET_KEY",
  ];
  return Object.fromEntries(keys.map((key) => [key, envValue(key)]));
}

function envValue(key) {
  return globalThis.Netlify?.env?.get(key) || process.env[key] || "";
}

function normalizedLocalApiPath(pathname) {
  let normalized = pathname.replace(/\/+$/, "");
  if (normalized.endsWith(".html")) normalized = normalized.slice(0, -5);
  return normalized;
}

async function createEmberCheckout(req, env) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: "POST",
      "Cache-Control": "no-store",
    });
  }
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({ error: "Pre-orders are opening soon." }, 503, {
      "Cache-Control": "no-store",
    });
  }

  const origin = new URL(req.url).origin;
  const allowedColors = new Set(["sage", "bone", "blush"]);
  const checkoutMarkets = {
    US: { currency: "usd", unitAmount: "4999" },
    SG: { currency: "sgd", unitAmount: "5999" },
  };
  let selectedColor = "bone";
  let selectedMarket = "US";
  try {
    const requestBody = await req.json();
    if (allowedColors.has(requestBody?.color)) selectedColor = requestBody.color;
    if (Object.hasOwn(checkoutMarkets, requestBody?.market)) selectedMarket = requestBody.market;
  } catch {
    // Preserve the default color and market for requests without a JSON body.
  }
  const colorLabels = {
    sage: "Sage",
    bone: "Beige",
    blush: "Sakura",
  };
  const colorLabel = colorLabels[selectedColor];
  const market = checkoutMarkets[selectedMarket];
  const body = new URLSearchParams({
    mode: "payment",
    customer_creation: "always",
    billing_address_collection: "required",
    "phone_number_collection[enabled]": "true",
    "name_collection[individual][enabled]": "true",
    "name_collection[individual][optional]": "false",
    "line_items[0][price_data][currency]": market.currency,
    "line_items[0][price_data][unit_amount]": market.unitAmount,
    "line_items[0][price_data][product_data][name]": `Makeable Ember -- ${colorLabel}`,
    "line_items[0][price_data][product_data][description]":
      "Desk pet kit display with USB-C",
    "line_items[0][quantity]": "1",
    "metadata[ember_color]": selectedColor,
    "metadata[market]": selectedMarket,
    success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?checkout=cancelled`,
    integration_identifier: "makeable_ember_qtmsvkwp",
  });
  body.append("shipping_address_collection[allowed_countries][]", "US");
  body.append("shipping_address_collection[allowed_countries][]", "SG");
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2026-06-24.dahlia",
    },
    body,
  });
  const checkout = await response.json();

  if (!response.ok || !checkout?.url) {
    return jsonResponse(
      { error: checkout?.error?.message || "Unable to create checkout." },
      502,
      { "Cache-Control": "no-store" },
    );
  }
  return jsonResponse({ url: checkout.url }, 200, { "Cache-Control": "no-store" });
}

async function emberCheckoutStatus(req, env) {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: "GET",
      "Cache-Control": "no-store",
    });
  }
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({ error: "Checkout verification is unavailable." }, 503, {
      "Cache-Control": "no-store",
    });
  }

  const sessionId = new URL(req.url).searchParams.get("session_id") || "";
  if (!/^cs_(?:test_|live_)[A-Za-z0-9]{10,255}$/.test(sessionId)) {
    return jsonResponse({ error: "Invalid checkout session." }, 400, {
      "Cache-Control": "no-store",
    });
  }

  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    {
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Stripe-Version": "2026-06-24.dahlia",
      },
    },
  );
  const checkout = await response.json();
  if (!response.ok) {
    return jsonResponse(
      { error: checkout?.error?.message || "Unable to verify checkout." },
      502,
      { "Cache-Control": "no-store" },
    );
  }

  const isEmberOrder = new Set(["sage", "bone", "blush"])
    .has(checkout?.metadata?.ember_color)
    && new Set(["US", "SG"]).has(checkout?.metadata?.market);
  return jsonResponse(
    {
      paid: isEmberOrder
        && checkout?.status === "complete"
        && checkout?.payment_status === "paid",
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

async function saveBuildInterest(req, context) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: "POST",
      "Cache-Control": "no-store",
    });
  }

  const body = await readLimitedJsonRequest(req, 4 * 1024);
  if (
    !body
    || typeof body !== "object"
    || Array.isArray(body)
    || Object.keys(body).some((key) => key !== "email")
  ) {
    return jsonResponse({ error: "Enter a valid email address." }, 400, {
      "Cache-Control": "no-store",
    });
  }
  const email = normalizeSignupEmail(body.email);
  if (!email) {
    return jsonResponse({ error: "Enter a valid email address." }, 400, {
      "Cache-Control": "no-store",
    });
  }

  const record = {
    email,
    name: "",
    source: "make-a-build",
    createdAt: new Date().toISOString(),
  };
  const key = `build-interest-${createHash("sha256").update(email).digest("hex")}`;
  try {
    const store = getStore({
      name: waitlistStoreNameForFunctionContext(context),
      consistency: "strong",
    });
    const payload = new Blob([JSON.stringify(record)], { type: "application/json" });
    const write = await store.set(key, payload, { onlyIfNew: true });
    const stored = await store.get(key, { type: "json", consistency: "strong" });
    if (!stored || stored.email !== email || stored.source !== "make-a-build") {
      throw new Error("Build-interest record could not be verified after storage");
    }
    return jsonResponse({ ok: true, created: write?.modified !== false }, 200, {
      "Cache-Control": "no-store",
    });
  } catch (error) {
    console.error("Build-interest storage failed", error);
    return jsonResponse({ error: "Your email could not be saved. Please try again." }, 502, {
      "Cache-Control": "no-store",
    });
  }
}

function normalizeSignupEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

async function dashboardSession(req, env) {
  if (req.method === "DELETE") {
    return jsonResponse({ ok: true }, 200, {
      "Cache-Control": "no-store",
      "Set-Cookie": clearDashboardSessionCookie(),
    });
  }
  if (!new Set(["GET", "POST"]).has(req.method)) {
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: "GET, POST, DELETE",
      "Cache-Control": "no-store",
    });
  }
  if (!dashboardAccessConfigured(
    env.DASHBOARD_ACCESS_KEY,
    env.DASHBOARD_SESSION_SECRET,
  )) {
    return jsonResponse({ error: "Dashboard access is not configured." }, 503, {
      "Cache-Control": "no-store",
    });
  }

  if (req.method === "GET") {
    const session = dashboardSessionState(req, env.DASHBOARD_SESSION_SECRET);
    return jsonResponse(
      { authenticated: session.authenticated },
      200,
      {
        "Cache-Control": "no-store",
        Vary: "Cookie",
        ...(session.state === "invalid"
          ? { "Set-Cookie": clearDashboardSessionCookie() }
          : {}),
      },
    );
  }

  const body = await readLimitedJsonRequest(req, 4 * 1024);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.accessKey !== "string" ||
    Object.keys(body).some((key) => key !== "accessKey")
  ) {
    return jsonResponse({ error: "Enter a valid access key." }, 400, {
      "Cache-Control": "no-store",
    });
  }
  if (!verifyDashboardAccessKey(body.accessKey, env.DASHBOARD_ACCESS_KEY)) {
    return jsonResponse({ error: "That access key is not valid." }, 401, {
      "Cache-Control": "no-store",
    });
  }
  return jsonResponse(
    { authenticated: true },
    200,
    {
      "Cache-Control": "no-store",
      "Set-Cookie": createDashboardSessionCookie(env.DASHBOARD_SESSION_SECRET),
    },
  );
}

async function dashboardData(req, env, context) {
  const authFailure = dashboardAuthorizationFailure(req, env, "GET");
  if (authFailure) return authFailure;
  const records = await loadDashboardRecords(context);
  return jsonResponse(
    {
      generatedAt: new Date().toISOString(),
      records,
    },
    200,
    {
      "Cache-Control": "no-store",
      Vary: "Cookie",
    },
  );
}

async function dashboardExport(req, env, context) {
  const authFailure = dashboardAuthorizationFailure(req, env, "GET");
  if (authFailure) return authFailure;
  const records = await loadDashboardRecords(context);
  return textResponse(
    waitlistCsv(records),
    "text/csv; charset=utf-8",
    200,
    {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="makeable-waitlist-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
      Vary: "Cookie",
    },
  );
}

function dashboardAuthorizationFailure(req, env, allowedMethod) {
  if (req.method !== allowedMethod) {
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: allowedMethod,
      "Cache-Control": "no-store",
    });
  }
  if (!dashboardAccessConfigured(
    env.DASHBOARD_ACCESS_KEY,
    env.DASHBOARD_SESSION_SECRET,
  )) {
    return jsonResponse({ error: "Dashboard access is not configured." }, 503, {
      "Cache-Control": "no-store",
    });
  }
  const session = dashboardSessionState(req, env.DASHBOARD_SESSION_SECRET);
  if (session.authenticated) return null;
  return jsonResponse({ error: "Dashboard authentication required." }, 401, {
    "Cache-Control": "no-store",
    Vary: "Cookie",
    ...(session.state === "invalid"
      ? { "Set-Cookie": clearDashboardSessionCookie() }
      : {}),
  });
}

async function loadDashboardRecords(context) {
  const store = getStore({
    name: waitlistStoreNameForFunctionContext(context),
    consistency: "strong",
  });
  const records = await readVerifiedWaitlist(store);
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function publicConfig(env) {
  return {
    apiBaseUrl: String(env.MAKEABLE_API_BASE_URL || "").replace(/\/$/, ""),
    githubOwner: env.GITHUB_OWNER || "",
    openaiModel: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    openaiReasoningModel: env.OPENAI_REASONING_MODEL || DEFAULT_OPENAI_MODEL,
    openaiReasoningEffort: env.OPENAI_REASONING_EFFORT || DEFAULT_OPENAI_REASONING_EFFORT,
    openaiServiceTier: openAIServiceTier(env),
    hasOpenAIKey: Boolean(env.OPENAI_API_KEY),
    hasGithubToken: Boolean(env.GITHUB_TOKEN),
    hasVoice: Boolean(env.MAKEABLE_API_BASE_URL),
    hasAccounts: Boolean(env.COGNITO_DOMAIN && env.COGNITO_CLIENT_ID),
    cognitoDomain: env.COGNITO_DOMAIN || "",
    cognitoClientId: env.COGNITO_CLIENT_ID || "",
    cognitoRedirectUri: env.COGNITO_REDIRECT_URI || "",
    googleClientId: env.GOOGLE_CLIENT_ID || "",
    hasGoogleSignIn: Boolean(env.GOOGLE_CLIENT_ID),
    hasEsp32Compiler: false,
    hostedMode: true,
    firmwareCompileSupported: Boolean(env.MAKEABLE_API_BASE_URL),
  };
}

async function resolvedPublicConfig(env) {
  const local = publicConfig(env);
  if (!local.apiBaseUrl) return local;
  try {
    const response = await fetch(`${local.apiBaseUrl}/api/config`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return local;
    const backend = await response.json();
    return {
      ...local,
      ...backend,
      apiBaseUrl: local.apiBaseUrl,
      cognitoRedirectUri: local.cognitoRedirectUri || backend.cognitoRedirectUri || "",
      googleClientId: local.googleClientId,
      hasGoogleSignIn: local.hasGoogleSignIn,
    };
  } catch {
    return local;
  }
}

async function completeGoogleWaitlist(req, env, context) {
  if (!env.GOOGLE_CLIENT_ID) {
    return jsonResponse({ error: "Google sign-in is not configured." }, 503, {
      "Cache-Control": "no-store",
    });
  }
  const body = await readLimitedJsonRequest(req, 20 * 1024);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.credential !== "string" ||
    !body.credential ||
    body.credential.length > 16_384 ||
    typeof body.intent !== "string" ||
    Object.keys(body).some((key) => !["credential", "intent"].includes(key))
  ) {
    return jsonResponse({ error: "Google sign-in request is invalid." }, 400, {
      "Cache-Control": "no-store",
    });
  }

  let identity;
  try {
    const client = googleVerifier(env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: body.credential,
      audience: env.GOOGLE_CLIENT_ID,
    });
    identity = ticket.getPayload();
  } catch {
    return jsonResponse({ error: "Google could not verify this sign-in." }, 401, {
      "Cache-Control": "no-store",
    });
  }

  const result = createGoogleWaitlistResult(identity, body.intent);
  if (!result.ok) {
    return jsonResponse({ error: result.error }, result.status, {
      "Cache-Control": "no-store",
    });
  }
  const delivery = await deliverWaitlistRecord(result.value.record, env, context);
  if (!delivery.ok) {
    return jsonResponse({ error: delivery.error }, delivery.status, {
      "Cache-Control": "no-store",
    });
  }
  const confirmation = await createBrowserConfirmation(delivery.key, context);
  if (!confirmation.ok) {
    return jsonResponse({ error: confirmation.error }, confirmation.status, {
      "Cache-Control": "no-store",
    });
  }
  return jsonResponse(
    { ok: true, created: delivery.created, user: result.value.user },
    200,
    {
      "Cache-Control": "no-store",
      "Set-Cookie": confirmation.cookie,
    },
  );
}

async function deliverWaitlistRecord(record, env, context) {
  try {
    const store = getStore({
      name: waitlistStoreNameForFunctionContext(context),
      consistency: "strong",
    });
    const result = await persistVerifiedWaitlistRecord(record, {
      store,
      webhookUrl: env.WAITLIST_WEBHOOK_URL,
      webhookSecret: env.WAITLIST_WEBHOOK_SECRET,
      waitUntil:
        typeof context?.waitUntil === "function"
          ? context.waitUntil.bind(context)
          : undefined,
    });
    return { ok: true, created: result.created, key: result.key };
  } catch (error) {
    console.error("Waitlist storage failed", error);
    return {
      ok: false,
      status: 502,
      error: "Waitlist signup could not be saved. Please try again.",
    };
  }
}

async function createBrowserConfirmation(signupKey, context) {
  try {
    const store = getStore({
      name: waitlistSessionStoreNameForFunctionContext(context),
      consistency: "strong",
    });
    const session = await createWaitlistSession(store, signupKey);
    return { ok: true, cookie: session.cookie };
  } catch (error) {
    console.error("Waitlist browser confirmation failed", error);
    return {
      ok: false,
      status: 502,
      error: "Your signup was saved, but this browser could not be remembered. Please try once more.",
    };
  }
}

async function waitlistStatus(req, context) {
  const cookie = waitlistSessionCookieState(req);
  if (cookie.state !== "valid") {
    return jsonResponse({ joined: false }, 200, {
      "Cache-Control": "no-store",
      ...(cookie.state === "invalid"
        ? { "Set-Cookie": clearWaitlistSessionCookie() }
        : {}),
    });
  }
  try {
    const signupStore = getStore({
      name: waitlistStoreNameForFunctionContext(context),
      consistency: "strong",
    });
    const sessionStore = getStore({
      name: waitlistSessionStoreNameForFunctionContext(context),
      consistency: "strong",
    });
    const status = await resolveWaitlistSession(req, { signupStore, sessionStore });
    return jsonResponse({ joined: status.joined }, 200, {
      "Cache-Control": "no-store",
      ...(status.clearCookie
        ? { "Set-Cookie": clearWaitlistSessionCookie() }
        : {}),
    });
  } catch (error) {
    console.error("Waitlist browser confirmation lookup failed", error);
    return jsonResponse({ joined: false }, 200, {
      "Cache-Control": "no-store",
    });
  }
}

async function forgetBrowserConfirmation(req, context) {
  if (waitlistSessionCookieState(req).state === "valid") {
    try {
      const sessionStore = getStore({
        name: waitlistSessionStoreNameForFunctionContext(context),
        consistency: "strong",
      });
      await forgetWaitlistSession(req, sessionStore);
    } catch (error) {
      console.error("Waitlist browser confirmation removal failed", error);
    }
  }
  return jsonResponse({ ok: true }, 200, {
    "Cache-Control": "no-store",
    "Set-Cookie": clearWaitlistSessionCookie(),
  });
}

function googleVerifier(clientId) {
  let client = googleVerifiers.get(clientId);
  if (!client) {
    client = new OAuth2Client(clientId);
    googleVerifiers.set(clientId, client);
  }
  return client;
}

async function readLimitedJsonRequest(req, maxBytes) {
  const advertisedLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(advertisedLength) && advertisedLength > maxBytes) {
    throw requestError("Request body is too large.", 413);
  }
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw requestError("Request body is too large.", 413);
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw requestError("Request body must be valid JSON.", 400);
  }
}

function requestError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function proxyMakeableApi(req, env) {
  const base = String(env.MAKEABLE_API_BASE_URL || "").replace(/\/$/, "");
  if (!base) return jsonResponse({ error: "The hosted firmware service is not configured." }, 503);
  const inputUrl = new URL(req.url);
  const headers = new Headers({
    "Content-Type": req.headers.get("content-type") || "application/json",
  });
  const authorization = req.headers.get("authorization");
  const generationId = req.headers.get("x-makeable-generation-id");
  const origin = req.headers.get("origin");
  const requestedMethod = req.headers.get("access-control-request-method");
  const requestedHeaders = req.headers.get("access-control-request-headers");
  if (authorization) headers.set("Authorization", authorization);
  if (generationId) headers.set("X-Makeable-Generation-Id", generationId);
  if (origin) headers.set("Origin", origin);
  if (requestedMethod) headers.set("Access-Control-Request-Method", requestedMethod);
  if (requestedHeaders) headers.set("Access-Control-Request-Headers", requestedHeaders);
  const upstream = await fetch(`${base}${inputUrl.pathname}${inputUrl.search}`, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
  });
  const responseHeaders = new Headers();
  for (const name of [
    "content-type",
    "cache-control",
    "access-control-allow-origin",
    "access-control-allow-headers",
    "access-control-allow-methods",
    "vary",
    "www-authenticate",
  ]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  const responseHasNoBody =
    req.method === "HEAD" || [204, 205, 304].includes(upstream.status);
  return new Response(responseHasNoBody ? null : await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

function publicConfigScript(env) {
  return `window.MAKEABLE_CONFIG = ${JSON.stringify(publicConfig(env))};`;
}

async function proxyOpenAI(req, env) {
  const missing = missingOpenAIKey(env);
  if (missing) return missing;

  const body = await req.json();
  body.model = env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  body.service_tier = openAIServiceTier(env);

  return streamJsonUpstream(requestOpenAIResponse(body, env));
}

async function createOpenAIBackgroundResponse(req, env) {
  const missing = missingOpenAIKey(env);
  if (missing) return missing;

  const body = await req.json();
  const payload = {
    ...body,
    model: env.OPENAI_REASONING_MODEL || env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    service_tier: openAIServiceTier(env),
    background: true,
    store: body.store ?? true,
  };
  delete payload.stream;

  return streamJsonUpstream(requestOpenAIResponse(payload, env));
}

function openAIServiceTier(env) {
  const tier = String(env.OPENAI_SERVICE_TIER || DEFAULT_OPENAI_SERVICE_TIER).toLowerCase();
  return ["auto", "default", "flex", "priority"].includes(tier)
    ? tier
    : DEFAULT_OPENAI_SERVICE_TIER;
}

async function requestOpenAIResponse(payload, env) {
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: openAIHeaders(env),
    body: JSON.stringify(payload),
  });
  if (openAIServiceTier(env) !== "priority" || upstream.ok) return upstream;

  const failure = await upstream.clone().text();
  if (!/service[_\s-]*tier|priority.*(?:unavailable|not enabled|not supported)/i.test(failure)) {
    return upstream;
  }

  console.warn("OpenAI priority tier is unavailable; retrying this request on the standard tier.");
  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: openAIHeaders(env),
    body: JSON.stringify({ ...payload, service_tier: "default" }),
  });
}

async function retrieveOpenAIResponse(responseId, env) {
  const missing = missingOpenAIKey(env);
  if (missing) return missing;

  const id = encodeURIComponent(decodeURIComponent(responseId));
  const upstream = await fetch(`https://api.openai.com/v1/responses/${id}`, {
    headers: openAIHeaders(env),
  });
  return pipeJson(upstream);
}

function missingOpenAIKey(env) {
  if (env.OPENAI_API_KEY) return null;
  return jsonResponse({ error: "OPENAI_API_KEY is missing in Netlify environment variables" }, 401);
}

function openAIHeaders(env) {
  return {
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function streamJsonUpstream(upstreamPromise) {
  const encoder = new TextEncoder();
  let keepAlive;

  return new Response(
    new ReadableStream({
      start(controller) {
        const send = (text) => controller.enqueue(encoder.encode(text));
        send(" \n");
        keepAlive = setInterval(() => send(" \n"), 8000);

        upstreamPromise
          .then(async (upstream) => {
            const text = await upstream.text();
            clearInterval(keepAlive);
            send(upstream.ok ? text || "{}" : upstreamErrorJson(upstream.status, text));
          })
          .catch((error) => {
            clearInterval(keepAlive);
            send(JSON.stringify({ error: String(error.message || error), upstreamStatus: 502 }));
          })
          .finally(() => controller.close());
      },
      cancel() {
        clearInterval(keepAlive);
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

function upstreamErrorJson(status, text) {
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { message: text };
  }
  const message = parsed.error?.message || parsed.message || parsed.error || `OpenAI returned HTTP ${status}`;
  return JSON.stringify({ error: message, upstreamStatus: status });
}

async function createGitHubRepo(req, env) {
  if (!env.GITHUB_TOKEN) {
    return jsonResponse({ error: "GITHUB_TOKEN is missing in Netlify environment variables" }, 401);
  }
  const body = await req.json();
  const upstream = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: githubHeaders(env),
    body: JSON.stringify({
      name: body.name,
      description: body.description || "Hardware project generated with Makeable",
      private: Boolean(body.private),
      auto_init: false,
    }),
  });
  return pipeJson(upstream);
}

async function uploadGitHubFile(req, env) {
  if (!env.GITHUB_TOKEN) {
    return jsonResponse({ error: "GITHUB_TOKEN is missing in Netlify environment variables" }, 401);
  }
  const body = await req.json();
  const owner = body.owner || env.GITHUB_OWNER;
  const repo = body.repo;
  const filePath = body.path;
  if (!owner || !repo || !filePath) {
    return jsonResponse({ error: "owner, repo, and path are required" }, 400);
  }

  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const branchQuery = body.branch ? `?ref=${encodeURIComponent(body.branch)}` : "";
  let sha;
  const existing = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}${branchQuery}`,
    { headers: githubHeaders(env) },
  );
  if (existing.ok) {
    const existingJson = await existing.json();
    sha = existingJson.sha;
  } else if (existing.status !== 404) {
    return pipeJson(existing);
  }

  const payload = {
    message: body.message || `Update ${filePath}`,
    content: Buffer.from(body.content || "", "utf8").toString("base64"),
    ...(body.branch ? { branch: body.branch } : {}),
    ...(sha ? { sha } : {}),
  };

  const upstream = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`,
    {
      method: "PUT",
      headers: githubHeaders(env),
      body: JSON.stringify(payload),
    },
  );
  return pipeJson(upstream);
}

function githubHeaders(env) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function pipeJson(upstream) {
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    },
  });
}

function jsonResponse(data, status = 200, headers = {}) {
  return textResponse(
    JSON.stringify(data),
    "application/json; charset=utf-8",
    status,
    headers,
  );
}

function textResponse(text, contentType, status = 200, headers = {}) {
  return new Response(text, {
    status,
    headers: {
      "Content-Type": contentType,
      ...headers,
    },
  });
}
