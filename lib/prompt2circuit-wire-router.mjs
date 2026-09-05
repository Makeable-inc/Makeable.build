// Generic circuit-only conductor router. This module deliberately has no
// dependency on project recipes, hero rendering, housings, or STL generation.
export function createCollisionFreeWireRoute(wire, route, boardPlaneZ = 0, keepouts = [], existingRoutes = []) {
  const from = endpointPosition(wire?.from, "from", wire?.id);
  const to = endpointPosition(wire?.to, "to", wire?.id);
  const lane = Math.max(-16, Math.min(16, Math.trunc(Number(route?.lane || 0))));
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const planarLength = Math.hypot(dx, dy);
  const planarNormal = planarLength > 0.000001 ? [-dy / planarLength, dx / planarLength] : [1, 0];
  const direction = route?.bowDirection === "right" ? -1 : 1;
  const sourceKeepout = keepouts.find((entry) => entry.id === wire?.from?.partId);
  const targetKeepout = keepouts.find((entry) => entry.id === wire?.to?.partId);
  const sourceEngagementPartIds = [sourceKeepout?.id, ...(wire?.from?.permittedEngagementPartIds || [])].filter(Boolean);
  const targetEngagementPartIds = [targetKeepout?.id, ...(wire?.to?.permittedEngagementPartIds || [])].filter(Boolean);
  const sourceEscapeKeepout = combinedKeepout(keepouts, sourceEngagementPartIds) || sourceKeepout;
  const targetEscapeKeepout = combinedKeepout(keepouts, targetEngagementPartIds) || targetKeepout;
  const wireRadiusM = Math.max(0.00025, Number(wire?.diameterM || 0.0012) / 2);
  const sourceExit = connectorEscapePoint(from, sourceEscapeKeepout, 0.0018 + wireRadiusM, route?.targetBundleCenter, wire?.from?.normal);
  const targetExit = connectorEscapePoint(to, targetEscapeKeepout, 0.0018 + wireRadiusM, route?.sourceBundleCenter, wire?.to?.normal);
  const localUndersideRoute = Boolean(
    wire?.from?.partId
    && wire.from.partId === wire?.to?.partId
    && Number(wire?.from?.normal?.[2]) < -0.7
    && Number(wire?.to?.normal?.[2]) < -0.7
  );
  const tallestKeepoutZ = Math.max(boardPlaneZ, from[2], to[2], ...keepouts.map((entry) => entry.bounds.max[2] + entry.paddingM));
  const lowestKeepoutZ = Math.min(boardPlaneZ, from[2], to[2], ...keepouts.map((entry) => entry.bounds.min[2] - entry.paddingM));
  const requestedBowM = Math.max(0.004, Math.min(0.007, Number(route?.bowHeightMm || 5) / 1_000));
  const heightLayer = Math.max(0, Math.min(64, Number(route?.heightLayer || 0)));
  const baseClearanceZ = localUndersideRoute
    ? lowestKeepoutZ - Math.max(0.003, requestedBowM * 0.7) - heightLayer * 0.003
    : tallestKeepoutZ + Math.max(0.003, requestedBowM * 0.7) + heightLayer * 0.003;
  if (localUndersideRoute) {
    const localRoute = createLocalUndersideArch({
      wire,
      from,
      to,
      sourceExit,
      targetExit,
      keepouts,
      existingRoutes,
      wireRadiusM,
      lane,
      direction,
      baseClearanceZ
    });
    if (localRoute) return localRoute;
  }
  // Dense independent harnesses can need a wider but still compact lateral
  // corridor than a single jumper. Search symmetrically out to 30 mm before
  // declaring the route impossible; this remains far below the forbidden
  // perimeter/loop behavior and is still cable-length gated below.
  const candidateOffsets = [0, ...Array.from({ length: 20 }, (_, index) => [direction * (index + 1), -direction * (index + 1)]).flat()];
  const rejectionCounts = { keepout: 0, sourceEngagement: 0, targetEngagement: 0, wireClearance: 0, cableLength: 0, bendRadius: 0 };
  const rejectedKeepoutIds = new Map();
  const rejectedBendReasons = new Map();
  const rejectedWireIds = new Map();

  for (let lift = 0; lift < 12; lift += 1) {
    for (const offsetMultiplier of candidateOffsets) {
      const laneOffset = (direction * lane * 0.0012) + offsetMultiplier * 0.0015;
      const verticalDirection = localUndersideRoute ? -1 : 1;
      const peakZ = baseClearanceZ + verticalDirection * (lift * 0.002 + Math.abs(lane) * 0.0009);
      const exitDx = targetExit[0] - sourceExit[0];
      const exitDy = targetExit[1] - sourceExit[1];
      const sourceNormal = unitVector(wire?.from?.normal, sourceExit.map((value, axis) => value - from[axis]));
      const targetNormal = unitVector(wire?.to?.normal, targetExit.map((value, axis) => value - to[axis]));
      const minimumBendRadiusM = Math.max(wireRadiusM * 2, Number(wire?.minimumBendRadiusM || 0.003));
      const leadLength = Math.max(0.0035, wireRadiusM * 4, minimumBendRadiusM * 2.5);
      const bendClearanceM = Math.max(0.0018 + wireRadiusM, minimumBendRadiusM * 2.25);
      const bendSafePeakZ = localUndersideRoute
        ? Math.min(peakZ, sourceExit[2] - minimumBendRadiusM * 5, targetExit[2] - minimumBendRadiusM * 5)
        : Math.max(peakZ, sourceExit[2] + minimumBendRadiusM * 5, targetExit[2] + minimumBendRadiusM * 5);
      const sourceApproachGeometry = connectorApproachGeometry({
        exit: sourceExit,
        normal: sourceNormal,
        keepout: sourceEscapeKeepout,
        peakZ: bendSafePeakZ,
        leadLength,
        clearanceM: bendClearanceM,
        traversalFallback: [exitDx, exitDy, 0],
        reverse: false
      });
      const targetApproachGeometry = connectorApproachGeometry({
        exit: targetExit,
        normal: targetNormal,
        keepout: targetEscapeKeepout,
        peakZ: bendSafePeakZ,
        leadLength,
        clearanceM: bendClearanceM,
        traversalFallback: [-exitDx, -exitDy, 0],
        reverse: true
      });
      const apex = [
        (sourceExit[0] + targetExit[0]) / 2 + planarNormal[0] * laneOffset,
        (sourceExit[1] + targetExit[1]) / 2 + planarNormal[1] * laneOffset,
        bendSafePeakZ
      ];
      const corridorShoulders = planarLength >= minimumBendRadiusM * 8 ? [
        [
          sourceExit[0] + exitDx * 0.3 + planarNormal[0] * laneOffset,
          sourceExit[1] + exitDy * 0.3 + planarNormal[1] * laneOffset,
          bendSafePeakZ
        ],
        [
          sourceExit[0] + exitDx * 0.7 + planarNormal[0] * laneOffset,
          sourceExit[1] + exitDy * 0.7 + planarNormal[1] * laneOffset,
          bendSafePeakZ
        ]
      ] : [];
      let freeSpan;
      try {
        freeSpan = route?.curveStyle === "smooth-cubic-arch"
          ? smoothCubicArch({
            sourceExit,
            targetExit,
            sourceNormal,
            targetNormal,
            sourceKeepout: sourceEscapeKeepout,
            targetKeepout: targetEscapeKeepout,
            apex,
            minimumBendRadiusM,
            planarLength,
            wireRadiusM,
            keepouts,
            transitionLayerM: heightLayer * 0.0008,
            sourcePlanarDepartureOverride: route?.sourcePlanarDeparture,
            targetPlanarDepartureOverride: route?.targetPlanarDeparture,
          })
          : filletPolyline(compactPoints([
            ...sourceApproachGeometry.waypoints,
            ...(corridorShoulders.length ? [corridorShoulders[0]] : []),
            apex,
            ...(corridorShoulders.length ? [corridorShoulders[1]] : []),
            ...targetApproachGeometry.waypoints
          ]), minimumBendRadiusM, 16);
      } catch (error) {
        rejectionCounts.bendRadius += 1;
        const reason = error instanceof Error ? error.message : "unknown_bend_failure";
        rejectedBendReasons.set(reason, (rejectedBendReasons.get(reason) || 0) + 1);
        continue;
      }
      const intersectedKeepouts = polylineIntersectedKeepoutIds(freeSpan, keepouts, wireRadiusM);
      if (intersectedKeepouts.length) {
        rejectionCounts.keepout += 1;
        for (const id of intersectedKeepouts) rejectedKeepoutIds.set(id, (rejectedKeepoutIds.get(id) || 0) + 1);
        continue;
      }
      if (!engagementClearsOtherParts(from, sourceExit, keepouts, sourceEngagementPartIds, wireRadiusM)) {
        rejectionCounts.sourceEngagement += 1;
        continue;
      }
      if (!engagementClearsOtherParts(targetExit, to, keepouts, targetEngagementPartIds, wireRadiusM)) {
        rejectionCounts.targetEngagement += 1;
        continue;
      }
      const candidate = compactPoints([from, sourceExit, ...freeSpan.slice(1, -1), targetExit, to]);
      const maximumCableLengthM = Number(wire?.maximumCableLengthM || 0);
      const cableReserveM = Math.max(0, Number(wire?.cableReserveM || 0));
      if (maximumCableLengthM > 0 && polylineLength(candidate) > maximumCableLengthM - cableReserveM) {
        rejectionCounts.cableLength += 1;
        continue;
      }
      if (polylineMinimumBendRadius(candidate) + 1e-7 < minimumBendRadiusM) {
        rejectionCounts.bendRadius += 1;
        rejectedBendReasons.set("measured_radius_below_minimum", (rejectedBendReasons.get("measured_radius_below_minimum") || 0) + 1);
        continue;
      }
      const blockingWire = firstBlockingWireRoute(
        candidate,
        wireRadiusM,
        existingRoutes,
        wire?.bundleId,
        wire?.planarCrossingForbidden === true
      );
      if (blockingWire) {
        rejectionCounts.wireClearance += 1;
        const blockingWireId = blockingWire.wireId;
        const previous = rejectedWireIds.get(blockingWireId) || { count: 0, firstConflict: blockingWire };
        rejectedWireIds.set(blockingWireId, { ...previous, count: previous.count + 1 });
        continue;
      }
      return candidate;
    }
  }
  const blockingKeepouts = [...rejectedKeepoutIds.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([id, count]) => ({ id, count }));
  const endpointGeometry = {
    from,
    to,
    sourceExit,
    targetExit,
    sourceNormal: wire?.from?.normal,
    targetNormal: wire?.to?.normal,
    sourceBounds: sourceEscapeKeepout?.bounds,
    targetBounds: targetEscapeKeepout?.bounds
  };
  const bendFailures = [...rejectedBendReasons.entries()].map(([reason, count]) => ({ reason, count }));
  const blockingWires = [...rejectedWireIds.entries()].map(([id, entry]) => ({ id, ...entry }));
  throw new Error(`Wire ${wire?.id || "unknown"} has no collision-free route through the locked GLB keepouts (${JSON.stringify({ ...rejectionCounts, blockingKeepouts, blockingWires, bendFailures, endpointGeometry })}).`);
}

