"use client";

import { useEffect, useRef, useState } from "react";
import { captureMakeableEvent } from "./analytics";

export type EmberColor = "sage" | "bone" | "blush";

export type EmberConfig = {
  name: string;
  personality: string;
  useCase: string;
  color: EmberColor;
  level: string;
};

type EmberColorOption = { id: EmberColor; label: string; stock?: number };

interface EmberAdoptProps {
  colors: EmberColorOption[];
  selectedColor: EmberColor;
  onSelectColor: (color: EmberColor) => void;
  price: { currency: string; amount: number };
  onAdopt: (config: EmberConfig) => void;
  onShowOtherBuilds: () => void;
}

// Ember grows through three real art states (sleepy → awakened → energized),
// one set per color, in /public/ember-states.
const STAGES = [
  { name: "Sleepy", state: "sleepy", tag: "Lvl 1", note: "Cold silicon. Barely awake." },
  { name: "Awakened", state: "awakened", tag: "Lvl 3", note: "First tokens land — it stirs." },
  { name: "Energized", state: "energized", tag: "Lvl 5", note: "Fully alive. Ready to come home." },
] as const;

// Ember color id → art filename prefix.
const COLOR_FILE: Record<EmberColor, string> = {
  sage: "green",
  bone: "bone-white",
  blush: "blush",
};

const USE_CASES = [
  { id: "coding", label: "Coding" },
  { id: "studying", label: "Studying" },
  { id: "creating", label: "Creating" },
  { id: "other", label: "Something else" },
] as const;

const PERSONALITIES = [
  { id: "calm", label: "Calm", note: "steady, low glow" },
  { id: "focused", label: "Focused", note: "locks in with you" },
  { id: "chaotic", label: "Chaotic", note: "big energy" },
  { id: "curious", label: "Curious", note: "always poking around" },
] as const;

const FINAL_STAGE = STAGES.length - 1;
const FEED_RATE = 62; // energy per second while holding (~1.6s per stage)
const SPAWN_INTERVAL = 0.04; // seconds between nutrient particles

const STEP_LABELS = ["Make it yours", "Raise & adopt"];

