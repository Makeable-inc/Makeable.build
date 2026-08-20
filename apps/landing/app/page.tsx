"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import SeenOnRealDesks from "./SeenOnRealDesks";
import EmberAdopt, { type EmberConfig } from "./EmberAdopt";
import Build002Builder from "./Build002Builder";
import { captureMakeableEvent, makeableDistinctId } from "./analytics";

type EmberColor = "sage" | "bone" | "blush";
type EmberMarket = "US" | "SG";
type CheckoutLocation = "catalogue" | "adopt_flow" | "story_card" | "sticky_bar";

const emberColors: Array<{ id: EmberColor; label: string; stock?: number }> = [
  { id: "sage", label: "Sage", stock: 5 },
  { id: "bone", label: "Beige" },
  { id: "blush", label: "Sakura", stock: 10 },
];

const emberPrices: Record<EmberMarket, { currency: string; amount: number }> = {
  US: { currency: "USD", amount: 34.99 },
  SG: { currency: "SGD", amount: 44.99 },
};

function BrandStar() {
  return (
    <svg className="brand-star" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">
      <path d="M63.8 0 63.3 35.6 98.4 27.5 70.9 49.3 100 61.7 66.5 66 70 100 52 74 43.2 88.7 38.5 71.2 8.5 85.6 28.6 57.5 0 42.5 31.5 40 22.7 9.6 46.3 30.6Z" />
    </svg>
  );
}

