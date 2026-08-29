const DEFAULT_MIN_EXPOSURE_M = 0.0015;
const DEFAULT_MIN_DIFFERENCE_M = 0.001;
const DEFAULT_MIN_CONFIDENCE = 0.25;

function finiteBounds(bounds, label) {
  if (!bounds || !Array.isArray(bounds.min) || !Array.isArray(bounds.max) || bounds.min.length !== 3 || bounds.max.length !== 3) {
    throw new Error(`${label} must contain three-dimensional min/max arrays.`);
  }
  for (const value of [...bounds.min, ...bounds.max]) {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite coordinate.`);
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if (bounds.min[axis] > bounds.max[axis]) throw new Error(`${label} has inverted bounds on axis ${axis}.`);
  }
  return bounds;
}

export function classifyPinMatingSide({
  pinBounds,
  boardBounds,
  boardNormalAxis = 2,
  minExposureM = DEFAULT_MIN_EXPOSURE_M,
  minDifferenceM = DEFAULT_MIN_DIFFERENCE_M,
  minConfidence = DEFAULT_MIN_CONFIDENCE,
}) {
  finiteBounds(pinBounds, "pinBounds");
  finiteBounds(boardBounds, "boardBounds");
  if (![0, 1, 2].includes(boardNormalAxis)) throw new Error("boardNormalAxis must be 0, 1, or 2.");

  const pinMin = pinBounds.min[boardNormalAxis];
  const pinMax = pinBounds.max[boardNormalAxis];
  const boardMin = boardBounds.min[boardNormalAxis];
  const boardMax = boardBounds.max[boardNormalAxis];
  const topExposureM = Math.max(0, pinMax - boardMax);
  const undersideExposureM = Math.max(0, boardMin - pinMin);
  const dominantExposureM = Math.max(topExposureM, undersideExposureM);
  const differenceM = Math.abs(topExposureM - undersideExposureM);
  const confidence = dominantExposureM === 0 ? 0 : differenceM / dominantExposureM;

  if (dominantExposureM < minExposureM) {
    throw new Error(`No usable exposed male-pin shank: ${(dominantExposureM * 1000).toFixed(2)} mm.`);
  }
  if (differenceM < minDifferenceM || confidence < minConfidence) {
    throw new Error(`Ambiguous male-pin mating side: top ${(topExposureM * 1000).toFixed(2)} mm, underside ${(undersideExposureM * 1000).toFixed(2)} mm.`);
  }

  const matingSide = topExposureM > undersideExposureM ? "top" : "underside";
  const connectorNormal = [0, 0, 0];
  connectorNormal[boardNormalAxis] = matingSide === "top" ? 1 : -1;
  return Object.freeze({
    matingSide,
    connectorNormal: Object.freeze(connectorNormal),
    pinTipCoordinate: matingSide === "top" ? pinMax : pinMin,
    topExposureM,
    undersideExposureM,
    confidence,
    method: "dominant-exposed-shank-v1",
  });
}
