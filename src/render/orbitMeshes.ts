import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { OrbitElements } from "../types";
import { KM_PER_SCENE_UNIT } from "../sim/constants";
import { sampleOrbitPointsKm } from "../sim/orbitMath";

export interface OrbitVisualHandle {
  mesh: Line2;
  material: LineMaterial;
}

export function createOrbitVisual(
  orbit: OrbitElements,
  color: THREE.ColorRepresentation,
  segments = 1024,
): OrbitVisualHandle {
  const pointsKm = sampleOrbitPointsKm(orbit, segments);
  const positions: number[] = [];

  for (const point of pointsKm) {
    point.multiplyScalar(1 / KM_PER_SCENE_UNIT);
    positions.push(point.x, point.y, point.z);
  }

  const geometry = new LineGeometry();
  geometry.setPositions(positions);

  const material = new LineMaterial({
    color,
    linewidth: 1.35,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    worldUnits: false,
    dashed: false,
    alphaToCoverage: true,
  });
  material.resolution.set(window.innerWidth, window.innerHeight);

  const mesh = new Line2(geometry, material);
  mesh.computeLineDistances();
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  return { mesh, material };
}

export function setOrbitVisualResolution(
  orbit: OrbitVisualHandle,
  width: number,
  height: number,
): void {
  orbit.material.resolution.set(Math.max(1, width), Math.max(1, height));
}
