import * as THREE from "three";
import type { MissionImportance, SpacecraftRecord } from "../types";
import { KM_PER_SCENE_UNIT } from "../sim/constants";
import { sampleOrbitPointsKm } from "../sim/orbitMath";
import { createSpacecraftOrbitElements } from "../sim/spacecraftPropagator";

const SOLID_OPACITY = 0.58;
const DASHED_OPACITY = 0.2;

const IMPORTANCE_COLORS: Record<MissionImportance, THREE.ColorRepresentation> = {
  1: "#B9D6FF",
  2: "#FC8A3A",
  3: "#FF5B38",
};

const IMPORTANCE_SIZES: Record<MissionImportance, number> = {
  1: 0.075,
  2: 0.095,
  3: 0.115,
};

const SHARED_OCTAHEDRON_GEOMETRIES: Record<MissionImportance, THREE.OctahedronGeometry> = {
  1: new THREE.OctahedronGeometry(IMPORTANCE_SIZES[1], 0),
  2: new THREE.OctahedronGeometry(IMPORTANCE_SIZES[2], 0),
  3: new THREE.OctahedronGeometry(IMPORTANCE_SIZES[3], 0),
};

const SHARED_PANEL_GEOMETRY = new THREE.BoxGeometry(0.05, 0.008, 0.018);

export interface SpacecraftVisualRuntime {
  root: THREE.Group;
  solidLine: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  dashedLine: THREE.LineSegments<THREE.BufferGeometry, THREE.LineDashedMaterial>;
  updateOrbitStyle: (linkedBodiesLocal: THREE.Vector3[], soiRadiiScene: number[]) => void;
  setOrbitVisible: (visible: boolean) => void;
  dispose: () => void;
}

function createSpacecraftBodyMesh(importance: MissionImportance): THREE.Group {
  const color = IMPORTANCE_COLORS[importance];
  const coreMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.18,
    roughness: 0.6,
    metalness: 0.14,
  });

  const panelMaterial = new THREE.MeshStandardMaterial({
    color: "#D8E8FF",
    roughness: 0.3,
    metalness: 0.35,
  });

  const group = new THREE.Group();
  const core = new THREE.Mesh(SHARED_OCTAHEDRON_GEOMETRIES[importance], coreMaterial);
  group.add(core);

  const panelOffset = IMPORTANCE_SIZES[importance] * 0.95;
  const panelA = new THREE.Mesh(SHARED_PANEL_GEOMETRY, panelMaterial);
  panelA.position.set(panelOffset, 0, 0);
  panelA.rotation.z = Math.PI * 0.12;
  const panelB = new THREE.Mesh(SHARED_PANEL_GEOMETRY, panelMaterial);
  panelB.position.set(-panelOffset, 0, 0);
  panelB.rotation.z = -Math.PI * 0.12;

  group.add(panelA, panelB);
  return group;
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

function createOrbitPoints(
  record: SpacecraftRecord,
  lowDetailMode: boolean,
): THREE.Vector3[] {
  const orbitElements = createSpacecraftOrbitElements(record);
  const segmentCount = lowDetailMode ? 64 : record.kind === "transfer" ? 128 : 96;
  const rawPoints = sampleOrbitPointsKm(orbitElements, segmentCount).map((pointKm) =>
    pointKm.multiplyScalar(1 / KM_PER_SCENE_UNIT),
  );
  return dropDuplicateClosingPoint(rawPoints);
}

function createSolidOrbitLine(
  record: SpacecraftRecord,
): THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> {
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
  const root = createSpacecraftBodyMesh(record.importance);
  root.name = `${record.id}-spacecraft`;
  const orbitPoints = createOrbitPoints(record, lowDetailMode);

  const solidLine = createSolidOrbitLine(record);
  solidLine.name = `${record.id}-orbit-solid`;
  const dashedLine = createDashedOrbitLine(record);
  dashedLine.name = `${record.id}-orbit-dashed`;

  const midpoint = new THREE.Vector3();

  const updateOrbitStyle = (
    linkedBodiesLocal: THREE.Vector3[],
    soiRadiiScene: number[],
  ): void => {
    const solidSegments: number[] = [];
    const dashedSegments: number[] = [];
    const linkedCount = Math.min(linkedBodiesLocal.length, soiRadiiScene.length);
    const soiSquared = soiRadiiScene.map((radius) => radius * radius);

    if (orbitPoints.length < 2) {
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
    root,
    solidLine,
    dashedLine,
    updateOrbitStyle,
    setOrbitVisible,
    dispose: () => {
      solidLine.geometry.dispose();
      solidLine.material.dispose();
      dashedLine.geometry.dispose();
      dashedLine.material.dispose();
      root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) {
          return;
        }
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((material) => material.dispose());
        } else {
          mesh.material.dispose();
        }
      });
    },
  };
}
