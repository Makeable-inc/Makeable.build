"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type ProjectPart } from "./project-overview";
import { SavedWiringViewer } from "./saved-wiring-viewer";
import { projectDisplayIdentity } from "./project-identity.mjs";
import { projectWiringSteps, wiringConnectionsForStep } from "./project-wiring-data.mjs";

type WiringEndpoint = {
  label?: string;
  partId?: string;
  nodeName?: string;
};

type WiringConnection = {
  id: string;
  label?: string;
  signal?: string;
  color?: string;
  from?: WiringEndpoint;
  to?: WiringEndpoint;
};

type WiringStep = {
  id: string;
  kind?: string;
  title: string;
  beginnerInstruction?: string;
  safetyNote?: string;
  activeWires?: string[];
  wirelessLinkIds?: string[];
  visibleParts?: string[];
};

type AssemblyPart = {
  id: string;
  assetId?: string;
  label?: string;
  catalogPartId?: string;
  role?: string;
};

type WirelessLink = {
  id: string;
  protocol?: string;
  fromNodeId?: string;
  toNodeId?: string;
};

export type WiringProject = {
  id: string;
  title: string;
  summary: string;
  behavior?: string;
  parts: ProjectPart[];
  artifactStates?: {
    wiring?: { state?: string; reason?: string };
  };
  artifacts?: {
    assembly?: {
      state?: string;
      guideSteps?: WiringStep[];
      wires?: WiringConnection[];
      wirelessLinks?: WirelessLink[];
      parts?: AssemblyPart[];
    };
  };
};

export function ProjectWiringGuide({ build }: { build: WiringProject }) {
  const steps = useMemo(() => projectWiringSteps(build) as WiringStep[], [build]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [mobilePane, setMobilePane] = useState<"visual" | "details">("visual");
  const identity = projectDisplayIdentity(build);

  const boundedIndex = Math.min(activeIndex, Math.max(0, steps.length - 1));
  const activeStep = steps[boundedIndex];
  const progressRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = progressRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!nav || !current) return;
    const keepCurrentVisible = () => {
      const frame = nav.getBoundingClientRect();
      const button = current.getBoundingClientRect();
      if (button.left < frame.left) nav.scrollLeft -= frame.left - button.left + 8;
      else if (button.right > frame.right) nav.scrollLeft += button.right - frame.right + 8;
    };
    keepCurrentVisible();
    const observer = new ResizeObserver(keepCurrentVisible);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [boundedIndex]);
  const connections = useMemo(
    () => wiringConnectionsForStep(build, activeStep) as WiringConnection[],
    [activeStep, build],
  );
  const wirelessLinks = useMemo(() => {
    const activeLinkIds = new Set(activeStep?.wirelessLinkIds || []);
    return (build.artifacts?.assembly?.wirelessLinks || []).filter((link) => activeLinkIds.has(link.id));
  }, [activeStep, build]);

  return (
    <section className="mk-project-wiring" aria-labelledby="workspace-title" data-mobile-pane={mobilePane}>
      <h1 id="workspace-title" className="mk-visually-hidden">Wire {identity.title}</h1>

      <div className="mk-wiring-toolbar">
        <nav ref={progressRef} className="mk-wiring-progress" aria-label="Wiring steps">
          {steps.map((step, index) => (
            <button
              type="button"
              key={step.id}
              aria-current={index === boundedIndex ? "step" : undefined}
              onClick={() => setActiveIndex(index)}
            >
              <strong>{index + 1}</strong>
              <span>{step.title}</span>
            </button>
          ))}
        </nav>
        <div className="mk-wiring-pane-toggle" aria-label="Wiring view">
          <button type="button" aria-pressed={mobilePane === "visual"} onClick={() => setMobilePane("visual")}>Visual</button>
          <button type="button" aria-pressed={mobilePane === "details"} onClick={() => setMobilePane("details")}>Details</button>
        </div>
      </div>

      <div className="mk-wiring-mobile-instruction" role="status"><strong>{activeStep?.title}</strong><span>{activeStep?.beginnerInstruction}</span>{activeStep?.safetyNote && <span className="mk-wiring-mobile-safety">{activeStep.safetyNote}</span>}</div>
      <div className="mk-wiring-workbench">
        <section className="mk-wiring-simulation" aria-labelledby="wiring-simulation-title">
          <div className="mk-wiring-simulation-heading">
            <div>
              <h2 id="wiring-simulation-title">Your assembly</h2>
            </div>
            <p>Saved guide · No credit used</p>
          </div>
          <SavedWiringViewer key={build.id} buildId={build.id} stepIndex={boundedIndex} />
        </section>

        {activeStep && <article className="mk-wiring-step-card">
          <div className="mk-wiring-step-heading" aria-live="polite" aria-atomic="true">
            <span>Step {boundedIndex + 1} of {steps.length}</span>
            <h2>{activeStep.title}</h2>
            <p>{activeStep.beginnerInstruction || "Follow the highlighted connection labels for this step."}</p>
          </div>

          <div className="mk-wiring-connections" tabIndex={0} role="region" aria-label="Connection instructions">
            {connections.length ? connections.map((connection) => (
              <div className="mk-wiring-connection" key={connection.id}>
                <i style={{ backgroundColor: connection.color || "#ff6470" }} aria-hidden="true" />
                <div>
                  <strong>{connection.label || connection.signal || "Connection"}</strong>
                  <span><b>From</b> {connection.from?.label || connection.from?.nodeName || connection.from?.partId}</span>
                  <span><b>To</b> {connection.to?.label || connection.to?.nodeName || connection.to?.partId}</span>
                </div>
              </div>
            )) : wirelessLinks.length ? wirelessLinks.map((link) => (
              <div className="mk-wiring-preparation" key={link.id}>
                <strong>{link.protocol || "ESP-NOW"} wireless link</strong>
                <span>{link.fromNodeId || "First device"} ↔ {link.toNodeId || "Second device"}. No physical wire needed.</span>
              </div>
            )) : (
              <div className="mk-wiring-preparation">
                <strong>{activeStep.kind === "placement" ? "No wire is needed yet." : "No external wire is required."}</strong>
                <span>{activeStep.kind === "placement" ? "Arrange or seat the named parts first, then continue." : "Follow the check above using the controller’s built-in hardware."}</span>
              </div>
            )}
          </div>

          {activeStep.safetyNote && <aside className="mk-wiring-safety">
            <strong>Before you continue</strong>
            <span>{activeStep.safetyNote}</span>
          </aside>}
        </article>}
      </div>

      <footer className="mk-wiring-step-controls">
        <button type="button" disabled={boundedIndex === 0} onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}>Previous</button>
        <span>{boundedIndex + 1} / {steps.length}</span>
        <button type="button" disabled={boundedIndex >= steps.length - 1} onClick={() => setActiveIndex((index) => Math.min(steps.length - 1, index + 1))}>Next step</button>
      </footer>
    </section>
  );
}
