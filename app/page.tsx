import { Logo, SiteFooter } from "./components/brand";

const upcoming = [
  { name: "Study Desk Tamagotchi", note: "A tiny focus buddy that grows while you work.", tone: "mint", glyph: "◉ᴗ◉" },
  { name: "Plant With Feelings", note: "A soil sensor with a very expressive face.", tone: "yellow", glyph: "✿" },
  { name: "Pocket Weather Window", note: "Your local forecast, living on your shelf.", tone: "blue", glyph: "☁" },
];

const flow = [
  { number: "01", title: "Choose one proven build", copy: "Every kit has one clear outcome and only the exact components it needs." },
  { number: "02", title: "Open a prepared box", copy: "Parts are counted, the code is already loaded, and nothing extra gets in the way." },
  { number: "03", title: "Follow the friendly guide", copy: "A project-specific walkthrough takes you from first connection to a working object." },
];

export default function Home() {
  return (
    <main id="top">
      <div className="announcement">Build 001 is here · Meet Ember</div>
      <nav className="nav shell" aria-label="Primary navigation">
        <a href="#top" className="logo-link" aria-label="Makeable home"><Logo /></a>
        <div className="nav-links"><a href="#builds">Builds</a><a href="#how">How Makeable works</a><a href="#faq">FAQ</a></div>
        <a className="button button-small" href="/products/ember">View Ember</a>
      </nav>

      <section className="hero shell compact-hero">
        <div className="hero-copy">
          <span className="scribble">Beginner-friendly · works out of the box</span>
          <h1>Small projects.<br />Big <em>I-made-that</em> energy.</h1>
          <p className="lede">Choose a proven electronics build. We send the exact parts, preload the code, and guide you one friendly step at a time.</p>
          <div className="hero-actions"><a className="button button-primary" href="#builds">Browse the builds ↓</a><a className="text-link" href="#how">See how it works →</a></div>
          <div className="hero-proof"><span>✓ No coding</span><span>✓ No soldering</span><span>✓ Nothing spare</span></div>
        </div>
        <a className="hero-feature" href="/products/ember" aria-label="View Ember product details">
          <div className="tape">Build 001</div>
          <img src="/ember-hero-v3.png" alt="Three Ember desktop companions in Sage Green, Bone White, and Blush Pink" />
          <div className="feature-caption"><div><span>Founding Maker Edition</span><strong>Ember</strong><p>Your Claude tokens, but cute.</p></div><div className="price">Explore →</div></div>
        </a>
      </section>

      <section className="builds-section" id="builds">
        <div className="shell">
          <div className="section-title compact-title"><div><span className="scribble">Pick your next little obsession</span><h2>Things you can make.</h2></div><p>One complete project per kit—prepared, proven, and friendly to first-time builders.</p></div>
          <div className="build-grid compact-build-grid">
            <article className="build-card featured-card">
              <a className="card-media" href="/products/ember"><img src="/ember-hero-v3.png" alt="Three Ember desktop companions" /><span className="status live">Pre-order open</span></a>
              <div className="card-body"><span className="difficulty">Beginner · 5-minute setup</span><h3>Ember</h3><p>A cheerful desktop companion that gives your Claude usage a face.</p><div className="card-meta"><span>Pre-assembled</span><strong>USD 45</strong></div><a className="button button-primary card-button" href="/products/ember">View Ember →</a></div>
            </article>
            {upcoming.map(project => <article className="build-card upcoming-card" key={project.name}><div className={`coming-art ${project.tone}`}><span>{project.glyph}</span><b className="status soon">Coming soon</b></div><div className="card-body"><span className="difficulty">In the workshop</span><h3>{project.name}</h3><p>{project.note}</p></div></article>)}
          </div>
        </div>
      </section>

      <section className="makeable-flow" id="how">
        <div className="shell flow-layout">
          <div className="flow-intro" id="why"><span className="scribble coral">The opposite of a starter kit</span><h2>Pick it. Open it. Make it.</h2><p>Makeable removes the parts-bin guesswork without removing the joy of building something real.</p></div>
          <div className="flow-steps">{flow.map(step => <article key={step.number}><span>{step.number}</span><div><h3>{step.title}</h3><p>{step.copy}</p></div></article>)}</div>
        </div>
      </section>

      <section className="faq shell compact-faq" id="faq"><div><span className="scribble coral">Good questions</span><h2>Before you build.</h2></div><div><details open><summary>Do I need electronics experience?<span>+</span></summary><p>No. Makeable is designed for first-time builders, with prepared hardware, preloaded code, and a project-specific guide.</p></details><details><summary>Where do I order a build?<span>+</span></summary><p>Open the build’s product page for its complete details, options, price, and secure checkout.</p></details><details><summary>Will there be more projects?<span>+</span></summary><p>Yes. New builds are being tested now and will receive full product pages when ready.</p></details></div></section>

      <SiteFooter />
    </main>
  );
}
