import * as THREE from "three";
import type { MissionImportance, SpacecraftRecord } from "../types";

const MAX_SPACECRAFT_INSTANCES_PER_IMPORTANCE = 512;

const IMPORTANCE_CORE_SIZE: Record<MissionImportance, number> = {
  1: 0.075,
  2: 0.095,
  3: 0.115,
};

const IMPORTANCE_CORE_COLOR: Record<MissionImportance, THREE.ColorRepresentation> = {
  1: "#B9D6FF",
  2: "#FC8A3A",
  3: "#FF5B38",
};

export interface SpacecraftInstanceHandle {
  importance: MissionImportance;
  index: number;
}

export interface SpacecraftInstanceManager {
  allocate: (record: SpacecraftRecord) => SpacecraftInstanceHandle;
  update: (handle: SpacecraftInstanceHandle, position: THREE.Vector3, yawRadians: number) => void;
  release: (handle: SpacecraftInstanceHandle) => void;
  dispose: () => void;
}

interface ImportancePool {
  importance: MissionImportance;
  group: THREE.Group;
  coreMesh: THREE.InstancedMesh;
  panelAMesh: THREE.InstancedMesh;
  panelBMesh: THREE.InstancedMesh;
  freeIndices: number[];
  allocated: Set<number>;
}

function createPool(importance: MissionImportance): ImportancePool {
  const maxInstances = MAX_SPACECRAFT_INSTANCES_PER_IMPORTANCE;
  const size = IMPORTANCE_CORE_SIZE[importance];
  const coreGeometry = new THREE.OctahedronGeometry(size, 0);
  const panelGeometry = new THREE.BoxGeometry(0.05, 0.008, 0.018);

  const coreColor = new THREE.Color(IMPORTANCE_CORE_COLOR[importance]);
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: coreColor,
    emissive: coreColor,
    emissiveIntensity: 0.18,
    roughness: 0.6,
    metalness: 0.14,
  });

  const panelMaterial = new THREE.MeshStandardMaterial({
    color: "#D8E8FF",
    roughness: 0.3,
    metalness: 0.35,
  });

  const coreMesh = new THREE.InstancedMesh(coreGeometry, coreMaterial, maxInstances);
  coreMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  coreMesh.count = maxInstances;
  coreMesh.frustumCulled = false;

  const panelAMesh = new THREE.InstancedMesh(panelGeometry, panelMaterial, maxInstances);
  panelAMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  panelAMesh.count = maxInstances;
  panelAMesh.frustumCulled = false;

  const panelBMesh = new THREE.InstancedMesh(panelGeometry, panelMaterial.clone(), maxInstances);
  panelBMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  panelBMesh.count = maxInstances;
  panelBMesh.frustumCulled = false;

  const hiddenMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(0, 0, 0),
  );
  for (let index = 0; index < maxInstances; index += 1) {
    coreMesh.setMatrixAt(index, hiddenMatrix);
    panelAMesh.setMatrixAt(index, hiddenMatrix);
    panelBMesh.setMatrixAt(index, hiddenMatrix);
  }
  coreMesh.instanceMatrix.needsUpdate = true;
  panelAMesh.instanceMatrix.needsUpdate = true;
  panelBMesh.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.name = `spacecraft-instances-imp-${importance}`;
  group.add(coreMesh, panelAMesh, panelBMesh);

  return {
    importance,
    group,
    coreMesh,
    panelAMesh,
    panelBMesh,
    freeIndices: [],
    allocated: new Set<number>(),
  };
}

