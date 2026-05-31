import type { BodyId, OrbitElements } from "../types";

interface SecularDriftRate {
  aKmPerCentury?: number;
  ePerCentury?: number;
  iDegPerCentury?: number;
  raanDegPerCentury?: number;
  argPeriapsisDegPerCentury?: number;
}

// Lightweight secular drift model (J2000 baseline + long-term element drift).
// Values are intentionally conservative to keep visuals stable and performant.
const SECULAR_DRIFT_RATES: Partial<Record<BodyId, SecularDriftRate>> = {
  earth: {
    aKmPerCentury: -3,
    ePerCentury: -0.000044,
    iDegPerCentury: -0.01295,
    raanDegPerCentury: -0.24124,
    argPeriapsisDegPerCentury: 0.32327,
  },
};

function normalizeDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function getSecularAdjustedElements(
  bodyId: BodyId,
  elements: OrbitElements,
  julianDate: number,
): OrbitElements {
  const drift = SECULAR_DRIFT_RATES[bodyId];
  if (!drift) {
    return elements;
  }

  const centuriesSinceEpoch = (julianDate - elements.epochJd) / 36_525;

  const aKm = elements.aKm + (drift.aKmPerCentury ?? 0) * centuriesSinceEpoch;
  const e = Math.min(
    0.99,
    Math.max(0, elements.e + (drift.ePerCentury ?? 0) * centuriesSinceEpoch),
  );
  const iDeg = elements.iDeg + (drift.iDegPerCentury ?? 0) * centuriesSinceEpoch;
  const raanDeg = normalizeDegrees(
    elements.raanDeg + (drift.raanDegPerCentury ?? 0) * centuriesSinceEpoch,
  );
  const argPeriapsisDeg = normalizeDegrees(
    elements.argPeriapsisDeg +
      (drift.argPeriapsisDegPerCentury ?? 0) * centuriesSinceEpoch,
  );

  return {
    ...elements,
    aKm,
    e,
    iDeg,
    raanDeg,
    argPeriapsisDeg,
  };
}
