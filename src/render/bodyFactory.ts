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

function tuneMeshMaterial(mesh: THREE.Mesh, config: BodyVisualConfig): void {
  const applyTuning = (material: THREE.Material): void => {
    if (material instanceof THREE.MeshStandardMaterial) {
      material.roughness = config.id === "sun" ? 0.38 : Math.min(material.roughness, 0.96);
      material.metalness = config.id === "sun" ? 0.01 : Math.min(material.metalness, 0.06);
      material.color = material.map ? new THREE.Color("#FFFFFF") : new THREE.Color(config.color);
      if (config.id === "sun") {
        material.emissive = new THREE.Color("#F8642E");
        material.emissiveIntensity = 0.62;
      } else {
        material.emissive = new THREE.Color(config.color).multiplyScalar(0.03);
        material.emissiveIntensity = 0.2;
      }
      material.envMapIntensity = config.id === "sun" ? 0.2 : 0.8;
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
    emissiveIntensity: config.id === "sun" ? 0.55 : 0,
    roughness: config.id === "sun" ? 0.4 : 0.88,
    metalness: config.id === "sun" ? 0.0 : 0.04,
  });
  return new THREE.Mesh(geometry, material);
}

function createSunGlowShell(radius: number): THREE.Mesh {
  const glowGeometry = new THREE.SphereGeometry(radius * 1.16, 40, 40);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color("#FD7F40"),
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.BackSide,
  });
  return new THREE.Mesh(glowGeometry, glowMaterial);
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

  if (!containsMesh(visual)) {
    return {
      visual: createFallbackSphere(config),
      loadState: "fallback",
    };
  }

  applyVisualTuning(visual, config);
  normalizeModelToRadius(visual, config.visualRadius);

  if (config.orientationOffsetDeg) {
    const [xDeg, yDeg, zDeg] = config.orientationOffsetDeg;
    visual.rotation.set(degToRad(xDeg), degToRad(yDeg), degToRad(zDeg));
  }

  if (config.id !== "sun") {
    return { visual, loadState: "loaded" };
  }

  const wrapper = new THREE.Group();
  wrapper.add(visual);
  wrapper.add(createSunGlowShell(config.visualRadius));
  return {
    visual: wrapper,
    loadState: "loaded",
  };
}
