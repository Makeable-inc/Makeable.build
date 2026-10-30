"use client";

import { useEffect, useRef } from "react";
import { mountIsoBuildScene } from "./iso-build-scene.mjs";

// Explainer between the hero and the walkthrough: an animated isometric drawing of
// idea -> verified parts -> wired device. It only animates while on screen.
export function LandingHowItWorks() {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = stageRef.current;
    if (!host) return;
    const scene = mountIsoBuildScene(host, { seed: 7 });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now;
      scene.render((now - start) / 1000);
      frame = requestAnimationFrame(tick);
    };
    scene.render(4.4);
    const observer = new IntersectionObserver(([entry]) => {
      cancelAnimationFrame(frame);
      if (entry.isIntersecting && !reduce) frame = requestAnimationFrame(tick);
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      scene.svg.remove();
    };
  }, []);

  return (
    <section className="mk-how" aria-labelledby="how-title">
      <div className="mk-how-inner">
        <div className="mk-how-copy">
          <h2 id="how-title">From an idea on your desk to parts that fit.</h2>
          <p>Makeable picks real parts, assigns every pin and routes every wire before you buy anything.</p>
          <ol className="mk-how-steps">
            <li><b>Describe it</b><span>Say what you want on your desk, in plain words.</span></li>
            <li><b>We pick the parts</b><span>Only from a hand-checked catalog of parts you can buy today.</span></li>
            <li><b>Wire it and build</b><span>Pins are assigned and wires routed in 3D, so it all fits.</span></li>
          </ol>
        </div>
        <div className="mk-how-stage" ref={stageRef} />
      </div>
    </section>
  );
}