function createLocalUndersideArch({
  wire,
  from,
  to,
  sourceExit,
  targetExit,
  keepouts,
  existingRoutes,
  wireRadiusM,
  lane,
  direction,
  baseClearanceZ
}) {
  const minimumBendRadiusM = Math.max(wireRadiusM * 2, Number(wire?.minimumBendRadiusM || 0.0005));
  const traversal = unitVector([
    targetExit[0] - sourceExit[0],
    targetExit[1] - sourceExit[1],
    0
  ], [0, 1, 0]);
  const planarNormal = [-traversal[1], traversal[0], 0];
  const endpointLeadM = Math.max(0.0015, minimumBendRadiusM * 3);
  const span = Math.hypot(targetExit[0] - sourceExit[0], targetExit[1] - sourceExit[1]);
  const apexTangentM = Math.max(0.0015, Math.min(0.008, span * 0.3));

  for (let depthLayer = 0; depthLayer < 12; depthLayer += 1) {
    for (let sideAttempt = 0; sideAttempt < 2; sideAttempt += 1) {
      const side = sideAttempt ? -direction : direction;
      for (let lateralLayer = 0; lateralLayer < 16; lateralLayer += 1) {
        const lateralM = 0.003 + Math.abs(lane) * 0.0012 + lateralLayer * 0.0015;
        const apex = [
          (sourceExit[0] + targetExit[0]) / 2 + planarNormal[0] * lateralM * side,
          (sourceExit[1] + targetExit[1]) / 2 + planarNormal[1] * lateralM * side,
          baseClearanceZ - depthLayer * 0.0015
        ];
        const first = sampleCubicBezier(
          sourceExit,
          [sourceExit[0], sourceExit[1], sourceExit[2] - endpointLeadM],
          apex.map((value, axis) => value - traversal[axis] * apexTangentM),
          apex,
          28
        );
        const second = sampleCubicBezier(
          apex,
          apex.map((value, axis) => value + traversal[axis] * apexTangentM),
          [targetExit[0], targetExit[1], targetExit[2] - endpointLeadM],
          targetExit,
          28
        );
        const freeSpan = compactPoints([...first, ...second.slice(1)]);
        if (polylineIntersectedKeepoutIds(freeSpan, keepouts, wireRadiusM).length) continue;
        const candidate = compactPoints([from, sourceExit, ...freeSpan.slice(1, -1), targetExit, to]);
        if (polylineMinimumBendRadius(candidate) + 1e-7 < minimumBendRadiusM) continue;
        if (firstBlockingWireRoute(
          candidate,
          wireRadiusM,
          existingRoutes,
          wire?.bundleId,
          wire?.planarCrossingForbidden === true
        )) continue;
        return candidate;
      }
    }
  }
  return null;
}

