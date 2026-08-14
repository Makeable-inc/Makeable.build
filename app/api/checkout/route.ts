export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return Response.json({ error: "Pre-orders are opening soon." }, { status: 503 });
  }

  const origin = new URL(request.url).origin;
  const body = new URLSearchParams({
    mode: "payment",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": "4500",
    "line_items[0][price_data][product_data][name]": "Makeable Ember — Build 001",
    "line_items[0][price_data][product_data][description]": "Snap-fit desk pet kit with USB-C power and a living display.",
    "line_items[0][quantity]": "1",
    success_url: `${origin}/?checkout=success`,
    cancel_url: `${origin}/?checkout=cancelled`,
    integration_identifier: "makeable_ember_qtmsvkwp",
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2026-06-24.dahlia",
    },
    body,
  });
  const checkout = await response.json() as { url?: string; error?: { message?: string } };

  if (!response.ok || !checkout.url) {
    return Response.json(
      { error: checkout.error?.message || "Unable to create checkout." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json({ url: checkout.url }, { headers: { "Cache-Control": "no-store" } });
}
