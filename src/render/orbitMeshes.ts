import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { BodyId, OrbitElements } from "../types";
import { KM_PER_SCENE_UNIT } from "../sim/constants";
import { degToRad, normalizeAngleRadians, sampleOrbitPointsKm } from "../sim/orbitMath";

const TAU = Math.PI * 2;
const BASE_OPACITY = 0.72;
const BASE_LINE_WIDTH = 1.35;
const TRAIL_TOTAL_DEG = 359.0;

export interface OrbitArcRuntime {
  bodyId: BodyId;
  line: Line2;
  geometry: LineGeometry;
  material: LineMaterial;
  basePointsScene: Float32Array;
  basePointCount: number;
  trailPositions: Float32Array;
  trailColors: Float32Array;
  trailPointCount: number;
  totalTrailRad: number;
  fadeDegrees: number;
}

function createLineMaterial(color: THREE.ColorRepresentation): LineMaterial {
  const material = new LineMaterial({
    color,
    linewidth: BASE_LINE_WIDTH,
    transparent: true,
    opacity: BASE_OPACITY,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    worldUnits: false,
    dashed: false,
    alphaToCoverage: true,
    vertexColors: true,
  });
  material.resolution.set(window.innerWidth, window.innerHeight);
  return material;
}

function createLine(color: THREE.ColorRepresentation): {
  line: Line2;
  geometry: LineGeometry;
  material: LineMaterial;
} {
  const geometry = new LineGeometry();
  const material = createLineMaterial(color);
  const line = new Line2(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 1;
  return { line, geometry, material };
}

function smoothstep01(value: number): number {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function dropDuplicateClosingPoint(points: THREE.Vector3[]): THREE.Vector3[] {
  if (points.length < 2) {
    return points;
  }

  const first = points[0];
  const last = points[points.length - 1];
  if (first.distanceToSquared(last) < 1e-12) {
    return points.slice(0, -1);
  }

  return points;
}

function sampleRingPoint(
  basePointsScene: Float32Array,
  pointCount: number,
  floatIndex: number,
  target: Float32Array,
  targetOffset: number,
): void {
  const wrapped = ((floatIndex % pointCount) + pointCount) % pointCount;
  const lowIndex = Math.floor(wrapped);
  const highIndex = (lowIndex + 1) % pointCount;
  const blend = wrapped - lowIndex;

  const lowOffset = lowIndex * 3;
  const highOffset = highIndex * 3;

  target[targetOffset] = THREE.MathUtils.lerp(
    basePointsScene[lowOffset],
    basePointsScene[highOffset],
    blend,
  );
  target[targetOffset + 1] = THREE.MathUtils.lerp(
    basePointsScene[lowOffset + 1],
    basePointsScene[highOffset + 1],
    blend,
  );
  target[targetOffset + 2] = THREE.MathUtils.lerp(
    basePointsScene[lowOffset + 2],
    basePointsScene[highOffset + 2],
    blend,
  );
}

export function createOrbitArcRuntime(
  bodyId: BodyId,
  orbit: OrbitElements,
  color: THREE.ColorRepresentation,
  samples = 1440,
): OrbitArcRuntime {
  const baseSampleCount = Math.max(2048, samples * 4);
  const sampled = dropDuplicateClosingPoint(sampleOrbitPointsKm(orbit, baseSampleCount));
  const basePointsScene = new Float32Array(sampled.length * 3);

  sampled.forEach((point, index) => {
    const scaled = point.multiplyScalar(1 / KM_PER_SCENE_UNIT);
    const offset = index * 3;
    basePointsScene[offset] = scaled.x;
    basePointsScene[offset + 1] = scaled.y;
    basePointsScene[offset + 2] = scaled.z;
  });

  const trailPointCount = Math.max(1024, samples);
  const { line, geometry, material } = createLine(color);

  return {
    bodyId,
    line,
    geometry,
    material,
    basePointsScene,
    basePointCount: sampled.length,
    trailPositions: new Float32Array((trailPointCount + 1) * 3),
    trailColors: new Float32Array((trailPointCount + 1) * 3),
    trailPointCount,
    totalTrailRad: degToRad(TRAIL_TOTAL_DEG),
    fadeDegrees: THREE.MathUtils.clamp(orbit.orbitGapDegrees ?? 45, 0, 359.5),
  };
}

export function updateOrbitArc(
  runtime: OrbitArcRuntime,
  currentTrueAnomalyRad: number,
): void {
  if (runtime.basePointCount < 2) {
    runtime.line.visible = false;
    return;
  }

  const headAnomaly = normalizeAngleRadians(currentTrueAnomalyRad);
  const fadeStartDeg = 360 - runtime.fadeDegrees;

  for (let pointIndex = 0; pointIndex <= runtime.trailPointCount; pointIndex += 1) {
    const progress = pointIndex / runtime.trailPointCount;
    const angleBehind = progress * runtime.totalTrailRad;
    const sampleAnomaly = normalizeAngleRadians(headAnomaly - angleBehind);
    const floatIndex = (sampleAnomaly / TAU) * runtime.basePointCount;
    const targetOffset = pointIndex * 3;

    sampleRingPoint(
      runtime.basePointsScene,
      runtime.basePointCount,
      floatIndex,
      runtime.trailPositions,
      targetOffset,
    );

    let fade = 1;
    if (runtime.fadeDegrees > 0) {
      const trailDeg = progress * 360;
      if (trailDeg > fadeStartDeg) {
        const t = (trailDeg - fadeStartDeg) / runtime.fadeDegrees;
        fade = 1 - smoothstep01(t);
      }
    }

    if (pointIndex >= runtime.trailPointCount - 2) {
      fade = 0;
    }

    runtime.trailColors[targetOffset] = fade;
    runtime.trailColors[targetOffset + 1] = fade;
    runtime.trailColors[targetOffset + 2] = fade;
  }

  runtime.line.visible = true;
  runtime.geometry.setPositions(runtime.trailPositions);
  runtime.geometry.setColors(runtime.trailColors);
  runtime.line.computeLineDistances();
}

export function setOrbitVisualResolution(
  orbit: OrbitArcRuntime,
  width: number,
  height: number,
): void {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  orbit.material.resolution.set(safeWidth, safeHeight);
}
