import { getStore } from "@netlify/blobs";
import { OAuth2Client } from "google-auth-library";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createGoogleWaitlistResult } from "../../lib/acquisition.mjs";
import {
  clearBuilderSessionCookie,
  createBuilderSession,
  builderSessionStoreNameForFunctionContext,
  forgetBuilderSession,
  normalizeGoogleBuilderIdentity,
  publicBuilderProfile,
  resolveBuilderSession,
} from "../../lib/builder-session.mjs";
import {
  createBuild,
} from "../../lib/makeable-builds.mjs";
import {
  BUILD_JOB_LIMITS,
  BUILD_JOB_STATES,
  accountBuildQuota,
  buildCommunityStoreNameForFunctionContext,
  buildJobImageStoreNameForFunctionContext,
  buildJobQuotaStoreNameForFunctionContext,
  buildJobStateStoreNameForFunctionContext,
  builderDisabled,
  cancelBuildJob,
  claimSuccessfulBuildJob,
  completeBuildJob,
  createBackgroundBuildDispatch,
  createAnonymousBuildJob,
  createRoutedBuildStateStore,
  failBuildJob,
  getBuildJob,
  getDraftJobImage,
  getGalleryImage,
  getPublicGalleryBuild,
  hidePublicGalleryBuild,
  listAccountGalleryBuilds,
  listPublicGalleryBuilds,
  markBuildJobState,
  publicBuildJob,
  resolveBuildJobAccess,
} from "../../lib/build-jobs.mjs";
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
} from "../../lib/waitlist-report.mjs";
import {
  buildDashboardReport,
  dashboardCsv,
  readJsonBlobRecords,
} from "../../lib/dashboard-report.mjs";
import {
  buildSocialDashboardReport,
  dashboardSocialResult,
  mergeSocialRecords,
  persistSocialRecords,
  readSocialRecords,
  socialStoreNameForFunctionContext,
} from "../../lib/social-dashboard.mjs";
import { refreshSocialRecords } from "../../lib/social-refresh.mjs";
import { readSocialWebsiteSessions } from "../../lib/posthog-social.mjs";
import {
  createTikTokAuthorization,
  createTikTokState,
  exchangeTikTokCode,
  loadTikTokAccessToken,
  saveTikTokToken,
  verifyTikTokState,
} from "../../lib/tiktok-oauth.mjs";
import {
  clearWaitlistSessionCookie,
  createWaitlistSession,
  forgetWaitlistSession,
  resolveWaitlistSession,
  waitlistSessionCookieState,
  waitlistSessionStoreNameForFunctionContext,
} from "../../lib/waitlist-session.mjs";