function smoothCubicArch({
  sourceExit,
  targetExit,
  sourceNormal,
  targetNormal,
  sourceKeepout,
  targetKeepout,
  apex,
  minimumBendRadiusM,
  planarLength,
  wireRadiusM,
  keepouts,
  transitionLayerM = 0,
  sourcePlanarDepartureOverride = null,
  targetPlanarDepartureOverride = null,
}) {
  const traversal = unitVector([
    targetExit[0] - sourceExit[0],
    targetExit[1] - sourceExit[1],
    0
  ], [1, 0, 0]);
  // A sampled quarter-turn needs margin above the nominal minimum radius,
  // especially when one endpoint exits upward and the other exits from an
  // underside header. The former 1.15x transition left almost no numerical
  // or join-curvature margin and rejected otherwise roomy long-span arches.
  // Adjacent underside pins in a header row can otherwise sweep through the
  // same planar quarter-turn when their nearest body face lies along the row.
  // Give every logical bundle lane a small, deterministic depth offset so the
  // fan-out remains a set of separated arches instead of overlapping at the
  // connector edge.
  const bendTransitionRadius = Math.max(minimumBendRadiusM * 2.5, wireRadiusM * 6);
  const sourcePlanarDeparture = validPlanarDirection(sourcePlanarDepartureOverride)
    ? unitVector(sourcePlanarDepartureOverride, [1, 0, 0])
    : sourceKeepout?.bounds
    ? nearestPlanarFaceDirection(sourceExit, sourceKeepout.bounds)
    : traversal;
  const targetPlanarOutward = validPlanarDirection(targetPlanarDepartureOverride)
    ? unitVector(targetPlanarDepartureOverride, [-1, 0, 0])
    : targetKeepout?.bounds
    ? nearestPlanarFaceDirection(targetExit, targetKeepout.bounds)
    : traversal.map((value) => -value);
  const sourceTransition = sourceNormal[2] < -0.7
    ? downwardSourceTransition(sourceExit, sourcePlanarDeparture, bendTransitionRadius, sourceKeepout, wireRadiusM, 16, transitionLayerM)
    : { points: [sourceExit], endpoint: sourceExit, departure: sourceNormal };
  const targetTransition = targetNormal[2] < -0.7
    ? downwardTargetTransition(targetExit, targetPlanarOutward.map((value) => -value), bendTransitionRadius, targetKeepout, wireRadiusM, 16, transitionLayerM)
    : { points: [targetExit], endpoint: targetExit, arrival: targetNormal.map((value) => -value) };
  const mainSource = sourceTransition.endpoint;
  const mainTarget = targetTransition.endpoint;
  const mainPlanarLength = Math.hypot(mainTarget[0] - mainSource[0], mainTarget[1] - mainSource[1]);
  const endpointLeadBase = Math.max(0.008, minimumBendRadiusM * 5);
  const apexTangentBase = Math.max(0.008, Math.min(0.03, Math.max(planarLength, mainPlanarLength) * 0.28));
  let bestMeasuredRadiusM = 0;
  // Long spans with opposed connector normals need different control-handle
  // proportions from short top-facing jumpers. Search a small deterministic
  // family of smooth cubic handles; every candidate is still subjected to the
  // same measured bend-radius and collision gates by the caller.
  for (const endpointScale of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 0.75]) {
    for (const apexScale of [1, 0.75, 0.5, 1.25, 1.5]) {
      const endpointLead = endpointLeadBase * endpointScale;
      const apexTangent = apexTangentBase * apexScale;
      const sourceControl = mainSource.map((value, axis) => value + sourceTransition.departure[axis] * endpointLead);
      const targetControl = mainTarget.map((value, axis) => value - targetTransition.arrival[axis] * endpointLead);
      const apexIncoming = apex.map((value, axis) => value - traversal[axis] * apexTangent);
      const apexOutgoing = apex.map((value, axis) => value + traversal[axis] * apexTangent);
      const first = sampleCubicBezier(mainSource, sourceControl, apexIncoming, apex, 28);
      const second = sampleCubicBezier(apex, apexOutgoing, targetControl, mainTarget, 28);
      const points = compactPoints([
        ...sourceTransition.points,
        ...first.slice(1),
        ...second.slice(1),
        ...targetTransition.points.slice(1)
      ]);
      const measuredRadiusM = polylineMinimumBendRadius(points);
      bestMeasuredRadiusM = Math.max(bestMeasuredRadiusM, measuredRadiusM);
      if (measuredRadiusM + 1e-7 < minimumBendRadiusM) continue;
      // An underside contact can be close to the far board edge. A curve may
      // satisfy bend radius yet descend through that board before reaching the
      // connector-normal transition. Keep searching handle proportions until
      // the whole smooth span clears every locked GLB keepout.
      if (polylineIntersectedKeepoutIds(points, keepouts, wireRadiusM).length) continue;
      return points;
    }
  }
  throw new Error(`smooth_arch_radius_below_minimum:${bestMeasuredRadiusM.toFixed(9)}`);
}

