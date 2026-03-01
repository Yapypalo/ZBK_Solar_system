import * as THREE from "three";
import type { OrbitElements } from "../types";

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function normalizeAngleRadians(angle: number): number {
  const fullTurn = Math.PI * 2;
  const normalized = angle % fullTurn;
  return normalized < 0 ? normalized + fullTurn : normalized;
}

export function julianDateFromDate(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

export function solveEccentricAnomaly(meanAnomaly: number, eccentricity: number): number {
  const normalizedMeanAnomaly = normalizeAngleRadians(meanAnomaly);
  let estimate = eccentricity < 0.8 ? normalizedMeanAnomaly : Math.PI;

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const sine = Math.sin(estimate);
    const cosine = Math.cos(estimate);
    const equation = estimate - eccentricity * sine - normalizedMeanAnomaly;
    const derivative = 1 - eccentricity * cosine;

    estimate -= equation / derivative;
  }

  return estimate;
}

function orbitalPlaneTo3D(
  radiusKm: number,
  trueAnomalyRad: number,
  argPeriapsisRad: number,
  inclinationRad: number,
  raanRad: number,
): THREE.Vector3 {
  const argumentOfLatitude = argPeriapsisRad + trueAnomalyRad;
  const cosArgLat = Math.cos(argumentOfLatitude);
  const sinArgLat = Math.sin(argumentOfLatitude);
  const cosRaan = Math.cos(raanRad);
  const sinRaan = Math.sin(raanRad);
  const cosInc = Math.cos(inclinationRad);
  const sinInc = Math.sin(inclinationRad);

  const x =
    radiusKm * (cosRaan * cosArgLat - sinRaan * sinArgLat * cosInc);
  const y =
    radiusKm * (sinRaan * cosArgLat + cosRaan * sinArgLat * cosInc);
  const z = radiusKm * (sinArgLat * sinInc);

  return new THREE.Vector3(x, z, y);
}

export function getRelativeOrbitalPositionKm(
  elements: OrbitElements,
  julianDate: number,
): THREE.Vector3 {
  const orbitVisualScale = elements.orbitVisualScale ?? 1;
  const elapsedDays = julianDate - elements.epochJd;
  const meanMotion = (Math.PI * 2) / elements.periodDays;
  const meanAnomaly =
    degToRad(elements.meanAnomalyDegAtEpoch) + meanMotion * elapsedDays;
  const eccentricAnomaly = solveEccentricAnomaly(meanAnomaly, elements.e);

  const trueAnomaly =
    2 *
    Math.atan2(
      Math.sqrt(1 + elements.e) * Math.sin(eccentricAnomaly / 2),
      Math.sqrt(1 - elements.e) * Math.cos(eccentricAnomaly / 2),
    );

  const radiusKm =
    elements.aKm * (1 - elements.e * Math.cos(eccentricAnomaly)) * orbitVisualScale;

  return orbitalPlaneTo3D(
    radiusKm,
    trueAnomaly,
    degToRad(elements.argPeriapsisDeg),
    degToRad(elements.iDeg),
    degToRad(elements.raanDeg),
  );
}

export function sampleOrbitPointsKm(
  elements: OrbitElements,
  segments = 512,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const orbitVisualScale = elements.orbitVisualScale ?? 1;
  const argPeriapsisRad = degToRad(elements.argPeriapsisDeg);
  const inclinationRad = degToRad(elements.iDeg);
  const raanRad = degToRad(elements.raanDeg);

  for (let pointIndex = 0; pointIndex <= segments; pointIndex += 1) {
    const t = pointIndex / segments;
    const trueAnomaly = t * Math.PI * 2;
    const radiusKm =
      (elements.aKm * (1 - elements.e * elements.e)) /
      (1 + elements.e * Math.cos(trueAnomaly)) *
      orbitVisualScale;

    points.push(
      orbitalPlaneTo3D(
        radiusKm,
        trueAnomaly,
        argPeriapsisRad,
        inclinationRad,
        raanRad,
      ),
    );
  }

  return points;
}
