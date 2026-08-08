"use client";

import { useRef, useState } from "react";

const upcoming = [
  { name: "Study Desk Tamagotchi", note: "A tiny focus buddy that grows while you work.", tone: "mint", glyph: "◉ᴗ◉" },
  { name: "Plant With Feelings", note: "A soil sensor with a very expressive face.", tone: "yellow", glyph: "✿" },
  { name: "Pocket Weather Window", note: "Your local forecast, living on your shelf.", tone: "blue", glyph: "☁" },
];

function Logo() {
  return <img className="brand-logo" src="/makeable-logo-transparent.png" alt="Makeable" />;
}

export default function Home() {
  const [quantity, setQuantity] = useState(1);
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
        body: JSON.stringify({ quantity }),
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
    <main id="top">
      <div className="announcement">Batch 01 is open · Ember ships December 2026</div>
      <nav className="nav shell" aria-label="Primary navigation">
        <a href="#top" className="logo-link" aria-label="Makeable home"><Logo /></a>
        <div className="nav-links"><a href="#builds">Builds</a><a href="#why">Why Makeable</a><a href="#how">How it works</a></div>
        <button className="button button-small" onClick={preorder} disabled={loading}>Pre-order Ember</button>
      </nav>

      <section className="hero shell">
        <div className="hero-copy">
          <span className="scribble">Beginner-friendly · works out of the box</span>
          <h1>Small projects.<br />Big <em>I-made-that</em> energy.</h1>
          <p className="lede">Choose a proven electronics build. We send the exact parts, preload the code, and guide you one friendly step at a time.</p>
          <div className="hero-actions"><a className="button button-primary" href="#builds">Browse the builds ↓</a><a className="text-link" href="#how">How Makeable works →</a></div>
          <div className="hero-proof"><span>✓ No coding</span><span>✓ No soldering</span><span>✓ Nothing spare</span></div>
        </div>
        <div className="hero-feature">
          <div className="tape">Available now</div>
          <img src="/amber-hero.jpg" alt="Three Ember desktop companions in sage, cream, and pink" />
          <div className="feature-caption"><div><span>Makeable build 001</span><strong>Ember</strong><p>Your Claude tokens, but cute.</p></div><div className="price">USD 45</div></div>
        </div>
      </section>

      <section className="builds-section" id="builds">
        <div className="shell">
          <div className="section-title"><div><span className="scribble">Pick your next little obsession</span><h2>Things you can make.</h2></div><p>Every kit is one complete project—not a box of mystery components and crossed fingers.</p></div>
          <div className="build-grid">
            <article className="build-card featured-card">
              <div className="card-media"><img src="/amber-hero.jpg" alt="Ember desktop companion" /><span className="status live">Pre-order</span></div>
              <div className="card-body"><span className="difficulty">Beginner · 5-minute setup</span><h3>Ember</h3><p>A cheerful desktop companion that changes mood as your Claude token usage climbs.</p><div className="card-meta"><span>Pre-assembled</span><strong>USD 45</strong></div><button className="button button-primary card-button" onClick={preorder} disabled={loading}>{loading ? "Opening checkout…" : "Pre-order Ember →"}</button></div>
            </article>
            {upcoming.map(project => <article className="build-card" key={project.name}><div className={`coming-art ${project.tone}`}><span>{project.glyph}</span><small>Product preview coming soon</small><b className="status soon">Coming soon</b></div><div className="card-body"><span className="difficulty">Beginner-friendly</span><h3>{project.name}</h3><p>{project.note}</p><div className="card-meta"><span>In the workshop</span><strong>—</strong></div><button className="button ghost-button" disabled>Coming soon</button></div></article>)}
          </div>
        </div>
      </section>

      <section className="ember-section shell" id="ember">
        <div className="ember-copy"><span className="scribble coral">Meet build 001</span><h2>Ember wears your token usage on its face.</h2><p>Connect Ember to Wi-Fi and your Claude usage becomes a tiny living presence on your desk—from quietly hopeful to dramatically overfed.</p><ul><li>Five expressive animated states</li><li>Pre-flashed and ready to connect</li><li>USB-C powered, Wi-Fi connected</li><li>Independent Makeable product</li></ul></div>
        <div className="mood-board"><figure><img src="/ember-cheerful.gif" alt="Ember cheerful animation" /><figcaption>Cheerful</figcaption></figure><figure><img src="/ember-excited.gif" alt="Ember excited animation" /><figcaption>Excited</figcaption></figure><figure><img src="/ember-explosion.gif" alt="Ember explosion animation" /><figcaption>Token feast</figcaption></figure></div>
      </section>

      <section className="why-section" id="why"><div className="shell why-grid"><div><span className="scribble">The opposite of a starter kit</span><h2>One kit. One build. Nothing spare.</h2><p>A starter kit gives you hundreds of parts and no idea what to do. Makeable sends only what your chosen project needs.</p></div><div className="box-list"><div><b>01</b><span><strong>Exact part count</strong><small>No leftovers and no missing pieces.</small></span></div><div><b>02</b><span><strong>Code already loaded</strong><small>Plug it in. Skip the setup spiral.</small></span></div><div><b>03</b><span><strong>A guide for this build</strong><small>Every screen shows exactly what comes next.</small></span></div></div></div></section>

      <section className="how-section shell" id="how">
        <div className="section-title"><div><span className="scribble coral">From click to working hardware</span><h2>Three steps. That’s it.</h2></div></div>
        <div className="steps"><article><span>01</span><div className="step-glyph">☝</div><h3>Choose a build</h3><p>Pick a project you actually want on your desk.</p></article><article><span>02</span><div className="step-glyph">▣</div><h3>Open the box</h3><p>Everything is counted, prepared, and ready.</p></article><article><span>03</span><div className="step-glyph">✦</div><h3>Make it work</h3><p>Follow the guide and enjoy the “I made this” moment.</p></article></div>
      </section>

      <section className="preorder-section"><div className="shell preorder-grid"><div><span className="scribble">Founding Maker Edition</span><h2>Make Ember yours.</h2><p>Batch 01 · Estimated shipping December 2026 · Secure checkout with Stripe.</p></div><div className="order-panel"><div className="order-line"><span>Ember preorder</span><strong>USD {45 * quantity}</strong></div><div className="quantity-row"><div className="quantity" aria-label="Quantity selector"><button onClick={() => setQuantity(Math.max(1, quantity - 1))} aria-label="Decrease quantity">−</button><span>{quantity}</span><button onClick={() => setQuantity(Math.min(5, quantity + 1))} aria-label="Increase quantity">+</button></div><button className="button button-primary" onClick={preorder} disabled={loading}>{loading ? "Opening checkout…" : "Continue to checkout →"}</button></div>{error && <p className="checkout-error" role="alert">{error}</p>}<small>Cancel for a full refund before shipping.</small></div></div></section>

      <section className="faq shell"><div><span className="scribble coral">Good questions</span><h2>Before you order.</h2></div><div><details open><summary>Do I need electronics experience?<span>+</span></summary><p>No. Makeable is designed for first-time builders, and Ember arrives assembled and pre-flashed.</p></details><details><summary>Is Ember an official Anthropic product?<span>+</span></summary><p>No. Ember is an independent Makeable product and is not affiliated with or endorsed by Anthropic.</p></details><details><summary>When will Ember ship?<span>+</span></summary><p>Batch 01 is planned for December 2026. We’ll send production updates and confirm your address before fulfillment.</p></details><details><summary>Can I cancel my preorder?<span>+</span></summary><p>Yes. You can request a full refund any time before your order ships.</p></details></div></section>

      <footer className="footer shell"><Logo /><p>Anything is Makeable.</p><div><a href="#builds">Builds</a><a href="mailto:hello@makeable.build">Contact</a></div><small>© 2026 Makeable. Claude is a trademark of Anthropic PBC. Makeable is not affiliated with Anthropic.</small></footer>
    </main>
  );
}
