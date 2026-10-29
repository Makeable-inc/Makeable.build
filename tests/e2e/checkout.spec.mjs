// Brief Step 5 (line 147): an Ember checkout test that always behaves the same
// and creates no real order. The pre-order runs through our real API on a
// second test server (PAYMENTS_PORT) that has a dummy Stripe key and a fake
// Stripe (scripts/dev-local.mjs --fake-stripe). The main test server has no
// Stripe key, like the live AWS site today, so it says pre-orders are opening soon.
import { createHmac } from "node:crypto";

import { expect, test } from "./test.mjs";

import { PAYMENTS_PORT, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } from "./fixture-data.mjs";
import { sameOriginHeaders } from "./helpers.mjs";

const PAYMENTS = `http://localhost:${PAYMENTS_PORT}`;
const FAKE_CHECKOUT = /^https:\/\/checkout\.stripe\.com\/c\/pay\/(cs_test_e2e\w+)$/;

async function openPreorder(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Pre-order Ember", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Make Ember yours." });
  const submit = dialog.getByRole("button", { name: "Continue to secure checkout" });
  await expect(submit).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /I agree to the Terms/ }).check();
  return { dialog, submit };
}

async function outsideCalls(request, baseURL) {
  return (await request.get(`${baseURL}/__outside-calls`)).json();
}

// Signs a webhook body the way Stripe does (Stripe-Signature: t=..., v1=HMAC).
function stripeSignature(payload, secret, time = Math.floor(Date.now() / 1000)) {
  return `t=${time},v1=${createHmac("sha256", secret).update(`${time}.${payload}`, "utf8").digest("hex")}`;
}

test.describe("with a Stripe key (fake Stripe)", () => {
  test.use({ baseURL: PAYMENTS });

  test("pre-order sends the buyer to Stripe checkout with the right order", async ({ page, request }) => {
    await request.delete(`${PAYMENTS}/__outside-calls`);
    // The fake checkout page; the browser never reaches Stripe.
    await page.route(FAKE_CHECKOUT, (route) => route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Fake Stripe checkout</title><h1>Fake Stripe checkout</h1>",
    }));

    const { submit } = await openPreorder(page);
    await submit.click();
    await expect(page).toHaveURL(FAKE_CHECKOUT);
    await expect(page.getByRole("heading", { name: "Fake Stripe checkout" })).toBeVisible();

    // What our API sent to Stripe.
    const { calls, misses } = await outsideCalls(request, PAYMENTS);
    expect(misses).toEqual([]);
    const created = calls.filter((call) => call.service === "stripe");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      method: "POST",
      path: "/v1/checkout/sessions",
      authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    });
    expect(created[0].form).toMatchObject({
      mode: "payment",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": "3499",
      "line_items[0][price_data][product_data][name]": "Makeable Ember — Beige",
      "line_items[0][quantity]": "1",
      "shipping_options[0][shipping_rate_data][fixed_amount][amount]": "0",
      "shipping_address_collection[allowed_countries][]": ["US", "SG"],
      "metadata[ember_color]": "bone",
      "metadata[market]": "US",
      "metadata[quantity]": "1",
      "metadata[terms_accepted]": "true",
      "metadata[privacy_acknowledged]": "true",
      "metadata[marketing_consent]": "false",
      "metadata[consent_source]": "makeable_web_preorder",
      "payment_intent_data[metadata][ember_color]": "bone",
      success_url: `${PAYMENTS}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PAYMENTS}/?checkout=cancelled`,
    });
  });

  test("@desktop-only a paid order is confirmed, and a signed Stripe webhook records it", async ({ request }) => {
    await request.delete(`${PAYMENTS}/__outside-calls`);
    const started = await request.post("/api/checkout", {
      headers: sameOriginHeaders(PAYMENTS),
      data: { color: "sage", market: "SG", quantity: 2, termsAccepted: true, posthogDistinctId: "e2e-buyer" },
    });
    expect(started.status()).toBe(200);
    const sessionId = (await started.json()).url.match(FAKE_CHECKOUT)?.[1];
    expect(sessionId).toBeTruthy();

    // Checkout status asks Stripe; the fake buyer has paid.
    const status = await request.get(`/api/checkout/status?session_id=${sessionId}`);
    expect(await status.json()).toEqual({ paid: true });

    // Stripe's webhook for the paid session, with the metadata our API sent.
    const { calls } = await outsideCalls(request, PAYMENTS);
    const form = calls.find((call) => call.service === "stripe" && call.method === "POST").form;
    const metadata = Object.fromEntries(Object.entries(form)
      .filter(([key]) => /^metadata\[[^\]]+\]$/.test(key))
      .map(([key, value]) => [key.slice(9, -1), value]));
    expect(metadata).toMatchObject({ ember_color: "sage", market: "SG", quantity: "2", posthog_distinct_id: "e2e-buyer" });
    const event = JSON.stringify({
      id: "evt_e2e_paid",
      type: "checkout.session.completed",
      data: { object: { id: sessionId, object: "checkout.session", payment_status: "paid", amount_total: 8998, currency: "sgd", metadata } },
    });

    // A wrong signature is refused and records nothing.
    const paidEvents = async () => (await outsideCalls(request, PAYMENTS)).calls
      .filter((call) => call.service === "posthog" && call.body?.event === "order paid");
    const forged = await request.post("/api/stripe/webhook", {
      headers: { "Content-Type": "application/json", "Stripe-Signature": stripeSignature(event, "whsec_wrong") },
      data: event,
    });
    expect(forged.status()).toBe(400);
    expect(await paidEvents()).toEqual([]);

    const signed = await request.post("/api/stripe/webhook", {
      headers: { "Content-Type": "application/json", "Stripe-Signature": stripeSignature(event, STRIPE_WEBHOOK_SECRET) },
      data: event,
    });
    expect(signed.status()).toBe(200);
    expect(await signed.json()).toEqual({ received: true });

    // The order is recorded as an "order paid" analytics event (PostHog,
    // answered locally by the test server).
    const recorded = await paidEvents();
    expect(recorded).toHaveLength(1);
    expect(recorded[0].body).toMatchObject({
      event: "order paid",
      properties: {
        $insert_id: "evt_e2e_paid",
        distinct_id: "e2e-buyer",
        amount_cents: 8998,
        currency: "sgd",
        color: "sage",
        market: "SG",
        quantity: 2,
        product_id: "ember",
        source: "stripe_webhook",
      },
    });
  });
});

test.describe("without a Stripe key (the live site today)", () => {
  test("pre-order says pre-orders are opening soon and calls nobody", async ({ page, request, baseURL }) => {
    await request.delete(`${baseURL}/__outside-calls`);
    const { dialog, submit } = await openPreorder(page);
    await submit.click();
    await expect(dialog.getByRole("alert")).toHaveText("Pre-orders are opening soon.");
    await expect(page).toHaveURL(`${baseURL}/`);
    const { calls, misses } = await outsideCalls(request, baseURL);
    expect(calls.filter((call) => call.service === "stripe")).toEqual([]);
    expect(misses).toEqual([]);
  });
});