function validPlanarDirection(value) {
  return Array.isArray(value)
    && value.length === 3
    && value.every(Number.isFinite)
    && Math.hypot(value[0], value[1]) > 0.000001
    && Math.abs(value[2]) < 0.000001;
}

function downwardSourceTransition(endpoint, traversal, radius, keepout, wireRadiusM, samples = 16, verticalLeadM = 0) {
  const bendStart = [endpoint[0], endpoint[1], endpoint[2] - Math.max(0, Number(verticalLeadM || 0))];
  const center = bendStart.map((value, axis) => value + traversal[axis] * radius);
  const arc = Array.from({ length: samples + 1 }, (_, index) => {
    const theta = Math.PI + (Math.PI / 2) * (index / samples);
    return [
      center[0] + radius * traversal[0] * Math.cos(theta),
      center[1] + radius * traversal[1] * Math.cos(theta),
      center[2] + radius * Math.sin(theta)
    ];
  });
  const outer = connectorEscapePoint(
    arc.at(-1),
    keepout,
    radius + Math.max(0, Number(wireRadiusM || 0)),
    null,
    traversal
  );
  const points = compactPoints([endpoint, bendStart, ...arc.slice(1), outer]);
  return { points, endpoint: points.at(-1), departure: traversal };
}

function downwardTargetTransition(endpoint, traversal, radius, keepout, wireRadiusM, samples = 16, verticalLeadM = 0) {
  const bendEnd = [endpoint[0], endpoint[1], endpoint[2] - Math.max(0, Number(verticalLeadM || 0))];
  const center = bendEnd.map((value, axis) => value - traversal[axis] * radius);
  const arc = Array.from({ length: samples + 1 }, (_, index) => {
    const theta = -Math.PI / 2 + (Math.PI / 2) * (index / samples);
    return [
      center[0] + radius * traversal[0] * Math.cos(theta),
      center[1] + radius * traversal[1] * Math.cos(theta),
      center[2] + radius * Math.sin(theta)
    ];
  });
  const outer = connectorEscapePoint(
    arc[0],
    keepout,
    radius + Math.max(0, Number(wireRadiusM || 0)),
    null,
    traversal.map((value) => -value)
  );
  const points = compactPoints([outer, arc[0], ...arc.slice(1), endpoint]);
  return { points, endpoint: points[0], arrival: traversal };
}

