"use client";

import { useEffect, useRef, useState } from "react";
import "./checkout-return.css";

type State = "loading" | "paid" | "pending" | "error" | "cancelled";
const copy: Record<State, { title: string; body: string }> = {
  loading: { title: "Checking your payment…", body: "Please wait while we verify your Ember pre-order securely." },
  paid: { title: "Your Ember pre-order is confirmed.", body: "Your payment has been verified. Thank you for making Ember part of your desk. Keep your checkout receipt for your records." },
  pending: { title: "Your payment isn’t confirmed yet.", body: "It may still be processing. Check again in a moment before placing another order." },
  error: { title: "We couldn’t verify your payment.", body: "This doesn’t mean your payment failed. Check again, or contact us if you’re unsure. Checking again will never charge you." },
  cancelled: { title: "Checkout was cancelled.", body: "Your pre-order hasn’t been confirmed. You can continue browsing and return to checkout when you’re ready." },
};

export function CheckoutReturn({ apiOrigin = "" }: { apiOrigin?: string }) {
  const [details, setDetails] = useState<{ session: string; cancelled: boolean } | null>(null);
  const [state, setState] = useState<State>("loading");
  const [attempt, setAttempt] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const query = new URL(window.location.href).searchParams;
    if (query.has("session_id") || query.get("checkout") === "success" || query.get("checkout") === "cancelled") {
      setDetails({ session: query.get("session_id") || "", cancelled: query.get("checkout") === "cancelled" });
    }
  }, []);

  useEffect(() => {
    if (!details) return;
    if (details.cancelled) { setState("cancelled"); return; }
    if (!details.session) { setState("error"); return; }
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => controller.abort(), 15000);
    setState("loading");
    void fetch(`${apiOrigin}/api/checkout/status?session_id=${encodeURIComponent(details.session)}`, {
      signal: controller.signal, cache: "no-store",
    }).then(async (response) => {
      const result = await response.json();
      if (!response.ok || typeof result.paid !== "boolean") throw new Error("Verification unavailable");
      if (active) setState(result.paid === true ? "paid" : "pending");
    }).catch(() => { if (active) setState("error"); })
      .finally(() => window.clearTimeout(timer));
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [details, attempt, apiOrigin]);

  useEffect(() => {
    if (!details || dismissed || !dialog.current) return;
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    heading.current?.focus();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [details, dismissed]);
  if (!details || dismissed) return null;
  function dismiss() {
    const url = new URL(window.location.href);
    url.searchParams.delete("checkout");
    url.searchParams.delete("session_id");
    window.history.replaceState(window.history.state, "", url);
    setDismissed(true);
  }
  return (
    <dialog ref={dialog} onCancel={(event) => event.preventDefault()} className="checkout-return" aria-labelledby="checkout-return-title" aria-busy={state === "loading"}>
      {state === "paid" && <div className="checkout-return-check" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none"><path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>}
      <span className="checkout-return-eyebrow">EMBER PRE-ORDER</span>
      <div role="status" aria-live="polite" aria-atomic="true">
        <h2 id="checkout-return-title" ref={heading} tabIndex={-1}>{copy[state].title}</h2>
        <p>{copy[state].body}</p>
      </div>
      <div className="checkout-return-actions">
        {(state === "pending" || state === "error") && details.session && <button type="button" onClick={() => setAttempt((value) => value + 1)}>Check again</button>}
        <button type="button" onClick={dismiss}>{state === "paid" || state === "cancelled" ? "Continue browsing" : "Close"}</button>
        {(state === "pending" || state === "error") && <a href="mailto:makeable.build@gmail.com">Contact us</a>}
      </div>
    </dialog>
  );
}
