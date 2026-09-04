export function projectWiringDeclaredReady(build) {
  return build?.artifactStates?.wiring?.state === "ready"
    && build?.artifacts?.assembly?.state === "ready";
}

export function projectWiringReady(build) {
  const assembly = build?.artifacts?.assembly;
  const hasSteps = projectWiringDeclaredReady(build)
    && Array.isArray(build?.artifacts?.assembly?.guideSteps)
    && build.artifacts.assembly.guideSteps.length > 0;
  if (!hasSteps) return false;
  const wires = new Map((Array.isArray(assembly.wires) ? assembly.wires : []).map((wire) => [wire?.id, wire]));
  const links = new Set((Array.isArray(assembly.wirelessLinks) ? assembly.wirelessLinks : []).map((link) => link?.id));
  const parts = new Set((Array.isArray(assembly.parts) ? assembly.parts : []).map((part) => part?.id));
  const ids = new Set();
  return assembly.guideSteps.every((step) => {
    if (!step || typeof step.id !== "string" || !step.id || ids.has(step.id) || typeof step.title !== "string" || !step.title.trim()) return false;
    ids.add(step.id);
    if (step.activeWires != null && !Array.isArray(step.activeWires)) return false;
    if (step.wirelessLinkIds != null && !Array.isArray(step.wirelessLinkIds)) return false;
    if (step.visibleParts != null && (!Array.isArray(step.visibleParts) || step.visibleParts.some((id) => !parts.has(id)))) return false;
    return (step.activeWires || []).every((id) => {
      const wire = wires.get(id);
      return wire?.from?.partId && wire?.to?.partId && parts.has(wire.from.partId) && parts.has(wire.to.partId);
    }) && (step.wirelessLinkIds || []).every((id) => links.has(id));
  });
}

export function projectWiringSteps(build) {
  return projectWiringReady(build) ? build.artifacts.assembly.guideSteps : [];
}

export function wiringConnectionsForStep(build, step) {
  const activeWireIds = new Set(Array.isArray(step?.activeWires) ? step.activeWires : []);
  return (build?.artifacts?.assembly?.wires || []).filter((wire) => activeWireIds.has(wire.id));
}
