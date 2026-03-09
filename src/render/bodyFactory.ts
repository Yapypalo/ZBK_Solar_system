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

interface ThermalProfile {
  color: THREE.ColorRepresentation;
  strength: number;
  terminatorSoftness: number;
}

const THERMAL_PROFILES: Partial<Record<BodyVisualConfig["id"], ThermalProfile>> = {
  mercury: { color: "#D9B38A", strength: 0.055, terminatorSoftness: 0.06 },
  venus: { color: "#F0C48E", strength: 0.06, terminatorSoftness: 0.07 },
  earth: { color: "#91BFFF", strength: 0.055, terminatorSoftness: 0.06 },
  mars: { color: "#FF9D78", strength: 0.06, terminatorSoftness: 0.065 },
  moon: { color: "#B7C4D4", strength: 0.045, terminatorSoftness: 0.055 },
  phobos: { color: "#C6B296", strength: 0.04, terminatorSoftness: 0.055 },
  deimos: { color: "#CDBFA4", strength: 0.04, terminatorSoftness: 0.055 },
};

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

function findDeimosTargetMesh(root: THREE.Object3D): THREE.Mesh | null {
  const meshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) {
      meshes.push(mesh);
    }
  });

  if (meshes.length === 0) {
    return null;
  }

  return meshes.find((mesh) => mesh.name.toLowerCase().includes("deimos")) ?? meshes[0];
}

function cloneMeshMaterial(
  material: THREE.Material | THREE.Material[],
): THREE.Material | THREE.Material[] {
  if (Array.isArray(material)) {
    return material.map((item) => item.clone());
  }
  return material.clone();
}

function buildFlattenedDeimosGroup(targetMesh: THREE.Mesh): THREE.Group | null {
  if (!targetMesh.geometry) {
    return null;
  }

  targetMesh.updateWorldMatrix(true, false);

  const geometry = targetMesh.geometry.clone();
  geometry.applyMatrix4(targetMesh.matrixWorld);
  geometry.computeBoundingBox();

  const bounds = geometry.boundingBox;
  if (!bounds) {
    return null;
  }

  const center = new THREE.Vector3();
  bounds.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingSphere();

  const flattenedMesh = new THREE.Mesh(
    geometry,
    cloneMeshMaterial(targetMesh.material),
  );
  flattenedMesh.name = targetMesh.name || "deimos-flattened";

  const group = new THREE.Group();
  group.name = "deimos-flattened-group";
  group.add(flattenedMesh);
  return group;
}

function applyTerminatorAndThermalPatch(
  material: THREE.MeshStandardMaterial,
  config: BodyVisualConfig,
): void {
  if (config.id === "sun") {
    return;
  }

  const profile = THERMAL_PROFILES[config.id];
  if (!profile) {
    return;
  }

  if (material.userData.zbkTerminatorPatched === true) {
    return;
  }

  material.userData.zbkTerminatorPatched = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uZbkSunWorldPosition = { value: new THREE.Vector3(0, 0, 0) };
    shader.uniforms.uZbkThermalColor = { value: new THREE.Color(profile.color) };
    shader.uniforms.uZbkThermalStrength = { value: profile.strength };
    shader.uniforms.uZbkTerminatorSoftness = { value: profile.terminatorSoftness };

    shader.vertexShader = `
varying vec3 vZbkWorldPos;
varying vec3 vZbkWorldNormal;
${shader.vertexShader}
`;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
  vZbkWorldPos = worldPosition.xyz;
  vZbkWorldNormal = normalize(mat3(modelMatrix) * transformedNormal);`,
    );

    shader.fragmentShader = `
uniform vec3 uZbkSunWorldPosition;
uniform vec3 uZbkThermalColor;
uniform float uZbkThermalStrength;
uniform float uZbkTerminatorSoftness;
varying vec3 vZbkWorldPos;
varying vec3 vZbkWorldNormal;
${shader.fragmentShader}
`;

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      `vec3 zbkSunDir = normalize(uZbkSunWorldPosition - vZbkWorldPos);
  float zbkNdotL = dot(normalize(vZbkWorldNormal), zbkSunDir);
  float zbkTerminator = smoothstep(-uZbkTerminatorSoftness, 0.28 + uZbkTerminatorSoftness, zbkNdotL);
  outgoingLight *= mix(0.34, 1.08, zbkTerminator);
  outgoingLight += uZbkThermalColor * uZbkThermalStrength * (0.24 + 0.76 * zbkTerminator);
  #include <dithering_fragment>`,
    );
  };

  const cacheKey = [
    "zbk-terminator",
    config.id,
    profile.color.toString(),
    profile.strength.toFixed(4),
    profile.terminatorSoftness.toFixed(4),
  ].join(":");
  material.customProgramCacheKey = () => cacheKey;
  material.needsUpdate = true;
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
        material.color = new THREE.Color("#FFD56D");
        material.emissive = new THREE.Color("#FFCD59");
        material.emissiveIntensity = 0.52;
        material.roughness = 0.78;
        material.metalness = 0;
      } else if (config.id === "mercury") {
        material.color = new THREE.Color("#8E8577");
        material.emissive = new THREE.Color("#000000");
        material.emissiveIntensity = 0;
        material.metalness = 0;
        material.roughness = Math.max(material.roughness, 0.995);
      } else {
        material.emissive = new THREE.Color("#000000");
        material.emissiveIntensity = 0;
      }

      if (config.id === "sun") {
        material.envMapIntensity = 0;
      } else if (config.id === "mercury") {
        material.envMapIntensity = 0.08;
      } else {
        material.envMapIntensity = 1.0;
      }

      applyTerminatorAndThermalPatch(material, config);
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
    emissive: config.id === "sun" ? new THREE.Color("#FFC94A") : new THREE.Color("#000000"),
    emissiveIntensity: config.id === "sun" ? 0.74 : 0,
    roughness: config.id === "sun" ? 0.64 : 0.92,
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
  const loadedVisual = await loadFirstAvailableModel([
    primaryPath,
    config.modelPath1k,
    `/assets/models/${config.id}/${config.id}.glb`,
    `/assets/models/${config.id}/model.glb`,
    `/assets/models/${config.id}/1k.glb`,
  ]);

  if (!loadedVisual) {
    return {
      visual: createFallbackSphere(config),
      loadState: "error",
    };
  }

  let visual = loadedVisual;
  if (config.id === "deimos") {
    const targetMesh = findDeimosTargetMesh(loadedVisual);
    if (targetMesh) {
      const flattened = buildFlattenedDeimosGroup(targetMesh);
      if (flattened) {
        visual = flattened;
      }
    }
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

  if (config.orientationOffsetDeg) {
    const [xDeg, yDeg, zDeg] = config.orientationOffsetDeg;
    visual.rotation.set(degToRad(xDeg), degToRad(yDeg), degToRad(zDeg));
  }

  return { visual, loadState: "loaded" };
}
