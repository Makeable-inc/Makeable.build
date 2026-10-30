"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from "react";
import { mountIsoWiring } from "./iso-build-scene.mjs";

// Product walkthrough: a step list on the left and a copy of the app on the right that acts
// out each step. Steps advance on a timer while the section is on screen; clicks and arrow
// keys jump to a step.

const STEP_MS = 6000;
const IDEA = "A desk pet that grows every time I code";

const STEPS = [
  { title: "Describe what you want", body: "Type an idea in plain words. You don't need part numbers." },
  { title: "Watch it plan the build", body: "Makeable picks parts, assigns every pin and routes every wire." },
  { title: "Get a parts list you can buy", body: "Every part comes from a hand-checked catalog, with Amazon and AliExpress prices." },
  { title: "Follow the 3D wiring guide", body: "Go step by step, with each wire shown on the real parts." },
];

const STAGES = ["Clarifying your idea", "Picking parts from the catalog", "Assigning ESP32 pins", "Routing wires in 3D", "Rendering your product"];

// Example parts for the demo screen. Prices are illustrative, not live quotes.
const PARTS = [
  { role: "Controller", spec: "ESP32-S3 DevKitC-1", price: "$14.99", chip: "#2f6f5e" },
  { role: "Display", spec: '1.3" LCD module', price: "$11.99", chip: "#1d3f8f" },
  { role: "Button", spec: "12 mm tactile switch", price: "$4.49", chip: "#d9dde6" },
];

const WIRES = [
  { from: "VCC", to: "3V3", color: "#e5484d" },
  { from: "GND", to: "GND", color: "#1b1d24" },
  { from: "SDA", to: "GPIO 8", color: "#ff2d73" },
  { from: "SCL", to: "GPIO 9", color: "#1688ff" },
];

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion() {
  return window.matchMedia(REDUCED_MOTION).matches;
}

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function at(seconds: number) {
  return { "--at": `${seconds}s` } as CSSProperties;
}

