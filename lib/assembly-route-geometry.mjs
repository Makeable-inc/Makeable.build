const EPSILON = 1e-9;

export function buildNormalAlignedHarnessRoute({
  source,
  target,
  lane = 0,
  bowDirection = "right",
  bowHeightMm = 5,
  sourceSleeveLengthMm = 4,
  sourceInsertionMm = 1,
  targetPlugLengthMm = 5.5,
  neckLengthMm = 4,
  cableLengthMm = null,
} = {}) {
  const sourceTip = vector(source?.position, "source.position");
  const targetMouth = vector(target?.position, "target.position");
  const sourceNormal = unit(source?.normal, "source.normal");
  const targetNormal = unit(target?.normal, "target.normal");
  const bowM = boundedMillimetres(bowHeightMm, 4, 7, "bowHeightMm");
  const sleeveM = boundedMillimetres(sourceSleeveLengthMm, 3, 15, "sourceSleeveLengthMm");
  const insertionM = boundedMillimetres(sourceInsertionMm, 0.5, sourceSleeveLengthMm - 0.5, "sourceInsertionMm");
  const plugM = boundedMillimetres(targetPlugLengthMm, 3, 12, "targetPlugLengthMm");
  const neckM = boundedMillimetres(neckLengthMm, 2, 12, "neckLengthMm");
  if (!Number.isInteger(lane) || lane < -4 || lane > 4) throw new Error("lane must be an integer from -4 to 4.");
  if (!['left', 'right'].includes(bowDirection)) throw new Error("bowDirection must be left or right.");

  const sourceSleeveCenter = add(sourceTip, scale(sourceNormal, sleeveM / 2 - insertionM));
  const sourceWireExit = add(sourceTip, scale(sourceNormal, sleeveM - insertionM));
  const targetPlugCenter = add(targetMouth, scale(targetNormal, plugM / 2));
  const targetWireExit = add(targetMouth, scale(targetNormal, plugM));
  const midpoint = scale(add(sourceWireExit, targetWireExit), 0.5);
  const laneSign = bowDirection === "left" ? -1 : 1;
  const laneM = lane * 0.0012 * laneSign;
  const defaultApex = add(midpoint, [laneM, 0, bowM]);
  const makeDirect = (anchor) => ({
    first: {
      p0: sourceWireExit,
      p1: add(sourceWireExit, scale(sourceNormal, neckM)),
      p2: add(anchor, [0, -0.004, 0]),
      p3: anchor,
    },
    second: {
      p0: anchor,
      p1: add(anchor, [0, 0.004, 0]),
      p2: add(targetWireExit, scale(targetNormal, neckM)),
      p3: targetWireExit,
    },
  });

  const { first, second } = makeDirect(defaultApex);
  const sourceTangent = unit(subtract(first.p1, first.p0), "source tangent");
  const targetApproach = unit(subtract(second.p3, second.p2), "target approach");
  if (dot(sourceTangent, sourceNormal) < 0.999) throw new Error("Source route does not leave along the connector normal.");
  if (dot(targetApproach, scale(targetNormal, -1)) < 0.999) throw new Error("Target route does not enter opposite the outward connector normal.");

  const curves = [first, second];
  const routedLengthMm = curves.reduce((sum, curve) => sum + approximateCubicLength(curve) * 1000, 0);
  const unusedSlackMm = cableLengthMm == null ? 0 : Number(cableLengthMm) - routedLengthMm;
  if (cableLengthMm != null && (!Number.isFinite(unusedSlackMm) || unusedSlackMm < -1)) {
    throw new Error(`Cable is too short by ${Math.abs(unusedSlackMm).toFixed(1)} mm.`);
  }

  const route = {
    version: "normal-aligned-no-loop-harness-v2",
    routingStyle: "single-open-bow",
    sourceTip,
    sourceSleeveCenter,
    sourceWireExit,
    targetMouth,
    targetPlugCenter,
    targetWireExit,
    curves,
    routedLengthMm: round(routedLengthMm),
    availableCableLengthMm: cableLengthMm == null ? null : round(Number(cableLengthMm)),
    unusedSlackMm: round(Math.max(0, unusedSlackMm)),
    loopCount: 0,
    selfIntersectionCount: 0,
    sourceTangent,
    targetApproach,
  };
  return assertRouteHasNoLoops(route);
}

