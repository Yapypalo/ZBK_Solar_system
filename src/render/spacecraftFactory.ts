import * as THREE from "three";
import type { SpacecraftRecord } from "../types";
import { KM_PER_SCENE_UNIT } from "../sim/constants";
import { sampleOrbitPointsKm } from "../sim/orbitMath";
import { createSpacecraftOrbitElements } from "../sim/spacecraftPropagator";

const SOLID_OPACITY = 0.58;
const DASHED_OPACITY = 0.2;

const IMPORTANCE_COLORS = {
  1: "#B9D6FF",
  2: "#FC8A3A",
  3: "#FF5B38",
} as const;

export interface SpacecraftVisualRuntime {
  solidLine: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  dashedLine: THREE.LineSegments<THREE.BufferGeometry, THREE.LineDashedMaterial>;
  updateOrbitStyle: (linkedBodiesLocal: THREE.Vector3[], soiRadiiScene: number[]) => void;
  setOrbitVisible: (visible: boolean) => void;
  dispose: () => void;
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

function createOrbitPoints(record: SpacecraftRecord, lowDetailMode: boolean): THREE.Vector3[] {
  const orbitElements = createSpacecraftOrbitElements(record);
  const segmentCount = lowDetailMode ? 64 : record.kind === "transfer" ? 128 : 96;
  const rawPoints = sampleOrbitPointsKm(orbitElements, segmentCount).map((pointKm) =>
    pointKm.multiplyScalar(1 / KM_PER_SCENE_UNIT),
  );
  return dropDuplicateClosingPoint(rawPoints);
}

function createSolidOrbitLine(record: SpacecraftRecord): THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const material = new THREE.LineBasicMaterial({
    color: IMPORTANCE_COLORS[record.importance],
    transparent: true,
    opacity: SOLID_OPACITY,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });

  const line = new THREE.LineSegments(new THREE.BufferGeometry(), material);
  line.frustumCulled = false;
  line.renderOrder = 2;
  return line;
}

function createDashedOrbitLine(
  record: SpacecraftRecord,
): THREE.LineSegments<THREE.BufferGeometry, THREE.LineDashedMaterial> {
  const color = new THREE.Color(IMPORTANCE_COLORS[record.importance]).offsetHSL(0, -0.1, 0.08);
  const material = new THREE.LineDashedMaterial({
    color,
    transparent: true,
    opacity: DASHED_OPACITY,
    depthWrite: false,
    depthTest: true,
    dashSize: 0.55,
    gapSize: 0.45,
    toneMapped: false,
  });

  const line = new THREE.LineSegments(new THREE.BufferGeometry(), material);
  line.frustumCulled = false;
  line.renderOrder = 1;
  return line;
}

function writeSegmentGeometry(
  line: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial | THREE.LineDashedMaterial>,
  positions: number[],
): void {
  const geometry = line.geometry;
  const array = positions.length > 0 ? new Float32Array(positions) : new Float32Array(0);
  geometry.setAttribute("position", new THREE.BufferAttribute(array, 3));
  geometry.setDrawRange(0, array.length / 3);
  geometry.computeBoundingSphere();
  if ("computeLineDistances" in line) {
    line.computeLineDistances();
  }
}

export function createSpacecraftVisual(
  record: SpacecraftRecord,
  lowDetailMode = false,
): SpacecraftVisualRuntime {
  const orbitPoints = createOrbitPoints(record, lowDetailMode);
  const solidLine = createSolidOrbitLine(record);
  solidLine.name = `${record.id}-orbit-solid`;
  const dashedLine = createDashedOrbitLine(record);
  dashedLine.name = `${record.id}-orbit-dashed`;
  const midpoint = new THREE.Vector3();

  const updateOrbitStyle = (linkedBodiesLocal: THREE.Vector3[], soiRadiiScene: number[]): void => {
    const solidSegments: number[] = [];
    const dashedSegments: number[] = [];
    const linkedCount = Math.min(linkedBodiesLocal.length, soiRadiiScene.length);
    const soiSquared = soiRadiiScene.map((radius) => radius * radius);

    if (orbitPoints.length < 2) {
      writeSegmentGeometry(solidLine, solidSegments);
      writeSegmentGeometry(dashedLine, dashedSegments);
      return;
    }

    if (record.kind === "orbiter") {
      for (let index = 0; index < orbitPoints.length; index += 1) {
        const start = orbitPoints[index];
        const end = orbitPoints[(index + 1) % orbitPoints.length];
        solidSegments.push(start.x, start.y, start.z, end.x, end.y, end.z);
      }
      writeSegmentGeometry(solidLine, solidSegments);
      writeSegmentGeometry(dashedLine, dashedSegments);
      return;
    }

    for (let index = 0; index < orbitPoints.length; index += 1) {
      const start = orbitPoints[index];
      const end = orbitPoints[(index + 1) % orbitPoints.length];
      midpoint.lerpVectors(start, end, 0.5);

      let insideLinkedSoi = false;
      for (let linkedIndex = 0; linkedIndex < linkedCount; linkedIndex += 1) {
        const bodyPosition = linkedBodiesLocal[linkedIndex];
        if (midpoint.distanceToSquared(bodyPosition) <= soiSquared[linkedIndex]) {
          insideLinkedSoi = true;
          break;
        }
      }

      const target = insideLinkedSoi || linkedCount === 0 ? solidSegments : dashedSegments;
      target.push(start.x, start.y, start.z, end.x, end.y, end.z);
    }

    writeSegmentGeometry(solidLine, solidSegments);
    writeSegmentGeometry(dashedLine, dashedSegments);
  };

  const setOrbitVisible = (visible: boolean): void => {
    solidLine.visible = visible;
    dashedLine.visible = visible;
  };

  updateOrbitStyle([], []);

  return {
    solidLine,
    dashedLine,
    updateOrbitStyle,
    setOrbitVisible,
    dispose: () => {
      solidLine.geometry.dispose();
      solidLine.material.dispose();
      dashedLine.geometry.dispose();
      dashedLine.material.dispose();
    },
  };
}