function sampleCubicBezier(p0, p1, p2, p3, samples) {
  return Array.from({ length: samples + 1 }, (_, index) => {
    const t = index / samples;
    const u = 1 - t;
    return [0, 1, 2].map((axis) => (
      u ** 3 * p0[axis]
      + 3 * u ** 2 * t * p1[axis]
      + 3 * u * t ** 2 * p2[axis]
      + t ** 3 * p3[axis]
    ));
  });
}

function connectorApproachGeometry({ exit, normal, keepout, peakZ, leadLength, clearanceM, traversalFallback, reverse }) {
  const normalLead = exit.map((value, axis) => value + normal[axis] * leadLength);
  let lead = normalLead;
  let control = lead;
  let waypoints;
  if (Math.abs(normal[2]) > 0.7) {
    if (normal[2] < 0 && keepout?.bounds) {
      const center = keepout.bounds.min.map((value, axis) => (value + keepout.bounds.max[axis]) / 2);
      const horizontal = unitVector([exit[0] - center[0], exit[1] - center[1], 0], traversalFallback);
      lead = connectorEscapePoint(lead, keepout, clearanceM, null, horizontal);
    }
    control = [lead[0], lead[1], Math.max(lead[2], peakZ)];
    const outward = compactPoints([exit, normalLead, lead, control]);
    waypoints = reverse ? [...outward].reverse() : outward;
  } else {
    // A side-facing connector may point away from its body while the ultimate
    // destination lies back across that same body. Rise only after a short
    // normal lead-out, then traverse above the keepout; never make a flat
    // U-turn through the source or target GLB.
    control = [lead[0], lead[1], Math.max(lead[2], peakZ)];
    const outward = compactPoints([exit, lead, control]);
    waypoints = reverse ? [...outward].reverse() : outward;
  }
  return { control, waypoints };
}

function combinedKeepout(keepouts, ids) {
  const included = (keepouts || []).filter((keepout) => ids.includes(keepout.id));
  if (!included.length) return null;
  return {
    id: ids.join("+"),
    paddingM: Math.max(...included.map((keepout) => Number(keepout.paddingM || 0))),
    bounds: {
      min: [0, 1, 2].map((axis) => Math.min(...included.map((keepout) => keepout.bounds.min[axis]))),
      max: [0, 1, 2].map((axis) => Math.max(...included.map((keepout) => keepout.bounds.max[axis])))
    }
  };
}

export function polylineClearsKeepouts(points, keepouts, radiusM = 0) {
  return polylineIntersectedKeepoutIds(points, keepouts, radiusM).length === 0;
}

// The radius of the circumcircle through three adjacent samples is the local
// polyline bend-radius estimate. Collinear samples have infinite radius and do
// not constrain the result. This is deterministic, scale-aware, and shared by
// loose jumpers, Qwiic adapters, and included factory harnesses.
export function polylineMinimumBendRadius(points) {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < (points || []).length - 1; index += 1) {
    const first = subtract(points[index], points[index - 1]);
    const second = subtract(points[index + 1], points[index]);
    const chord = subtract(points[index + 1], points[index - 1]);
    const firstLength = Math.hypot(...first);
    const secondLength = Math.hypot(...second);
    const chordLength = Math.hypot(...chord);
    if (firstLength < 1e-9 || secondLength < 1e-9 || chordLength < 1e-9) continue;
    const twiceArea = Math.hypot(...cross(first, chord));
    if (twiceArea < 1e-12) continue;
    minimum = Math.min(minimum, (firstLength * secondLength * chordLength) / (2 * twiceArea));
  }
  return minimum;
}

