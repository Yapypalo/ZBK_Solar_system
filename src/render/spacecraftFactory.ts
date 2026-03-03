import * as THREE from "three";
import type { MissionImportance, SpacecraftRecord } from "../types";
import { KM_PER_SCENE_UNIT } from "../sim/constants";
import { sampleOrbitPointsKm } from "../sim/orbitMath";
import { createSpacecraftOrbitElements } from "../sim/spacecraftPropagator";

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
  orbitLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  dispose: () => void;
}

function createSpacecraftBodyMesh(
  importance: MissionImportance,
): THREE.Group {
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

function createSpacecraftOrbitLine(
  record: SpacecraftRecord,
  lowDetailMode: boolean,
): THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const orbitElements = createSpacecraftOrbitElements(record);
  const segmentCount = lowDetailMode ? 64 : record.kind === "transfer" ? 128 : 96;
  const orbitPointsScene = sampleOrbitPointsKm(orbitElements, segmentCount).map((pointKm) =>
    pointKm.multiplyScalar(1 / KM_PER_SCENE_UNIT),
  );

  const geometry = new THREE.BufferGeometry().setFromPoints(orbitPointsScene);
  const material = new THREE.LineBasicMaterial({
    color: IMPORTANCE_COLORS[record.importance],
    transparent: true,
    opacity: 0.54,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });

  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 1;
  return line;
}

export function createSpacecraftVisual(
  record: SpacecraftRecord,
  lowDetailMode = false,
): SpacecraftVisualRuntime {
  const root = createSpacecraftBodyMesh(record.importance);
  root.name = `${record.id}-spacecraft`;
  const orbitLine = createSpacecraftOrbitLine(record, lowDetailMode);
  orbitLine.name = `${record.id}-orbit-line`;

  return {
    root,
    orbitLine,
    dispose: () => {
      orbitLine.geometry.dispose();
      orbitLine.material.dispose();
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
