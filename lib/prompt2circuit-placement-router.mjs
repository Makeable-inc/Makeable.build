import { createHash } from "node:crypto";

import { createCollisionFreeWireRoute, polylineMinimumBendRadius } from "./prompt2circuit-wire-router.mjs";

const DEFAULT_BODY_GAP_M = 0.03;
const KEEP_OUT_PADDING_M = 0.0015;

export function placeAndRouteCircuit({
  parts,
  profiles,
  electricalGraph,
  bodyGapM = DEFAULT_BODY_GAP_M,
  routingMode = "physical-cable"
} = {}) {
  if (!electricalGraph || electricalGraph.state !== "ready") throw new Error("electrical_graph_not_ready");
  if (!Number.isFinite(bodyGapM) || bodyGapM < 0.02 || bodyGapM > 0.035) throw new Error("bodyGapM must be between 0.02 and 0.035 metres");
  if (!["physical-cable", "logical-guide"].includes(routingMode)) throw new Error(`routing_mode_invalid:${routingMode}`);
  const profileByAsset = new Map((profiles || []).map((profile) => [profile.assetId, profile]));
  const placed = deterministicPlacement(parts || [], profileByAsset, electricalGraph, bodyGapM);
  const ownerVerifiedGuidePartIds = new Set((electricalGraph.connections || [])
    .filter((connection) => connection.ownerVerifiedServoGuide === true)
    .map((connection) => connection.toPartId));
  for (const part of placed) {
    if (!ownerVerifiedGuidePartIds.has(part.id)) continue;
    // The FS90R GLBs contain decorative pre-bent factory-lead meshes. They are
    // not this circuit's routed conductors and form large closed-looking loops
    // in the guide view. Hide them and render only the exact deterministic
    // contact-to-contact guide lines compiled above.
    // GLTFLoader sanitizes ':' in node names, so match the stable semantic
    // stem rather than a punctuation-sensitive full token.
    part.hiddenNodeIncludes = [...new Set([...(part.hiddenNodeIncludes || []), "factory-lead"] )];
    part.harnessGeometryMode = "deterministic_logical_guides_factory_lead_mesh_hidden";
  }
  const placedById = new Map(placed.map((part) => [part.id, part]));
  const harnessSpecs = resolveDeformableHarnesses(placed, placedById, profileByAsset, electricalGraph);
  const rigidMates = electricalGraph.connections.filter((connection) => connection.connectionMode === "rigid-mate");
  const resolvedRigidMateIds = new Set([
    ...harnessSpecs.flatMap((spec) => spec.rigidMateIds),
    ...rigidMates.filter((mate) => mate.selectorShuntRigidMate).map((mate) => mate.id)
  ]);
  const unresolvedRigidMate = rigidMates.find((mate) => !resolvedRigidMateIds.has(mate.id));
  if (unresolvedRigidMate) throw new Error(`rigid_mate_geometry_unresolved:${unresolvedRigidMate.id}`);
  const keepouts = placed.filter((part) => !part.deformableHarness)
    .map((part) => ({ id: part.id, bounds: part.worldBounds, paddingM: KEEP_OUT_PADDING_M }));
  const routes = routingMode === "physical-cable" ? routeDeformableHarnesses(harnessSpecs, keepouts) : [];
  const routedConnections = routingMode === "physical-cable"
    ? electricalGraph.connections.filter((connection) => connection.connectionMode === "routed-conductor")
    : [];
  for (const [index, connection] of routedConnections.entries()) {
    const fromPart = requiredPart(placedById, connection.fromPartId);
    const toPart = requiredPart(placedById, connection.toPartId);
    const from = worldEndpoint(connection.fromEndpoint, fromPart);
    const to = worldEndpoint(connection.toEndpoint, toPart);
    const wire = {
      id: connection.id,
      signal: connection.signal,
      color: connection.color,
      diameterM: 0.0012,
      minimumBendRadiusM: 0.003,
      bundleId: connection.bundleId || connection.fromPartId,
      from: { ...from, permittedEngagementPartIds: relatedEngagementIds(fromPart, placed) },
      to: { ...to, permittedEngagementPartIds: relatedEngagementIds(toPart, placed) }
    };
    const points = createCollisionFreeWireRoute(wire, {
      lane: laneFor(index),
      bowDirection: index % 2 ? "left" : "right",
      bowHeightMm: 5
    }, 0, keepouts, routes);
    assertOpenNonLoopingPolyline(points, wire.id);
    assertExactEndpoints(points, from.position, to.position, wire.id);
    assertClearOfOtherRoutes(points, routes, wire.id, wire.diameterM / 2, wire.bundleId);
    routes.push({
      wireId: wire.id,
      netId: connection.netId,
      signal: connection.signal,
      color: connection.color,
      radiusM: wire.diameterM / 2,
      diameterM: wire.diameterM,
      minimumBendRadiusM: wire.minimumBendRadiusM,
      measuredMinimumBendRadiusM: polylineMinimumBendRadius(points),
      bundleId: wire.bundleId,
      points,
      loopCount: 0,
      selfIntersectionCount: 0,
      routingStyle: "short-open-natural-arch"
    });
  }
  const contract = {
    schemaVersion: "MakeablePlacementRoutingContractV1",
    state: "ready",
    circuitOnly: true,
    parts: placed,
    keepouts,
    connections: electricalGraph.connections,
    subcomponents: electricalGraph.subcomponents || [],
    routes,
    rigidMates,
    deformableHarnesses: harnessSpecs.map((spec) => ({
      cablePartId: spec.cablePartId,
      signals: spec.conductors.map((entry) => entry.signal),
      rigidMateIds: spec.rigidMateIds
    })),
    routingMode,
    fingerprint: fingerprint({ parts: placed, graph: electricalGraph, routes, routingMode })
  };
  if (routingMode === "logical-guide") {
    const guide = projectLogicalWiringGuide({ placement: contract, electricalGraph });
    contract.hiddenCablePartIds = guide.hiddenCablePartIds;
    contract.routes = guide.routes;
    contract.fingerprint = fingerprint({
      parts: placed,
      graph: electricalGraph,
      routes: guide.routes,
      routingMode
    });
  }
  return contract;
}

