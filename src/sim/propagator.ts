import * as THREE from "three";
import { J2000_JD } from "../data/orbitalElements";
import type { BodyVisualConfig, BodyId } from "../types";
import { KM_PER_SCENE_UNIT } from "./constants";
import {
  getOrbitalState,
  julianDateFromDate,
  normalizeAngleRadians,
} from "./orbitMath";

export interface PropagationSnapshot {
  julianDate: number;
  positionsScene: Record<BodyId, THREE.Vector3>;
  spinAnglesRad: Record<BodyId, number>;
  trueAnomaliesRad: Partial<Record<BodyId, number>>;
}

export function propagateSystem(
  bodies: BodyVisualConfig[],
  date: Date,
): PropagationSnapshot {
  const julianDate = julianDateFromDate(date);
  const bodyById = new Map<BodyId, BodyVisualConfig>(
    bodies.map((body) => [body.id, body]),
  );
  const resolving = new Set<BodyId>();
  const positionsKm = new Map<BodyId, THREE.Vector3>();
  const trueAnomaliesRad: Partial<Record<BodyId, number>> = {};
  const sceneScale = 1 / KM_PER_SCENE_UNIT;

  const resolvePositionKm = (id: BodyId): THREE.Vector3 => {
    const cachedPosition = positionsKm.get(id);
    if (cachedPosition) {
      return cachedPosition.clone();
    }

    if (resolving.has(id)) {
      throw new Error(`Orbit hierarchy cycle detected for body "${id}".`);
    }

    const body = bodyById.get(id);
    if (!body) {
      throw new Error(`Body "${id}" is missing from propagation config.`);
    }

    resolving.add(id);

    let position = new THREE.Vector3(0, 0, 0);
    if (body.orbit) {
      const parent = resolvePositionKm(body.orbit.centralBody);
      const orbitalState = getOrbitalState(body.orbit, julianDate);
      const relative = orbitalState.positionKm;
      trueAnomaliesRad[id] = orbitalState.trueAnomalyRad;
      position = parent.add(relative);
    }

    resolving.delete(id);
    positionsKm.set(id, position.clone());
    return position;
  };

  const positionsScene = {} as Record<BodyId, THREE.Vector3>;
  const spinAnglesRad = {} as Record<BodyId, number>;
  const elapsedHours = (julianDate - J2000_JD) * 24;

  for (const body of bodies) {
    positionsScene[body.id] = resolvePositionKm(body.id).multiplyScalar(sceneScale);

    const direction = body.spin.retrograde ? -1 : 1;
    const turns = elapsedHours / body.spin.rotationPeriodHours;
    spinAnglesRad[body.id] = normalizeAngleRadians(direction * turns * Math.PI * 2);
  }

  return { julianDate, positionsScene, spinAnglesRad, trueAnomaliesRad };
}
