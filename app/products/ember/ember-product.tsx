"use client";

import { useRef, useState } from "react";

const emberColors = [
  { name: "Sage Green", swatch: "sage" },
  { name: "Bone White", swatch: "bone-white" },
  { name: "Blush Pink", swatch: "blush" },
] as const;

const moods = [
  { name: "Cheerful", copy: "A clean task completion earns a happy bounce.", image: "/ember-cheerful.gif" },
  { name: "Excited", copy: "Sustained activity turns up the flame and sparks.", image: "/ember-excited.gif" },
  { name: "Token feast", copy: "Milestones get one gloriously dramatic celebration.", image: "/ember-explosion.gif" },
];

function Logo() {
  return <img className="brand-logo" src="/makeable-logo-transparent.png" alt="Makeable" />;
}

function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <fieldset className="color-picker product-color-picker">
      <legend>Enclosure color · {value}</legend>
      <div className="color-options">
        {emberColors.map(color => (
          <button type="button" className="color-option" aria-pressed={value === color.name} onClick={() => onChange(color.name)} key={color.name}>
            <span className={`color-swatch ${color.swatch}`} aria-hidden="true" />{color.name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export default function EmberProduct() {
  const [quantity, setQuantity] = useState(1);
  const [selectedColor, setSelectedColor] = useState("Sage Green");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const checkoutAttempt = useRef(crypto.randomUUID());

  async function preorder() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Idempotency-Key": checkoutAttempt.current },
        body: JSON.stringify({ quantity, color: selectedColor }),
      });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error || "Checkout could not start.");
      window.location.href = data.url;
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Checkout could not start.");
      checkoutAttempt.current = crypto.randomUUID();
      setLoading(false);
    }
  }

  return (
    <main id="top" className="product-page">
      <div className="announcement">Founding Maker Edition · Batch 01</div>
      <nav className="nav shell" aria-label="Primary navigation">
        <a href="/" className="logo-link" aria-label="Makeable home"><Logo /></a>
        <div className="nav-links"><a href="/#builds">All builds</a><a href="#how-it-works">How Ember works</a><a href="#specs">Specifications</a></div>
        <a className="button button-small" href="#buy">Pre-order Ember</a>
      </nav>

      <div className="product-breadcrumb shell"><a href="/">All builds</a><span>→</span><strong>Ember</strong></div>

      <section className="product-hero shell">
        <div className="product-gallery">
          <div className="product-main-image"><span className="status live">Pre-order open</span><img src="/ember-hero-v2.png" alt="Ember in Sage Green, Bone White, and Blush Pink showing Cheerful, Excited, and Token Feast artwork" /></div>
          <div className="product-gallery-strip">
            {moods.map(mood => <figure key={mood.name}><img src={mood.image} alt={`${mood.name} Ember animation`} /><figcaption>{mood.name}</figcaption></figure>)}
          </div>
        </div>

        <aside className="purchase-card" id="buy">
          <span className="scribble">Makeable build 001</span>
          <h1>Ember</h1>
          <p className="product-tagline">Your Claude tokens, but cute.</p>
          <div className="product-price"><strong>USD 45</strong><span>Founding Maker Edition</span></div>
          <p className="product-summary">A palm-sized USB-C desktop companion whose little charcoal-and-flame creature reacts to your Claude Code activity—without reading or uploading your prompts or code.</p>
          <div className="product-pills"><span>Pre-assembled</span><span>Local-only</span><span>USB-C</span></div>
          <ColorPicker value={selectedColor} onChange={setSelectedColor} />
          <div className="product-order-row">
            <div className="quantity" aria-label="Quantity selector"><button onClick={() => setQuantity(Math.max(1, quantity - 1))} aria-label="Decrease quantity">−</button><span>{quantity}</span><button onClick={() => setQuantity(Math.min(5, quantity + 1))} aria-label="Increase quantity">+</button></div>
            <button className="button button-primary product-buy-button" onClick={preorder} disabled={loading}>{loading ? "Opening checkout…" : `Pre-order ${selectedColor} · USD ${45 * quantity}`}</button>
          </div>
          {error && <p className="checkout-error" role="alert">{error}</p>}
          <div className="purchase-notes"><span>Estimated shipping December 2026</span><span>Secure Stripe checkout</span><span>Full refund before shipping</span></div>
        </aside>
      </section>

      <section className="product-story shell" id="how-it-works">
        <div><span className="scribble coral">A usage meter with a soul</span><h2>Invisible work becomes a tiny living presence.</h2></div>
        <div><p>Ember turns your Claude Code activity into something you can understand at a glance. It looks curious when your agent needs input, focuses while tools run, celebrates success, cools down when your budget is full, and falls peacefully asleep when you step away.</p><p>The launch experience is intentionally simple: one original creature, an expressive face, a growing habitat, and no dashboard clutter.</p></div>
      </section>

      <section className="moods-section">
        <div className="shell">
          <div className="section-title"><div><span className="scribble">A face you learn in seconds</span><h2>Work has a mood now.</h2></div><p>Large eyes, a tiny mouth, and a flame that changes with activity keep every state readable from across your desk.</p></div>
          <div className="mood-detail-grid">{moods.map(mood => <article key={mood.name}><img src={mood.image} alt={`${mood.name} Ember animation`} /><span>Animated state</span><h3>{mood.name}</h3><p>{mood.copy}</p></article>)}</div>
        </div>
      </section>

      <section className="privacy-section"><div className="shell privacy-grid"><div><span className="scribble">Private by design</span><h2>Your code stays yours.</h2><p>The local helper reads small usage and status signals, turns them into mood events, and sends those events directly to Ember over USB. It does not need your prompt text, source code, filenames, or conversation history.</p></div><div className="privacy-card"><strong>Ember receives</strong><ul><li>Usage percentage and activity</li><li>Needs-input and completion signals</li><li>A small locally generated mood state</li></ul><strong>Ember never receives</strong><ul><li>Your prompts or responses</li><li>Your source code or filenames</li><li>Your Claude credentials</li></ul></div></div></section>

      <section className="specs-section shell" id="specs">
        <div className="section-title"><div><span className="scribble coral">The useful details</span><h2>Small enough for the corner of your desk.</h2></div><p>Prototype specifications may receive small production refinements before Batch 01 ships.</p></div>
        <div className="spec-grid">
          <div><span>Display</span><strong>2.4-inch, 320 × 240 color screen</strong></div>
          <div><span>Approx. size</span><strong>76 × 70 × 38 mm</strong></div>
          <div><span>Power + data</span><strong>Single USB-C connection</strong></div>
          <div><span>Controls</span><strong>One side button + auto brightness</strong></div>
          <div><span>Prototype host</span><strong>Apple Silicon Mac · macOS 13+</strong></div>
          <div><span>Claude Code</span><strong>Version 2.1.80 or newer</strong></div>
          <div><span>Enclosure</span><strong>Matte printed shell + dark bezel</strong></div>
          <div><span>Not included</span><strong>No camera, mic, battery, or cloud account</strong></div>
        </div>
      </section>

      <section className="inside-section"><div className="shell inside-grid"><div><span className="scribble">Inside Batch 01</span><h2>Everything Ember needs. Nothing it doesn’t.</h2><p>Ember arrives assembled, prepared, and ready for the short guided setup.</p></div><ol><li><b>01</b><span><strong>Ember desktop companion</strong><small>Pre-assembled enclosure, display, controller, and expressive light.</small></span></li><li><b>02</b><span><strong>Pre-flashed controller</strong><small>The device software is already loaded.</small></span></li><li><b>03</b><span><strong>USB-C cable</strong><small>Power and local data in one connection.</small></span></li><li><b>04</b><span><strong>Makeable setup guide</strong><small>Install the local helper, connect Ember, and meet your new desk pet.</small></span></li></ol></div></section>

      <section className="product-steps shell">
        <div className="section-title"><div><span className="scribble coral">From box to first reaction</span><h2>Three-minute setup target.</h2></div></div>
        <div className="steps"><article><span>01</span><div className="step-glyph">⌁</div><h3>Install the helper</h3><p>The first prototype supports Apple Silicon Macs and Claude Code.</p></article><article><span>02</span><div className="step-glyph">⌁</div><h3>Connect USB-C</h3><p>One cable carries both power and tiny local state messages.</p></article><article><span>03</span><div className="step-glyph">✦</div><h3>Start working</h3><p>Complete a Claude Code response and watch Ember wake up.</p></article></div>
      </section>

      <section className="faq product-faq shell"><div><span className="scribble coral">Before you preorder</span><h2>Good to know.</h2></div><div><details open><summary>Is Ember an official Anthropic product?<span>+</span></summary><p>No. Ember is an independent Makeable product and is not affiliated with or endorsed by Anthropic.</p></details><details><summary>Does Ember read my conversations or code?<span>+</span></summary><p>No. The local helper uses usage and status signals. It never needs your prompts, responses, source code, filenames, or Claude credentials.</p></details><details><summary>What does the current prototype support?<span>+</span></summary><p>The current helper targets Apple Silicon Macs running macOS 13 or newer with Claude Code 2.1.80 or newer. Compatibility may expand before shipping.</p></details><details><summary>When will Batch 01 ship?<span>+</span></summary><p>Shipping is estimated for December 2026. Makeable will send production updates and confirm your address before fulfillment.</p></details><details><summary>Can I cancel my preorder?<span>+</span></summary><p>Yes. You can request a full refund any time before your Ember ships.</p></details></div></section>

      <section className="product-final-cta"><div className="shell"><span className="scribble">Founding Maker Edition</span><h2>Give your tokens a face.</h2><p>Choose Sage Green, Bone White, or Blush Pink. Batch 01 is USD 45.</p><a className="button button-primary" href="#buy">Choose your Ember ↑</a></div></section>

      <footer className="footer shell"><Logo /><p>Anything is Makeable.</p><div><a href="/">All builds</a><a href="mailto:hello@makeable.build">Contact</a></div><small>© 2026 Makeable. Claude is a trademark of Anthropic PBC. Makeable is not affiliated with Anthropic.</small></footer>
    </main>
  );
}
