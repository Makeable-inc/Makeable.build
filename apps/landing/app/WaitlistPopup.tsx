"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import "./waitlist-popup.css";

type WaitlistPopupProps = {
  open: boolean;
  /** Dismiss the popup (close button, backdrop, or Escape). */
  onClose: () => void;
  /** Called once the email has been saved to the waitlist. */
  onJoined: () => void;
  /** Success CTA: take the visitor to the Ember offer / checkout. */
  onGetEmber: () => void;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function WaitlistPopup({ open, onClose, onJoined, onGetEmber }: WaitlistPopupProps) {
  const emailRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [emberImageBroken, setEmberImageBroken] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTarget = joined ? closeRef.current : emailRef.current;
    const timer = window.setTimeout(() => focusTarget?.focus(), 150);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [open, joined, busy, onClose]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = email.trim();
    setMessage("");
    if (!EMAIL_PATTERN.test(value)) {
      setMessage("Please enter a valid email.");
      emailRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/build-interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      const contentType = response.headers.get("content-type") || "";
      const result = contentType.includes("application/json")
        ? await response.json() as { ok?: boolean; error?: string }
        : {};
      if (!response.ok || !result.ok) {
        throw new Error(result.error || (response.status === 404
          ? "Waitlist signup is available on the deployed site."
          : "Something went wrong. Please try again."));
      }
      onJoined();
      setJoined(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`mk-overlay ${open ? "is-open" : ""}`}
      role="presentation"
      aria-hidden={!open}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="mk-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={joined ? undefined : "mkTitle"}
        aria-label={joined ? "You're in" : undefined}
      >
        <button
          ref={closeRef}
          className="mk-close"
          type="button"
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
        >
          ×
        </button>

        {!joined ? (
          <div className="mk-main">
            <div className="mk-spark" aria-hidden="true">✦</div>

            <h2 id="mkTitle" className="mk-title">
              Join the<br />
              Make Your Own Build<br />
              waitlist
            </h2>

            <div className="mk-divider" />

            <p className="mk-intro">
              Be the first to get <strong>early access</strong> to Makeable builds
              and get 61% off Ember — available to use <strong>right away.</strong>
            </p>

            <div className="mk-offer-card">
              <div className="mk-tag-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 2.8 12V4a1.2 1.2 0 0 1 1.2-1.2H12a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.8Z" />
                  <circle cx="7.3" cy="7.3" r="1.4" fill="currentColor" stroke="none" />
                  <path d="M15.4 13.1 16 15l1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z" fill="currentColor" stroke="none" />
                </svg>
              </div>
              <div>
                <p className="mk-offer-label">Waitlist exclusive</p>
                <p className="mk-offer-title">
                  Get <strong>61% off</strong> Ember
                </p>
                <p className="mk-offer-sub">Use your code immediately.</p>
              </div>
            </div>

            <form className="mk-form" onSubmit={submit} noValidate>
              <label className="mk-sr-only" htmlFor="mkEmail" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
                Email address
              </label>
              <input
                ref={emailRef}
                id="mkEmail"
                className="mk-email"
                type="email"
                name="email"
                autoComplete="email"
                placeholder="Enter your email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
              <button id="mkSubmit" className="mk-submit" type="submit" disabled={busy}>
                {busy ? "CONFIRMING…" : "CONFIRM ✦"}
              </button>
              <p className={`mk-message ${message ? "error" : ""}`} aria-live="polite">{message}</p>
            </form>

            <div className="mk-ember-wrap">
              <span className="mk-mini-spark left" aria-hidden="true">✦</span>
              {emberImageBroken ? (
                <span className="mk-ember-fallback" aria-hidden="true">🔥</span>
              ) : (
                <img
                  className="mk-ember-image"
                  src="/waitlist-ember.png"
                  alt="Ember"
                  onError={() => setEmberImageBroken(true)}
                />
              )}
              <span className="mk-mini-spark right" aria-hidden="true">✧</span>
            </div>
          </div>
        ) : (
          <div className="mk-success">
            <div className="mk-spark" aria-hidden="true">✦</div>
            <h3>You&apos;re in.</h3>
            <p>
              Your Ember discount is ready. Continue to Ember and use your
              61% discount right away.
            </p>
            <button className="mk-buy" type="button" onClick={onGetEmber}>
              GET EMBER WITH 61% OFF ✦
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