export default function EmberAdopt({
  colors,
  selectedColor,
  onSelectColor,
  price,
  onAdopt,
  onShowOtherBuilds,
}: EmberAdoptProps) {
  const [step, setStep] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);
  const [energy, setEnergy] = useState(0);
  const [burstKey, setBurstKey] = useState(0);
  const [emberName, setEmberName] = useState("");
  const [useCase, setUseCase] = useState<string>("");
  const [personality, setPersonality] = useState<string>("");
  const [holding, setHolding] = useState(false);

  const innerRef = useRef<HTMLDivElement>(null);
  const particleCanvasRef = useRef<HTMLCanvasElement>(null);
  const feedBtnRef = useRef<HTMLButtonElement>(null);
  const emberRef = useRef<HTMLDivElement>(null);
  const holdingRef = useRef(false);
  const energyRef = useRef(0);
  const stageRef = useRef(0);
  const useCaseRef = useRef(useCase);
  useEffect(() => { useCaseRef.current = useCase; }, [useCase]);

  const stage = STAGES[stageIndex];
  const atFinal = stageIndex >= FINAL_STAGE;
  const selectedOption = colors.find((color) => color.id === selectedColor);
  const displayName = emberName.trim();
  const priceLabel = `${price.currency} $${price.amount.toFixed(2)}`;

  const config = (): EmberConfig => ({
    name: displayName,
    personality,
    useCase,
    color: selectedColor,
    level: stage.name,
  });

  const goStep = (next: number) => {
    setStep(next);
    captureMakeableEvent("ember preview step", { step_index: next, step: STEP_LABELS[next] });
  };

  const chooseColor = (color: EmberColor) => {
    if (color === selectedColor) return;
    onSelectColor(color);
    captureMakeableEvent("ember color selected", { color });
  };

  const chooseUseCase = (id: string) => {
    setUseCase(id);
    captureMakeableEvent("ember use case selected", { use_case: id });
  };

  const startHold = () => {
    if (stageRef.current >= FINAL_STAGE) return;
    holdingRef.current = true;
    setHolding(true);
    captureMakeableEvent("ember fed", { stage_index: stageRef.current, input_method: "hold" });
  };
  const stopHold = () => {
    holdingRef.current = false;
    setHolding(false);
  };

  // Hold-to-feed loop + nutrient particles streaming from the button to Ember.
  useEffect(() => {
    const canvas = particleCanvasRef.current;
    const inner = innerRef.current;
    if (!canvas || !inner) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    type Particle = { sx: number; sy: number; cx: number; cy: number; ex: number; ey: number; t: number; life: number; size: number; hue: string };
    const particles: Particle[] = [];
    let raf = 0;
    let last = performance.now();
    let spawnAcc = 0;
    let disposed = false;

    const resize = () => {
      const r = inner.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(inner);

    const center = (el: Element) => {
      const cr = canvas.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      return { x: (er.left + er.width / 2 - cr.left) * dpr, y: (er.top + er.height / 2 - cr.top) * dpr };
    };

    const spawn = () => {
      const btn = feedBtnRef.current;
      const ember = emberRef.current;
      if (!btn || !ember) return;
      const s = center(btn);
      const e = center(ember);
      particles.push({
        sx: s.x, sy: s.y, ex: e.x, ey: e.y,
        cx: (s.x + e.x) / 2 + (Math.random() - 0.5) * 80 * dpr,
        cy: Math.min(s.y, e.y) - (50 + Math.random() * 70) * dpr,
        t: 0,
        life: 0.7 + Math.random() * 0.5,
        size: (2.5 + Math.random() * 3) * dpr,
        hue: Math.random() < 0.5 ? "#e02d6c" : "#f0954a",
      });
    };

    const loop = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (holdingRef.current && stageRef.current < FINAL_STAGE) {
        energyRef.current += FEED_RATE * dt;
        spawnAcc += dt;
        while (spawnAcc >= SPAWN_INTERVAL) { spawn(); spawnAcc -= SPAWN_INTERVAL; }
        if (energyRef.current >= 100) {
          const to = stageRef.current + 1;
          captureMakeableEvent("ember evolution reached", { from_level: stageRef.current, to_level: to });
          if (to === FINAL_STAGE) {
            captureMakeableEvent("ember aha completed", { use_case_set: useCaseRef.current.length > 0 });
            holdingRef.current = false;
            setHolding(false);
          }
          stageRef.current = to;
          energyRef.current = 0;
          setStageIndex(to);
          setBurstKey((key) => key + 1);
        }
        setEnergy(Math.round(energyRef.current));
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.t += dt / p.life;
        if (p.t >= 1) { particles.splice(i, 1); continue; }
        const mt = 1 - p.t;
        const x = mt * mt * p.sx + 2 * mt * p.t * p.cx + p.t * p.t * p.ex;
        const y = mt * mt * p.sy + 2 * mt * p.t * p.cy + p.t * p.t * p.ey;
        ctx.globalAlpha = p.t < 0.15 ? p.t / 0.15 : 1 - p.t;
        ctx.fillStyle = p.hue;
        ctx.shadowColor = p.hue;
        ctx.shadowBlur = 8 * dpr;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const adopt = (placement: string) => {
    captureMakeableEvent("ember adopt clicked", {
      placement,
      name_set: displayName.length > 0,
      personality_set: personality.length > 0,
      use_case_set: useCase.length > 0,
      level: stage.name,
      color: selectedColor,
    });
    onAdopt(config());
  };

  return (
    <section className="raise" id="experience" aria-labelledby="raise-title">
      {/* Feature 1 — clear offer, always visible up top */}
      <div className="raise-offerbar">
        <img className="raise-logo" src="/makeable-logo-tight.webp" alt="Makeable" />
        <div className="raise-offerbar-price">
          <s><sup>$</sup>89.99</s>
          <strong><sup>$</sup>{price.amount.toFixed(2)}</strong>
          <span className="discount-tag">61% off</span>
        </div>
        <span className="raise-offerbar-facts">Free shipping · Ships Oct 2026</span>
        <button type="button" className="raise-offerbar-cta" onClick={() => adopt("offer_bar")}>
          Pre-order now
        </button>
      </div>

      <div className="raise-inner" ref={innerRef}>
        <canvas className="raise-particles" ref={particleCanvasRef} aria-hidden="true" />
        <div className="raise-stage" ref={emberRef}>
          <div className={`raise-glow color-${selectedColor}`} data-stage={stageIndex} aria-hidden="true" />
          <span key={burstKey} className="raise-burst" aria-hidden="true" />
          <div className="raise-figures" data-stage={stageIndex}>
            {STAGES.map((item, index) => (
              <img
                key={item.state}
                className={`raise-figure-layer ${index === stageIndex ? "is-active" : ""}`}
                src={`/ember-states/${COLOR_FILE[selectedColor]}_${item.state}.png`}
                alt={index === stageIndex ? `${selectedOption?.label ?? "Beige"} Ember — ${item.name}` : ""}
                aria-hidden={index !== stageIndex}
                decoding="async"
              />
            ))}
          </div>
          <div className="raise-badge" aria-live="polite">
            <span className="raise-badge-tag">{stage.tag}</span>
            <strong>{displayName || "Ember"} · {stage.name}</strong>
            <span className="raise-badge-note">{stage.note}</span>
          </div>
          {/* Placeholder marker: swap in real per-level Ember art here. */}
        </div>

        <aside className="raise-panel">
          <ol className="raise-steps" aria-label="Ownership preview steps">
            {STEP_LABELS.map((label, index) => (
              <li key={label} className={index === step ? "is-active" : index < step ? "is-done" : ""}>
                <span>{index + 1}</span> {label}
              </li>
            ))}
          </ol>

          {step === 0 && (
            <div className="raise-body">
              <small className="raise-eyebrow">Build 001 · Raise your Ember</small>
              <h1 id="raise-title"><span>Feed</span> <span>Ember</span> <span>Tokens.</span></h1>
              <p className="raise-lede">
                A desk pet that grows with every Claude and Codex token you burn.
                Make it yours, raise it, then adopt the one you grew.
              </p>

              <fieldset className="color-picker">
                <legend>Choose a color</legend>
                <div className="color-options">
                  {colors.map((color) => (
                    <button
                      key={color.id}
                      type="button"
                      className={`color-option color-${color.id}`}
                      aria-pressed={selectedColor === color.id}
                      onClick={() => chooseColor(color.id)}
                    >
                      <span aria-hidden="true" />
                      {color.label}
                      {selectedColor === color.id && <b aria-hidden="true">✓</b>}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="raise-chips">
                <legend>What are you building today?</legend>
                <div>
                  {USE_CASES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="raise-chip"
                      aria-pressed={useCase === item.id}
                      onClick={() => chooseUseCase(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <button type="button" className="raise-primary" onClick={() => goStep(1)}>
                Start raising Ember <span aria-hidden="true">→</span>
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="raise-body">
              <small className="raise-eyebrow">Step 2 · {atFinal ? "Adopt it" : "Raise it"}</small>
              <h2 className="raise-h2">{atFinal ? "Make it truly yours." : "Feed Ember your work."}</h2>
              {!atFinal && (
                <p className="raise-lede">
                  Every session of tokens grows it. Raise it to Supercharged, then adopt the one you raised.
                </p>
              )}

              <div className="raise-energy" aria-hidden={atFinal}>
                <div className="raise-energy-head">
                  <span>{atFinal ? "Fully charged" : "Ember energy"}</span>
                  <span>{stage.tag}</span>
                </div>
                <div className="raise-energy-track">
                  <div
                    className="raise-energy-fill"
                    style={{ width: `${atFinal ? 100 : energy}%` }}
                    role="progressbar"
                    aria-valuenow={atFinal ? 100 : energy}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Ember energy"
                  />
                </div>
              </div>

              {atFinal ? (
                <>
                  {/* Fully charged: name + adopt inline — no separate stage. */}
                  <label className="raise-name">
                    <span>Name your Ember</span>
                    <input
                      type="text"
                      maxLength={24}
                      value={emberName}
                      placeholder="e.g. Lumi"
                      onChange={(event) => setEmberName(event.target.value)}
                      onBlur={() => { if (displayName) captureMakeableEvent("ember named", { name_set: true }); }}
                    />
                  </label>

                  <fieldset className="raise-chips">
                    <legend>Pick a personality</legend>
                    <div>
                      {PERSONALITIES.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="raise-chip"
                          aria-pressed={personality === item.id}
                          onClick={() => {
                            setPersonality(item.id);
                            captureMakeableEvent("ember personality selected", { personality: item.id });
                          }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  {/* Feature 4 — ownership card */}
                  <div className="raise-ownercard">
                    <span className="raise-ownercard-tag">Your Ember</span>
                    <strong>{displayName || "Ember"}</strong>
                    <p>
                      {selectedOption?.label ?? "Beige"} Ember · Level 5
                      {useCase ? ` · ${USE_CASES.find((u) => u.id === useCase)?.label} companion` : ""}
                    </p>
                    <p className="raise-ownercard-sub">
                      {personality ? `${PERSONALITIES.find((p) => p.id === personality)?.label} personality · ` : ""}
                      Grows with Claude and Codex
                    </p>
                  </div>

                  <div className="raise-offer">
                    <s className="ember-price-was"><sup>$</sup>89.99</s>
                    <span className="price-arrow" aria-hidden="true">→</span>
                    <strong className="ember-price"><sup>$</sup>{price.amount.toFixed(2)}</strong>
                    <span className="discount-tag">61% off</span>
                  </div>
                  <button type="button" className="raise-adopt-btn" onClick={() => adopt("adopt_flow")}>
                    Adopt {displayName || "Ember"} — {priceLabel}
                    <span aria-hidden="true">✦</span>
                  </button>
                  <p className="raise-fineprint">Free shipping · Ships October 2026 · No account required</p>
                </>
              ) : (
                <>
                  <div className="raise-feed-hold">
                    <button
                      type="button"
                      ref={feedBtnRef}
                      className={`raise-holdbtn ${holding ? "is-holding" : ""}`}
                      onPointerDown={startHold}
                      onPointerUp={stopHold}
                      onPointerLeave={stopHold}
                      onPointerCancel={stopHold}
                      onContextMenu={(event) => event.preventDefault()}
                      aria-label="Press and hold to feed Ember"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 11V6.5a1.5 1.5 0 0 1 3 0V11" />
                        <path d="M12 11V4.5a1.5 1.5 0 0 1 3 0V11" />
                        <path d="M15 11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-2.3-3a1.5 1.5 0 0 1 2.3-1.9l1 1V9a1.5 1.5 0 0 1 3 0v2" />
                      </svg>
                    </button>
                    <span className="raise-hold-label">Hold to feed 25k tokens</span>
                  </div>
                  <button
                    type="button"
                    className={`raise-hold-cta ${holding ? "is-holding" : ""}`}
                    onPointerDown={startHold}
                    onPointerUp={stopHold}
                    onPointerLeave={stopHold}
                    onPointerCancel={stopHold}
                    onContextMenu={(event) => event.preventDefault()}
                  >
                    {holding ? "Keep holding…" : "Hold to feed"}
                  </button>
                </>
              )}
              <button type="button" className="raise-link" onClick={() => goStep(0)}>← Back</button>
            </div>
          )}

          <button type="button" className="other-builds" onClick={onShowOtherBuilds}>
            Ember isn’t your build? Make your own.
          </button>
        </aside>
      </div>
    </section>
  );
}
