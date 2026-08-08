export async function POST(request: Request) {
  try {
    const body = await request.json() as { quantity?: number; color?: string };
    const quantity = Math.max(1, Math.min(5, Math.floor(Number(body.quantity) || 1)));
    const allowedColors = ["Sage", "Bone White", "Blush"] as const;
    const color = allowedColors.includes(body.color as (typeof allowedColors)[number]) ? body.color as (typeof allowedColors)[number] : "Sage";
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) return Response.json({ error: "Pre-orders are not connected yet. Add the Stripe secret key to activate checkout." }, { status: 503 });

    const origin = new URL(request.url).origin;
    const requestId = request.headers.get("x-idempotency-key") || crypto.randomUUID();
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", `${origin}/order/success?session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", `${origin}/?order=cancelled#top`);
    params.set("line_items[0][quantity]", String(quantity));
    if (process.env.AMBER_PRICE_ID) {
      params.set("line_items[0][price]", process.env.AMBER_PRICE_ID);
    } else {
      params.set("line_items[0][price_data][currency]", "usd");
      params.set("line_items[0][price_data][unit_amount]", process.env.AMBER_PRICE_CENTS || "4500");
      params.set("line_items[0][price_data][product_data][name]", "Ember by Makeable — Pre-order");
      params.set("line_items[0][price_data][product_data][description]", `Founding Maker Edition in ${color}. Estimated shipping December 2026.`);
    }
    params.set("shipping_address_collection[allowed_countries][0]", "US");
    params.set("shipping_address_collection[allowed_countries][1]", "SG");
    params.set("shipping_address_collection[allowed_countries][2]", "GB");
    params.set("shipping_address_collection[allowed_countries][3]", "CA");
    params.set("shipping_address_collection[allowed_countries][4]", "AU");
    params.set("phone_number_collection[enabled]", "true");
    params.set("billing_address_collection", "auto");
    params.set("customer_creation", "always");
    params.set("payment_intent_data[description]", "Ember pre-order");
    params.set("metadata[product]", "ember-preorder");
    params.set("metadata[color]", color);
    params.set("metadata[checkout_attempt]", requestId);
    params.set("payment_intent_data[metadata][product]", "ember-preorder");
    params.set("payment_intent_data[metadata][color]", color);
    params.set("payment_intent_data[metadata][checkout_attempt]", requestId);
    // Ember is a physical product. Managed Payments only supports digital goods,
    // so use standard Checkout to collect the customer's shipping address.
    params.set("managed_payments[enabled]", "false");
    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": requestId },
      body: params,
    });
    const session = await stripeResponse.json() as { url?: string; error?: { message?: string } };
    if (!stripeResponse.ok || !session.url) throw new Error(session.error?.message || "Stripe Checkout could not be created.");
    return Response.json({ url: session.url });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Checkout could not start." }, { status: 500 });
  }
}