export function createSpacecraftInstanceManager(scene: THREE.Scene): SpacecraftInstanceManager {
  const pools: Record<MissionImportance, ImportancePool> = {
    1: createPool(1),
    2: createPool(2),
    3: createPool(3),
  };

  scene.add(pools[1].group, pools[2].group, pools[3].group);

  const quaternion = new THREE.Quaternion();
  const unitScale = new THREE.Vector3(1, 1, 1);
  const hiddenScale = new THREE.Vector3(0, 0, 0);
  const transformMatrix = new THREE.Matrix4();
  const localMatrix = new THREE.Matrix4();
  const localMatrixB = new THREE.Matrix4();
  const panelMatrixA = new THREE.Matrix4();
  const panelMatrixB = new THREE.Matrix4();
  const hiddenMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0, 0),
    new THREE.Quaternion(),
    hiddenScale,
  );

  function getPanelOffset(importance: MissionImportance): number {
    return IMPORTANCE_CORE_SIZE[importance] * 0.95;
  }

  function applyHiddenAt(pool: ImportancePool, index: number): void {
    pool.coreMesh.setMatrixAt(index, hiddenMatrix);
    pool.panelAMesh.setMatrixAt(index, hiddenMatrix);
    pool.panelBMesh.setMatrixAt(index, hiddenMatrix);
    pool.coreMesh.instanceMatrix.needsUpdate = true;
    pool.panelAMesh.instanceMatrix.needsUpdate = true;
    pool.panelBMesh.instanceMatrix.needsUpdate = true;
  }

  function takeIndex(pool: ImportancePool): number {
    const reusedIndex = pool.freeIndices.pop();
    if (typeof reusedIndex === "number") {
      pool.allocated.add(reusedIndex);
      return reusedIndex;
    }

    const nextIndex = pool.allocated.size + pool.freeIndices.length;
    if (nextIndex >= MAX_SPACECRAFT_INSTANCES_PER_IMPORTANCE) {
      throw new Error(
        `Instance pool overflow for importance ${pool.importance}. Max ${MAX_SPACECRAFT_INSTANCES_PER_IMPORTANCE} reached.`,
      );
    }
    pool.allocated.add(nextIndex);
    return nextIndex;
  }

  function update(handle: SpacecraftInstanceHandle, position: THREE.Vector3, yawRadians: number): void {
    const pool = pools[handle.importance];
    if (!pool.allocated.has(handle.index)) {
      return;
    }

    quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yawRadians);
    transformMatrix.compose(position, quaternion, unitScale);

    const panelOffset = getPanelOffset(handle.importance);
    localMatrix.makeRotationZ(Math.PI * 0.12);
    localMatrix.setPosition(panelOffset, 0, 0);

    localMatrixB.makeRotationZ(-Math.PI * 0.12);
    localMatrixB.setPosition(-panelOffset, 0, 0);

    pool.coreMesh.setMatrixAt(handle.index, transformMatrix);
    panelMatrixA.multiplyMatrices(transformMatrix, localMatrix);
    panelMatrixB.multiplyMatrices(transformMatrix, localMatrixB);
    pool.panelAMesh.setMatrixAt(handle.index, panelMatrixA);
    pool.panelBMesh.setMatrixAt(handle.index, panelMatrixB);

    pool.coreMesh.instanceMatrix.needsUpdate = true;
    pool.panelAMesh.instanceMatrix.needsUpdate = true;
    pool.panelBMesh.instanceMatrix.needsUpdate = true;
  }

  function allocate(record: SpacecraftRecord): SpacecraftInstanceHandle {
    const importance = record.importance;
    const pool = pools[importance];
    const index = takeIndex(pool);
    applyHiddenAt(pool, index);
    return { importance, index };
  }

  function release(handle: SpacecraftInstanceHandle): void {
    const pool = pools[handle.importance];
    if (!pool.allocated.has(handle.index)) {
      return;
    }
    pool.allocated.delete(handle.index);
    pool.freeIndices.push(handle.index);
    applyHiddenAt(pool, handle.index);
  }

  function dispose(): void {
    const poolOrder: MissionImportance[] = [1, 2, 3];
    poolOrder.forEach((importance) => {
      const pool = pools[importance];
      scene.remove(pool.group);
      pool.coreMesh.geometry.dispose();
      if (Array.isArray(pool.coreMesh.material)) {
        pool.coreMesh.material.forEach((material) => material.dispose());
      } else {
        pool.coreMesh.material.dispose();
      }
      pool.panelAMesh.geometry.dispose();
      if (Array.isArray(pool.panelAMesh.material)) {
        pool.panelAMesh.material.forEach((material) => material.dispose());
      } else {
        pool.panelAMesh.material.dispose();
      }
      if (Array.isArray(pool.panelBMesh.material)) {
        pool.panelBMesh.material.forEach((material) => material.dispose());
      } else {
        pool.panelBMesh.material.dispose();
      }
    });
  }

  return { allocate, update, release, dispose };
}