export function projectLogicalWiringGuide({ placement, electricalGraph } = {}) {
  if (!placement || placement.state !== "ready" || !electricalGraph || electricalGraph.state !== "ready") {
    throw new Error("wiring_guide_projection_input_not_ready");
  }
  const placedById = new Map((placement.parts || []).map((part) => [part.id, part]));
  const hiddenCablePartIds = new Set((placement.parts || [])
    .filter((part) => part.role === "cable" || part.deformableHarness === true)
    .map((part) => part.id));
  const keepouts = (placement.keepouts || []).filter((keepout) => !hiddenCablePartIds.has(keepout.id));
  const netById = new Map((electricalGraph.nets || []).map((net) => [net.id, net]));
  const routes = [];
  const connectionsByNet = Map.groupBy(electricalGraph.connections || [], (connection) => connection.netId);
  const guideCandidates = [];
  for (const net of electricalGraph.nets || []) {
    const connections = connectionsByNet.get(net.id) || [];
    const routedConnections = connections.filter((connection) => (
      ["routed-conductor", "logical-guide"].includes(connection.connectionMode)
      && placedById.has(connection.fromEndpoint?.partId)
      && placedById.has(connection.toEndpoint?.partId)
      && !hiddenCablePartIds.has(connection.fromEndpoint.partId)
      && !hiddenCablePartIds.has(connection.toEndpoint.partId)
    ));
    for (const connection of routedConnections) {
      const externalEndpoints = orderedGuideEndpoints(uniqueEndpoints([connection.fromEndpoint, connection.toEndpoint]));
      if (externalEndpoints.length !== 2) {
        throw new Error(`wiring_guide_connection_endpoint_count_invalid:${connection.id}:${externalEndpoints.length}`);
      }
      const peripheralEndpoint = externalEndpoints.find((endpoint) => endpoint.partId !== "carrier") || externalEndpoints[0];
      guideCandidates.push({
        connectionId: connection.id,
        wireId: `${connection.id}:guide`,
        netId: net.id,
        signal: connection.signal || net.signal,
        color: connection.color || guideColorForSignal(connection.signal || net.signal),
        bundleId: connection.visualBundleId || connection.bundleId
          || (connection.analogInterconnect ? connection.toEndpoint.partId : peripheralEndpoint.partId),
        analogInterconnect: connection.analogInterconnect === true,
        requiredSignalStrap: connection.requiredSignalStrap === true,
        ownerVerifiedServoGuide: connection.ownerVerifiedServoGuide === true,
        terminalOccupancyAuthorizationId: connection.terminalOccupancyAuthorizationId || null,
        inputSignal: connection.inputSignal || null,
        externalEndpoints
      });
    }
    // Collapse cable bodies and included factory-harness sockets into exact
    // external-to-external guide edges. This preserves multi-branch nets (for
    // example servo power common ground) instead of assuming every net has
    // only two visible endpoints or silently dropping a branch.
    for (const edge of collapsedDeformableGuideEdges({
      net,
      connections,
      placedById,
      hiddenCablePartIds
    })) {
      const duplicate = guideCandidates.some((candidate) => (
        candidate.netId === net.id
        && undirectedEndpointPairKey(candidate.externalEndpoints) === undirectedEndpointPairKey(edge.externalEndpoints)
      ));
      if (duplicate) continue;
      const peripheralEndpoint = edge.externalEndpoints.find((endpoint) => endpoint.partId !== "carrier") || edge.externalEndpoints[0];
      guideCandidates.push({
        connectionId: edge.sourceConnection.id || null,
        wireId: `${net.id}:guide:${guideCandidates.filter((candidate) => candidate.netId === net.id).length + 1}`,
        netId: net.id,
        signal: net.signal || edge.sourceConnection.signal,
        color: edge.sourceConnection.color || guideColorForSignal(net.signal || edge.sourceConnection.signal),
        bundleId: edge.sourceConnection.bundleId || peripheralEndpoint.partId,
        externalEndpoints: orderedGuideEndpoints(edge.externalEndpoints)
      });
    }
  }
  const bundleCounts = new Map();
  for (const route of guideCandidates) {
    bundleCounts.set(route.bundleId, (bundleCounts.get(route.bundleId) || 0) + 1);
  }
  const orderedRoutes = [...guideCandidates].sort((left, right) => (
    Number(right.requiredSignalStrap === true) - Number(left.requiredSignalStrap === true)
      // Route compact device bundles before wide fan-outs. The later, larger
      // bundle retains more lane choices and can route around the smaller
      // bundle; reversing this order can cage a final three-wire sensor behind
      // an already-complete six-wire interface.
      || (bundleCounts.get(left.bundleId) || 0) - (bundleCounts.get(right.bundleId) || 0)
      || (left.ownerVerifiedServoGuide && right.ownerVerifiedServoGuide
        ? guideSignalOrder(left.signal, true) - guideSignalOrder(right.signal, true)
        : 0)
      || left.bundleId.localeCompare(right.bundleId)
      || guideSignalOrder(left.signal, left.ownerVerifiedServoGuide)
        - guideSignalOrder(right.signal, right.ownerVerifiedServoGuide)
      || left.wireId.localeCompare(right.wireId)
  ));
  const bundleOrder = new Map();
  for (const route of orderedRoutes) {
    if (!bundleOrder.has(route.bundleId)) bundleOrder.set(route.bundleId, bundleOrder.size);
  }
  const withinBundleIndex = new Map();
  const bundleDepartureDirections = logicalBundleDepartureDirections(orderedRoutes, placedById);

  for (const sourceRoute of orderedRoutes) {
    const net = netById.get(sourceRoute.netId);
    const externalEndpoints = sourceRoute.externalEndpoints;
    const fromPart = placedById.get(externalEndpoints[0].partId);
    const toPart = placedById.get(externalEndpoints[1].partId);
    const from = worldEndpoint(externalEndpoints[0], fromPart);
    const to = worldEndpoint(externalEndpoints[1], toPart);
    const diameterM = sourceRoute.requiredSignalStrap ? 0.00045 : 0.00065;
    // These are semantic guide lines rather than manufactured cable bodies.
    // A compact 1.2 mm curvature floor keeps them smoothly arched while
    // allowing dense, individually addressed 2.54 mm header fan-out.
    const minimumBendRadiusM = sourceRoute.requiredSignalStrap ? 0.0005 : 0.0012;
    const deviceLane = withinBundleIndex.get(sourceRoute.bundleId) || 0;
    withinBundleIndex.set(sourceRoute.bundleId, deviceLane + 1);
    const bundleIndex = bundleOrder.get(sourceRoute.bundleId) || 0;
    const wire = {
      id: sourceRoute.wireId,
      netId: sourceRoute.netId,
      signal: sourceRoute.signal,
      color: sourceRoute.color,
      diameterM,
      minimumBendRadiusM,
      // Conductors for one device share a compact visual bundle; different
      // devices retain independent clearance identities and cannot cross.
      bundleId: sourceRoute.bundleId,
      planarCrossingForbidden: sourceRoute.ownerVerifiedServoGuide === true,
      from: { ...from, permittedEngagementPartIds: relatedEngagementIds(fromPart, placement.parts) },
      to: { ...to, permittedEngagementPartIds: relatedEngagementIds(toPart, placement.parts) }
    };
    const points = createCollisionFreeWireRoute(wire, {
      lane: laneFor(deviceLane) + (bundleIndex % 2 ? 2 : -2),
      bowDirection: sourceRoute.requiredSignalStrap
        ? (deviceLane % 2 ? "left" : "right")
        : (bundleIndex % 2 ? "left" : "right"),
      bowHeightMm: 4,
      curveStyle: "smooth-cubic-arch",
      // All guides start in the same compact height band. Collision search may
      // add only the lift actually required; it must not build a staircase or
      // rectangular cage from one global layer per wire.
      heightLayer: deviceLane,
      sourcePlanarDeparture: bundleDepartureDirections.get(bundlePartKey(sourceRoute.bundleId, externalEndpoints[0].partId)) || null,
      targetPlanarDeparture: bundleDepartureDirections.get(bundlePartKey(sourceRoute.bundleId, externalEndpoints[1].partId)) || null
    }, 0, keepouts, routes);
    assertOpenNonLoopingPolyline(points, wire.id);
    assertExactEndpoints(points, from.position, to.position, wire.id);
    assertClearOfOtherRoutes(points, routes, wire.id, diameterM / 2, wire.bundleId, sourceRoute.netId);
    routes.push({
      connectionId: sourceRoute.connectionId,
      wireId: sourceRoute.wireId,
      netId: sourceRoute.netId,
      signal: sourceRoute.signal,
      color: sourceRoute.color,
      radiusM: diameterM / 2,
      diameterM,
      minimumBendRadiusM,
      measuredMinimumBendRadiusM: polylineMinimumBendRadius(points),
      bundleId: sourceRoute.bundleId,
      analogInterconnect: sourceRoute.analogInterconnect === true,
      requiredSignalStrap: sourceRoute.requiredSignalStrap === true,
      ownerVerifiedServoGuide: sourceRoute.ownerVerifiedServoGuide === true,
      ...(sourceRoute.terminalOccupancyAuthorizationId
        ? { terminalOccupancyAuthorizationId: sourceRoute.terminalOccupancyAuthorizationId }
        : {}),
      planarCrossingForbidden: sourceRoute.ownerVerifiedServoGuide === true,
      ...(sourceRoute.inputSignal ? { inputSignal: sourceRoute.inputSignal } : {}),
      points,
      fromEndpoint: from,
      toEndpoint: to,
      loopCount: 0,
      selfIntersectionCount: 0,
      projectedSelfIntersectionCount: 0,
      projectedCrossingCount: 0,
      routingStyle: "logical-pin-to-pin-guide-line"
    });
  }

  return {
    schemaVersion: "MakeableLogicalWiringGuideV1",
    state: "ready",
    hiddenCablePartIds: [...hiddenCablePartIds].sort(),
    routes
  };
}

function collapsedDeformableGuideEdges({ net, connections, placedById, hiddenCablePartIds }) {
  const deformableConnections = connections.filter((connection) => (
    String(connection.connectionMode || "").startsWith("deformable-")
  ));
  const hiddenEndpointsByPart = Map.groupBy(
    (net.endpoints || []).filter((endpoint) => hiddenCablePartIds.has(endpoint?.partId)),
    (endpoint) => endpoint.partId
  );
  if (!deformableConnections.length && !hiddenEndpointsByPart.size) return [];

  const endpointByKey = new Map();
  const adjacency = new Map();
  const integratedHarnessInternalKeys = new Set(deformableConnections
    .filter((connection) => connection.factoryHarnessConductor === true)
    .flatMap((connection) => [connection.fromEndpoint, connection.toEndpoint])
    .filter(Boolean)
    .map(endpointKey));
  for (const endpoint of [...(net.endpoints || []), ...connections.flatMap((connection) => [connection.fromEndpoint, connection.toEndpoint])]) {
    if (!endpoint?.partId || !endpoint?.nodeName) continue;
    endpointByKey.set(endpointKey(endpoint), endpoint);
  }
  for (const connection of connections) {
    const from = connection.fromEndpoint;
    const to = connection.toEndpoint;
    if (!from?.partId || !from?.nodeName || !to?.partId || !to?.nodeName) continue;
    const fromKey = endpointKey(from);
    const toKey = endpointKey(to);
    if (!adjacency.has(fromKey)) adjacency.set(fromKey, []);
    if (!adjacency.has(toKey)) adjacency.set(toKey, []);
    const deformable = String(connection.connectionMode || "").startsWith("deformable-");
    adjacency.get(fromKey).push({ key: toKey, connection, deformable });
    adjacency.get(toKey).push({ key: fromKey, connection, deformable });
  }
  // Some legacy verified adapter profiles express the two cable contacts in
  // the net and rigid mating edges, while conductor continuity is implicit in
  // the cable asset rather than duplicated as a graph connection. Contract the
  // exact two hidden contacts as one virtual deformable edge for the visual
  // guide; no cable geometry is rendered.
  for (const [partId, endpoints] of deformableConnections.length ? [] : hiddenEndpointsByPart) {
    const unique = uniqueEndpoints(endpoints);
    if (unique.length !== 2) {
      throw new Error(`wiring_guide_hidden_cable_endpoint_count_invalid:${net.id}:${partId}:${unique.length}`);
    }
    const [from, to] = unique;
    const fromKey = endpointKey(from);
    const toKey = endpointKey(to);
    if (!adjacency.has(fromKey)) adjacency.set(fromKey, []);
    if (!adjacency.has(toKey)) adjacency.set(toKey, []);
    const connection = connections.find((candidate) => candidate.color) || connections[0] || {
      id: `${net.id}:implicit-cable-continuity`,
      signal: net.signal
    };
    adjacency.get(fromKey).push({ key: toKey, connection, deformable: true });
    adjacency.get(toKey).push({ key: fromKey, connection, deformable: true });
  }
  const internal = (key) => {
    const endpoint = endpointByKey.get(key);
    return Boolean(endpoint && (
      hiddenCablePartIds.has(endpoint.partId)
      || integratedHarnessInternalKeys.has(key)
    ));
  };
  const externalKeys = [...endpointByKey.keys()].filter((key) => {
    const endpoint = endpointByKey.get(key);
    return placedById.has(endpoint.partId) && !internal(key);
  });
  const found = new Map();

  for (const startKey of externalKeys) {
    const queue = [{ key: startKey, sawDeformable: false, sourceConnection: null }];
    const visited = new Set([`${startKey}:0`]);
    while (queue.length) {
      const current = queue.shift();
      for (const step of adjacency.get(current.key) || []) {
        const sawDeformable = current.sawDeformable || step.deformable;
        const sourceConnection = current.sourceConnection || (step.deformable ? step.connection : null);
        const stateKey = `${step.key}:${sawDeformable ? 1 : 0}`;
        if (visited.has(stateKey)) continue;
        visited.add(stateKey);
        if (step.key !== startKey && !internal(step.key)) {
          if (sawDeformable) {
            const pairKey = [startKey, step.key].sort().join("|");
            if (!found.has(pairKey)) {
              found.set(pairKey, {
                externalEndpoints: [endpointByKey.get(startKey), endpointByKey.get(step.key)],
                sourceConnection: sourceConnection || step.connection
              });
            }
          }
          continue;
        }
        queue.push({ key: step.key, sawDeformable, sourceConnection });
      }
    }
  }
  return [...found.values()];
}

function endpointKey(endpoint) {
  return `${endpoint.partId}:${endpoint.nodeName}`;
}

function undirectedEndpointPairKey(endpoints) {
  return (endpoints || []).map(endpointKey).sort().join("|");
}

