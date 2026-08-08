const upcoming = [
  { name: "Study Desk Tamagotchi", note: "A tiny focus buddy that grows while you work.", tone: "mint", glyph: "◉ᴗ◉" },
  { name: "Plant With Feelings", note: "A soil sensor with a very expressive face.", tone: "yellow", glyph: "✿" },
  { name: "Pocket Weather Window", note: "Your local forecast, living on your shelf.", tone: "blue", glyph: "☁" },
];

function Logo() {
  return <img className="brand-logo" src="/makeable-logo-transparent.png" alt="Makeable" />;
}

export default function Home() {
  return (
    <main id="top">
      <div className="announcement">Build 001 is here · Meet Ember</div>
      <nav className="nav shell" aria-label="Primary navigation">
        <a href="#top" className="logo-link" aria-label="Makeable home"><Logo /></a>
        <div className="nav-links"><a href="#builds">Builds</a><a href="#why">Why Makeable</a><a href="#how">How it works</a></div>
        <a className="button button-small" href="/products/ember">View Ember</a>
      </nav>

      <section className="hero shell">
        <div className="hero-copy">
          <span className="scribble">Beginner-friendly · works out of the box</span>
          <h1>Small projects.<br />Big <em>I-made-that</em> energy.</h1>
          <p className="lede">Choose a proven electronics build. We send the exact parts, preload the code, and guide you one friendly step at a time.</p>
          <div className="hero-actions"><a className="button button-primary" href="#builds">Browse the builds ↓</a><a className="text-link" href="#how">How Makeable works →</a></div>
          <div className="hero-proof"><span>✓ No coding</span><span>✓ No soldering</span><span>✓ Nothing spare</span></div>
        </div>
        <a className="hero-feature" href="/products/ember" aria-label="View Ember product details">
          <div className="tape">Build 001</div>
          <img src="/amber-hero.jpg" alt="Three Ember desktop companions in Sage, Bone White, and Blush" />
          <div className="feature-caption"><div><span>Makeable build 001</span><strong>Ember</strong><p>Your Claude tokens, but cute.</p></div><div className="price">Explore →</div></div>
        </a>
      </section>

      <section className="builds-section" id="builds">
        <div className="shell">
          <div className="section-title"><div><span className="scribble">Pick your next little obsession</span><h2>Things you can make.</h2></div><p>Every kit is one complete project—not a box of mystery components and crossed fingers.</p></div>
          <div className="build-grid">
            <article className="build-card featured-card">
              <a className="card-media" href="/products/ember"><img src="/amber-hero.jpg" alt="Ember desktop companion" /><span className="status live">Pre-order open</span></a>
              <div className="card-body"><span className="difficulty">Beginner · 5-minute setup</span><h3>Ember</h3><p>A cheerful desktop companion that gives your Claude usage a face.</p><div className="card-meta"><span>Pre-assembled</span><strong>USD 45</strong></div><a className="button button-primary card-button" href="/products/ember">View Ember →</a></div>
            </article>
            {upcoming.map(project => <article className="build-card" key={project.name}><div className={`coming-art ${project.tone}`}><span>{project.glyph}</span><small>Product preview coming soon</small><b className="status soon">Coming soon</b></div><div className="card-body"><span className="difficulty">Beginner-friendly</span><h3>{project.name}</h3><p>{project.note}</p><div className="card-meta"><span>In the workshop</span><strong>—</strong></div><button className="button ghost-button" disabled>Coming soon</button></div></article>)}
          </div>
        </div>
      </section>

      <section className="ember-section shell" id="ember">
        <div className="ember-copy"><span className="scribble coral">Meet build 001</span><h2>Ember wears your token usage on its face.</h2><p>A tiny charcoal-and-flame creature lives beside your laptop, reacting to your Claude Code activity with glances, sparks, celebrations, and dramatic little moods.</p><ul><li>Expressive animated states</li><li>Local-only usage reading</li><li>USB-C powered and connected</li><li>No camera, microphone, or cloud account</li></ul><a className="text-link inline-product-link" href="/products/ember">See everything about Ember →</a></div>
        <div className="mood-board"><figure><img src="/ember-cheerful.gif" alt="Ember cheerful animation" /><figcaption>Cheerful</figcaption></figure><figure><img src="/ember-excited.gif" alt="Ember excited animation" /><figcaption>Excited</figcaption></figure><figure><img src="/ember-explosion.gif" alt="Ember celebration animation" /><figcaption>Token feast</figcaption></figure></div>
      </section>

      <section className="why-section" id="why"><div className="shell why-grid"><div><span className="scribble">The opposite of a starter kit</span><h2>One kit. One build. Nothing spare.</h2><p>A starter kit gives you hundreds of parts and no idea what to do. Makeable sends only what your chosen project needs.</p></div><div className="box-list"><div><b>01</b><span><strong>Exact part count</strong><small>No leftovers and no missing pieces.</small></span></div><div><b>02</b><span><strong>Code already loaded</strong><small>Plug it in. Skip the setup spiral.</small></span></div><div><b>03</b><span><strong>A guide for this build</strong><small>Every screen shows exactly what comes next.</small></span></div></div></div></section>

      <section className="how-section shell" id="how">
        <div className="section-title"><div><span className="scribble coral">From click to working hardware</span><h2>Three steps. That’s it.</h2></div></div>
        <div className="steps"><article><span>01</span><div className="step-glyph">☝</div><h3>Choose a build</h3><p>Open its product page and make sure it belongs on your desk.</p></article><article><span>02</span><div className="step-glyph">▣</div><h3>Open the box</h3><p>Everything is counted, prepared, and ready.</p></article><article><span>03</span><div className="step-glyph">✦</div><h3>Make it work</h3><p>Follow the guide and enjoy the “I made this” moment.</p></article></div>
      </section>

      <section className="preorder-section discovery-cta"><div className="shell preorder-grid"><div><span className="scribble">Founding Maker Edition</span><h2>Curious about Ember?</h2><p>See the complete story, specifications, compatibility, included parts, colors, and preorder terms on its product page.</p></div><div className="discovery-panel"><img src="/ember-cheerful.gif" alt="Ember smiling" /><div><strong>Ember · Build 001</strong><span>Pre-order · USD 45</span></div><a className="button button-primary" href="/products/ember">View product →</a></div></div></section>

      <section className="faq shell"><div><span className="scribble coral">Good questions</span><h2>What is Makeable?</h2></div><div><details open><summary>Do I need electronics experience?<span>+</span></summary><p>No. Makeable is designed for first-time builders, with prepared hardware, preloaded code, and a project-specific guide.</p></details><details><summary>Where do I order a build?<span>+</span></summary><p>Open the build’s product page. That is where you’ll find its complete details, compatibility information, options, price, and checkout.</p></details><details><summary>Will there be more projects?<span>+</span></summary><p>Yes. New builds are being tested now. They’ll receive full product pages when they are ready.</p></details></div></section>

      <footer className="footer shell"><Logo /><p>Anything is Makeable.</p><div><a href="#builds">Builds</a><a href="mailto:hello@makeable.build">Contact</a></div><small>© 2026 Makeable. Claude is a trademark of Anthropic PBC. Makeable is not affiliated with Anthropic.</small></footer>
    </main>
  );
}
