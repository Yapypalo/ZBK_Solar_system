import * as THREE from "three";
import type { OrbitElements } from "../types";
import { KM_PER_SCENE_UNIT } from "../sim/constants";
import { sampleOrbitPointsKm } from "../sim/orbitMath";

export interface OrbitVisualHandle {
  mesh: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  material: THREE.MeshBasicMaterial;
}

function getOrbitTubeRadius(orbit: OrbitElements): number {
  const scaledSemiMajorAxis = orbit.aKm / KM_PER_SCENE_UNIT;
  return THREE.MathUtils.clamp(scaledSemiMajorAxis * 0.00028, 0.0014, 0.008);
}

export function createOrbitVisual(
  orbit: OrbitElements,
  color: THREE.ColorRepresentation,
  segments = 512,
): OrbitVisualHandle {
  const pointsKm = sampleOrbitPointsKm(orbit, segments);
  const pointsScene = pointsKm.map((point) => point.multiplyScalar(1 / KM_PER_SCENE_UNIT));

  const curve = new THREE.CatmullRomCurve3(pointsScene, true, "catmullrom", 0.02);
  const geometry = new THREE.TubeGeometry(
    curve,
    segments * 2,
    getOrbitTubeRadius(orbit),
    12,
    true,
  );

  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.NormalBlending,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  return { mesh, material };
}