function guideColorForSignal(signal) {
  const normalized = String(signal || "").toUpperCase();
  if (normalized === "GND") return "black";
  if (["3V3", "5V", "VCC", "VDD", "VIN", "POWER"].includes(normalized)) return "red";
  if (["SDA", "MOSI", "DIN"].includes(normalized)) return "#35c77a";
  if (["SCL", "SCK", "CLK", "ECHO"].includes(normalized)) return "#3f8cff";
  if (["RX", "MISO"].includes(normalized)) return "#a66cff";
  if (["TX", "PWM"].includes(normalized)) return "#ff9f43";
  return "#f2cc3d";
}

function guideSignalOrder(signal, ownerVerifiedServoGuide = false) {
  const normalized = String(signal || "").toUpperCase();
  if (normalized === "GND") return 0;
  // Route the local GND/PWM pair first for the exact FS90R GVS channel, then
  // send its physically separate 5 V branch around that compact pair. Routing
  // 5 V first made the later PWM line swap sides beside the connector.
  if (ownerVerifiedServoGuide && normalized === "PWM") return 1;
  if (ownerVerifiedServoGuide && ["3V3", "5V", "VCC", "VDD", "VIN", "POWER"].includes(normalized)) return 2;
  if (["3V3", "5V", "VCC", "VDD", "VIN", "POWER"].includes(normalized)) return 1;
  if (normalized === "SDA") return 2;
  if (normalized === "SCL") return 3;
  return 4;
}

