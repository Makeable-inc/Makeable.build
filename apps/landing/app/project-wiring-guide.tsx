"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PartThumbnail, type ProjectPart } from "./project-overview";
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
  const connections = useMemo(
    () => wiringConnectionsForStep(build, activeStep) as WiringConnection[],
    [activeStep, build],
  );
  const wirelessLinks = useMemo(() => {
    const activeLinkIds = new Set(activeStep?.wirelessLinkIds || []);
    return (build.artifacts?.assembly?.wirelessLinks || []).filter((link) => activeLinkIds.has(link.id));
  }, [activeStep, build]);
  const visibleParts = useMemo(() => wiringPartsForStep(build, activeStep, connections), [activeStep, build, connections]);
  const diagramRef = useRef<HTMLDivElement>(null);
  const [diagram, setDiagram] = useState<{width: number; height: number; parts: Record<string, {x: number; y: number; width: number; height: number}>}>({width: 1, height: 1, parts: {}});
  useEffect(() => {
    const container = diagramRef.current;
    if (!container) return;
    const measure = () => {
      const frame = container.getBoundingClientRect();
      if (!frame.width || !frame.height) return;
      const parts = Object.fromEntries(Array.from(container.querySelectorAll<HTMLElement>("article[data-part-id]")).map((part) => {
        const box = part.getBoundingClientRect();
        return [part.dataset.partId!, {x: box.x - frame.x, y: box.y - frame.y, width: box.width, height: box.height}];
      }));
      setDiagram({width: frame.width, height: frame.height, parts});
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    container.querySelectorAll("article").forEach((part) => observer.observe(part));
    measure();
    return () => observer.disconnect();
  }, [visibleParts, mobilePane]);
  const connectionPaths = useMemo(() => {
    return connections.flatMap((connection, index) => {
      const from = diagram.parts[connection.from?.partId || ""];
      const to = diagram.parts[connection.to?.partId || ""];
      if (!from || !to) return [];
      const forward = to.x >= from.x;
      const startX = from.x + (forward ? from.width : 0);
      const endX = to.x + (forward ? 0 : to.width);
      const offset = (index - (connections.length - 1) / 2) * Math.min(14, Math.min(from.height, to.height) / (connections.length + 1));
      const fromY = from.y + from.height / 2 + offset;
      const toY = to.y + to.height / 2 + offset;
      const midX = (startX + endX) / 2;
      return [{ id: connection.id, color: connection.color || "#ff6470", path: `M ${startX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${endX} ${toY}` }];
    });
  }, [connections, diagram]);

  return (
    <section className="mk-project-wiring" aria-labelledby="workspace-title" data-mobile-pane={mobilePane}>
      <h1 id="workspace-title" className="mk-visually-hidden">Wire {identity.title}</h1>

      <div className="mk-wiring-toolbar">
        <nav className="mk-wiring-progress" aria-label="Wiring steps">
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
              <span>Saved assembly view</span>
              <h2 id="wiring-simulation-title">Parts used in this step</h2>
            </div>
            <p>Drawn from this project’s saved wiring artifact.</p>
          </div>
          <div className="mk-wiring-artifact-visual">
            <div className="mk-wiring-artifact-parts" ref={diagramRef}>
              {connections.length > 0 && (
                <svg className="mk-wiring-connection-map" viewBox={`0 0 ${diagram.width} ${diagram.height}`} aria-hidden="true">
                  {connectionPaths.map((connection) => <path key={connection.id} d={connection.path} style={{ stroke: connection.color }} />)}
                </svg>
              )}
              {visibleParts.map(({ assemblyPart, catalogPart }) => (
                <article key={assemblyPart.id} data-part-id={assemblyPart.id}>
                  {catalogPart ? <PartThumbnail part={catalogPart} /> : <span className="mk-wiring-part-placeholder" aria-hidden="true" />}
                  <div><small>{assemblyPart.role || "part"}</small><strong>{assemblyPart.label || catalogPart?.name || assemblyPart.id}</strong></div>
                </article>
              ))}
            </div>
            <div className="mk-wiring-artifact-lines" aria-label="Active saved connections">
              {connections.length ? connections.map((connection) => (
                <span key={connection.id}><i style={{ backgroundColor: connection.color || "#ff6470" }} /><strong>{connection.label || connection.signal || "Connection"}</strong></span>
              )) : wirelessLinks.length ? wirelessLinks.map((link) => (
                <span key={link.id} data-wireless="true"><i /><strong>{link.protocol || "Wireless"}</strong></span>
              )) : <span className="mk-wiring-no-connection"><strong>No wire is needed in this step.</strong></span>}
            </div>
          </div>
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
                <span>{link.fromNodeId || "First device"} ↔ {link.toNodeId || "Second device"}. This dashed radio link is not a physical wire.</span>
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

function wiringPartsForStep(build: WiringProject, step: WiringStep | undefined, connections: WiringConnection[]) {
  const requestedIds = new Set([
    ...(step?.visibleParts || []),
    ...connections.flatMap((connection) => [connection.from?.partId, connection.to?.partId]),
  ].filter((value): value is string => Boolean(value)));
  const assemblyParts = build.artifacts?.assembly?.parts || [];
  const selected = requestedIds.size
    ? assemblyParts.filter((part) => requestedIds.has(part.id))
    : assemblyParts.slice(0, 3);

  return selected.map((assemblyPart) => ({
    assemblyPart,
    catalogPart: build.parts.find((part) => part.id === assemblyPart.catalogPartId || part.id === assemblyPart.id),
  }));
}
