import type { BodyId, OrbitElements } from "../types";

export const J2000_JD = 2451545.0;

type OrbitingBodyId = Exclude<BodyId, "sun">;

export const ORBITAL_ELEMENTS: Record<OrbitingBodyId, OrbitElements> = {
  earth: {
    epochJd: J2000_JD,
    aKm: 149_598_262,
    e: 0.01671123,
    iDeg: 0.00001531,
    raanDeg: -11.26064,
    argPeriapsisDeg: 114.20783,
    meanAnomalyDegAtEpoch: 357.51716,
    periodDays: 365.25636,
    centralBody: "sun",
    orbitGapDegrees: 45,
  },
};