const googleVerifiers = new Map();
const EMBER_OFFER_VERSION = "ember_usd_3499_free_shipping_oct_2026_v1";
const POSTHOG_PROJECT_TOKEN = "phc_rfcnAWiEY6337gWcv54R8JHBNQ5K2iYy2Hd76ZUM6CJH";
const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/capture/";
const PUBLIC_PRICE_LISTING_IDS = new Set([
  "amz-us-xiao-s3-pre-soldered-v1",
  "amz-us-hcsr04p-2pk-v1",
  "amz-us-esp32-2432s028r-v1",
]);
const PRICE_STORE_NAME = "makeable-price-current";

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

    if (localApiPath === "/api/stripe/webhook") {
      return await stripeWebhook(req, env);
    }

    if (localApiPath === "/api/checkout") {
      return await createEmberCheckout(req, env, context);
    }

    if (localApiPath === "/api/checkout/status") {
      return await emberCheckoutStatus(req, env);
    }

    if (localApiPath === "/api/account") {
      return await accountStatus(req, env, context);
    }

    if (localApiPath === "/api/auth/session") {
      return await authSession(req, context);
    }

    if (localApiPath === "/api/build-jobs") {
      return await buildJobs(req, env, context);
    }

    if (localApiPath === "/api/builds") {
      return await communityBuilds(req, env, context);
    }

    if (localApiPath === "/api/account/builds") {
      return await accountBuilds(req, env, context);
    }

    const buildImageMatch = localApiPath.match(/^\/api\/builds\/([^/]+)\/image$/);
    if (buildImageMatch) {
      return await communityBuildImage(req, context, buildImageMatch[1]);
    }

    const buildMatch = localApiPath.match(/^\/api\/builds\/([^/]+)$/);
    if (buildMatch) {
      return await communityBuild(req, context, buildMatch[1]);
    }

    const jobImageMatch = localApiPath.match(/^\/api\/build-jobs\/([^/]+)\/image$/);
    if (jobImageMatch) {
      return await buildJobImage(req, env, context, jobImageMatch[1]);
    }

    const jobClaimMatch = localApiPath.match(/^\/api\/build-jobs\/([^/]+)\/claim$/);
    if (jobClaimMatch) {
      return await claimBuildJob(req, env, context, jobClaimMatch[1]);
    }

    const jobCancelMatch = localApiPath.match(/^\/api\/build-jobs\/([^/]+)\/cancel$/);
    if (jobCancelMatch) {
      return await cancelDraftBuildJob(req, env, context, jobCancelMatch[1]);
    }

    const jobMatch = localApiPath.match(/^\/api\/build-jobs\/([^/]+)$/);
    if (jobMatch) {
      if (req.method === "DELETE") {
        return await cancelDraftBuildJob(req, env, context, jobMatch[1]);
      }
      return await buildJobStatus(req, env, context, jobMatch[1]);
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

    if (localApiPath === "/api/dashboard/social") {
      return await dashboardSocial(req, env, context);
    }

    if (localApiPath === "/api/dashboard/social/refresh-public") {
      return await dashboardSocialPublicRefresh(req, env, context);
    }

    if (localApiPath === "/api/dashboard/social/tiktok/connect") {
      return dashboardTikTokConnect(req, env);
    }

    if (localApiPath === "/api/dashboard/tiktok/callback") {
      return await dashboardTikTokCallback(req, env, context);
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

    if (localApiPath === "/api/part-prices") {
      if (req.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405, {
          Allow: "GET",
          "Cache-Control": "no-store",
        });
      }
      return await publicPartPrices(url, context);
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
    "OPENAI_BASE_URL",
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
    "POSTHOG_PERSONAL_API_KEY",
    "POSTHOG_PROJECT_ID",
    "META_ACCESS_TOKEN",
    "INSTAGRAM_MAKEABLE_BUILD_ID",
    "INSTAGRAM_MAKEABLE_ZAK_ID",
    "TIKTOK_ACCESS_TOKEN",
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_SECRET",
    "TIKTOK_REDIRECT_URI",
    "FACEBOOK_PAGE_ID",
    "YOUTUBE_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "OPENAI_BUILD_MODEL",
    "OPENAI_BUILD_SERVICE_TIER",
    "OPENAI_IMAGE_MODEL",
    "OPENAI_IMAGE_SIZE",
    "OPENAI_IMAGE_QUALITY",
    "MAKEABLE_FORCE_BUILD_FALLBACK",
    "MAKEABLE_SKIP_IMAGE_GENERATION",
    "MAKEABLE_DRAFT_COOKIE_SECRET",
    "MAKEABLE_ANALYTICS_ID_SECRET",
    "MAKEABLE_BACKGROUND_SECRET",
    "MAKEABLE_BUILD_GENERATION_ENABLED",
    "MAKEABLE_ANONYMOUS_GENERATION_ENABLED",
    "NODE_ENV",
    "NETLIFY",
    "CONTEXT",
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

async function createEmberCheckout(req, env, context) {
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
    US: { currency: "usd", unitAmount: "3499" },
    SG: { currency: "sgd", unitAmount: "4499" },
  };
  let selectedColor = "bone";
  let selectedMarket = "US";
  let quantity = 1;
  let termsAccepted = false;
  let marketingConsent = false;
  let posthogDistinctId = "";
  try {
    const requestBody = await req.json();
    if (allowedColors.has(requestBody?.color)) selectedColor = requestBody.color;
    if (Object.hasOwn(checkoutMarkets, requestBody?.market)) selectedMarket = requestBody.market;
    if (Number.isInteger(requestBody?.quantity)) quantity = requestBody.quantity;
    termsAccepted = requestBody?.termsAccepted === true;
    marketingConsent = requestBody?.marketingConsent === true;
    posthogDistinctId = safeAnalyticsDistinctId(requestBody?.posthogDistinctId);
  } catch {
    // Preserve the default color and market for requests without a JSON body.
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return jsonResponse({ error: "Choose a quantity between 1 and 10." }, 400, {
      "Cache-Control": "no-store",
    });
  }
  if (!termsAccepted) {
    return jsonResponse(
      { error: "Agree to the Terms and acknowledge the Privacy Policy to continue." },
      400,
      { "Cache-Control": "no-store" },
    );
  }
  const colorLabels = {
    sage: "Sage",
    bone: "Beige",
    blush: "Sakura",
  };
  const colorLabel = colorLabels[selectedColor];
  const market = checkoutMarkets[selectedMarket];
  const consentRecordedAt = new Date().toISOString();
  const body = new URLSearchParams({
    mode: "payment",
    customer_creation: "always",
    billing_address_collection: "required",
    "phone_number_collection[enabled]": "true",
    "name_collection[individual][enabled]": "true",
    "name_collection[individual][optional]": "false",
    "line_items[0][price_data][currency]": market.currency,
    "line_items[0][price_data][unit_amount]": market.unitAmount,
    "line_items[0][price_data][product_data][name]": `Makeable Ember — ${colorLabel}`,
    "line_items[0][price_data][product_data][description]":
      "Token-burner desk pet. Easy-to-assemble kit, USB-C cable included.",
    "line_items[0][quantity]": String(quantity),
    "metadata[ember_color]": selectedColor,
    "metadata[market]": selectedMarket,
    "metadata[quantity]": String(quantity),
    "metadata[terms_accepted]": "true",
    "metadata[privacy_acknowledged]": "true",
    "metadata[marketing_consent]": marketingConsent ? "true" : "false",
    "metadata[consent_version]": "2026-08-16",
    "metadata[consent_recorded_at]": consentRecordedAt,
    "metadata[consent_source]": "makeable_web_preorder",
    "metadata[offer_version]": EMBER_OFFER_VERSION,
    "payment_intent_data[metadata][ember_color]": selectedColor,
    "payment_intent_data[metadata][market]": selectedMarket,
    "payment_intent_data[metadata][quantity]": String(quantity),
    "payment_intent_data[metadata][terms_accepted]": "true",
    "payment_intent_data[metadata][privacy_acknowledged]": "true",
    "payment_intent_data[metadata][marketing_consent]": marketingConsent ? "true" : "false",
    "payment_intent_data[metadata][consent_version]": "2026-08-16",
    "payment_intent_data[metadata][consent_recorded_at]": consentRecordedAt,
    "payment_intent_data[metadata][consent_source]": "makeable_web_preorder",
    "payment_intent_data[metadata][offer_version]": EMBER_OFFER_VERSION,
    "shipping_options[0][shipping_rate_data][type]": "fixed_amount",
    "shipping_options[0][shipping_rate_data][fixed_amount][amount]": "0",
    "shipping_options[0][shipping_rate_data][fixed_amount][currency]": market.currency,
    "shipping_options[0][shipping_rate_data][display_name]": "Free shipping",
    "custom_text[shipping_address][message]":
      "Pre-orders are expected to ship in October 2026.",
    success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?checkout=cancelled`,
    integration_identifier: "makeable_ember_qtmsvkwp",
  });
  if (posthogDistinctId) {
    body.set("metadata[posthog_distinct_id]", posthogDistinctId);
    body.set("payment_intent_data[metadata][posthog_distinct_id]", posthogDistinctId);
  }
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
  queueAnalyticsCapture(
    context,
    "checkout session created",
    posthogDistinctId,
    {
      color: selectedColor,
      currency: market.currency,
      market: selectedMarket,
      price_cents: Number(market.unitAmount) * quantity,
      quantity,
      source: "checkout_api",
    },
  );
  return jsonResponse({ url: checkout.url }, 200, { "Cache-Control": "no-store" });
}

async function stripeWebhook(req, env) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: "POST",
      "Cache-Control": "no-store",
    });
  }
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return jsonResponse({ error: "Stripe webhook verification is not configured." }, 503, {
      "Cache-Control": "no-store",
    });
  }

  const rawPayload = await req.text();
  if (new TextEncoder().encode(rawPayload).byteLength > 512 * 1024) {
    return jsonResponse({ error: "Webhook payload is too large." }, 413, {
      "Cache-Control": "no-store",
    });
  }
  if (!stripeSignatureMatches(rawPayload, req.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET)) {
    return jsonResponse({ error: "Invalid Stripe signature." }, 400, {
      "Cache-Control": "no-store",
    });
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(rawPayload);
  } catch {
    return jsonResponse({ error: "Invalid Stripe webhook payload." }, 400, {
      "Cache-Control": "no-store",
    });
  }

  const eventType = typeof stripeEvent?.type === "string" ? stripeEvent.type : "";
  const eventId = typeof stripeEvent?.id === "string" ? stripeEvent.id : "";
  const stripeObject = stripeEvent?.data?.object;
  if (new Set([
    "checkout.session.completed",
    "checkout.session.expired",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
  ]).has(eventType) && isEmberCheckout(stripeObject)) {
    const eventName = {
      "checkout.session.completed": "order paid",
      "checkout.session.expired": "checkout expired",
      "checkout.session.async_payment_succeeded": "order paid",
      "checkout.session.async_payment_failed": "payment async failed",
    }[eventType];
    if (eventName !== "order paid" || stripeObject.payment_status === "paid") {
      await captureCheckoutAnalytics(eventName, stripeObject, eventId, {
        source: "stripe_webhook",
        payment_status: typeof stripeObject.payment_status === "string" ? stripeObject.payment_status : "",
      });
    }
  }

  if (eventType === "charge.refunded") {
    await captureRefundAnalytics(stripeObject, env, eventId);
  }
  return jsonResponse({ received: true }, 200, { "Cache-Control": "no-store" });
}

function safeAnalyticsDistinctId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(value)
    ? value
    : "";
}

function analyticsAccountId(sub, env) {
  const normalizedSub = typeof sub === "string" ? sub.trim().slice(0, 255) : "";
  const secret = String(
    env.MAKEABLE_ANALYTICS_ID_SECRET
      || env.MAKEABLE_DRAFT_COOKIE_SECRET
      || env.DASHBOARD_SESSION_SECRET
      || "",
  );
  if (!normalizedSub || secret.length < 32) return "";
  return `makeable_account_${createHmac("sha256", secret)
    .update(`posthog-account:${normalizedSub}`)
    .digest("hex")
    .slice(0, 40)}`;
}

function normalizedReferringDomain(value) {
  if (value === "$direct") return "$direct";
  if (typeof value !== "string") return "";
  const domain = value.trim().toLowerCase().slice(0, 253);
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
    ? domain
    : "";
}

function isEmberCheckout(checkout) {
  return Boolean(checkout && new Set(["sage", "bone", "blush"])
    .has(checkout?.metadata?.ember_color)
    && new Set(["US", "SG"]).has(checkout?.metadata?.market));
}

async function captureCheckoutAnalytics(event, checkout, insertId, properties = {}) {
  const metadata = checkout?.metadata || {};
  return capturePosthogEvent(
    event,
    safeAnalyticsDistinctId(metadata.posthog_distinct_id),
    {
      amount_cents: Number.isInteger(checkout?.amount_total) ? checkout.amount_total : null,
      color: metadata.ember_color || "",
      currency: checkout?.currency || "",
      market: metadata.market || "",
      quantity: Number(metadata.quantity) || null,
      source: "stripe_webhook",
      ...properties,
    },
    insertId,
  );
}

async function captureRefundAnalytics(charge, env, insertId) {
  if (!env.STRIPE_SECRET_KEY || typeof charge?.payment_intent !== "string") return;
  try {
    const response = await fetch(
      `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(charge.payment_intent)}`,
      {
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Stripe-Version": "2026-06-24.dahlia",
        },
      },
    );
    const paymentIntent = await response.json();
    if (!response.ok || !isEmberCheckout({ metadata: paymentIntent?.metadata })) return;
    await capturePosthogEvent(
      "order refunded",
      safeAnalyticsDistinctId(paymentIntent.metadata.posthog_distinct_id),
      {
        amount_cents: Number.isInteger(charge.amount_refunded) ? charge.amount_refunded : null,
        currency: charge.currency || "",
        market: paymentIntent.metadata.market || "",
        quantity: Number(paymentIntent.metadata.quantity) || null,
        source: "stripe_webhook",
      },
      insertId,
    );
  } catch (error) {
    console.error("Could not record Stripe refund analytics", error);
  }
}

async function queueAnalyticsCapture(context, event, distinctId, properties, insertId = "") {
  if (!distinctId) return;
  const capture = capturePosthogEvent(event, distinctId, properties, insertId);
  if (typeof context?.waitUntil === "function") {
    context.waitUntil(capture);
    return;
  }
  await capture;
}

async function capturePosthogEvent(event, distinctId, properties, insertId = "") {
  if (!distinctId) return;
  try {
    await fetch(POSTHOG_CAPTURE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: POSTHOG_PROJECT_TOKEN,
        event,
        properties: {
          $insert_id: insertId || undefined,
          distinct_id: distinctId,
          offer_version: EMBER_OFFER_VERSION,
          product_id: "ember",
          site: "makeable.build",
          ...properties,
        },
      }),
    });
  } catch (error) {
    console.error("Could not record PostHog analytics", error);
  }
}

function stripeSignatureMatches(payload, header, secret) {
  if (!header) return false;
  const entries = header.split(",").map((entry) => entry.trim());
  const timestamp = entries.find((entry) => entry.startsWith("t="))?.slice(2) || "";
  const timestampNumber = Number(timestamp);
  if (!Number.isInteger(timestampNumber) || Math.abs(Date.now() / 1000 - timestampNumber) > 5 * 60) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  return entries
    .filter((entry) => entry.startsWith("v1="))
    .some((entry) => timingSafeStringEqual(entry.slice(3), expected));
}

function timingSafeStringEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
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

async function communityBuilds(req, env, context) {
  if (req.method === "GET") {
    return jsonResponse({ builds: await listPublicGalleryBuilds(buildStateStore(context)) }, 200, {
      "Cache-Control": "no-store",
    });
  }
  if (req.method === "POST") {
    return startAnonymousBuildJob(req, env, context);
  }
  return jsonResponse({ error: "Method not allowed" }, 405, {
    Allow: "GET, POST",
    "Cache-Control": "no-store",
  });
}

async function buildJobs(req, env, context) {
  if (req.method === "POST") {
    return startAnonymousBuildJob(req, env, context);
  }
  return jsonResponse({ error: "Method not allowed" }, 405, {
    Allow: "POST",
    "Cache-Control": "no-store",
  });
}

async function startAnonymousBuildJob(req, env, context) {
  const csrfFailure = sameOriginFailure(req);
  if (csrfFailure) return csrfFailure;

  const body = await readLimitedJsonRequest(req, 8 * 1024);
  const stateStore = buildStateStore(context);
  const imageStore = buildImageStore(context);
  const auth = await optionalBuilderSession(req, context);
  if (auth.user) {
    const quota = await accountBuildQuota(stateStore, auth.user.sub);
    if (quota.remaining <= 0) {
      return jsonResponse({ error: `This Google account has used its ${quota.limit} successful builds.` }, 429, {
        "Cache-Control": "no-store",
      });
    }
  }
  const start = await createAnonymousBuildJob({
    request: req,
    stateStore,
    env,
    idea: body?.idea,
    user: auth.user,
  });
  if (!start.ok) {
    const activeJob = start.activeJob || null;
    const dispatch = activeJob?.state === BUILD_JOB_STATES.queued && shouldUseNetlifyBackground(env, context)
      ? createBackgroundBuildDispatch(env, activeJob.id)
      : null;
    return jsonResponse({ error: start.error, activeJob, dispatch }, start.status, {
      "Cache-Control": "no-store",
      ...(start.headers || {}),
    });
  }
  const dispatch = shouldUseNetlifyBackground(env, context)
    ? createBackgroundBuildDispatch(env, start.job.id)
    : null;
  if (!dispatch) {
    scheduleBuildExecution(context, {
      jobId: start.job.id,
      idea: start.job.idea,
      env,
      stateStore,
      imageStore,
    });
  }
  return jsonResponse(
    {
      job: publicBuildJob(start.job),
      dispatch,
      limits: {
        startsPerWindow: auth.user
          ? BUILD_JOB_LIMITS.successfulClaimsPerAccount
          : BUILD_JOB_LIMITS.startsPerWindow,
        windowHours: 24,
      },
    },
    202,
    {
      "Cache-Control": "no-store",
      "Set-Cookie": start.cookie,
    },
  );
}

async function accountBuilds(req, env, context) {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: "GET",
      "Cache-Control": "no-store",
    });
  }
  const auth = await requireBuilderSession(req, context);
  if (!auth.ok) return auth.response;
  const stateStore = buildStateStore(context);
  const profile = publicBuilderProfile(auth.user);
  const quota = await accountBuildQuota(stateStore, auth.user.sub);
  const userBuilds = await listAccountGalleryBuilds(stateStore, auth.user.sub);
  return jsonResponse(
    {
      authenticated: true,
      profile,
      user: profile,
      analyticsId: analyticsAccountId(auth.user.sub, env),
      builds: userBuilds,
      quota,
    },
    200,
    { "Cache-Control": "no-store", Vary: "Cookie" },
  );
}

async function communityBuild(req, context, id) {
  if (req.method === "GET") {
    const build = await getPublicGalleryBuild(buildStateStore(context), id);
    return build
      ? jsonResponse({ build }, 200, { "Cache-Control": "no-store" })
      : jsonResponse({ error: "Build not found" }, 404, { "Cache-Control": "no-store" });
  }

  if (req.method === "DELETE") {
    const csrfFailure = sameOriginFailure(req);
    if (csrfFailure) return csrfFailure;

    const auth = await requireBuilderSession(req, context);
    if (!auth.ok) return auth.response;
    const stateStore = buildStateStore(context);
    const result = await hidePublicGalleryBuild({
      stateStore,
      buildId: id,
      user: auth.user,
    });
    if (!result.ok) {
      return jsonResponse({ error: result.error }, result.status, {
        "Cache-Control": "no-store",
        Vary: "Cookie",
      });
    }
    return jsonResponse(
      {
        ok: true,
        build: result.build,
        quota: await accountBuildQuota(stateStore, auth.user.sub),
      },
      200,
      { "Cache-Control": "no-store", Vary: "Cookie" },
    );
  }

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: "GET, DELETE",
      "Cache-Control": "no-store",
    });
  }
}

async function communityBuildImage(req, context, id) {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: "GET",
      "Cache-Control": "no-store",
    });
  }
  const build = await getPublicGalleryBuild(buildStateStore(context), id);
  if (!build) {
    return jsonResponse({ error: "Build image not found" }, 404, {
      "Cache-Control": "no-store",
    });
  }
  const image = await getGalleryImage(buildImageStore(context), id);
  if (!image) {
    return jsonResponse({ error: "Build image not found" }, 404, {
      "Cache-Control": "no-store",
    });
  }
  return binaryResponse(image.bytes, image.contentType, {
    "Cache-Control": "public, max-age=3600",
  });
}

async function buildJobStatus(req, env, context, jobId) {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: "GET",
      "Cache-Control": "no-store",
    });
  }
  const auth = await optionalBuilderSession(req, context);
  const access = await resolveBuildJobAccess({
    request: req,
    stateStore: buildStateStore(context),
    env,
    jobId,
    user: auth.user,
  });
  if (!access.ok) {
    return jsonResponse({ error: access.error }, access.status, {
      "Cache-Control": "no-store",
      Vary: "Cookie",
      ...(access.headers || {}),
      ...(auth.clearCookie ? { "Set-Cookie": clearBuilderSessionCookie() } : {}),
    });
  }
  return jsonResponse({ job: publicBuildJob(access.job) }, 200, {
    "Cache-Control": "no-store",
    Vary: "Cookie",
  });
}

async function buildJobImage(req, env, context, jobId) {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: "GET",
      "Cache-Control": "no-store",
    });
  }
  const auth = await optionalBuilderSession(req, context);
  const result = await getDraftJobImage({
    request: req,
    stateStore: buildStateStore(context),
    imageStore: buildImageStore(context),
    env,
    jobId,
    user: auth.user,
  });
  if (!result.ok) {
    return jsonResponse({ error: result.error }, result.status, {
      "Cache-Control": "no-store",
      Vary: "Cookie",
      ...(result.headers || {}),
    });
  }
  return binaryResponse(result.image.bytes, result.image.contentType, {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
  });
}

async function claimBuildJob(req, env, context, jobId) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: "POST",
      "Cache-Control": "no-store",
    });
  }
  const csrfFailure = sameOriginFailure(req);
  if (csrfFailure) return csrfFailure;

  const auth = await requireBuilderSession(req, context);
  if (!auth.ok) return auth.response;
  const body = await readLimitedJsonRequest(req, 4 * 1024);
  if (
    !body
    || typeof body !== "object"
    || Array.isArray(body)
    || Object.keys(body).some((key) => !new Set([
      "galleryName",
      "name",
      "posthogDistinctId",
      "referringDomain",
    ]).has(key))
  ) {
    return jsonResponse({ error: "Build claim request is invalid." }, 400, {
      "Cache-Control": "no-store",
    });
  }
  const result = await claimSuccessfulBuildJob({
    request: req,
    stateStore: buildStateStore(context),
    imageStore: buildImageStore(context),
    env,
    jobId,
    user: auth.user,
    galleryName: body?.galleryName || body?.name,
  });
  if (!result.ok) {
    return jsonResponse({ error: result.error }, result.status, {
      "Cache-Control": "no-store",
      ...(result.headers || {}),
    });
  }
  const buildId = String(result.build?.id || result.job?.buildId || "");
  const analyticsId = analyticsAccountId(auth.user.sub, env)
    || safeAnalyticsDistinctId(body.posthogDistinctId);
  await queueAnalyticsCapture(
    context,
    "makeable build claimed",
    analyticsId,
    {
      product_id: "makeable_builder",
      offer_version: "makeable_builder_v1",
      build_id: buildId,
      source: result.build?.image?.source || "unknown",
      parts_count: Array.isArray(result.build?.parts) ? result.build.parts.length : 0,
      referring_domain: normalizedReferringDomain(body.referringDomain) || "$direct",
      claim_method: "server",
    },
    buildId ? `makeable-build-claimed:${buildId}` : `makeable-build-claimed:${jobId}`,
  );
  return jsonResponse(
    { job: result.job, build: result.build, quota: result.quota },
    200,
    { "Cache-Control": "no-store", Vary: "Cookie" },
  );
}

async function cancelDraftBuildJob(req, env, context, jobId) {
  if (!new Set(["POST", "DELETE"]).has(req.method)) {
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: "POST, DELETE",
      "Cache-Control": "no-store",
    });
  }
  const csrfFailure = sameOriginFailure(req);
  if (csrfFailure) return csrfFailure;

  const auth = await optionalBuilderSession(req, context);
  const result = await cancelBuildJob({
    request: req,
    stateStore: buildStateStore(context),
    env,
    jobId,
    user: auth.user,
  });
  if (!result.ok) {
    return jsonResponse({ error: result.error }, result.status, {
      "Cache-Control": "no-store",
      Vary: "Cookie",
      ...(result.headers || {}),
    });
  }
  return jsonResponse({ job: result.job }, 200, {
    "Cache-Control": "no-store",
    Vary: "Cookie",
  });
}

async function accountStatus(req, env, context) {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: "GET",
      "Cache-Control": "no-store",
    });
  }
  const session = await resolveBuilderSession(req, builderSessionStore(context));
  if (!session.authenticated) {
    const quota = await accountBuildQuota(buildStateStore(context), "");
    return jsonResponse(
      { authenticated: false, profile: null, user: null, quota, builds: [] },
      200,
      {
        "Cache-Control": "no-store",
        Vary: "Cookie",
        ...(session.clearCookie ? { "Set-Cookie": clearBuilderSessionCookie() } : {}),
      },
    );
  }
  const stateStore = buildStateStore(context);
  const profile = publicBuilderProfile(session.user);
  const quota = await accountBuildQuota(stateStore, session.user.sub);
  const builds = await listAccountGalleryBuilds(stateStore, session.user.sub);
  return jsonResponse(
    {
      authenticated: true,
      profile,
      user: profile,
      analyticsId: analyticsAccountId(session.user.sub, env),
      quota,
      builds,
    },
    200,
    { "Cache-Control": "no-store", Vary: "Cookie" },
  );
}

async function authSession(req, context) {
  if (req.method !== "DELETE") {
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: "DELETE",
      "Cache-Control": "no-store",
    });
  }
  const csrfFailure = sameOriginFailure(req);
  if (csrfFailure) return csrfFailure;

  await forgetBuilderSession(req, builderSessionStore(context));
  return jsonResponse({ ok: true }, 200, {
    "Cache-Control": "no-store",
    "Set-Cookie": clearBuilderSessionCookie(),
  });
}

function buildStateStore(context) {
  return createRoutedBuildStateStore({
    jobStore: getStore({
      name: buildJobStateStoreNameForFunctionContext(context),
      consistency: "strong",
    }),
    quotaStore: getStore({
      name: buildJobQuotaStoreNameForFunctionContext(context),
      consistency: "strong",
    }),
    communityStore: getStore({
      name: buildCommunityStoreNameForFunctionContext(context),
      consistency: "strong",
    }),
  });
}

function buildImageStore(context) {
  return getStore({
    name: buildJobImageStoreNameForFunctionContext(context),
    consistency: "strong",
  });
}

function builderSessionStore(context) {
  return getStore({
    name: builderSessionStoreNameForFunctionContext(context),
    consistency: "strong",
  });
}

async function requireBuilderSession(req, context) {
  const session = await resolveBuilderSession(req, builderSessionStore(context));
  if (session.authenticated) return { ok: true, user: session.user };
  return {
    ok: false,
    response: jsonResponse(
      { error: "Log in with Google to create builds." },
      401,
      {
        "Cache-Control": "no-store",
        Vary: "Cookie",
        ...(session.clearCookie ? { "Set-Cookie": clearBuilderSessionCookie() } : {}),
      },
    ),
  };
}

async function optionalBuilderSession(req, context) {
  const session = await resolveBuilderSession(req, builderSessionStore(context));
  return session.authenticated
    ? { user: session.user, clearCookie: false }
    : { user: null, clearCookie: session.clearCookie };
}

function scheduleBuildExecution(context, params) {
  const promise = runCommunityBuildJob(params);
  if (typeof context?.waitUntil === "function") context.waitUntil(promise);
  else {
    promise.catch((error) => {
      console.error("Background build failed", error);
    });
  }
}

function shouldUseNetlifyBackground(env, context) {
  return env.NETLIFY === "true"
    || Boolean(env.CONTEXT)
    || Boolean(context?.deploy)
    || typeof context?.waitUntil === "function"
    || typeof globalThis.Netlify?.env?.get === "function";
}

async function runCommunityBuildJob({ jobId, idea, env, stateStore, imageStore }) {
  try {
    const planning = await markBuildJobState(stateStore, jobId, BUILD_JOB_STATES.planning);
    if (!planning || planning.state === BUILD_JOB_STATES.cancelled) return;

    const captureStore = {
      saved: null,
      async save(build) {
        this.saved = build;
        return build;
      },
    };
    const result = await createBuild(
      { idea },
      {
        env,
        store: captureStore,
        fetchFn: fetch,
        allowAnonymous: true,
        onPhase: (state) => markBuildJobState(stateStore, jobId, state),
      },
    );
    if (result.status !== 201) {
      throw new Error(result.body?.error || "Build generation failed.");
    }
    const latest = await getBuildJob(stateStore, jobId);
    if (!latest || latest.state === BUILD_JOB_STATES.cancelled) return;
    await completeBuildJob({
      stateStore,
      imageStore,
      jobId,
      build: captureStore.saved || result.body,
    });
  } catch (error) {
    await failBuildJob(stateStore, jobId, error);
  }
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
  const report = await loadDashboardReport(context);
  return jsonResponse(
    report,
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
  const report = await loadDashboardReport(context);
  return textResponse(
    dashboardCsv(report.records),
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

async function dashboardSocial(req, env, context) {
  if (!new Set(["GET", "POST"]).has(req.method)) {
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: "GET, POST",
      "Cache-Control": "no-store",
    });
  }
  const authFailure = dashboardAuthorizationFailure(req, env, req.method);
  if (authFailure) return authFailure;
  if (req.method === "POST") {
    const csrfFailure = sameOriginFailure(req);
    if (csrfFailure) return csrfFailure;
  }
  const body = req.method === "POST"
    ? await readLimitedJsonRequest(req, (2 * 1024 * 1024) + 8 * 1024)
    : null;
  const attribution = await readSocialWebsiteSessions({
    personalApiKey: env.POSTHOG_PERSONAL_API_KEY,
    projectId: env.POSTHOG_PROJECT_ID,
    fetchImpl: fetch,
  });
  const result = await dashboardSocialResult(
    { method: req.method, body },
    {
      store: getStore({
        name: socialStoreNameForFunctionContext(context),
        consistency: "strong",
      }),
      attribution,
    },
  );
  return jsonResponse(result.body, result.status, {
    ...result.headers,
    "Cache-Control": "no-store",
    Vary: "Cookie",
  });
}

async function dashboardSocialPublicRefresh(req, env, context) {
  const authFailure = dashboardAuthorizationFailure(req, env, "POST");
  if (authFailure) return authFailure;
  const csrfFailure = sameOriginFailure(req);
  if (csrfFailure) return csrfFailure;
  try {
    const store = getStore({
      name: socialStoreNameForFunctionContext(context),
      consistency: "strong",
    });
    const tiktokAccessToken = await resolvedTikTokAccessToken(store, env);
    const { records: incoming, failures } = await refreshSocialRecords({
      youtubeApiKey: env.YOUTUBE_API_KEY,
      metaAccessToken: env.META_ACCESS_TOKEN,
      instagramAccounts: instagramAccountsFromEnv(env),
      tiktokAccessToken,
      facebookPageId: env.FACEBOOK_PAGE_ID,
    });
    const records = mergeSocialRecords(await readSocialRecords(store), incoming);
    await persistSocialRecords(store, records);
    const attribution = await readSocialWebsiteSessions({
      personalApiKey: env.POSTHOG_PERSONAL_API_KEY,
      projectId: env.POSTHOG_PROJECT_ID,
      fetchImpl: fetch,
    });
    return jsonResponse({
      imported: incoming.length,
      partialFailures: failures,
      report: buildSocialDashboardReport(records, { attribution }),
    }, 200, { "Cache-Control": "no-store", Vary: "Cookie" });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : "Public social refresh failed.",
    }, 502, { "Cache-Control": "no-store", Vary: "Cookie" });
  }
}

function dashboardTikTokConnect(req, env) {
  const authFailure = dashboardAuthorizationFailure(req, env, "POST");
  if (authFailure) return authFailure;
  const csrfFailure = sameOriginFailure(req);
  if (csrfFailure) return csrfFailure;
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
    return jsonResponse({ error: "TikTok owner access is not configured." }, 503, { "Cache-Control": "no-store" });
  }
  const state = createTikTokState(env.DASHBOARD_SESSION_SECRET);
  const authorization = createTikTokAuthorization({
    clientKey: env.TIKTOK_CLIENT_KEY,
    redirectUri: tiktokRedirectUri(env),
    state,
  });
  return jsonResponse({ authorizationUrl: authorization.href }, 200, { "Cache-Control": "no-store" });
}

async function dashboardTikTokCallback(req, env, context) {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, { Allow: "GET", "Cache-Control": "no-store" });
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code || !verifyTikTokState(state, env.DASHBOARD_SESSION_SECRET)) {
    return jsonResponse({ error: "TikTok authorization could not be verified." }, 400, { "Cache-Control": "no-store" });
  }
  const token = await exchangeTikTokCode({
    code,
    clientKey: env.TIKTOK_CLIENT_KEY,
    clientSecret: env.TIKTOK_CLIENT_SECRET,
    redirectUri: tiktokRedirectUri(env),
    fetchImpl: fetch,
  });
  const store = getStore({
    name: socialStoreNameForFunctionContext(context),
    consistency: "strong",
  });
  await saveTikTokToken(store, token);
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/dashboard/?tiktok=connected",
      "Cache-Control": "no-store",
    },
  });
}

async function resolvedTikTokAccessToken(store, env) {
  try {
    return await loadTikTokAccessToken({
      store,
      clientKey: env.TIKTOK_CLIENT_KEY,
      clientSecret: env.TIKTOK_CLIENT_SECRET,
      fallbackToken: env.TIKTOK_ACCESS_TOKEN,
      fetchImpl: fetch,
    });
  } catch (error) {
    console.warn("TikTok owner token refresh failed", error instanceof Error ? error.message : "Unknown error");
    return env.TIKTOK_ACCESS_TOKEN;
  }
}

function tiktokRedirectUri(env) {
  return env.TIKTOK_REDIRECT_URI || "https://makeable.build/api/dashboard/tiktok/callback";
}

function instagramAccountsFromEnv(env) {
  return [
    { id: env.INSTAGRAM_MAKEABLE_BUILD_ID, account: "@makeable.build", attributionKey: "makeable_build" },
    { id: env.INSTAGRAM_MAKEABLE_ZAK_ID, account: "@makeable.zak", attributionKey: "makeable_zak" },
  ].filter((account) => account.id);
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

async function loadDashboardReport(context) {
  const waitlistStore = getStore({
    name: waitlistStoreNameForFunctionContext(context),
    consistency: "strong",
  });
  const sessionsStore = getStore({
    name: builderSessionStoreNameForFunctionContext(context),
    consistency: "strong",
  });
  const galleryStore = getStore({
    name: buildCommunityStoreNameForFunctionContext(context),
    consistency: "strong",
  });
  const [waitlistRecords, builderSessions, galleryRecords] = await Promise.all([
    readVerifiedWaitlist(waitlistStore),
    readJsonBlobRecords(sessionsStore, "builder-session-"),
    readJsonBlobRecords(galleryStore, "gallery/"),
  ]);
  return buildDashboardReport(waitlistRecords, builderSessions, galleryRecords);
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
    hasAccounts: Boolean(env.GOOGLE_CLIENT_ID || (env.COGNITO_DOMAIN && env.COGNITO_CLIENT_ID)),
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
  const csrfFailure = sameOriginFailure(req);
  if (csrfFailure) return csrfFailure;

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
    !new Set(["waitlist", "build", "account"]).has(body.intent) ||
    Object.keys(body).some((key) => ![
      "credential",
      "intent",
      "posthogDistinctId",
    ].includes(key))
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

  if (body.intent === "build" || body.intent === "account") {
    const result = normalizeGoogleBuilderIdentity(identity);
    if (!result.ok) {
      return jsonResponse({ error: result.error }, result.status, {
        "Cache-Control": "no-store",
      });
    }
    const record = {
      email: result.value.email,
      name: result.value.name,
      source: "google",
      createdAt: result.value.createdAt,
    };
    const delivery = await deliverWaitlistRecord(record, env, context);
    if (!delivery.ok) {
      return jsonResponse({ error: delivery.error }, delivery.status, {
        "Cache-Control": "no-store",
      });
    }
    const session = await createBuilderSession(builderSessionStore(context), result.value);
    const profile = publicBuilderProfile(session.record.user);
    const analyticsId = analyticsAccountId(result.value.sub, env);
    if (delivery.created) {
      await queueAnalyticsCapture(
        context,
        "make a build interest submitted",
        analyticsId || safeAnalyticsDistinctId(body.posthogDistinctId),
        {
          product_id: "makeable_builder",
          offer_version: "makeable_google_waitlist_v1",
          signup_method: "google",
          signup_date: record.createdAt.slice(0, 10),
          source: body.intent === "account" ? "account_login" : "build_login",
        },
        delivery.key,
      );
    }
    return jsonResponse(
      { ok: true, created: delivery.created, user: profile, analyticsId },
      200,
      {
        "Cache-Control": "no-store",
        "Set-Cookie": session.cookie,
      },
    );
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
  const requestPayload = openAIRequestPayload(payload, env);
  const upstream = await fetch(openAIEndpoint(env, "/v1/responses"), {
    method: "POST",
    headers: openAIHeaders(env),
    body: JSON.stringify(requestPayload),
  });
  if (!usesDirectOpenAI(env) || openAIServiceTier(env) !== "priority" || upstream.ok) return upstream;

  const failure = await upstream.clone().text();
  if (!/service[_\s-]*tier|priority.*(?:unavailable|not enabled|not supported)/i.test(failure)) {
    return upstream;
  }

  console.warn("OpenAI priority tier is unavailable; retrying this request on the standard tier.");
  return fetch(openAIEndpoint(env, "/v1/responses"), {
    method: "POST",
    headers: openAIHeaders(env),
    body: JSON.stringify({ ...payload, service_tier: "default" }),
  });
}

async function retrieveOpenAIResponse(responseId, env) {
  const missing = missingOpenAIKey(env);
  if (missing) return missing;

  const id = encodeURIComponent(decodeURIComponent(responseId));
  const upstream = await fetch(openAIEndpoint(env, `/v1/responses/${id}`), {
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
    Accept: "application/json",
  };
}

function openAIEndpoint(env, pathname) {
  return `${openAIBaseUrl(env)}${pathname}`;
}

function openAIBaseUrl(env) {
  const raw = String(env.OPENAI_BASE_URL || "https://api.openai.com").trim().replace(/\/+$/, "");
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:") throw new Error("The OpenAI endpoint must use HTTPS.");
  return parsed.toString().replace(/\/+$/, "");
}

function usesDirectOpenAI(env) {
  return new URL(openAIBaseUrl(env)).hostname === "api.openai.com";
}

function openAIRequestPayload(payload, env) {
  if (usesDirectOpenAI(env)) return payload;
  const gatewayPayload = { ...payload };
  delete gatewayPayload.service_tier;
  return gatewayPayload;
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

function sameOriginFailure(req) {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  let expected;
  try {
    expected = new URL(req.url).origin;
  } catch {
    return jsonResponse({ error: "Origin not allowed." }, 403, {
      "Cache-Control": "no-store",
    });
  }
  return origin === expected
    ? null
    : jsonResponse({ error: "Origin not allowed." }, 403, {
      "Cache-Control": "no-store",
    });
}

async function publicPartPrices(url, context) {
  const requested = String(url.searchParams.get("listingIds") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const listingIds = [...new Set(requested)];
  if (!listingIds.length || listingIds.length > 30) {
    return jsonResponse({ error: "Provide between 1 and 30 approved listing IDs." }, 400, {
      "Cache-Control": "no-store",
    });
  }
  if (listingIds.some((listingId) => !PUBLIC_PRICE_LISTING_IDS.has(listingId))) {
    return jsonResponse({ error: "One or more listing IDs are not approved." }, 400, {
      "Cache-Control": "no-store",
    });
  }

  try {
    const store = getStore({
      name: priceStoreNameForFunctionContext(context),
      consistency: "strong",
    });
    const quotes = [];
    for (const listingId of listingIds) {
      const value = await store.get(`v1/us/${listingId}.json`, {
        type: "json",
        consistency: "strong",
      });
      const quote = publicPriceQuote(value, listingId);
      if (quote) quotes.push(quote);
    }
    return jsonResponse(
      { quotes, generatedAt: new Date().toISOString() },
      200,
      { "Cache-Control": "public, max-age=60, stale-while-revalidate=180" },
    );
  } catch (error) {
    console.error("Public part-price lookup failed", error);
    return jsonResponse({ quotes: [], generatedAt: new Date().toISOString() }, 200, {
      "Cache-Control": "no-store",
    });
  }
}

function priceStoreNameForFunctionContext(context = {}) {
  return context?.deploy?.context === "production"
    ? PRICE_STORE_NAME
    : `${PRICE_STORE_NAME}-preview`;
}

function publicPriceQuote(value, expectedListingId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.listingId !== expectedListingId) return null;
  const displayState = String(value.displayState || "");
  if (!new Set(["fresh", "recent", "stale", "unavailable", "review-required"]).has(displayState)) {
    return null;
  }
  const destinationUrl = approvedAmazonDestination(value.destinationUrl);
  if (!destinationUrl) return null;
  const quote = {
    listingId: expectedListingId,
    displayState,
    asOf: validIsoDate(value.asOf) ? value.asOf : null,
    expiresAt: validIsoDate(value.expiresAt) ? value.expiresAt : null,
    destinationUrl,
  };
  if (Number.isInteger(value.amount) && value.amount > 0 && value.currency === "USD") {
    quote.price = { amount: value.amount, currency: value.currency };
  }
  return quote;
}

function approvedAmazonDestination(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    return host === "amazon.com" || host.endsWith(".amazon.com") ? url.href : "";
  } catch {
    return "";
  }
}

function validIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
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

function binaryResponse(bytes, contentType, headers = {}) {
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      ...headers,
    },
  });
}
