"use client";

import { useMemo, useState } from "react";
import { compactStepNumbers, friendlyPartName, wiringCopy, wiringEndpointLabel } from "../../circuit-lab/wiring-presentation.mjs";
import { PartThumbnail, type ProjectPart } from "./project-overview";
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
  const copy = wiringCopy(activeStep, build.artifacts?.assembly);
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
        <nav className="mk-wiring-progress" aria-label="Wiring steps">
          {compactStepNumbers(steps.length, boundedIndex).map((entry, position) => entry === "gap" ? <span className="mk-step-gap" key={`gap-${position}`} aria-hidden="true">…</span> : (
            <button
              type="button"
              key={entry}
              aria-label={`Step ${Number(entry) + 1}: ${wiringCopy(steps[Number(entry)], build.artifacts?.assembly).title}`}
              aria-current={entry === boundedIndex ? "step" : undefined}
              onClick={() => setActiveIndex(Number(entry))}
            >
              <strong>{Number(entry) + 1}</strong>
            </button>
          ))}
        </nav>
        <div className="mk-wiring-pane-toggle" aria-label="Wiring view">
          <button type="button" aria-pressed={mobilePane === "visual"} onClick={() => setMobilePane("visual")}>3D view</button>
          <button type="button" aria-pressed={mobilePane === "details"} onClick={() => setMobilePane("details")}>Instructions</button>
        </div>
      </div>

      <div className="mk-wiring-mobile-instruction" role="status"><strong>{copy.title}</strong>{copy.safety && <span className="mk-wiring-mobile-safety">{copy.safety}</span>}</div>
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
            <h2>{copy.title}</h2>
            <p>{copy.instruction || "Follow the highlighted connection labels for this step."}</p>
          </div>

          <div className="mk-wiring-connections" tabIndex={0} role="region" aria-label="Connection instructions">
            {connections.length ? connections.map((connection) => (
              <div className="mk-wiring-connection" key={connection.id}>
                <i style={{ backgroundColor: connection.color || "#ff6470" }} aria-hidden="true" />
                <div>
                  <strong>{connection.label || connection.signal || "Connection"}</strong>
                  <span><b>From</b> {wiringEndpointLabel(connection.from, build.artifacts?.assembly)}</span>
                  <span><b>To</b> {wiringEndpointLabel(connection.to, build.artifacts?.assembly)}</span>
                </div>
              </div>
            )) : wirelessLinks.length ? wirelessLinks.map((link) => (
              <div className="mk-wiring-preparation" key={link.id}>
                <strong>{link.protocol || "ESP-NOW"} wireless link</strong>
                <span>{link.fromNodeId || "First device"} ↔ {link.toNodeId || "Second device"}. No physical wire needed.</span>
              </div>
            )) : (
              <div className="mk-wiring-preparation">
                {activeStep.kind === "mount" ? (build.artifacts?.assembly?.parts || []).filter(part => activeStep.visibleParts?.includes(part.id)).map(part => {
                  const catalog = build.parts.find(item => item.id === part.catalogPartId || item.name === part.label);
                  return <div className="mk-step-part" key={part.id}>{catalog && <PartThumbnail part={catalog} />}<strong>{friendlyPartName(part)}</strong></div>;
                }) : <><strong>{activeStep.kind === "placement" ? "No wires needed yet." : "Check the connections shown."}</strong><span>{activeStep.kind === "placement" ? "Arrange the parts as shown." : "Follow the instructions above."}</span></>}
              </div>
            )}
          </div>

          <details className="mk-wiring-original"><summary>Part details</summary><p>{activeStep.title}</p><p>{activeStep.beginnerInstruction}</p></details>
          {copy.safety && <aside className="mk-wiring-safety">
            <strong>Before you continue</strong>
            <span>{copy.safety}</span>
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
