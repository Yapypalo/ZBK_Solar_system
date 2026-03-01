import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type {
  BodyVisualConfig,
  ModelLoadState,
  QualityPreset,
} from "../types";
import { degToRad } from "../sim/orbitMath";
import { normalizeModelToRadius } from "./modelNormalize";

const loader = new GLTFLoader();

export interface BodyVisualResult {
  visual: THREE.Object3D;
  loadState: ModelLoadState;
}

function loadModel(path: string): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    loader.load(
      path,
      (gltf) => resolve(gltf.scene),
      undefined,
      (error) => reject(error),
    );
  });
}

function containsMesh(object: THREE.Object3D): boolean {
  let hasMesh = false;
  object.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) {
      hasMesh = true;
    }
  });
  return hasMesh;
}

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) {
      meshes.push(mesh);
    }
  });
  return meshes;
}

function pruneToTargetMeshPath(root: THREE.Object3D, target: THREE.Object3D): void {
  const keepSet = new Set<THREE.Object3D>();
  let cursor: THREE.Object3D | null = target;
  while (cursor) {
    keepSet.add(cursor);
    if (cursor === root) {
      break;
    }
    cursor = cursor.parent;
  }

  const visit = (node: THREE.Object3D): void => {
    const children = [...node.children];
    for (const child of children) {
      if (!keepSet.has(child)) {
        node.remove(child);
        continue;
      }
      visit(child);
    }
  };

  visit(root);
}

function isolateDeimosMeshHierarchy(root: THREE.Object3D): void {
  const meshes = collectMeshes(root);
  if (meshes.length <= 1) {
    return;
  }

  const byName = meshes.find((mesh) => mesh.name.toLowerCase().includes("deimos"));
  const targetMesh = byName ?? meshes[0];
  if (!targetMesh) {
    return;
  }

  pruneToTargetMeshPath(root, targetMesh);
}

function computeMeshBoundsInRootSpace(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const bounds = new THREE.Box3();
  const meshBounds = new THREE.Box3();
  let hasMesh = false;

  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) {
      return;
    }

    const geometry = mesh.geometry;
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }
    if (!geometry.boundingBox) {
      return;
    }

    meshBounds
      .copy(geometry.boundingBox)
      .applyMatrix4(mesh.matrixWorld)
      .applyMatrix4(rootInverse);

    bounds.union(meshBounds);
    hasMesh = true;
  });

  if (!hasMesh) {
    bounds.makeEmpty();
  }

  return bounds;
}

function recenterVisualToMeshBounds(root: THREE.Object3D): void {
  const bounds = computeMeshBoundsInRootSpace(root);
  if (bounds.isEmpty()) {
    return;
  }

  const center = new THREE.Vector3();
  bounds.getCenter(center);
  if (center.lengthSq() < 1e-10) {
    return;
  }

  root.position.sub(center);
  root.updateMatrixWorld(true);
}

function tuneMeshMaterial(mesh: THREE.Mesh, config: BodyVisualConfig): void {
  const applyTuning = (material: THREE.Material): void => {
    if (material instanceof THREE.MeshStandardMaterial) {
      material.roughness = config.id === "sun" ? 0.55 : Math.min(material.roughness, 0.95);
      material.metalness = config.id === "sun" ? 0.0 : Math.min(material.metalness, 0.12);
      material.color = material.map ? new THREE.Color("#FFFFFF") : new THREE.Color(config.color);

      if (config.id === "earth" && material.emissiveMap) {
        material.emissive = new THREE.Color("#FFFFFF");
        material.emissiveIntensity = 1.2;
      } else if (config.id === "sun") {
        material.emissive = new THREE.Color("#F8642E");
        material.emissiveIntensity = 0.35;
      } else if (config.id === "mercury") {
        material.emissive = new THREE.Color("#000000");
        material.emissiveIntensity = 0;
        material.metalness = 0;
        material.roughness = Math.max(material.roughness, 0.92);
      } else {
        material.emissive = new THREE.Color("#000000");
        material.emissiveIntensity = 0;
      }

      material.envMapIntensity = config.id === "sun" ? 0.0 : 1.0;
      material.needsUpdate = true;
    }
  };

  if (Array.isArray(mesh.material)) {
    mesh.material.forEach(applyTuning);
  } else {
    applyTuning(mesh.material);
  }
}

function applyVisualTuning(object: THREE.Object3D, config: BodyVisualConfig): void {
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    mesh.castShadow = false;
    mesh.receiveShadow = false;
    tuneMeshMaterial(mesh, config);
  });
}

function createFallbackSphere(config: BodyVisualConfig): THREE.Object3D {
  const geometry = new THREE.SphereGeometry(config.visualRadius, 48, 48);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(config.color),
    emissive: config.id === "sun" ? new THREE.Color("#F8642E") : new THREE.Color("#000000"),
    emissiveIntensity: config.id === "sun" ? 0.35 : 0,
    roughness: config.id === "sun" ? 0.5 : 0.92,
    metalness: config.id === "sun" ? 0.0 : 0.02,
  });
  return new THREE.Mesh(geometry, material);
}

function resolvePreferredPath(config: BodyVisualConfig, quality: QualityPreset): string {
  if (quality === "4k" && config.modelPath4k) {
    return config.modelPath4k;
  }
  return config.modelPath1k;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

async function loadFirstAvailableModel(paths: string[]): Promise<THREE.Object3D | null> {
  let loadedWithoutMesh = false;

  for (const path of unique(paths)) {
    try {
      const loaded = await loadModel(path);
      if (containsMesh(loaded)) {
        return loaded;
      }

      loadedWithoutMesh = true;
    } catch {
      continue;
    }
  }

  if (loadedWithoutMesh) {
    return new THREE.Group();
  }

  return null;
}

export async function createBodyVisual(
  config: BodyVisualConfig,
  quality: QualityPreset,
): Promise<BodyVisualResult> {
  const primaryPath = resolvePreferredPath(config, quality);
  const visual = await loadFirstAvailableModel([
    primaryPath,
    config.modelPath1k,
    `/assets/models/${config.id}/${config.id}.glb`,
    `/assets/models/${config.id}/model.glb`,
    `/assets/models/${config.id}/1k.glb`,
  ]);

  if (!visual) {
    return {
      visual: createFallbackSphere(config),
      loadState: "error",
    };
  }

  if (config.id === "deimos") {
    isolateDeimosMeshHierarchy(visual);
  }

  if (!containsMesh(visual)) {
    return {
      visual: createFallbackSphere(config),
      loadState: "fallback",
    };
  }

  applyVisualTuning(visual, config);
  normalizeModelToRadius(visual, config.visualRadius);
  if (config.modelScaleMultiplier && config.modelScaleMultiplier > 0) {
    visual.scale.multiplyScalar(config.modelScaleMultiplier);
  }

  if (config.id === "deimos") {
    recenterVisualToMeshBounds(visual);
  }

  if (config.orientationOffsetDeg) {
    const [xDeg, yDeg, zDeg] = config.orientationOffsetDeg;
    visual.rotation.set(degToRad(xDeg), degToRad(yDeg), degToRad(zDeg));
  }

  return { visual, loadState: "loaded" };
}