function filletPolyline(points, radiusM, arcSegments) {
  if (!Array.isArray(points) || points.length < 2) throw new Error("fillet_polyline_invalid");
  if (!(radiusM > 0)) return points.map((point) => point.map(Number));
  const corners = Array(points.length).fill(null);
  for (let index = 1; index < points.length - 1; index += 1) {
    const incomingVector = subtract(points[index], points[index - 1]);
    const outgoingVector = subtract(points[index + 1], points[index]);
    const incomingLength = Math.hypot(...incomingVector);
    const outgoingLength = Math.hypot(...outgoingVector);
    if (incomingLength < 1e-8 || outgoingLength < 1e-8) throw new Error("fillet_zero_segment");
    const incoming = incomingVector.map((value) => value / incomingLength);
    const outgoing = outgoingVector.map((value) => value / outgoingLength);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(incoming, outgoing))));
    if (angle < 0.1) continue;
    if (Math.PI - angle < 1e-4) throw new Error("fillet_uturn");
    const tangentDistance = radiusM * Math.tan(angle / 2);
    const normal = cross(incoming, outgoing);
    const normalMagnitude = Math.hypot(...normal);
    if (normalMagnitude < 1e-8) continue;
    corners[index] = {
      angle,
      tangentDistance,
      axis: normal.map((value) => value / normalMagnitude),
      incoming,
      outgoing
    };
  }
  for (let segment = 0; segment < points.length - 1; segment += 1) {
    const length = Math.hypot(...subtract(points[segment + 1], points[segment]));
    const usedAtStart = corners[segment]?.tangentDistance || 0;
    const usedAtEnd = corners[segment + 1]?.tangentDistance || 0;
    if (usedAtStart + usedAtEnd > length - 1e-7) {
      throw new Error(`fillet_radius_does_not_fit:${segment}:${length.toFixed(6)}:${usedAtStart.toFixed(6)}:${usedAtEnd.toFixed(6)}`);
    }
  }
  const output = [points[0].map(Number)];
  for (let index = 1; index < points.length - 1; index += 1) {
    const corner = corners[index];
    if (!corner) {
      appendDistinct(output, points[index]);
      continue;
    }
    const start = points[index].map((value, axis) => value - corner.incoming[axis] * corner.tangentDistance);
    const end = points[index].map((value, axis) => value + corner.outgoing[axis] * corner.tangentDistance);
    const inward = cross(corner.axis, corner.incoming);
    const center = start.map((value, axis) => value + inward[axis] * radiusM);
    const startRadius = subtract(start, center);
    appendDistinct(output, start);
    for (let step = 1; step <= arcSegments; step += 1) {
      const rotated = rotateAroundAxis(startRadius, corner.axis, corner.angle * step / arcSegments);
      appendDistinct(output, center.map((value, axis) => value + rotated[axis]));
    }
    if (Math.hypot(...subtract(output.at(-1), end)) > 1e-6) throw new Error("fillet_arc_endpoint_mismatch");
  }
  appendDistinct(output, points.at(-1));
  return output;
}

function rotateAroundAxis(vector, axis, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const axisCross = cross(axis, vector);
  const axisProjection = dot(axis, vector) * (1 - cosine);
  return vector.map((value, index) => value * cosine + axisCross[index] * sine + axis[index] * axisProjection);
}

function appendDistinct(points, point) {
  const safe = point.map(Number);
  if (!points.length || Math.hypot(...subtract(safe, points.at(-1))) > 1e-7) points.push(safe);
}

function polylineIntersectedKeepoutIds(points, keepouts, radiusM = 0) {
  const ids = [];
  for (const keepout of keepouts || []) {
    const expanded = expandedBounds(keepout, radiusM);
    let intersects = points.some((point) => pointInsideBounds(point, expanded));
    for (let index = 1; index < points.length; index += 1) {
      if (segmentIntersectsBounds(points[index - 1], points[index], expanded)) {
        intersects = true;
        break;
      }
    }
    if (intersects) ids.push(keepout.id || "unnamed-keepout");
  }
  return ids;
}

function expandedBounds(keepout, radiusM) {
  const padding = Number(keepout?.paddingM || 0) + radiusM;
  return {
    min: keepout.bounds.min.map((value) => value - padding),
    max: keepout.bounds.max.map((value) => value + padding)
  };
}

function pointInsideBounds(point, bounds) {
  return point.every((value, axis) => value >= bounds.min[axis] && value <= bounds.max[axis]);
}

// Slab intersection tests the complete conductor segment, not merely sampled
// points. This prevents a long segment from tunneling through a thin GLB.
function segmentIntersectsBounds(start, end, bounds) {
  let near = 0;
  let far = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-12) {
      if (start[axis] < bounds.min[axis] || start[axis] > bounds.max[axis]) return false;
      continue;
    }
    const first = (bounds.min[axis] - start[axis]) / delta;
    const second = (bounds.max[axis] - start[axis]) / delta;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return false;
  }
  return far >= 0 && near <= 1;
}

function connectorEscapePoint(endpoint, keepout, clearanceM, bundleCenter = null, outwardNormal = null) {
  if (!keepout?.bounds) {
    const unit = unitVector(outwardNormal, [0, 0, 1]);
    return endpoint.map((value, axis) => value + unit[axis] * clearanceM);
  }
  const expanded = expandedBounds(keepout, 0);
  const center = expanded.min.map((value, axis) => (value + expanded.max[axis]) / 2);
  const directionPoint = Array.isArray(bundleCenter) && bundleCenter.length === 3 ? bundleCenter : endpoint;
  let direction = Array.isArray(outwardNormal) && outwardNormal.length === 3 && outwardNormal.every(Number.isFinite)
    ? outwardNormal.map(Number)
    : [directionPoint[0] - center[0], directionPoint[1] - center[1], 0];
  if (Math.hypot(...direction) < 0.000001) direction = nearestFaceDirection(endpoint, expanded);
  const unit = unitVector(direction, [0, 0, 1]);
  if (pointBeyondForwardFace(endpoint, expanded, unit)) {
    return endpoint.map((value, axis) => value + unit[axis] * clearanceM);
  }
  const intersections = [];
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(unit[axis]) < 0.000001) continue;
    const boundary = unit[axis] > 0 ? expanded.max[axis] : expanded.min[axis];
    const distance = (boundary - endpoint[axis]) / unit[axis];
    if (distance >= 0) intersections.push(distance);
  }
  const travel = (intersections.length ? Math.min(...intersections) : 0) + clearanceM;
  return endpoint.map((value, axis) => value + unit[axis] * travel);
}

