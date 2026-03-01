import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { BodyId, OrbitElements } from "../types";
import { KM_PER_SCENE_UNIT } from "../sim/constants";
import { degToRad, normalizeAngleRadians, sampleOrbitPointsKm } from "../sim/orbitMath";

const TAU = Math.PI * 2;

export interface OrbitArcRuntime {
  bodyId: BodyId;
  segmentA: Line2;
  segmentB: Line2;
  basePointsScene: Float32Array;
  lastGapStartRad: number;
}

function createLineMaterial(color: THREE.ColorRepresentation): LineMaterial {
  const material = new LineMaterial({
    color,
    linewidth: 1.1,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    worldUnits: false,
    dashed: false,
    alphaToCoverage: true,
  });
  material.resolution.set(window.innerWidth, window.innerHeight);
  return material;
}

function createLine(color: THREE.ColorRepresentation): Line2 {
  const line = new Line2(new LineGeometry(), createLineMaterial(color));
  line.frustumCulled = false;
  line.renderOrder = 1;
  return line;
}

function pointsCount(runtime: OrbitArcRuntime): number {
  return runtime.basePointsScene.length / 3;
}

function appendPoint(target: number[], basePointsScene: Float32Array, index: number): void {
  const pointOffset = index * 3;
  target.push(
    basePointsScene[pointOffset],
    basePointsScene[pointOffset + 1],
    basePointsScene[pointOffset + 2],
  );
}

function appendRange(
  target: number[],
  basePointsScene: Float32Array,
  startIndex: number,
  endIndex: number,
): void {
  if (startIndex > endIndex) {
    return;
  }

  for (let index = startIndex; index <= endIndex; index += 1) {
    appendPoint(target, basePointsScene, index);
  }
}

function applyPositions(line: Line2, positions: number[]): void {
  const geometry = line.geometry as LineGeometry;
  if (positions.length < 6) {
    line.visible = false;
    return;
  }

  line.visible = true;
  geometry.setPositions(positions);
  line.computeLineDistances();
}

function angularDistance(a: number, b: number): number {
  const diff = Math.abs(normalizeAngleRadians(a - b));
  return Math.min(diff, TAU - diff);
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

export function createOrbitArcRuntime(
  bodyId: BodyId,
  orbit: OrbitElements,
  color: THREE.ColorRepresentation,
  segments = 1024,
): OrbitArcRuntime {
  const sampled = dropDuplicateClosingPoint(sampleOrbitPointsKm(orbit, segments));
  const basePointsScene = new Float32Array(sampled.length * 3);

  sampled.forEach((point, index) => {
    const scaledPoint = point.multiplyScalar(1 / KM_PER_SCENE_UNIT);
    const offset = index * 3;
    basePointsScene[offset] = scaledPoint.x;
    basePointsScene[offset + 1] = scaledPoint.y;
    basePointsScene[offset + 2] = scaledPoint.z;
  });

  const runtime: OrbitArcRuntime = {
    bodyId,
    segmentA: createLine(color),
    segmentB: createLine(color),
    basePointsScene,
    lastGapStartRad: Number.NaN,
  };

  return runtime;
}

export function updateOrbitArc(
  runtime: OrbitArcRuntime,
  currentTrueAnomalyRad: number,
  gapDegrees: number,
  resolutionWidth: number,
  resolutionHeight: number,
  minUpdateDeltaRad = 0,
): void {
  const normalizedGapStart = normalizeAngleRadians(currentTrueAnomalyRad);
  if (
    Number.isFinite(runtime.lastGapStartRad) &&
    angularDistance(normalizedGapStart, runtime.lastGapStartRad) < minUpdateDeltaRad
  ) {
    return;
  }

  runtime.lastGapStartRad = normalizedGapStart;
  setOrbitVisualResolution(runtime, resolutionWidth, resolutionHeight);

  const count = pointsCount(runtime);
  if (count < 3) {
    runtime.segmentA.visible = false;
    runtime.segmentB.visible = false;
    return;
  }

  const normalizedGap = THREE.MathUtils.clamp(gapDegrees, 0, 359.5);
  if (normalizedGap <= 0) {
    const positions: number[] = [];
    appendRange(positions, runtime.basePointsScene, 0, count - 1);
    appendPoint(positions, runtime.basePointsScene, 0);
    applyPositions(runtime.segmentA, positions);
    runtime.segmentB.visible = false;
    return;
  }

  const gapSizeRad = degToRad(normalizedGap);
  const gapEnd = normalizeAngleRadians(normalizedGapStart + gapSizeRad);

  const startIndex = Math.floor((normalizedGapStart / TAU) * count) % count;
  const endIndex = Math.floor((gapEnd / TAU) * count) % count;

  const segmentAPositions: number[] = [];
  const segmentBPositions: number[] = [];

  if (startIndex < endIndex) {
    appendRange(segmentAPositions, runtime.basePointsScene, endIndex + 1, count - 1);
    appendRange(segmentBPositions, runtime.basePointsScene, 0, startIndex - 1);
  } else if (startIndex > endIndex) {
    appendRange(segmentAPositions, runtime.basePointsScene, endIndex + 1, startIndex - 1);
  } else {
    appendRange(segmentAPositions, runtime.basePointsScene, 0, count - 1);
  }

  applyPositions(runtime.segmentA, segmentAPositions);
  applyPositions(runtime.segmentB, segmentBPositions);
}

export function setOrbitVisualResolution(
  orbit: OrbitArcRuntime,
  width: number,
  height: number,
): void {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  (orbit.segmentA.material as LineMaterial).resolution.set(safeWidth, safeHeight);
  (orbit.segmentB.material as LineMaterial).resolution.set(safeWidth, safeHeight);
}