export function LandingWalkthrough() {
  const [step, setStep] = useState(0);
  const [round, setRound] = useState(0); // bumps on every click so the same step restarts
  const [typing, setTyping] = useState({ key: "", count: 0 });
  const [visible, setVisible] = useState(false);
  const reduce = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  const sectionRef = useRef<HTMLElement>(null);
  const wireRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const typingKey = `${step}-${round}`;

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.35 });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = wireRef.current;
    if (!host) return;
    const svg = mountIsoWiring(host);
    return () => svg.remove();
  }, []);

  // advance while on screen
  useEffect(() => {
    if (reduce || !visible) return;
    const timer = window.setTimeout(() => setStep((current) => (current + 1) % STEPS.length), STEP_MS);
    return () => window.clearTimeout(timer);
  }, [step, round, visible, reduce]);

  // type the idea on step 1
  useEffect(() => {
    if (step !== 0 || reduce) return;
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      setTyping({ key: typingKey, count });
      if (count >= IDEA.length) window.clearInterval(timer);
    }, 70);
    return () => window.clearInterval(timer);
  }, [step, reduce, typingKey]);

  function choose(index: number, focus = false) {
    setStep(index);
    setRound((current) => current + 1);
    if (focus) tabRefs.current[index]?.focus();
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      choose((index + 1) % STEPS.length, true);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      choose((index + STEPS.length - 1) % STEPS.length, true);
    }
  }

  const typed = reduce ? IDEA : IDEA.slice(0, typing.key === typingKey ? typing.count : 0);
  const sent = typed.length === IDEA.length;

  return (
    <section
      ref={sectionRef}
      className="mk-walkthrough"
      aria-labelledby="walkthrough-title"
      data-running={visible && !reduce ? "true" : undefined}
      style={{ "--mk-step-ms": `${STEP_MS}ms` } as CSSProperties}
    >
      <div className="mk-walkthrough-inner">
        <div className="mk-walkthrough-copy">
          <h2 id="walkthrough-title">What making it with <em>Makeable</em> looks like</h2>
          <div className="mk-walkthrough-steps" role="tablist" aria-label="Walkthrough steps" aria-orientation="vertical">
            {STEPS.map((item, index) => (
              <button
                key={item.title}
                ref={(node) => { tabRefs.current[index] = node; }}
                type="button"
                role="tab"
                id={`walkthrough-tab-${index}`}
                aria-controls={`walkthrough-panel-${index}`}
                aria-selected={step === index}
                tabIndex={step === index ? 0 : -1}
                onClick={() => choose(index)}
                onKeyDown={(event) => onTabKey(event, index)}
              >
                <span className="mk-walkthrough-rail" aria-hidden="true"><i /></span>
                <b>{item.title}</b>
                <span className="mk-walkthrough-body">{item.body}</span>
              </button>
            ))}
          </div>
          <a className="mk-walkthrough-cta" href="#make">Start your build</a>
        </div>

        <div className="mk-walkthrough-frame">
          <div className="mk-demo-app">
            <div className="mk-demo-top">
              <img src="/makeable-logo-tight.webp" alt="" />
              <div className="mk-demo-tabs" aria-hidden="true">
                <span data-on={step < 3 || undefined}>Overview</span>
                <span data-on={step === 3 || undefined}>Wiring</span>
                <span>Code</span>
              </div>
              <div className="mk-demo-me" aria-hidden="true"><span>10 free builds left</span><i>A</i></div>
            </div>

            <div className="mk-demo-panels">
              <div className="mk-demo-panel mk-demo-create" id="walkthrough-panel-0" role="tabpanel" aria-labelledby="walkthrough-tab-0" data-on={step === 0 || undefined}>
                <h3>Create your own build.</h3>
                <div className="mk-demo-ask">
                  <span>{typed}</span><span className="mk-demo-caret" aria-hidden="true" />
                  <span className="mk-demo-go" data-sent={sent || undefined} aria-hidden="true">→</span>
                </div>
                <small>10 of 10 free builds left</small>
              </div>

              <div className="mk-demo-panel mk-demo-build" id="walkthrough-panel-1" role="tabpanel" aria-labelledby="walkthrough-tab-1" data-on={step === 1 || undefined}>
                <div className="mk-demo-shot"><img src="/assets/landing/walkthrough/ember-card.webp" alt="The desk pet Makeable is building" /></div>
                <div>
                  <h3>Building your desk pet</h3>
                  <p>&ldquo;{IDEA}&rdquo;</p>
                  <ol className="mk-demo-stages">
                    {STAGES.map((stage, index) => <li key={stage} style={at(0.2 + index * 0.9)}><i>✓</i>{stage}</li>)}
                  </ol>
                </div>
              </div>

              <div className="mk-demo-panel mk-demo-parts" id="walkthrough-panel-2" role="tabpanel" aria-labelledby="walkthrough-tab-2" data-on={step === 2 || undefined}>
                <div>
                  <h3>Ember Desk Pet</h3>
                  <div className="mk-demo-image"><img src="/assets/landing/walkthrough/ember-card.webp" alt="Ember desk pet" /></div>
                </div>
                <div>
                  <div className="mk-demo-parts-head"><h3>Your parts</h3><span>$31.47 estimated parts total</span></div>
                  {PARTS.map((part, index) => (
                    <div className="mk-demo-part" key={part.role} style={at(0.15 + index * 0.3)}>
                      <span className="mk-demo-thumb"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13 12 8l9 5-9 5z" fill={part.chip} stroke="#1b1d24" strokeWidth="1" /><path d="M9 12.5 12 11l3 1.5-3 1.5z" fill="#ff2d73" /></svg></span>
                      <div><b>{part.role}</b><small>{part.spec} · Qty 1</small></div>
                      <div className="mk-demo-retailer"><span className="mk-demo-amazon">amazon</span><strong>{part.price}</strong>View listing</div>
                      <div className="mk-demo-retailer"><span className="mk-demo-ali">AliExpress</span><strong>Check</strong>Search</div>
                    </div>
                  ))}
                  <div className="mk-demo-actions"><span className="mk-demo-coral">Open wiring →</span></div>
                </div>
              </div>

              <div className="mk-demo-panel mk-demo-wiring" id="walkthrough-panel-3" role="tabpanel" aria-labelledby="walkthrough-tab-3" data-on={step === 3 || undefined}>
                <div className="mk-demo-view">
                  <div className="mk-demo-view-tabs"><span data-on>Isometric</span><span>Top</span><span>Pin close-up</span></div>
                  <div className="mk-demo-view-stage" ref={wireRef} />
                </div>
                <div>
                  <div className="mk-demo-nums"><span>1</span><span data-on>2</span><span>3</span></div>
                  <div className="mk-demo-eyebrow">Step 2 of 3</div>
                  <h3>Connect the display</h3>
                  <ul className="mk-demo-wires">
                    {WIRES.map((wire, index) => (
                      <li key={wire.from} style={{ ...at(0.3 + index * 0.8), "--wire": wire.color } as CSSProperties}>
                        <i /><code>{wire.from}</code> to <code>{wire.to}</code>
                      </li>
                    ))}
                  </ul>
                  <span className="mk-demo-coral">Next step →</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
