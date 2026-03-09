import * as THREE from "three";
import type { BodyId, OrbitElements, SpacecraftRecord } from "../types";
import { KM_PER_SCENE_UNIT } from "./constants";
import { getRelativeOrbitalPositionKm, julianDateFromDate } from "./orbitMath";

export function createSpacecraftOrbitElements(record: SpacecraftRecord): OrbitElements {
  return {
    epochJd: julianDateFromDate(new Date(record.createdAtIso)),
    aKm: record.orbit.aKm,
    e: record.orbit.e,
    iDeg: record.orbit.iDeg,
    raanDeg: record.orbit.raanDeg,
    argPeriapsisDeg: record.orbit.argPeriapsisDeg,
    meanAnomalyDegAtEpoch: record.orbit.meanAnomalyDegAtEpoch,
    periodDays: record.orbit.periodDays,
    centralBody: record.orbit.attractorBodyId,
    orbitVisualScale: record.orbit.orbitVisualScale,
  };
}

export function getSpacecraftPositionScene(
  record: SpacecraftRecord,
  date: Date,
  bodyPositionsScene: Record<BodyId, THREE.Vector3>,
): THREE.Vector3 {
  const parentPosition = bodyPositionsScene[record.orbit.attractorBodyId];
  const orbitalElements = createSpacecraftOrbitElements(record);
  const relativeKm = getRelativeOrbitalPositionKm(orbitalElements, julianDateFromDate(date));
  return parentPosition.clone().add(relativeKm.multiplyScalar(1 / KM_PER_SCENE_UNIT));
}
