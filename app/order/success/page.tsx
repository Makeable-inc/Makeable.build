import Link from "next/link";

type CheckoutSession = { id?: string; payment_status?: string; customer_details?: { email?: string }; amount_total?: number; currency?: string };

export default async function OrderSuccess({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id } = await searchParams;
  let session: CheckoutSession | null = null;
  if (session_id && /^cs_[A-Za-z0-9_]+$/.test(session_id) && process.env.STRIPE_SECRET_KEY) {
    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session_id)}`, {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }, cache: "no-store",
    });
    if (response.ok) session = await response.json() as CheckoutSession;
  }
  const paid = session?.payment_status === "paid";
  return (
    <main className="order-page">
      <section className="order-card">
        <div className="order-pet">{paid ? "•ᴗ•" : "•︵•"}</div>
        <span className="kicker">{paid ? "Pre-order confirmed" : "Payment status unavailable"}</span>
        <h1>{paid ? "Ember is saving you a spot." : "Let’s check that again."}</h1>
        <p>{paid ? `A receipt is on its way${session?.customer_details?.email ? ` to ${session.customer_details.email}` : ""}. We’ll send production updates and confirm your shipping address before Ember leaves the workshop.` : "We couldn’t verify a completed payment for this checkout. No fulfillment has been started."}</p>
        {paid && <div className="order-total">Paid <strong>{new Intl.NumberFormat("en-US", { style: "currency", currency: (session?.currency || "usd").toUpperCase() }).format((session?.amount_total || 0) / 100)}</strong></div>}
        <Link href="/" className="button button-primary">Back to Ember</Link>
      </section>
    </main>
  );
}