export default function Home() {
  const catalogueRef = useRef<HTMLElement>(null);
  const [selectedColor, setSelectedColor] = useState<EmberColor>("bone");
  const [selectedMarket, setSelectedMarket] = useState<EmberMarket>("US");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const checkoutCloseRef = useRef<HTMLButtonElement>(null);
  const [checkoutSuccessOpen, setCheckoutSuccessOpen] = useState(false);
  const checkoutSuccessCloseRef = useRef<HTMLButtonElement>(null);
  const [adoptedConfig, setAdoptedConfig] = useState<EmberConfig | null>(null);
  const [exitSurveyOpen, setExitSurveyOpen] = useState(false);
  const build002Ref = useRef<HTMLElement>(null);
  const checkoutOriginRef = useRef<CheckoutLocation>("adopt_flow");
  const selectedEmberColor = emberColors.find((color) => color.id === selectedColor);
  const selectedPrice = emberPrices[selectedMarket];
  useEffect(() => {
    const locale = navigator.language.toUpperCase();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (locale.endsWith("-SG") || timeZone === "Asia/Singapore") setSelectedMarket("SG");
  }, []);

  useEffect(() => {
    const returnUrl = new URL(window.location.href);
    const checkoutState = returnUrl.searchParams.get("checkout");
    if (checkoutState === "cancelled") {
      captureMakeableEvent("checkout cancelled", { checkout_state: "cancelled" });
      returnUrl.searchParams.delete("checkout");
      window.history.replaceState({}, "", `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`);
      return;
    }
    if (checkoutState !== "success") return;

    const sessionId = returnUrl.searchParams.get("session_id");
    if (!sessionId) return;

    let cancelled = false;
    const verifyCheckout = async () => {
      try {
        const response = await fetch(`/api/checkout/status?session_id=${encodeURIComponent(sessionId)}`, {
          headers: { Accept: "application/json" },
        });
        const result = await response.json() as { paid?: boolean };
        if (!cancelled && response.ok && result.paid) {
          captureMakeableEvent("checkout return verified", { checkout_state: "success" });
          setCheckoutSuccessOpen(true);
          returnUrl.searchParams.delete("checkout");
          returnUrl.searchParams.delete("session_id");
          window.history.replaceState({}, "", `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`);
        }
      } catch (error) {
        console.error("Could not verify completed checkout", error);
      }
    };

    void verifyCheckout();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!checkoutSuccessOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    checkoutSuccessCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCheckoutSuccessOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [checkoutSuccessOpen]);

  useEffect(() => {
    if (!checkoutOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    checkoutCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !checkoutBusy) { setCheckoutOpen(false); setExitSurveyOpen(true); }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [checkoutBusy, checkoutOpen]);

  // Retention — reveal sections as they scroll into view (staggered fade + rise).
  // Skipped entirely under reduced-motion so nothing is hidden from those users.
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (reduceMotion || !("IntersectionObserver" in window)) {
      targets.forEach((el) => el.classList.add("is-inview"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-inview");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -8% 0px" });
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const openCheckout = (location: CheckoutLocation) => {
    checkoutOriginRef.current = location;
    captureMakeableEvent("preorder opened", { cta_location: location });
    setCheckoutError("");
    setCheckoutOpen(true);
  };

  const startCheckout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!termsAccepted) {
      setCheckoutError("Please agree to the Terms and acknowledge the Privacy Policy.");
      return;
    }
    setCheckoutBusy(true);
    setCheckoutError("");
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          color: selectedColor,
          market: selectedMarket,
        quantity,
        termsAccepted,
        marketingConsent,
        posthogDistinctId: makeableDistinctId(),
      }),
      });
      const contentType = response.headers.get("content-type") || "";
      const result = contentType.includes("application/json")
        ? await response.json() as { url?: string; error?: string }
        : {};
      if (!response.ok || !result.url) {
        throw new Error(result.error || (response.status === 404
          ? "Checkout is available on the deployed site."
          : "Checkout is unavailable right now."));
      }
      captureMakeableEvent("checkout started", {
        cta_location: checkoutOriginRef.current,
        market: selectedMarket,
        quantity,
        price_cents: Math.round(selectedPrice.amount * quantity * 100),
      });
      window.location.assign(result.url);
    } catch (error) {
      captureMakeableEvent("checkout start failed", {
        cta_location: checkoutOriginRef.current,
        failure_category: "checkout_session_unavailable",
      });
      setCheckoutError(error instanceof Error ? error.message : "Checkout is unavailable right now.");
      setCheckoutBusy(false);
    }
  };

  // Feature 7 — post-decline placement: point people who pass on Ember at Build 002.
  const showOtherBuilds = () => {
    captureMakeableEvent("build002 entry clicked", { placement: "post_decline" });
    build002Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const inventBuild002 = () => {
    setCheckoutSuccessOpen(false);
    captureMakeableEvent("build002 entry clicked", { placement: "post_purchase" });
    build002Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Feature 8 — closing the modal without paying opens the one-question survey.
  const closeCheckout = () => {
    if (checkoutBusy) return;
    setCheckoutOpen(false);
    setExitSurveyOpen(true);
  };

  const submitExitReason = (reason: string) => {
    captureMakeableEvent("checkout exit reason submitted", { reason });
    setExitSurveyOpen(false);
  };

  return (
    <main>
      <EmberAdopt
        colors={emberColors}
        selectedColor={selectedColor}
        onSelectColor={(color) => setSelectedColor(color)}
        price={selectedPrice}
        onAdopt={(config) => { setAdoptedConfig(config); openCheckout("adopt_flow"); }}
        onShowOtherBuilds={showOtherBuilds}
      />

      <section className="value-strip" data-reveal aria-labelledby="value-title">
        <div className="value-intro">
          <span className="raise-eyebrow">What Ember actually is</span>
          <h2 id="value-title">A tiny living device that runs on your work.</h2>
          <p>
            Ember is a palm-size desk companion with a 2.8-inch display. It wakes up,
            evolves, and glows with every Claude and Codex token you burn — then slowly
            cools while you rest.
          </p>
          <p className="value-spec">2.8″ display · USB-powered · Sage / Beige / Sakura · Ships Oct 2026</p>
        </div>
        <figure className="value-shot">
          <img
            src={`/ember-${selectedColor}-desktop.webp`}
            alt={`${selectedEmberColor?.label ?? "Beige"} Ember`}
            loading="lazy"
            decoding="async"
          />
        </figure>
        <ol className="value-steps">
          <li>
            <span aria-hidden="true">1</span>
            <div>
              <strong>Set it on your desk</strong>
              <p>Plug the Ember display into any USB port. No setup, no app store.</p>
            </div>
          </li>
          <li>
            <span aria-hidden="true">2</span>
            <div>
              <strong>Just keep building</strong>
              <p>Every token you spend with Claude and Codex feeds it and charges its energy.</p>
            </div>
          </li>
          <li>
            <span aria-hidden="true">3</span>
            <div>
              <strong>Watch it come alive</strong>
              <p>Ember levels up through moods and forms, then cools over ~60 hours when you step away.</p>
            </div>
          </li>
        </ol>
      </section>

      <section className="catalogue" id="builds" data-reveal ref={catalogueRef} aria-label="Browse more Makeable builds">
        <div className="catalogue-artwork">
          <img className="catalogue-sheet" src="/build-catalogue-page.png?v=4" alt="What will you make? Ember, Study Desk Companion, and Plant Companion build catalogue" />
          <button
            className={`catalogue-preorder ${checkoutBusy ? "is-busy" : ""}`}
            type="button"
            onClick={() => openCheckout("catalogue")}
            aria-label="Pre-order Ember for 34 dollars and 99 cents USD"
          />
          {checkoutError && <p className="catalogue-checkout-error" role="status">{checkoutError}</p>}
        </div>
      </section>

      <SeenOnRealDesks />

      <section className="make-build-feature" id="make-a-build" data-reveal ref={build002Ref} aria-label="Make your own build">
        <Build002Builder placement="section" />
      </section>

      <footer className="site-footer">
        <div className="footer-main">
          <div className="footer-brand">
            <img className="footer-logo" src="/makeable-logo-tight.webp" alt="Makeable" />
            <strong>Anything is makeable.</strong>
          </div>
          <div className="footer-socials" aria-label="Makeable social channels">
            <a className="footer-social" href="https://www.instagram.com/makeable.build/" target="_blank" rel="noreferrer">
              <img src="/social-instagram.svg" alt="" aria-hidden="true" /><span>Instagram</span>
            </a>
            <a className="footer-social" href="https://www.linkedin.com/company/makeable-build/" target="_blank" rel="noreferrer">
              <img src="/social-linkedin.svg" alt="" aria-hidden="true" /><span>LinkedIn</span>
            </a>
            <a className="footer-social" href="https://x.com/Makeablebuild" target="_blank" rel="noreferrer">
              <img src="/social-x.svg" alt="" aria-hidden="true" /><span>X</span>
            </a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>@Makeable 2026</span>
        </div>
      </footer>

      {/* Retention — sticky buy bar keeps the offer one tap away on mobile scroll. */}
      <div className="sticky-buy" role="region" aria-label="Pre-order Ember">
        <div className="sticky-buy-offer">
          <s><sup>$</sup>89.99</s>
          <strong><sup>$</sup>{selectedPrice.amount.toFixed(2)}</strong>
          <span className="sticky-buy-ship">Free shipping · Ships Oct 2026</span>
        </div>
        <button type="button" className="sticky-buy-cta" onClick={() => openCheckout("sticky_bar")}>
          Pre-order now
        </button>
      </div>

      {checkoutOpen && (
        <div
          className="checkout-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCheckout();
          }}
        >
          <form
            className="checkout-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-title"
            onSubmit={startCheckout}
          >
            <button
              ref={checkoutCloseRef}
              className="checkout-dialog-close"
              type="button"
              aria-label="Close preorder options"
              onClick={closeCheckout}
              disabled={checkoutBusy}
            >
              ×
            </button>
            <small>Build 001 preorder</small>
            <h2 id="checkout-title">
              {adoptedConfig?.name ? `Bring ${adoptedConfig.name} home.` : "Make Ember yours."}
            </h2>
            <p className="checkout-shipping">Free shipping · Ships October 2026 · No account required.</p>

            <div className="checkout-summary">
              <span>
                {adoptedConfig?.name ? `${adoptedConfig.name} · ` : ""}
                {selectedEmberColor?.label ?? "Beige"} Ember
                {adoptedConfig?.level ? ` · ${adoptedConfig.level}` : ""}
                {adoptedConfig?.personality ? ` · ${adoptedConfig.personality}` : ""}
              </span>
              <strong>{selectedPrice.currency} ${(selectedPrice.amount * quantity).toFixed(2)}</strong>
            </div>

            <fieldset className="quantity-picker">
              <legend>Quantity</legend>
              <div>
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  onClick={() => setQuantity((current) => {
                    const next = Math.max(1, current - 1);
                    if (next !== current) captureMakeableEvent("preorder quantity changed", { quantity: next });
                    return next;
                  })}
                  disabled={quantity <= 1 || checkoutBusy}
                >
                  −
                </button>
                <output aria-live="polite" aria-label={`${quantity} Ember kits`}>{quantity}</output>
                <button
                  type="button"
                  aria-label="Increase quantity"
                  onClick={() => setQuantity((current) => {
                    const next = Math.min(10, current + 1);
                    if (next !== current) captureMakeableEvent("preorder quantity changed", { quantity: next });
                    return next;
                  })}
                  disabled={quantity >= 10 || checkoutBusy}
                >
                  +
                </button>
              </div>
              <p>Up to 10 kits per order.</p>
            </fieldset>

            <div className="checkout-consents">
              <label>
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(event) => {
                    setTermsAccepted(event.target.checked);
                    if (event.target.checked) captureMakeableEvent("preorder terms acknowledged");
                  }}
                  required
                />
                <span>
                  I agree to the <a href="/terms/" target="_blank" rel="noreferrer" onClick={() => captureMakeableEvent("preorder legal opened", { document: "terms" })}>Terms</a> and acknowledge the <a href="/privacy/" target="_blank" rel="noreferrer" onClick={() => captureMakeableEvent("preorder legal opened", { document: "privacy" })}>Privacy Policy</a>.
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={marketingConsent}
                  onChange={(event) => {
                    setMarketingConsent(event.target.checked);
                    captureMakeableEvent("preorder marketing consent changed", { opted_in: event.target.checked });
                  }}
                />
                <span>Email me product news, launch updates, and occasional offers.</span>
              </label>
            </div>

            <button className="checkout-continue" type="submit" disabled={checkoutBusy || !termsAccepted}>
              {checkoutBusy ? "Opening secure checkout…" : "Continue to secure checkout"}
              <span aria-hidden="true">→</span>
            </button>
            <p className="checkout-reassure">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
              Payment secured by Stripe · 30-day money-back · Cancel anytime before it ships
            </p>
            {checkoutError && <p className="checkout-dialog-error" role="alert">{checkoutError}</p>}
          </form>
        </div>
      )}

      {checkoutSuccessOpen && (
        <div
          className="checkout-success-backdrop"
          role="presentation"
          onMouseDown={() => setCheckoutSuccessOpen(false)}
        >
          <section
            className="checkout-success-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-success-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              ref={checkoutSuccessCloseRef}
              className="checkout-success-close"
              type="button"
              aria-label="Close order confirmation"
              onClick={() => setCheckoutSuccessOpen(false)}
            >
              ×
            </button>
            <span className="checkout-success-kicker">Pre-order confirmed</span>
            <BrandStar />
            <h2 id="checkout-success-title">
              {adoptedConfig?.name ? `${adoptedConfig.name} is yours.` : "Ember is yours."}
            </h2>
            <p>Your payment was received. Shipping is free and your Ember pre-order is estimated to ship in October 2026.</p>
            {/* Feature 7 — post-purchase Build 002 invitation */}
            <div className="success-next">
              <strong>You adopted Build 001. What should Build 002 do?</strong>
              <button className="checkout-success-action" type="button" onClick={inventBuild002}>
                Invent Build 002 ✦
              </button>
            </div>
            <button
              className="raise-link"
              type="button"
              onClick={() => setCheckoutSuccessOpen(false)}
            >
              Continue exploring
            </button>
          </section>
        </div>
      )}

      {/* Feature 8 — one-question exit survey */}
      {exitSurveyOpen && (
        <div
          className="exit-survey-backdrop"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setExitSurveyOpen(false); }}
        >
          <section className="exit-survey" role="dialog" aria-modal="true" aria-labelledby="exit-survey-title">
            <button
              className="checkout-dialog-close"
              type="button"
              aria-label="Dismiss survey"
              onClick={() => setExitSurveyOpen(false)}
            >
              ×
            </button>
            <h2 id="exit-survey-title">What stopped you today?</h2>
            <div className="exit-survey-options">
              {[
                { id: "price", label: "Price" },
                { id: "ships_late", label: "Ships too late" },
                { id: "unclear_value", label: "Not sure what Ember does for me" },
                { id: "compatibility", label: "Compatibility questions" },
                { id: "checkout_problem", label: "Checkout problem" },
                { id: "just_browsing", label: "Just browsing" },
              ].map((option) => (
                <button key={option.id} type="button" onClick={() => submitExitReason(option.id)}>
                  {option.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