export function assertRouteHasNoLoops(route, options = {}) {
  if (route?.loopCount !== 0) throw new Error("Route contains a forbidden cable loop.");
  const sampleCount = Number.isInteger(options.sampleCount) ? options.sampleCount : 48;
  const toleranceM = Number.isFinite(options.toleranceM) ? options.toleranceM : 0.0001;
  const samples = [];
  for (const curve of route?.curves || []) {
    for (let index = samples.length ? 1 : 0; index <= sampleCount; index += 1) {
      samples.push(cubicPoint(curve, index / sampleCount));
    }
  }
  for (let left = 0; left < samples.length; left += 1) {
    for (let right = left + 4; right < samples.length; right += 1) {
      if (Math.hypot(...subtract(samples[left], samples[right])) < toleranceM) {
        throw new Error("Route contains a forbidden self-intersection or closed coil.");
      }
    }
  }
  return route;
}

export function pointInsideAabb(point, bounds, paddingM = 0) {
  const value = vector(point, "point");
  const min = vector(bounds?.min, "bounds.min");
  const max = vector(bounds?.max, "bounds.max");
  return value.every((coordinate, axis) => coordinate >= min[axis] - paddingM && coordinate <= max[axis] + paddingM);
}

export function assertRouteAvoidsKeepouts(route, keepouts = [], options = {}) {
  const sampleCount = Number.isInteger(options.sampleCount) ? options.sampleCount : 48;
  for (const curve of route.curves || []) {
    for (let index = 0; index <= sampleCount; index += 1) {
      const point = cubicPoint(curve, index / sampleCount);
      for (const keepout of keepouts) {
        if (pointInsideAabb(point, keepout.bounds, Number(keepout.paddingM || 0))) {
          throw new Error(`Route enters keepout ${keepout.id || "unknown"}.`);
        }
      }
    }
  }
  return route;
}

export function assertRouteInsideBounds(route, bounds, options = {}) {
  const sampleCount = Number.isInteger(options.sampleCount) ? options.sampleCount : 48;
  const paddingM = Number(options.paddingM || 0);
  const min = vector(bounds?.min, "bounds.min").map((value) => value + paddingM);
  const max = vector(bounds?.max, "bounds.max").map((value) => value - paddingM);
  for (const curve of route.curves || []) {
    for (let index = 0; index <= sampleCount; index += 1) {
      const point = cubicPoint(curve, index / sampleCount);
      if (point.some((value, axis) => value < min[axis] || value > max[axis])) {
        throw new Error("Route leaves the locked enclosure interior bounds.");
      }
    }
  }
  return route;
}

function approximateCubicLength(curve, samples = 64) {
  let length = 0;
  let prior = cubicPoint(curve, 0);
  for (let index = 1; index <= samples; index += 1) {
    const next = cubicPoint(curve, index / samples);
    length += Math.hypot(...subtract(next, prior));
    prior = next;
  }
  return length;
}

function cubicPoint({ p0, p1, p2, p3 }, t) {
  const u = 1 - t;
  return [0, 1, 2].map((axis) => (
    u ** 3 * p0[axis]
    + 3 * u ** 2 * t * p1[axis]
    + 3 * u * t ** 2 * p2[axis]
    + t ** 3 * p3[axis]
  ));
}

function vector(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new Error(`${label} must be a finite 3-vector.`);
  return value.map(Number);
}

function unit(value, label) {
  const raw = vector(value, label);
  const length = Math.hypot(...raw);
  if (length < EPSILON) throw new Error(`${label} cannot be zero.`);
  return raw.map((item) => item / length);
}

function boundedMillimetres(value, minimum, maximum, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < minimum || numeric > maximum) throw new Error(`${label} must be ${minimum}-${maximum} mm.`);
  return numeric / 1000;
}

function add(a, b) { return a.map((value, index) => value + b[index]); }
function subtract(a, b) { return a.map((value, index) => value - b[index]); }
function scale(a, scalar) { return a.map((value) => value * scalar); }
function dot(a, b) { return a.reduce((sum, value, index) => sum + value * b[index], 0); }
function round(value) { return Math.round(value * 10) / 10; }