function pointBeyondForwardFace(point, bounds, direction) {
  return direction.some((value, axis) => (value > 0.000001 && point[axis] >= bounds.max[axis])
    || (value < -0.000001 && point[axis] <= bounds.min[axis]));
}

function nearestFaceDirection(point, bounds) {
  return [
    { direction: [-1, 0, 0], distance: Math.abs(point[0] - bounds.min[0]) },
    { direction: [1, 0, 0], distance: Math.abs(bounds.max[0] - point[0]) },
    { direction: [0, -1, 0], distance: Math.abs(point[1] - bounds.min[1]) },
    { direction: [0, 1, 0], distance: Math.abs(bounds.max[1] - point[1]) },
    { direction: [0, 0, -1], distance: Math.abs(point[2] - bounds.min[2]) },
    { direction: [0, 0, 1], distance: Math.abs(bounds.max[2] - point[2]) }
  ].sort((left, right) => left.distance - right.distance)[0].direction;
}

function nearestPlanarFaceDirection(point, bounds) {
  return [
    { direction: [-1, 0, 0], distance: Math.abs(point[0] - bounds.min[0]) },
    { direction: [1, 0, 0], distance: Math.abs(bounds.max[0] - point[0]) },
    { direction: [0, -1, 0], distance: Math.abs(point[1] - bounds.min[1]) },
    { direction: [0, 1, 0], distance: Math.abs(bounds.max[1] - point[1]) }
  ].sort((left, right) => left.distance - right.distance)[0].direction;
}

function engagementClearsOtherParts(start, end, keepouts, permittedPartIds, radiusM) {
  const permitted = new Set(permittedPartIds.filter(Boolean));
  return polylineClearsKeepouts([start, end], keepouts.filter((keepout) => !permitted.has(keepout.id)), radiusM);
}

function firstBlockingWireRoute(points, radiusM, existingRoutes, bundleId, planarCrossingForbidden = false) {
  const candidateSegments = interiorRouteSegments(points);
  for (const route of existingRoutes || []) {
    // Connector fan-out zones may contain touching insulation from adjacent
    // physical contacts, but conductor centre lines may never cross anywhere.
    for (const left of allRouteSegments(points)) {
      for (const right of allRouteSegments(route.points)) {
        // A branched electrical net may legitimately fan out from one exact
        // contact. Ignore only the two segments incident to that shared
        // endpoint; every downstream segment remains subject to the strict
        // centre-line crossing gate.
        if (segmentsMeetAtSharedRouteEndpoint(left, right, points, route.points)) continue;
        // Simple beginner-facing logical guides can require a clean planar
        // presentation. Fitted keyed/factory harnesses remain valid when two
        // conductors pass at different heights: their immutable contact order
        // can make a planar embedding impossible, but they must still pass the
        // universal 3D centre-line and insulation-clearance checks below.
        // If either route opts into the stricter presentation contract, no
        // top-view X is allowed against any neighbouring conductor.
        if ((planarCrossingForbidden || route.planarCrossingForbidden === true)
          && segmentsCrossInPlanView(left, right)) return {
          wireId: route.wireId || "unknown-route",
          reason: "projected_centerline_crossing",
          candidateSegment: left,
          existingSegment: right,
        };
        if (segmentDistance(left.start, left.end, right.start, right.end) < 1e-7) return {
          wireId: route.wireId || "unknown-route",
          reason: "centerline_crossing",
          candidateSegment: left,
          existingSegment: right,
        };
      }
    }
    // Conductors in one factory-style bundle may run closely in parallel. A
    // true 3D centre-line intersection is always rejected above; the stricter
    // projected-X rule applies only to explicitly planar-clean guide modes.
    // Independent bundles additionally require insulation clearance.
    if (route.bundleId === bundleId) continue;
    const minimum = radiusM + Number(route.radiusM || 0.0006) + 0.0003;
    const existingSegments = interiorRouteSegments(route.points);
    for (const left of candidateSegments) {
      for (const right of existingSegments) {
        if (segmentDistance(left.start, left.end, right.start, right.end) < minimum) return {
          wireId: route.wireId || "unknown-route",
          reason: "insulation_clearance",
          candidateSegment: left,
          existingSegment: right,
        };
      }
    }
  }
  return null;
}

