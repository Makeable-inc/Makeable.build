function hex(bytes: ArrayBuffer) { return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function timingSafeEqual(a: string, b: string) { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }

async function verify(payload: string, signatureHeader: string, secret: string) {
  const fields = Object.fromEntries(signatureHeader.split(",").map((part) => part.split("=", 2)));
  if (!fields.t || !fields.v1 || Math.abs(Date.now() / 1000 - Number(fields.t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${fields.t}.${payload}`));
  return timingSafeEqual(hex(signature), fields.v1);
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  const payload = await request.text();
  if (!secret || !signature || !(await verify(payload, signature, secret))) return Response.json({ error: "Invalid webhook signature" }, { status: 400 });
  const event = JSON.parse(payload) as { id: string; type: string; data?: { object?: { id?: string; payment_status?: string; metadata?: Record<string, string> } } };
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "charge.refunded"].includes(event.type)) {
    console.log(JSON.stringify({ stripe_event: event.id, type: event.type, object: event.data?.object?.id, product: event.data?.object?.metadata?.product }));
  }
  return Response.json({ received: true });
}