function uniqueEndpoints(endpoints) {
  const seen = new Set();
  return endpoints.filter((endpoint) => {
    const key = `${endpoint.partId}:${endpoint.connectorId || ""}:${endpoint.nodeName || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveDeformableHarnesses(placed, placedById, profileByAsset, graph) {
  const output = [];
  for (const cable of placed.filter((part) => part.deformableHarness)) {
    const profile = profileByAsset.get(cable.assetId);
    const exactCableConductors = graph.connections.filter((connection) => (
      connection.connectionMode === "deformable-exact-mating-cable"
      && connection.fromPartId === cable.id
      && connection.exactMatingCableConductor === true
    ));
    if (exactCableConductors.length) {
      output.push(resolveExactMatingCableGeometry({
        cable,
        profile,
        placed,
        placedById,
        graph,
        conductorConnections: exactCableConductors
      }));
      continue;
    }
    const poweredLogicConductors = graph.connections.filter((connection) => (
      connection.connectionMode === "deformable-powered-logic-harness"
      && connection.fromPartId === cable.id
      && connection.poweredLogicHarnessConductor === true
    ));
    if (poweredLogicConductors.length) {
      output.push(resolvePoweredLogicHarnessGeometry({
        cable,
        profile,
        placed,
        placedById,
        graph,
        conductorConnections: poweredLogicConductors
      }));
      continue;
    }
    const servoConductors = graph.connections.filter((connection) => (
      connection.connectionMode === "deformable-servo-harness"
      && connection.fromPartId === cable.id
      && connection.servoHarnessConductor === true
    ));
    if (servoConductors.length) {
      output.push(resolveServoHarnessGeometry({
        cable,
        profile,
        placed,
        placedById,
        graph,
        conductorConnections: servoConductors
      }));
      continue;
    }
    const qwiicAnchors = (profile?.routingAnchors || []).filter((anchor) => /^anchor:qwiic:wire-exit:/i.test(anchor.nodeName));
    const socketAnchors = (profile?.routingAnchors || []).filter((anchor) => /^anchor:socket:[^:]+:wire-exit$/i.test(anchor.nodeName));
    if (!qwiicAnchors.length && !socketAnchors.length) {
      throw new Error(`deformable_harness_anchor_contract_missing:${cable.assetId}`);
    }
    if (qwiicAnchors.length !== 4 || socketAnchors.length !== 4) {
      throw new Error(`qwiic_harness_anchor_count_invalid:${cable.assetId}:${qwiicAnchors.length}:${socketAnchors.length}`);
    }
    const mates = graph.connections.filter((connection) => connection.connectionMode === "rigid-mate" && connection.fromPartId === cable.id);
    const plugMates = mates.filter((connection) => connection.fromEndpoint?.connectorId === "qwiic-plug");
    const socketMates = mates.filter((connection) => connection.fromEndpoint?.connectorId === "individual-socket");
    if (plugMates.length !== 4 || socketMates.length !== 4) {
      throw new Error(`qwiic_rigid_mate_contract_incomplete:${cable.id}:${plugMates.length}:${socketMates.length}`);
    }
    const plugTransform = fitConnectorTransform(plugMates.map((mate) => ({
      signal: mate.signal,
      source: mate.fromEndpoint,
      target: worldEndpoint(mate.toEndpoint, requiredPart(placedById, mate.toPartId))
    })), cable.id);
    const plugTargetPart = requiredPart(placedById, plugMates[0].toPartId);
    const nodeTransformRules = [
      { namePrefix: "connector:qwiic-jst-sh-1.0mm-4p:", matrix: plugTransform },
      { namePrefix: "connector:qwiic:", matrix: plugTransform },
      { namePrefix: "anchor:qwiic:", matrix: plugTransform }
    ];
    const conductors = [];
    for (const mate of socketMates) {
      const targetPart = requiredPart(placedById, mate.toPartId);
      const target = worldEndpoint(mate.toEndpoint, targetPart);
      const socketTransform = alignContactTransform(mate.fromEndpoint, target);
      const signal = normalizeSignal(mate.signal);
      nodeTransformRules.push(
        { namePrefix: `connector:socket:${signal.toLowerCase()}:`, matrix: socketTransform },
        { namePrefix: `anchor:socket:${signal.toLowerCase()}:`, matrix: socketTransform }
      );
      const plugAnchor = qwiicAnchors.find((anchor) => normalizeSignal(anchor.signal) === signal);
      const socketAnchor = socketAnchors.find((anchor) => normalizeSignal(anchor.signal) === signal);
      if (!plugAnchor || !socketAnchor) throw new Error(`qwiic_wire_exit_anchor_missing:${cable.id}:${signal}`);
      conductors.push({
        id: `${cable.id}:runtime-harness:${signal.toLowerCase()}`,
        cablePartId: cable.id,
        netId: mate.netId,
        signal,
        color: colorForSignal(signal),
        diameterM: 0.0012,
        minimumBendRadiusM: 0.0024,
        from: transformedAnchor(plugAnchor, plugTransform, cable.id, relatedEngagementIds(plugTargetPart, placed)),
        to: transformedAnchor(socketAnchor, socketTransform, cable.id, relatedEngagementIds(targetPart, placed)),
        maximumCableLengthM: 0.15
      });
    }
    cable.hiddenNodeIncludes = ["cable:conductor:", "cable:split-boot", "anchor:cable:split"];
    cable.nodeTransformRules = nodeTransformRules;
    cable.harnessGeometryMode = "deterministic_runtime_harness_from_locked_anchors";
    output.push({ cablePartId: cable.id, conductors, rigidMateIds: mates.map((mate) => mate.id) });
  }
  for (const owner of placed.filter((part) => (profileByAsset.get(part.assetId)?.includedFactoryHarnesses || []).length)) {
    const profile = profileByAsset.get(owner.assetId);
    for (const harness of profile.includedFactoryHarnesses) {
      const conductorConnections = graph.connections.filter((connection) => (
        connection.connectionMode === "deformable-factory-harness"
        && connection.fromPartId === owner.id
        && connection.factoryHarnessId === harness.id
        && connection.factoryHarnessConductor === true
      ));
      const mates = graph.connections.filter((connection) => (
        connection.connectionMode === "rigid-mate"
        && connection.fromPartId === owner.id
        && connection.factoryHarnessId === harness.id
        && connection.factoryHarnessRigidMate === true
      ));
      if (conductorConnections.length !== harness.conductors.length || mates.length !== harness.conductors.length * 2) {
        throw new Error(`included_factory_harness_graph_contract_incomplete:${owner.id}:${harness.id}:${conductorConnections.length}:${mates.length}`);
      }
      const conductors = [];
      const nodeTransformRules = [];
      const hiddenNodeIncludes = [];
      for (const conductor of harness.conductors) {
        const connection = conductorConnections.find((entry) => entry.factoryHarnessConductorId === conductor.id);
        const conductorMates = mates.filter((entry) => entry.factoryHarnessConductorId === conductor.id);
        const deviceMate = conductorMates.find((entry) => entry.toPartId === owner.id);
        const surfaceMate = conductorMates.find((entry) => entry.toPartId !== owner.id);
        if (!connection || !deviceMate || !surfaceMate) {
          throw new Error(`included_factory_harness_conductor_mates_missing:${owner.id}:${harness.id}:${conductor.id}`);
        }
        const deviceTargetLocal = deviceMate.toEndpoint;
        const surfaceTargetPart = requiredPart(placedById, surfaceMate.toPartId);
        const surfaceTargetLocal = localEndpointFromWorld(
          worldEndpoint(surfaceMate.toEndpoint, surfaceTargetPart),
          owner
        );
        const deviceTransform = alignContactTransform(
          deviceMate.fromEndpoint,
          deviceTargetLocal,
          Number(deviceMate.engagementDepthM || conductor.deviceEnd.engagementDepthM || 0)
        );
        const surfaceTransform = alignContactTransform(
          surfaceMate.fromEndpoint,
          surfaceTargetLocal,
          Number(surfaceMate.engagementDepthM || conductor.surfaceEnd.engagementDepthM || 0)
        );
        nodeTransformRules.push(
          { namePrefix: conductor.deviceEnd.housingNodeName, matrix: deviceTransform },
          { namePrefix: conductor.deviceEnd.recessNodeName, matrix: deviceTransform },
          { namePrefix: conductor.surfaceEnd.housingNodeName, matrix: surfaceTransform },
          { namePrefix: conductor.surfaceEnd.recessNodeName, matrix: surfaceTransform }
        );
        hiddenNodeIncludes.push(conductor.sourceNodeName);
        conductors.push({
          id: connection.id,
          cablePartId: owner.id,
          netId: connection.netId,
          signal: normalizeSignal(connection.signal),
          color: connection.color || colorForSignal(connection.signal),
          diameterM: conductor.diameterM,
          minimumBendRadiusM: conductor.minimumBendRadiusM,
          maximumCableLengthM: conductor.usableLengthM,
          from: transformedEmbeddedAnchor(
            conductor.deviceEnd.wireExit,
            deviceTransform,
            owner,
            relatedEngagementIds(owner, placed)
          ),
          to: transformedEmbeddedAnchor(
            conductor.surfaceEnd.wireExit,
            surfaceTransform,
            owner,
            relatedEngagementIds(surfaceTargetPart, placed)
          )
        });
      }
      owner.hiddenNodeIncludes = [...new Set([...(owner.hiddenNodeIncludes || []), ...hiddenNodeIncludes])];
      owner.nodeTransformRules = [...(owner.nodeTransformRules || []), ...nodeTransformRules];
      owner.harnessGeometryMode = "deterministic_runtime_included_factory_harness_from_hash_bound_mesh";
      output.push({ cablePartId: owner.id, factoryHarnessId: harness.id, conductors, rigidMateIds: mates.map((mate) => mate.id) });
    }
  }
  return output;
}

function resolveExactMatingCableGeometry({ cable, profile, placed, placedById, graph, conductorConnections }) {
  const contract = profile?.exactMatingCable;
  if (!contract || !contract.conductors?.length || conductorConnections.length !== contract.conductors.length) {
    throw new Error(`exact_mating_cable_conductor_count_invalid:${cable.id}:${conductorConnections.length}`);
  }
  const mates = graph.connections.filter((connection) => (
    connection.connectionMode === "rigid-mate"
    && connection.fromPartId === cable.id
    && connection.exactMatingCableRigidMate === true
  ));
  if (mates.length !== conductorConnections.length * 2) {
    throw new Error(`exact_mating_cable_rigid_mate_contract_incomplete:${cable.id}:${mates.length}`);
  }
  const groups = new Map();
  for (const mate of mates) {
    const groupId = mate.exactMatingCableTransformGroup;
    if (!groupId) throw new Error(`exact_mating_cable_transform_group_missing:${mate.id}`);
    const entries = groups.get(groupId) || [];
    entries.push(mate);
    groups.set(groupId, entries);
  }
  const transforms = new Map();
  for (const [groupId, groupMates] of groups) {
    const targetPartIds = new Set(groupMates.map((mate) => mate.toPartId));
    if (targetPartIds.size !== 1) throw new Error(`exact_mating_cable_transform_target_ambiguous:${cable.id}:${groupId}`);
    const targetPart = requiredPart(placedById, groupMates[0].toPartId);
    const transform = groupMates.length > 1
      ? fitConnectorTransform(groupMates.map((mate) => ({
        signal: mate.deviceSignal || mate.signal,
        source: mate.fromEndpoint,
        target: worldEndpoint(mate.toEndpoint, targetPart)
      })), `${cable.id}:${groupId}`)
      : alignContactTransform(
        groupMates[0].fromEndpoint,
        worldEndpoint(groupMates[0].toEndpoint, targetPart),
        Number(groupMates[0].engagementDepthM || 0)
      );
    transforms.set(groupId, { transform, targetPart });
  }
  const anchorByNode = new Map((profile.routingAnchors || []).map((anchor) => [anchor.nodeName, anchor]));
  const nodeTransformRules = [];
  const conductors = [];
  for (const connection of conductorConnections) {
    const conductor = contract.conductors.find((entry) => entry.id === connection.exactMatingCableConductorId);
    const fromMate = mates.find((mate) => (
      mate.exactMatingCableConductorId === conductor?.id && mate.exactMatingCableEnd === "from"
    ));
    const toMate = mates.find((mate) => (
      mate.exactMatingCableConductorId === conductor?.id && mate.exactMatingCableEnd === "to"
    ));
    if (!conductor || !fromMate || !toMate) {
      throw new Error(`exact_mating_cable_conductor_mates_missing:${cable.id}:${connection.exactMatingCableConductorId}`);
    }
    const fromFit = transforms.get(fromMate.exactMatingCableTransformGroup);
    const toFit = transforms.get(toMate.exactMatingCableTransformGroup);
    const fromAnchor = anchorByNode.get(connection.fromWireExitAnchorNodeName);
    const toAnchor = anchorByNode.get(connection.toWireExitAnchorNodeName);
    if (!fromFit || !toFit || !fromAnchor || !toAnchor) {
      throw new Error(`exact_mating_cable_wire_exit_contract_missing:${cable.id}:${conductor.id}`);
    }
    nodeTransformRules.push(
      { namePrefix: connection.fromNodePrefix, matrix: fromFit.transform },
      { namePrefix: connection.toNodePrefix, matrix: toFit.transform }
    );
    conductors.push({
      id: connection.id,
      cablePartId: cable.id,
      netId: connection.netId,
      signal: normalizeSignal(connection.signal),
      color: connection.color || colorForSignal(connection.signal),
      diameterM: Number(connection.diameterM || 0.0012),
      minimumBendRadiusM: Number(connection.minimumBendRadiusM || 0.003),
      maximumCableLengthM: Number(connection.maximumCableLengthM),
      connectionMode: "deformable-exact-mating-cable",
      from: transformedAnchor(fromAnchor, fromFit.transform, cable.id, relatedEngagementIds(fromFit.targetPart, placed)),
      to: transformedAnchor(toAnchor, toFit.transform, cable.id, relatedEngagementIds(toFit.targetPart, placed))
    });
  }
  cable.hiddenNodeIncludes = [...new Set([...(cable.hiddenNodeIncludes || []), ...(contract.hiddenNodeIncludes || [])])];
  cable.nodeTransformRules = [...(cable.nodeTransformRules || []), ...nodeTransformRules];
  cable.harnessGeometryMode = "deterministic_runtime_exact_keyed_mating_cable_from_locked_anchors";
  return {
    cablePartId: cable.id,
    exactMatingCableId: contract.id,
    conductors,
    rigidMateIds: mates.map((mate) => mate.id)
  };
}

function resolvePoweredLogicHarnessGeometry({ cable, profile, placed, placedById, graph, conductorConnections }) {
  const contract = profile?.poweredLogicHarness;
  if (!contract || conductorConnections.length !== 6 || contract.conductors?.length !== 6) {
    throw new Error(`powered_logic_harness_conductor_count_invalid:${cable.id}:${conductorConnections.length}`);
  }
  const mates = graph.connections.filter((connection) => (
    connection.connectionMode === "rigid-mate"
    && connection.fromPartId === cable.id
    && connection.poweredLogicHarnessRigidMate === true
  ));
  if (mates.length !== conductorConnections.length * 2) {
    throw new Error(`powered_logic_harness_rigid_mate_contract_incomplete:${cable.id}:${mates.length}`);
  }
  const groups = new Map();
  for (const mate of mates) {
    const key = mate.poweredLogicHarnessTransformGroup;
    if (!key) throw new Error(`powered_logic_harness_transform_group_missing:${mate.id}`);
    const entries = groups.get(key) || [];
    entries.push(mate);
    groups.set(key, entries);
  }
  const transforms = new Map();
  for (const [groupId, groupMates] of groups) {
    const targetPartIds = new Set(groupMates.map((mate) => mate.toPartId));
    if (targetPartIds.size !== 1) throw new Error(`powered_logic_harness_transform_target_ambiguous:${cable.id}:${groupId}`);
    const targetPart = requiredPart(placedById, groupMates[0].toPartId);
    const transform = groupMates.length > 1
      ? fitConnectorTransform(groupMates.map((mate) => ({
        signal: mate.signal,
        source: mate.fromEndpoint,
        target: worldEndpoint(mate.toEndpoint, targetPart)
      })), `${cable.id}:${groupId}`)
      : alignContactTransform(groupMates[0].fromEndpoint, worldEndpoint(groupMates[0].toEndpoint, targetPart));
    transforms.set(groupId, { transform, targetPart });
  }
  const anchorByNode = new Map((profile.routingAnchors || []).map((anchor) => [anchor.nodeName, anchor]));
  const nodeTransformRules = [];
  const conductors = [];
  for (const connection of conductorConnections) {
    const conductor = contract.conductors.find((entry) => entry.id === connection.poweredLogicHarnessConductorId);
    if (!conductor) throw new Error(`powered_logic_harness_conductor_contract_missing:${cable.id}:${connection.poweredLogicHarnessConductorId}`);
    const fromMate = mates.find((mate) => (
      mate.poweredLogicHarnessConductorId === conductor.id && mate.poweredLogicHarnessEnd === "from"
    ));
    const toMate = mates.find((mate) => (
      mate.poweredLogicHarnessConductorId === conductor.id && mate.poweredLogicHarnessEnd === "to"
    ));
    if (!fromMate || !toMate) throw new Error(`powered_logic_harness_conductor_mates_missing:${cable.id}:${conductor.id}`);
    const fromFit = transforms.get(fromMate.poweredLogicHarnessTransformGroup);
    const toFit = transforms.get(toMate.poweredLogicHarnessTransformGroup);
    const fromAnchor = anchorByNode.get(connection.fromWireExitAnchorNodeName);
    const toAnchor = anchorByNode.get(connection.toWireExitAnchorNodeName);
    if (!fromFit || !toFit || !fromAnchor || !toAnchor) {
      throw new Error(`powered_logic_harness_wire_exit_contract_missing:${cable.id}:${conductor.id}`);
    }
    nodeTransformRules.push(
      { namePrefix: connection.fromNodePrefix, matrix: fromFit.transform },
      { namePrefix: connection.toNodePrefix, matrix: toFit.transform }
    );
    conductors.push({
      id: connection.id,
      cablePartId: cable.id,
      netId: connection.netId,
      signal: normalizeSignal(connection.signal),
      color: connection.color || colorForSignal(connection.signal),
      diameterM: Number(connection.diameterM || 0.0012),
      minimumBendRadiusM: Number(connection.minimumBendRadiusM || 0.003),
      maximumCableLengthM: Number(connection.maximumCableLengthM),
      connectionMode: "deformable-powered-logic-harness",
      from: transformedAnchor(fromAnchor, fromFit.transform, cable.id, relatedEngagementIds(fromFit.targetPart, placed)),
      to: transformedAnchor(toAnchor, toFit.transform, cable.id, relatedEngagementIds(toFit.targetPart, placed))
    });
  }
  cable.hiddenNodeIncludes = [...new Set([...(cable.hiddenNodeIncludes || []), ...(contract.hiddenNodeIncludes || [])])];
  cable.nodeTransformRules = [...(cable.nodeTransformRules || []), ...nodeTransformRules];
  cable.harnessGeometryMode = "deterministic_runtime_powered_logic_harness_from_locked_anchors";
  return {
    cablePartId: cable.id,
    poweredLogicHarnessId: contract.id,
    conductors,
    rigidMateIds: mates.map((mate) => mate.id)
  };
}

function resolveServoHarnessGeometry({ cable, profile, placed, placedById, graph, conductorConnections }) {
  if (conductorConnections.length !== 3) {
    throw new Error(`servo_harness_conductor_count_invalid:${cable.id}:${conductorConnections.length}`);
  }
  const signals = new Set(conductorConnections.map((connection) => normalizeSignal(connection.signal)));
  if (!["GND", "POWER", "PWM"].every((signal) => signals.has(signal))) {
    throw new Error(`servo_harness_signal_contract_incomplete:${cable.id}`);
  }
  const mates = graph.connections.filter((connection) => (
    connection.connectionMode === "rigid-mate"
    && connection.fromPartId === cable.id
    && connection.servoHarnessRigidMate === true
  ));
  const servoMates = mates.filter((connection) => connection.id.endsWith(":servo-mate"));
  const sourceMates = mates.filter((connection) => connection.id.endsWith(":source-mate"));
  if (servoMates.length !== 3 || sourceMates.length !== 3) {
    throw new Error(`servo_harness_rigid_mate_contract_incomplete:${cable.id}:${servoMates.length}:${sourceMates.length}`);
  }
  const targetPartIds = new Set(servoMates.map((mate) => mate.toPartId));
  if (targetPartIds.size !== 1) throw new Error(`servo_harness_servo_target_ambiguous:${cable.id}`);
  const servoPart = requiredPart(placedById, servoMates[0].toPartId);
  const servoTransform = fitConnectorTransform(servoMates.map((mate) => ({
    signal: mate.signal,
    source: mate.fromEndpoint,
    target: worldEndpoint(mate.toEndpoint, servoPart)
  })), cable.id);
  const nodeTransformRules = [
    { namePrefix: "connector:servo:", matrix: servoTransform },
    { namePrefix: "anchor:servo:", matrix: servoTransform }
  ];
  const conductors = [];
  for (const connection of conductorConnections) {
    const signal = normalizeSignal(connection.signal);
    const sourceMate = sourceMates.find((mate) => normalizeSignal(mate.signal) === signal);
    if (!sourceMate) throw new Error(`servo_harness_source_mate_missing:${cable.id}:${signal}`);
    const sourceTargetPart = requiredPart(placedById, sourceMate.toPartId);
    const sourceTarget = worldEndpoint(sourceMate.toEndpoint, sourceTargetPart);
    const sourceTransform = alignContactTransform(sourceMate.fromEndpoint, sourceTarget);
    nodeTransformRules.push(
      { namePrefix: `connector:source:${signal.toLowerCase()}:`, matrix: sourceTransform },
      { namePrefix: `anchor:source:${signal.toLowerCase()}:`, matrix: sourceTransform }
    );
    const servoAnchor = (profile.routingAnchors || []).find((anchor) => (
      anchor.nodeName === `anchor:servo:${signal.toLowerCase()}:wire-exit`
    ));
    const sourceAnchor = (profile.routingAnchors || []).find((anchor) => (
      anchor.nodeName === `anchor:source:${signal.toLowerCase()}:wire-exit`
    ));
    if (!servoAnchor || !sourceAnchor) throw new Error(`servo_harness_wire_exit_anchor_missing:${cable.id}:${signal}`);
    conductors.push({
      id: connection.id,
      cablePartId: cable.id,
      netId: connection.netId,
      signal,
      color: connection.color || colorForSignal(signal),
      diameterM: Number(connection.diameterM || 0.0012),
      minimumBendRadiusM: Number(connection.minimumBendRadiusM || 0.003),
      maximumCableLengthM: Number(connection.maximumCableLengthM),
      connectionMode: "deformable-servo-harness",
      from: transformedAnchor(servoAnchor, servoTransform, cable.id, relatedEngagementIds(servoPart, placed)),
      to: transformedAnchor(sourceAnchor, sourceTransform, cable.id, relatedEngagementIds(sourceTargetPart, placed))
    });
  }
  cable.hiddenNodeIncludes = [...new Set([...(cable.hiddenNodeIncludes || []), "cable:servo-conductor:"] )];
  cable.nodeTransformRules = [...(cable.nodeTransformRules || []), ...nodeTransformRules];
  cable.harnessGeometryMode = "deterministic_runtime_intact_servo_harness_from_locked_anchors";
  return {
    cablePartId: cable.id,
    servoHarnessId: conductorConnections[0].servoHarnessId,
    conductors,
    rigidMateIds: mates.map((mate) => mate.id)
  };
}

function routeDeformableHarnesses(specs, keepouts) {
  const routes = [];
  // Route the shortest connector-to-carrier bundles first. Their compact
  // local corridors are easy to destroy with a long early sweep; longer
  // harnesses retain enough length and lane freedom to route around the
  // already reserved short paths. Lexical tie-breaking keeps this stable.
  const orderedSpecs = [...specs].sort((left, right) => harnessDirectSpan(left) - harnessDirectSpan(right)
    || left.cablePartId.localeCompare(right.cablePartId));
  for (const [bundleIndex, spec] of orderedSpecs.entries()) {
    const bundleLane = alternatingBundleLane(bundleIndex);
    for (const [index, conductor] of spec.conductors.entries()) {
      const wire = {
        id: conductor.id,
        signal: conductor.signal,
        color: conductor.color,
        diameterM: Number(conductor.diameterM || 0.0012),
        minimumBendRadiusM: Number(conductor.minimumBendRadiusM || 0.003),
        bundleId: conductor.cablePartId,
        maximumCableLengthM: conductor.maximumCableLengthM,
        from: conductor.from,
        to: conductor.to
      };
      const points = createCollisionFreeWireRoute(wire, {
        lane: Math.max(-16, Math.min(16, laneFor(index) + bundleLane)),
        bowDirection: (index + bundleIndex) % 2 ? "left" : "right",
        bowHeightMm: Math.min(7, 4.5 + bundleIndex)
      }, 0, keepouts, routes);
      assertOpenNonLoopingPolyline(points, wire.id);
      assertExactEndpoints(points, conductor.from.position, conductor.to.position, wire.id);
      routes.push({
        wireId: wire.id,
        netId: conductor.netId,
        signal: conductor.signal,
        color: conductor.color,
        radiusM: wire.diameterM / 2,
        diameterM: wire.diameterM,
        minimumBendRadiusM: wire.minimumBendRadiusM,
        measuredMinimumBendRadiusM: polylineMinimumBendRadius(points),
        bundleId: conductor.cablePartId,
        points,
        fromEndpoint: conductor.from,
        toEndpoint: conductor.to,
        connectionMode: conductor.connectionMode || "deformable-factory-harness",
        loopCount: 0,
        selfIntersectionCount: 0,
        routingStyle: "short-open-natural-arch"
      });
    }
  }
  return routes;
}

function harnessDirectSpan(spec) {
  const lengths = (spec.conductors || []).map((conductor) => Math.hypot(...conductor.from.position.map((value, axis) => conductor.to.position[axis] - value)));
  return lengths.length ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length : Number.POSITIVE_INFINITY;
}

function alternatingBundleLane(index) {
  if (index === 0) return 0;
  const magnitude = Math.ceil(index / 2) * 5;
  return index % 2 ? magnitude : -magnitude;
}

function relatedEngagementIds(part, placed) {
  return [...new Set([
    part.id,
    part.mountedToPartId,
    ...placed.filter((candidate) => candidate.mountedToPartId === part.id).map((candidate) => candidate.id)
  ].filter(Boolean))];
}

function deterministicPlacement(parts, profileByAsset, graph, gap) {
  const input = parts.map((part) => {
    const profile = profileByAsset.get(part.assetId);
    if (!profile || profile.state !== "ready") throw new Error(`interface_profile_not_ready:${part.assetId}`);
    const bounds = profile.geometry?.bounds;
    if (!finiteBounds(bounds)) throw new Error(`glb_bounds_missing:${part.assetId}`);
    return { ...part, profile, localBounds: bounds };
  });
  const controller = input.find((part) => part.id === graph.controllerPartId);
  const carrier = graph.carrierPartId ? input.find((part) => part.id === graph.carrierPartId) : null;
  if (!controller) throw new Error("controller_part_missing");
  if (graph.carrierPartId && !carrier) throw new Error("carrier_part_missing");
  const anchor = carrier || controller;
  const anchorTranslation = exactTranslation(anchor.transform?.translation || [0, 0, -anchor.localBounds.min[2]], anchor.id);
  const placed = [place(anchor, anchorTranslation)];
  if (carrier) {
    const mount = resolveControllerCarrierMount(carrier.profile, controller.assetId);
    const fittedMount = mount.transformMethod === "align-matching-contact-frames"
      ? fitControllerCarrierContacts(mount, controller.profile, carrier.profile)
      : { rotation: mount?.rotation || [0, 0, 0], translation: null };
    const controllerRotation = fittedMount.rotation;
    const controllerLocalTranslation = controller.transform?.translation
      ? exactTranslation(controller.transform.translation, controller.id)
      : fittedMount.translation || translationFromMount(mount, controller.localBounds, controller.id, controllerRotation);
    const controllerTranslation = controllerLocalTranslation.map((value, axis) => value + anchorTranslation[axis]);
    placed.push(place(controller, controllerTranslation, {
      rotation: controllerRotation,
      mountedToPartId: carrier.id,
      mountId: mount?.id || "caller-supplied-transform"
    }));
  }
  const fixedIds = new Set(placed.map((part) => part.id));
  const selectorShuntPartIds = new Set(input.filter((part) => part.profile.selectorShunt).map((part) => part.id));
  const movable = input.filter((part) => !fixedIds.has(part.id)
    && part.profile.coverage?.category !== "cable"
    && !selectorShuntPartIds.has(part.id));
  const cablePartIds = new Set(input.filter((part) => part.profile.coverage?.category === "cable").map((part) => part.id));
  for (const [index, part] of movable.sort((left, right) => left.id.localeCompare(right.id)).entries()) {
    const anchorContact = preferredAnchorContactPosition(part.id, anchor.id, graph, cablePartIds);
    const peripheralContactNormal = preferredPeripheralContactNormal(part.id, graph, cablePartIds);
    const preferredSide = preferredPlacementSide(anchorContact, anchor.localBounds, index);
    const ownerGvsRotation = ownerVerifiedGvsContactRotation(part.id, graph);
    const candidate = placePeripheralInNearestClearLane(
      part,
      preferredSide,
      placed,
      placed[0],
      gap,
      anchorContact,
      peripheralContactNormal,
      ownerGvsRotation
    );
    placed.push(candidate);
  }
  for (const cable of input.filter((part) => !fixedIds.has(part.id) && part.profile.coverage?.category === "cable")) {
    placed.push(place(cable, cable.transform?.translation ? exactTranslation(cable.transform.translation, cable.id) : [0, 0, 0], { deformableHarness: true }));
  }
  for (const shunt of input.filter((part) => selectorShuntPartIds.has(part.id))) {
    const mates = graph.connections.filter((connection) => (
      connection.selectorShuntRigidMate === true && connection.fromPartId === shunt.id
    ));
    if (mates.length !== 2) throw new Error(`selector_shunt_rigid_mate_contract_incomplete:${shunt.id}:${mates.length}`);
    const targetPartIds = new Set(mates.map((mate) => mate.toPartId));
    if (targetPartIds.size !== 1) throw new Error(`selector_shunt_target_ambiguous:${shunt.id}`);
    const targetPart = placed.find((part) => part.id === mates[0].toPartId);
    if (!targetPart) throw new Error(`selector_shunt_target_not_placed:${shunt.id}:${mates[0].toPartId}`);
    const transform = fitConnectorTransform(mates.map((mate) => ({
      signal: mate.signal,
      source: mate.fromEndpoint,
      target: worldEndpoint(mate.toEndpoint, targetPart)
    })), shunt.id);
    const { translation, rotation } = decomposeRigidAffine(transform);
    placed.push(place(shunt, translation, {
      rotation,
      mountedToPartId: targetPart.id,
      mountId: mates[0].selectorShuntRequirementId
    }));
  }
  return placed.map(({ profile, localBounds, ...part }) => part);
}

function placePeripheralInNearestClearLane(
  part,
  preferredSide,
  placed,
  anchor,
  gap,
  preferredContact = null,
  connectorNormal = null,
  rotationOverrideZ = null
) {
  // Center the peripheral on the carrier contact cluster that owns its cable.
  // This preserves source/target ordering and prevents later harnesses from
  // crossing earlier bundles merely because asset IDs sort differently.
  const anchorCenterX = Number.isFinite(preferredContact?.[0]) ? preferredContact[0] : center(anchor.worldBounds, 0);
  const anchorCenterY = Number.isFinite(preferredContact?.[1]) ? preferredContact[1] : center(anchor.worldBounds, 1);
  // Fill the preferred side first, then the two perpendicular sides and the
  // opposite side. A pure left/right lane eventually places a fourth large
  // sensor beyond a real 150 mm harness even when compact top/bottom space is
  // available around the same carrier.
  const sideOrder = sidePreferenceOrder(preferredSide);
  const laneStepM = 0.005;
  for (let lane = 0; lane <= 50; lane += 1) {
    const offsets = lane === 0 ? [0] : [lane * laneStepM, -lane * laneStepM];
    for (const side of sideOrder) {
      const rotation = Number.isFinite(rotationOverrideZ)
        ? [0, 0, rotationOverrideZ]
        : rotationToFaceAnchor(connectorNormal, side);
      const rotatedBounds = transformBounds(part.localBounds, rotation, [0, 0, 0]);
      for (const offset of offsets) {
        const translation = peripheralTranslationForSide(rotatedBounds, anchor.worldBounds, side, gap, anchorCenterX, anchorCenterY, offset);
        const candidate = place(part, translation, { rotation });
        if (placed.every((existing) => aabbSeparation(candidate.worldBounds, existing.worldBounds) >= gap - 1e-9)) return candidate;
      }
    }
  }
  throw new Error(`placement_lane_unavailable:${part.id}`);
}

function ownerVerifiedGvsContactRotation(partId, graph) {
  const guides = (graph.connections || []).filter((connection) => (
    connection.ownerVerifiedServoGuide === true
    && connection.toPartId === partId
  ));
  if (!guides.length) return null;
  const bundles = Map.groupBy(guides, (connection) => connection.bundleId);
  for (const bundle of bundles.values()) {
    const ground = bundle.find((connection) => connection.signal === "GND");
    const pwm = bundle.find((connection) => connection.signal === "PWM");
    if (!ground || !pwm) continue;
    const deviceGround = ground.toEndpoint?.position;
    const devicePwm = pwm.toEndpoint?.position;
    const surfaceGround = ground.surfaceEndpoint?.position;
    const surfacePwm = pwm.surfaceEndpoint?.position;
    if (![deviceGround, devicePwm, surfaceGround, surfacePwm].every(finitePoint)) continue;
    const deviceAngle = Math.atan2(devicePwm[1] - deviceGround[1], devicePwm[0] - deviceGround[0]);
    const surfaceAngle = Math.atan2(surfacePwm[1] - surfaceGround[1], surfacePwm[0] - surfaceGround[0]);
    return normalizeAngle(surfaceAngle - deviceAngle);
  }
  return null;
}

function rotationToFaceAnchor(connectorNormal, side) {
  if (!finitePoint(connectorNormal) || Math.hypot(connectorNormal[0], connectorNormal[1]) < 1e-9) return [0, 0, 0];
  const desired = side === "right" ? [-1, 0] : side === "left" ? [1, 0] : side === "top" ? [0, -1] : [0, 1];
  const sourceAngle = Math.atan2(connectorNormal[1], connectorNormal[0]);
  const desiredAngle = Math.atan2(desired[1], desired[0]);
  return [0, 0, normalizeAngle(desiredAngle - sourceAngle)];
}

function normalizeAngle(value) {
  let output = value;
  while (output > Math.PI) output -= Math.PI * 2;
  while (output <= -Math.PI) output += Math.PI * 2;
  return output;
}

function preferredPlacementSide(contact, bounds, fallbackIndex) {
  if (!finitePoint(contact)) return fallbackIndex % 2 ? "left" : "right";
  const normalizedX = (contact[0] - center(bounds, 0)) / Math.max(1e-9, bounds.max[0] - bounds.min[0]);
  const normalizedY = (contact[1] - center(bounds, 1)) / Math.max(1e-9, bounds.max[1] - bounds.min[1]);
  if (Math.abs(normalizedX) >= Math.abs(normalizedY)) return normalizedX >= 0 ? "right" : "left";
  return normalizedY >= 0 ? "top" : "bottom";
}

function sidePreferenceOrder(preferred) {
  if (preferred === "right") return ["right", "top", "bottom", "left"];
  if (preferred === "left") return ["left", "bottom", "top", "right"];
  if (preferred === "top") return ["top", "right", "left", "bottom"];
  return ["bottom", "left", "right", "top"];
}

function peripheralTranslationForSide(bounds, anchorBounds, side, gap, centerX, centerY, offset) {
  if (side === "right" || side === "left") {
    const edge = side === "right" ? anchorBounds.max[0] + gap : anchorBounds.min[0] - gap;
    return [
      side === "right" ? edge - bounds.min[0] : edge - bounds.max[0],
      centerY + offset - center(bounds, 1),
      -bounds.min[2]
    ];
  }
  const edge = side === "top" ? anchorBounds.max[1] + gap : anchorBounds.min[1] - gap;
  return [
    centerX + offset - center(bounds, 0),
    side === "top" ? edge - bounds.min[1] : edge - bounds.max[1],
    -bounds.min[2]
  ];
}

function preferredAnchorContactPosition(partId, anchorPartId, graph, cablePartIds) {
  const relatedCableIds = new Set();
  for (const connection of graph.connections || []) {
    if (connection.fromPartId === partId && cablePartIds.has(connection.toPartId)) relatedCableIds.add(connection.toPartId);
    if (connection.toPartId === partId && cablePartIds.has(connection.fromPartId)) relatedCableIds.add(connection.fromPartId);
  }
  const owners = new Set([partId, ...relatedCableIds]);
  const positions = [];
  for (const connection of graph.connections || []) {
    const touchesOwner = owners.has(connection.fromPartId) || owners.has(connection.toPartId);
    if (!touchesOwner) continue;
    if (connection.fromPartId === anchorPartId && finitePoint(connection.fromEndpoint?.position)) positions.push(connection.fromEndpoint.position);
    if (connection.toPartId === anchorPartId && finitePoint(connection.toEndpoint?.position)) positions.push(connection.toEndpoint.position);
    if (connection.surfaceEndpoint?.partId === anchorPartId && finitePoint(connection.surfaceEndpoint.position)) positions.push(connection.surfaceEndpoint.position);
  }
  if (!positions.length) return null;
  return [0, 1, 2].map((axis) => positions.reduce((sum, position) => sum + position[axis], 0) / positions.length);
}

function preferredPeripheralContactNormal(partId, graph, cablePartIds) {
  const relatedCableIds = new Set();
  for (const connection of graph.connections || []) {
    if (connection.fromPartId === partId && cablePartIds.has(connection.toPartId)) relatedCableIds.add(connection.toPartId);
    if (connection.toPartId === partId && cablePartIds.has(connection.fromPartId)) relatedCableIds.add(connection.fromPartId);
  }
  const normals = [];
  for (const connection of graph.connections || []) {
    const touchesRelatedCable = relatedCableIds.has(connection.fromPartId) || relatedCableIds.has(connection.toPartId);
    if (!touchesRelatedCable && relatedCableIds.size) continue;
    if (connection.fromPartId === partId && finitePoint(connection.fromEndpoint?.normal)) normals.push(connection.fromEndpoint.normal);
    if (connection.toPartId === partId && finitePoint(connection.toEndpoint?.normal)) normals.push(connection.toEndpoint.normal);
  }
  if (!normals.length) return null;
  return [0, 1, 2].map((axis) => normals.reduce((sum, normal) => sum + normal[axis], 0) / normals.length);
}

function fitControllerCarrierContacts(mount, controllerProfile, carrierProfile) {
  const controllerContacts = (controllerProfile.contacts || []).filter((contact) => finitePoint(contact.position));
  const carrierContacts = (carrierProfile.contacts || []).filter((contact) => finitePoint(contact.position)
    && mount.carrierConnectorIds.includes(contact.connectorId));
  const rotation = mount.rotation || [0, 0, 0];
  const uniquePairs = [];
  const signals = new Set(controllerContacts.map(controllerCarrierFitKey));
  for (const signal of signals) {
    const controllerMatches = controllerContacts.filter((contact) => controllerCarrierFitKey(contact) === signal);
    const carrierMatches = carrierContacts.filter((contact) => controllerCarrierFitKey(contact) === signal);
    if (controllerMatches.length === 1 && carrierMatches.length === 1) uniquePairs.push([controllerMatches[0], carrierMatches[0]]);
  }
  if (uniquePairs.length < 2) throw new Error(`controller_carrier_contact_frame_underconstrained:${carrierProfile.assetId}:${controllerProfile.assetId}`);
  const offsets = uniquePairs.map(([source, target]) => rotatePoint(source.position, rotation)
    .map((value, axis) => target.position[axis] - value));
  const translation = [0, 1, 2].map((axis) => offsets.reduce((sum, value) => sum + value[axis], 0) / offsets.length);
  const candidates = [];
  for (const [sourceIndex, source] of controllerContacts.entries()) {
    for (const [targetIndex, target] of carrierContacts.entries()) {
      if (controllerCarrierFitKey(source) !== controllerCarrierFitKey(target)) continue;
      const transformed = rotatePoint(source.position, rotation).map((value, axis) => value + translation[axis]);
      const transformedNormal = rotatePoint(source.normal || [0, 0, 1], rotation);
      candidates.push({
        sourceIndex,
        targetIndex,
        distance: Math.hypot(...transformed.map((value, axis) => value - target.position[axis])),
        normalDot: normalizedDot(transformedNormal, target.normal || [0, 0, -1])
      });
    }
  }
  candidates.sort((left, right) => left.distance - right.distance);
  const usedSource = new Set();
  const usedTarget = new Set();
  const paired = [];
  for (const candidate of candidates) {
    if (usedSource.has(candidate.sourceIndex) || usedTarget.has(candidate.targetIndex)) continue;
    usedSource.add(candidate.sourceIndex);
    usedTarget.add(candidate.targetIndex);
    paired.push(candidate);
  }
  if (paired.length < mount.minimumPairedContacts) {
    throw new Error(`controller_carrier_contact_pairs_incomplete:${carrierProfile.assetId}:${controllerProfile.assetId}:${paired.length}/${mount.minimumPairedContacts}`);
  }
  const maximumResidual = Math.max(...paired.map((pair) => pair.distance));
  if (maximumResidual > mount.contactAlignmentToleranceM) {
    throw new Error(`controller_carrier_contact_alignment_failed:${carrierProfile.assetId}:${controllerProfile.assetId}:${maximumResidual}`);
  }
  const worstFacing = Math.max(...paired.map((pair) => pair.normalDot));
  if (worstFacing > -0.95) {
    throw new Error(`controller_carrier_contact_orientation_failed:${carrierProfile.assetId}:${controllerProfile.assetId}:${worstFacing}`);
  }
  return { rotation, translation };
}

function controllerCarrierFitKey(contact) {
  // XIAO controller profiles retain the manufacturer D0-D10 label separately
  // from the family-specific GPIO number. The expansion base socket is labeled
  // by D-number, so seating must pair the shared physical label—not falsely
  // require every XIAO family to expose identical GPIO numbers.
  const physicalLabel = String(contact?.physicalLabel || "").trim().toUpperCase();
  if (/^D(?:10|[0-9])$/.test(physicalLabel)) return physicalLabel;
  return String(contact?.signal || "").trim().toUpperCase();
}

function normalizedDot(left, right) {
  const leftLength = Math.hypot(...left);
  const rightLength = Math.hypot(...right);
  if (leftLength < 1e-9 || rightLength < 1e-9) return 1;
  return left.reduce((sum, value, axis) => sum + (value / leftLength) * (right[axis] / rightLength), 0);
}

function finitePoint(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function place(part, translation, extra = {}) {
  const rotation = extra.rotation || [0, 0, 0];
  return {
    id: part.id,
    assetId: part.assetId,
    role: part.role || part.profile.coverage?.category || "part",
    translation,
    rotation,
    scale: [1, 1, 1],
    localBounds: part.localBounds,
    worldBounds: transformBounds(part.localBounds, rotation, translation),
    textFace: "up",
    ...extra
  };
}

function resolveControllerCarrierMount(carrierProfile, controllerAssetId) {
  const mounts = (carrierProfile.mounts || []).filter((mount) => mount.kind === "controller-carrier");
  const compatible = mounts.filter((mount) => mount.compatibleAssetIds?.includes(controllerAssetId));
  if (compatible.length !== 1) {
    throw new Error(compatible.length
      ? `controller_carrier_mount_ambiguous:${controllerAssetId}`
      : `controller_carrier_mount_missing_or_incompatible:${carrierProfile.assetId}:${controllerAssetId}`);
  }
  return compatible[0];
}

function translationFromMount(mount, controllerBounds, controllerId, rotation = [0, 0, 0]) {
  if (mount.transformMethod !== "align-controller-bounds-to-seat") {
    throw new Error(`controller_carrier_mount_method_unsupported:${mount.transformMethod}`);
  }
  const rotatedBounds = transformBounds(controllerBounds, rotation, [0, 0, 0]);
  const centerX = center(rotatedBounds, 0);
  const centerY = center(rotatedBounds, 1);
  return exactTranslation([
    mount.seatCenter[0] - centerX,
    mount.seatCenter[1] - centerY,
    mount.seatCenter[2] - rotatedBounds.min[2] + mount.insertionClearanceM
  ], controllerId);
}

function assertSeparatedFromPlaced(candidate, placed, gap) {
  for (const existing of placed) {
    const separation = aabbSeparation(candidate.worldBounds, existing.worldBounds);
    if (separation < gap - 1e-9) throw new Error(`placement_body_gap_violation:${candidate.id}:${existing.id}:${separation}`);
  }
}

function aabbSeparation(left, right) {
  const axisGaps = [0, 1, 2].map((axis) => Math.max(0, left.min[axis] - right.max[axis], right.min[axis] - left.max[axis]));
  return Math.hypot(...axisGaps);
}

function worldEndpoint(endpoint, placedPart) {
  if (!Array.isArray(endpoint?.position) || endpoint.position.length !== 3 || !endpoint.position.every(Number.isFinite)) {
    throw new Error(`endpoint_position_missing:${endpoint?.partId || "unknown"}:${endpoint?.nodeName || "unknown"}`);
  }
  return {
    ...endpoint,
    position: rotatePoint(endpoint.position, placedPart.rotation || [0, 0, 0])
      .map((value, axis) => value + placedPart.translation[axis]),
    normal: rotatePoint(endpoint.normal || [0, 0, 1], placedPart.rotation || [0, 0, 0])
  };
}

function transformBounds(bounds, rotation, translation) {
  const corners = [];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) corners.push(rotatePoint([x, y, z], rotation));
    }
  }
  return {
    min: [0, 1, 2].map((axis) => Math.min(...corners.map((point) => point[axis])) + translation[axis]),
    max: [0, 1, 2].map((axis) => Math.max(...corners.map((point) => point[axis])) + translation[axis])
  };
}

function rotatePoint(point, rotation) {
  const [rx, ry, rz] = rotation;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const afterX = [point[0], point[1] * cx - point[2] * sx, point[1] * sx + point[2] * cx];
  const afterY = [afterX[0] * cy + afterX[2] * sy, afterX[1], -afterX[0] * sy + afterX[2] * cy];
  return [afterY[0] * cz - afterY[1] * sz, afterY[0] * sz + afterY[1] * cz, afterY[2]];
}

function assertOpenNonLoopingPolyline(points, wireId) {
  if (!Array.isArray(points) || points.length < 2) throw new Error(`route_empty:${wireId}`);
  if (distance(points[0], points.at(-1)) < 0.001) throw new Error(`route_closed_loop:${wireId}`);
  const cumulativeLength = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulativeLength.push(cumulativeLength.at(-1) + distance(points[index - 1], points[index]));
  }
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 4; right < points.length; right += 1) {
      const separation = distance(points[left], points[right]);
      // Dense samples on one legitimate bend can be spatially close. Treat
      // closeness as a loop only when the two samples are also separated by
      // at least 1 mm of conductor travel.
      if (cumulativeLength[right] - cumulativeLength[left] > 0.001 && separation < 0.00015) {
        throw new Error(`route_self_intersection:${wireId}:${left}:${right}:${separation}`);
      }
    }
  }
}

function assertExactEndpoints(points, source, target, wireId) {
  if (distance(points[0], source) > 1e-9 || distance(points.at(-1), target) > 1e-9) throw new Error(`route_endpoint_gap:${wireId}`);
}

function assertClearOfOtherRoutes(points, routes, wireId, radiusM, bundleId, netId) {
  const candidateInterior = routeInteriorPoints(points);
  for (const route of routes) {
    if (route.bundleId === bundleId) continue;
    const clearance = radiusM + Number(route.radiusM || 0.0006) + 0.0002;
    const existingInterior = routeInteriorPoints(route.points);
    for (const left of candidateInterior) {
      for (const right of existingInterior) {
        if (distance(left, right) < clearance) {
          throw new Error(`route_to_route_clearance:${wireId}:${route.wireId}`);
        }
      }
    }
  }
}

function routeInteriorPoints(points, endpointAllowanceM = 0.015) {
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative.at(-1) + distance(points[index - 1], points[index]));
  }
  const total = cumulative.at(-1) || 0;
  return points.filter((point, index) => cumulative[index] >= endpointAllowanceM && total - cumulative[index] >= endpointAllowanceM);
}

function laneFor(index) {
  const magnitude = Math.floor(index / 2);
  return index % 2 ? -(magnitude + 1) : magnitude;
}

// Electrical edge direction is semantic: power commonly flows surface to
// peripheral while ground/signal edges may be authored in the opposite
// direction. Visual guide direction must not inherit that inconsistency or
// conductors in one device bundle can be forced to swap sides and cross.
// Normalize every displayed edge to peripheral -> carrier, with a stable
// lexical fallback for the uncommon peripheral-to-peripheral interconnect.
function orderedGuideEndpoints(endpoints) {
  return [...endpoints].sort((left, right) => (
    Number(left.partId === "carrier") - Number(right.partId === "carrier")
      || String(left.partId || "").localeCompare(String(right.partId || ""))
      || String(left.nodeName || "").localeCompare(String(right.nodeName || ""))
  ));
}

function logicalBundleDepartureDirections(routes, placedById) {
  const groups = new Map();
  for (const route of routes) {
    for (const endpoint of route.externalEndpoints || []) {
      const part = placedById.get(endpoint.partId);
      if (!part) continue;
      const key = bundlePartKey(route.bundleId, endpoint.partId);
      const point = worldEndpoint(endpoint, part).position;
      if (!groups.has(key)) groups.set(key, { part, points: [] });
      groups.get(key).points.push(point);
    }
  }
  const result = new Map();
  for (const [key, { part, points }] of groups) {
    if (!finiteBounds(part.worldBounds)) continue;
    const distinct = uniquePoints(points);
    if (distinct.length < 2) continue;
    let farthest = null;
    for (let left = 0; left < distinct.length; left += 1) {
      for (let right = left + 1; right < distinct.length; right += 1) {
        const dx = distinct[right][0] - distinct[left][0];
        const dy = distinct[right][1] - distinct[left][1];
        const span = Math.hypot(dx, dy);
        if (!farthest || span > farthest.span) farthest = { dx, dy, span };
      }
    }
    if (!farthest || farthest.span < 0.0005) continue;
    const perpendicular = [-farthest.dy / farthest.span, farthest.dx / farthest.span, 0];
    const groupCenter = [0, 1, 2].map((axis) => distinct.reduce((sum, point) => sum + point[axis], 0) / distinct.length);
    const bodyCenter = [0, 1, 2].map((axis) => (part.worldBounds.min[axis] + part.worldBounds.max[axis]) / 2);
    const outward = [groupCenter[0] - bodyCenter[0], groupCenter[1] - bodyCenter[1], 0];
    const sign = perpendicular[0] * outward[0] + perpendicular[1] * outward[1] >= 0 ? 1 : -1;
    result.set(key, perpendicular.map((value) => value * sign));
  }
  return result;
}

function bundlePartKey(bundleId, partId) {
  return `${bundleId || "unbundled"}\u0000${partId || "unknown"}`;
}

function uniquePoints(points, toleranceM = 1e-7) {
  const output = [];
  for (const point of points) {
    if (!output.some((candidate) => distance(candidate, point) <= toleranceM)) output.push(point);
  }
  return output;
}

function finiteBounds(bounds) {
  return [bounds?.min, bounds?.max].every((value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite));
}

function exactTranslation(value, partId) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new Error(`invalid_translation:${partId}`);
  return value.map(Number);
}

function center(bounds, axis) {
  return (bounds.min[axis] + bounds.max[axis]) / 2;
}

function distance(left, right) {
  return Math.hypot(...left.map((value, axis) => value - right[axis]));
}

function fitConnectorTransform(entries, cablePartId) {
  if (entries.length < 2) throw new Error(`connector_frame_requires_two_contacts:${cablePartId}`);
  const ordered = [...entries].sort((left, right) => signalOrder(left.signal) - signalOrder(right.signal));
  const sourcePoints = ordered.map((entry) => entry.source.position);
  const targetPoints = ordered.map((entry) => entry.target.position);
  const sourceNormal = averageUnit(ordered.map((entry) => entry.source.normal));
  const targetNormal = scaleVec(averageUnit(ordered.map((entry) => entry.target.normal)), -1);
  const sourceBasis = connectorBasis(sourcePoints, sourceNormal, `${cablePartId}:source`);
  const targetBasis = connectorBasis(targetPoints, targetNormal, `${cablePartId}:target`);
  const rotation = multiplyMat3(targetBasis, transposeMat3(sourceBasis));
  const sourceCenter = averagePoints(sourcePoints);
  const targetCenter = averagePoints(targetPoints);
  const translation = subtractVec(targetCenter, transformDirection3(rotation, sourceCenter));
  const matrix = affineMatrix(rotation, translation);
  const maximumResidual = Math.max(...sourcePoints.map((point, index) => distance(transformPoint4(matrix, point), targetPoints[index])));
  if (maximumResidual > 0.00045) throw new Error(`connector_pitch_or_order_mismatch:${cablePartId}:${maximumResidual}`);
  return matrix;
}

function decomposeRigidAffine(matrix) {
  const rotationMatrix = matrix3FromAffine(matrix);
  const ry = Math.asin(clamp(-rotationMatrix[2][0], -1, 1));
  const cy = Math.cos(ry);
  const rx = Math.abs(cy) > 1e-8
    ? Math.atan2(rotationMatrix[2][1], rotationMatrix[2][2])
    : Math.atan2(-rotationMatrix[1][2], rotationMatrix[1][1]);
  const rz = Math.abs(cy) > 1e-8
    ? Math.atan2(rotationMatrix[1][0], rotationMatrix[0][0])
    : 0;
  return {
    translation: [matrix[12], matrix[13], matrix[14]],
    rotation: [rx, ry, rz]
  };
}

function alignContactTransform(source, target, engagementDepthM = 0) {
  const rotation = rotationFromTo(unitVec(source.normal), scaleVec(unitVec(target.normal), -1));
  const targetPosition = subtractVec(target.position, scaleVec(unitVec(target.normal), Math.max(0, Number(engagementDepthM || 0))));
  const translation = subtractVec(targetPosition, transformDirection3(rotation, source.position));
  return affineMatrix(rotation, translation);
}

function transformedAnchor(anchor, matrix, cablePartId, engagementPartIds) {
  return {
    partId: cablePartId,
    nodeName: anchor.nodeName,
    signal: anchor.signal,
    position: transformPoint4(matrix, anchor.position),
    normal: unitVec(transformDirection3(matrix3FromAffine(matrix), anchor.normal)),
    permittedEngagementPartIds: [cablePartId, ...(engagementPartIds || [])]
  };
}

function transformedEmbeddedAnchor(anchor, matrix, owner, engagementPartIds) {
  const localPosition = transformPoint4(matrix, anchor.position);
  const localNormal = unitVec(transformDirection3(matrix3FromAffine(matrix), anchor.normal));
  return {
    partId: owner.id,
    nodeName: anchor.nodeName,
    signal: anchor.signal,
    position: rotatePoint(localPosition, owner.rotation || [0, 0, 0])
      .map((value, axis) => value + owner.translation[axis]),
    normal: unitVec(rotatePoint(localNormal, owner.rotation || [0, 0, 0])),
    permittedEngagementPartIds: [owner.id, ...(engagementPartIds || [])]
  };
}

function localEndpointFromWorld(endpoint, owner) {
  const translated = endpoint.position.map((value, axis) => value - owner.translation[axis]);
  return {
    ...endpoint,
    position: inverseRotatePoint(translated, owner.rotation || [0, 0, 0]),
    normal: inverseRotatePoint(endpoint.normal || [0, 0, 1], owner.rotation || [0, 0, 0])
  };
}

function inverseRotatePoint(point, rotation) {
  const [rx, ry, rz] = rotation;
  const cz = Math.cos(-rz), sz = Math.sin(-rz);
  const cy = Math.cos(-ry), sy = Math.sin(-ry);
  const cx = Math.cos(-rx), sx = Math.sin(-rx);
  const afterZ = [point[0] * cz - point[1] * sz, point[0] * sz + point[1] * cz, point[2]];
  const afterY = [afterZ[0] * cy + afterZ[2] * sy, afterZ[1], -afterZ[0] * sy + afterZ[2] * cy];
  return [afterY[0], afterY[1] * cx - afterY[2] * sx, afterY[1] * sx + afterY[2] * cx];
}

function connectorBasis(points, normal, label) {
  const row = unitVec(subtractVec(points.at(-1), points[0]));
  let side = cross(normal, row);
  if (Math.hypot(...side) < 0.000001) throw new Error(`connector_frame_degenerate:${label}`);
  side = unitVec(side);
  const correctedRow = unitVec(cross(side, normal));
  return columnsMat3(correctedRow, side, unitVec(normal));
}

function rotationFromTo(from, to) {
  const cosine = clamp(dotVec(from, to), -1, 1);
  if (cosine > 1 - 1e-10) return identityMat3();
  if (cosine < -1 + 1e-10) {
    const candidate = Math.abs(from[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
    const axis = unitVec(cross(from, candidate));
    return axisAngle(axis, Math.PI);
  }
  const axis = unitVec(cross(from, to));
  return axisAngle(axis, Math.acos(cosine));
}

function axisAngle([x, y, z], angle) {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    [t*x*x+c, t*x*y-s*z, t*x*z+s*y],
    [t*x*y+s*z, t*y*y+c, t*y*z-s*x],
    [t*x*z-s*y, t*y*z+s*x, t*z*z+c]
  ];
}

function columnsMat3(a, b, c) {
  return [[a[0], b[0], c[0]], [a[1], b[1], c[1]], [a[2], b[2], c[2]]];
}
function identityMat3() { return [[1,0,0],[0,1,0],[0,0,1]]; }
function transposeMat3(matrix) { return matrix[0].map((_, column) => matrix.map((row) => row[column])); }
function multiplyMat3(a, b) { return a.map((row) => b[0].map((_, column) => row.reduce((sum, value, index) => sum + value * b[index][column], 0))); }
function transformDirection3(matrix, vector) { return matrix.map((row) => dotVec(row, vector)); }
function matrix3FromAffine(matrix) { return [[matrix[0],matrix[4],matrix[8]],[matrix[1],matrix[5],matrix[9]],[matrix[2],matrix[6],matrix[10]]]; }
function affineMatrix(rotation, translation) {
  return [rotation[0][0],rotation[1][0],rotation[2][0],0,rotation[0][1],rotation[1][1],rotation[2][1],0,rotation[0][2],rotation[1][2],rotation[2][2],0,translation[0],translation[1],translation[2],1];
}
function transformPoint4(matrix, point) { return [matrix[0]*point[0]+matrix[4]*point[1]+matrix[8]*point[2]+matrix[12],matrix[1]*point[0]+matrix[5]*point[1]+matrix[9]*point[2]+matrix[13],matrix[2]*point[0]+matrix[6]*point[1]+matrix[10]*point[2]+matrix[14]]; }
function averagePoints(points) { return [0,1,2].map((axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length); }
function averageUnit(vectors) { return unitVec(averagePoints(vectors)); }
function subtractVec(left, right) { return left.map((value, axis) => value - right[axis]); }
function scaleVec(value, scale) { return value.map((entry) => entry * scale); }
function dotVec(left, right) { return left.reduce((sum, value, axis) => sum + value * right[axis], 0); }
function cross(left, right) { return [left[1]*right[2]-left[2]*right[1],left[2]*right[0]-left[0]*right[2],left[0]*right[1]-left[1]*right[0]]; }
function unitVec(value) { const length = Math.hypot(...value); if (length < 1e-12) throw new Error("zero_length_vector"); return value.map((entry) => entry / length); }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function signalOrder(signal) { return ({ GND: 0, "3V3": 1, SDA: 2, SCL: 3 })[normalizeSignal(signal)] ?? 99; }
function normalizeSignal(signal) { const value = String(signal || "").toUpperCase(); if (/^GND(?:-[ABC])?$/.test(value)) return "GND"; if (/^3V3[AB]?$/.test(value)) return "3V3"; return value; }
function colorForSignal(signal) { const value = normalizeSignal(signal); return value === "GND" ? "black" : ["3V3", "5V", "VCC"].includes(value) ? "red" : "yellow"; }

function requiredPart(parts, id) {
  const part = parts.get(id);
  if (!part) throw new Error(`placed_part_missing:${id}`);
  return part;
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