function segmentsCrossInPlanView(left, right, tolerance = 1e-9) {
  const a = left.start, b = left.end, c = right.start, d = right.end;
  const leftLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const rightLength = Math.hypot(d[0] - c[0], d[1] - c[1]);
  if (leftLength <= tolerance || rightLength <= tolerance) return false;
  const cross2 = (ux, uy, vx, vy) => ux * vy - uy * vx;
  const rx = b[0] - a[0], ry = b[1] - a[1];
  const sx = d[0] - c[0], sy = d[1] - c[1];
  const denominator = cross2(rx, ry, sx, sy);
  const qpx = c[0] - a[0], qpy = c[1] - a[1];
  if (Math.abs(denominator) <= tolerance) {
    if (Math.abs(cross2(qpx, qpy, rx, ry)) > tolerance) return false;
    const axis = Math.abs(rx) >= Math.abs(ry) ? 0 : 1;
    const leftMin = Math.min(a[axis], b[axis]);
    const leftMax = Math.max(a[axis], b[axis]);
    const rightMin = Math.min(c[axis], d[axis]);
    const rightMax = Math.max(c[axis], d[axis]);
    return Math.min(leftMax, rightMax) - Math.max(leftMin, rightMin) > tolerance;
  }
  const t = cross2(qpx, qpy, sx, sy) / denominator;
  const u = cross2(qpx, qpy, rx, ry) / denominator;
  // Endpoint contact is handled by the explicit shared-endpoint rule above;
  // only a true interior X is a top-view crossing.
  return t > tolerance && t < 1 - tolerance && u > tolerance && u < 1 - tolerance;
}

function segmentsMeetAtSharedRouteEndpoint(left, right, leftPoints, rightPoints, toleranceM = 1e-9, fanOutLeadM = 0.015) {
  const sharedEndpoints = [leftPoints[0], leftPoints.at(-1)].filter((endpoint) => (
    [rightPoints[0], rightPoints.at(-1)].some((candidate) => Math.hypot(...subtract(endpoint, candidate)) <= toleranceM)
  ));
  // An explicitly shared endpoint may have one short common engagement
  // lead before the logical guides fan out. Permit overlap only inside that
  // 15 mm connector fan-out zone. Every downstream segment still passes the
  // strict centre-line crossing and insulation-clearance gates, so this does
  // not legalize arbitrary wire crossings elsewhere in the circuit.
  return sharedEndpoints.some((endpoint) => (
    [left.start, left.end, right.start, right.end]
      .every((candidate) => Math.hypot(...subtract(endpoint, candidate)) <= fanOutLeadM)
  ));
}

function allRouteSegments(points) {
  return points.slice(1).map((end, index) => ({ start: points[index], end }));
}

function interiorRouteSegments(points, endpointAllowanceM = 0.015) {
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative.at(-1) + Math.hypot(...subtract(points[index], points[index - 1])));
  }
  const total = cumulative.at(-1) || 0;
  const output = [];
  for (let index = 1; index < points.length; index += 1) {
    const midpointDistance = (cumulative[index - 1] + cumulative[index]) / 2;
    if (midpointDistance < endpointAllowanceM || total - midpointDistance < endpointAllowanceM) continue;
    output.push({ start: points[index - 1], end: points[index] });
  }
  return output;
}

function segmentDistance(a0, a1, b0, b1) {
  const u = subtract(a1, a0);
  const v = subtract(b1, b0);
  const w = subtract(a0, b0);
  const aa = dot(u, u);
  const bb = dot(u, v);
  const cc = dot(v, v);
  const dd = dot(u, w);
  const ee = dot(v, w);
  const denominator = aa * cc - bb * bb;
  let s = denominator < 1e-15 ? 0 : clamp((bb * ee - cc * dd) / denominator);
  let t = cc < 1e-15 ? 0 : clamp((bb * s + ee) / cc);
  if (t === 0 || t === 1) s = aa < 1e-15 ? 0 : clamp((bb * t - dd) / aa);
  const left = a0.map((value, axis) => value + u[axis] * s);
  const right = b0.map((value, axis) => value + v[axis] * t);
  return Math.hypot(...subtract(left, right));
}

function subtract(left, right) { return left.map((value, axis) => value - right[axis]); }
function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0]
  ];
}
function dot(left, right) { return left.reduce((sum, value, axis) => sum + value * right[axis], 0); }
function clamp(value) { return Math.max(0, Math.min(1, value)); }
function polylineLength(points) { return points.slice(1).reduce((sum, point, index) => sum + Math.hypot(...subtract(point, points[index])), 0); }

function unitVector(value, fallback) {
  const source = Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? value.map(Number) : fallback;
  const magnitude = Math.hypot(...source);
  return magnitude > 0.000001 ? source.map((entry) => entry / magnitude) : [0, 0, 1];
}

function compactPoints(points) {
  return points.reduce((output, point) => {
    const safe = point.map(Number);
    const previous = output.at(-1);
    if (!previous || previous.some((value, index) => Math.abs(value - safe[index]) > 0.000001)) output.push(safe);
    return output;
  }, []);
}

function endpointPosition(endpoint, side, wireId) {
  const position = endpoint?.position;
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) {
    throw new Error(`Wire ${wireId || "unknown"} has an invalid ${side} endpoint.`);
  }
  return position.map(Number);
}
