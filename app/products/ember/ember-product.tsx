"use client";

import { useRef, useState } from "react";
import { Logo, SiteFooter } from "../../components/brand";

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

const specs = [
  ["Display", "2.4-inch, 320 × 240 color screen"],
  ["Approx. size", "76 × 70 × 38 mm"],
  ["Power + data", "Single USB-C connection"],
  ["Controls", "Side button + auto brightness"],
  ["Prototype host", "Apple Silicon Mac · macOS 13+"],
  ["Claude Code", "Version 2.1.80 or newer"],
  ["Enclosure", "Matte printed shell + dark bezel"],
  ["Not included", "Camera, mic, battery, or cloud account"],
];

const included = [
  ["01", "Ember desktop companion", "Pre-assembled enclosure, display, controller, and expressive light."],
  ["02", "Pre-flashed controller", "The device software is already loaded."],
  ["03", "USB-C cable", "Power and local data in one connection."],
  ["04", "Makeable setup guide", "Connect the helper, plug in Ember, and meet your desk pet."],
];

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
    <main id="top" className="product-page compact-product-page">
      <div className="announcement">Founding Maker Edition · Batch 01</div>
      <nav className="nav shell" aria-label="Primary navigation">
        <a href="/" className="logo-link" aria-label="Makeable home"><Logo /></a>
        <div className="nav-links"><a href="#overview">Meet Ember</a><a href="#specs">Details</a><a href="#product-faq">FAQ</a></div>
        <a className="button button-small" href="#buy">Pre-order Ember</a>
      </nav>

      <div className="product-breadcrumb shell"><a href="/">All builds</a><span>→</span><strong>Ember</strong></div>

      <section className="product-hero shell">
        <div className="product-gallery">
          <div className="product-main-image"><span className="status live">Pre-order open</span><img src="/ember-hero-v3.png" alt="Ember in Sage Green, Bone White, and Blush Pink" /></div>
          <div className="product-gallery-strip">
            {moods.map(mood => <figure key={mood.name}><img src={mood.image} alt={`${mood.name} Ember animation`} /><figcaption>{mood.name}</figcaption></figure>)}
          </div>
        </div>

        <aside className="purchase-card" id="buy">
          <span className="scribble">Makeable build 001</span>
          <h1>Ember</h1>
          <p className="product-tagline">Your Claude tokens, but cute.</p>
          <div className="product-price"><strong>USD 45</strong><span>Founding Maker Edition</span></div>
          <p className="product-summary">A palm-sized USB-C companion whose charcoal-and-flame creature reacts to your Claude Code activity—without reading or uploading your prompts or code.</p>
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

      <section className="product-overview" id="overview">
        <div className="shell overview-layout">
          <div className="overview-copy"><span className="scribble coral">A usage meter with a soul</span><h2>Invisible work becomes a tiny living presence.</h2><p>Ember turns Claude Code activity into glanceable moods: curious when input is needed, focused while tools run, joyful after success, and peacefully asleep when you step away.</p></div>
          <div className="mood-compact">{moods.map(mood => <article key={mood.name}><img src={mood.image} alt={`${mood.name} Ember animation`} /><div><h3>{mood.name}</h3><p>{mood.copy}</p></div></article>)}</div>
          <div className="privacy-inline"><div><strong>Private by design.</strong><span>The local helper sends only small usage and mood signals over USB.</span></div><div className="privacy-chips"><span>No prompts</span><span>No source code</span><span>No credentials</span></div></div>
        </div>
      </section>

      <section className="product-details" id="specs">
        <div className="shell details-layout">
          <div><div className="compact-heading"><span className="scribble coral">The useful details</span><h2>Small, local, and desk-ready.</h2><p>Prototype specifications may receive small production refinements before Batch 01 ships.</p></div><div className="spec-grid compact-spec-grid">{specs.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></div>
          <div className="inside-compact"><span className="scribble">Inside Batch 01</span><h2>Everything Ember needs.</h2><ol>{included.map(([number, title, copy]) => <li key={number}><b>{number}</b><span><strong>{title}</strong><small>{copy}</small></span></li>)}</ol></div>
        </div>
      </section>

      <section className="product-setup-faq shell" id="product-faq">
        <div className="setup-compact"><span className="scribble coral">Three-minute setup target</span><h2>From box to first reaction.</h2><ol><li><b>01</b><span><strong>Install the helper</strong><small>For Apple Silicon Macs and Claude Code.</small></span></li><li><b>02</b><span><strong>Connect USB-C</strong><small>One cable carries power and local state messages.</small></span></li><li><b>03</b><span><strong>Start working</strong><small>Complete a response and watch Ember wake up.</small></span></li></ol></div>
        <div className="faq-list"><span className="scribble coral">Before you preorder</span><h2>Good to know.</h2><details open><summary>Does Ember read my conversations or code?<span>+</span></summary><p>No. It only uses local usage and status signals—never prompts, responses, source code, filenames, or credentials.</p></details><details><summary>What does the current prototype support?<span>+</span></summary><p>Apple Silicon Macs running macOS 13 or newer with Claude Code 2.1.80 or newer.</p></details><details><summary>When will Batch 01 ship?<span>+</span></summary><p>Shipping is estimated for December 2026. Makeable will send production updates before fulfillment.</p></details><details><summary>Can I cancel my preorder?<span>+</span></summary><p>Yes. You can request a full refund any time before your Ember ships.</p></details></div>
      </section>

      <SiteFooter />
    </main>
  );
}
