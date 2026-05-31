import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { BodyVisualConfig, ModelLoadState, QualityPreset } from "../types";
import { degToRad } from "../sim/orbitMath";
import { normalizeModelToRadius } from "./modelNormalize";

const loader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();

interface TextureLoadOptions {
  colorSpace?: THREE.ColorSpace;
  anisotropy?: number;
  flipY?: boolean;
}

interface TerminatorProfile {
  softness: number;
  dayGain: number;
  nightFloor: number;
  twilightBoost: number;
  twilightColor: THREE.ColorRepresentation;
}

const TERMINATOR_PROFILES: Partial<Record<BodyVisualConfig["id"], TerminatorProfile>> = {
  earth: {
    softness: 0.18,
    dayGain: 1.14,
    nightFloor: 0.07,
    twilightBoost: 0.16,
    twilightColor: "#7EA9D1",
  },
};

export interface BodyVisualResult {
  visual: THREE.Object3D;
  loadState: ModelLoadState;
}

interface BodyPbrTextures {
  albedo: THREE.Texture | null;
  normal: THREE.Texture | null;
  roughness: THREE.Texture | null;
  metalness: THREE.Texture | null;
  specular: THREE.Texture | null;
}

const pbrTextureCache = new Map<BodyVisualConfig["id"], Promise<BodyPbrTextures>>();

function loadTexture(path: string, options: TextureLoadOptions = {}): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    textureLoader.load(
      path,
      (texture) => {
        texture.colorSpace = options.colorSpace ?? THREE.SRGBColorSpace;
        texture.anisotropy = options.anisotropy ?? 4;
        texture.flipY = options.flipY ?? false;
        resolve(texture);
      },
      undefined,
      reject,
    );
  });
}

async function loadOptionalTexture(
  paths: string[],
  options: TextureLoadOptions = {},
): Promise<THREE.Texture | null> {
  const uniquePaths = [...new Set(paths)];
  for (const path of uniquePaths) {
    try {
      return await loadTexture(path, options);
    } catch {
      continue;
    }
  }
  return null;
}

function buildTextureCandidates(bodyId: BodyVisualConfig["id"], labels: string[]): string[] {
  const extensions = ["jpg", "png", "webp"];
  const candidates: string[] = [];
  for (const label of labels) {
    for (const ext of extensions) {
      candidates.push(`/assets/textures/${bodyId}/${label}.${ext}`);
    }
  }
  return candidates;
}

function getOrCreateBodyPbrTextures(bodyId: BodyVisualConfig["id"]): Promise<BodyPbrTextures> {
  const cached = pbrTextureCache.get(bodyId);
  if (cached) {
    return cached;
  }

  const loading = Promise.all([
    loadOptionalTexture(
      buildTextureCandidates(bodyId, [
        `${bodyId}_albedo_2k`,
        `${bodyId}_albedo`,
        `${bodyId}_basecolor_2k`,
        `${bodyId}_basecolor`,
        "albedo_2k",
        "albedo",
      ]),
      { colorSpace: THREE.SRGBColorSpace, flipY: false },
    ),
    loadOptionalTexture(
      buildTextureCandidates(bodyId, [
        `${bodyId}_normal_2k`,
        `${bodyId}_normal`,
        "normal_2k",
        "normal",
      ]),
      { colorSpace: THREE.NoColorSpace, flipY: false },
    ),
    loadOptionalTexture(
      buildTextureCandidates(bodyId, [
        `${bodyId}_roughness_2k`,
        `${bodyId}_roughness`,
        "roughness_2k",
        "roughness",
      ]),
      { colorSpace: THREE.NoColorSpace, flipY: false },
    ),
    loadOptionalTexture(
      buildTextureCandidates(bodyId, [
        `${bodyId}_metalness_2k`,
        `${bodyId}_metalness`,
        "metalness_2k",
        "metalness",
      ]),
      { colorSpace: THREE.NoColorSpace, flipY: false },
    ),
    loadOptionalTexture(
      buildTextureCandidates(bodyId, [
        `${bodyId}_specular_2k`,
        `${bodyId}_specular`,
        "specular_2k",
        "specular",
      ]),
      { colorSpace: THREE.NoColorSpace, flipY: false },
    ),
  ]).then(([albedo, normal, roughness, metalness, specular]) => ({
    albedo,
    normal,
    roughness,
    metalness,
    specular,
  }));

  pbrTextureCache.set(bodyId, loading);
  return loading;
}

function createProceduralEarthCloudTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to create cloud texture context.");
  }

  context.clearRect(0, 0, size, size);
  context.fillStyle = "#000";
  context.fillRect(0, 0, size, size);

  for (let i = 0; i < 2000; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = Math.random() * 12 + 2;
    const alpha = Math.random() * 0.22;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(3)})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

async function createEarthCloudLayer(config: BodyVisualConfig): Promise<THREE.Mesh> {
  const cloudMap =
    (await loadOptionalTexture(
      [
        "/assets/textures/earth/earth_clouds_2k.jpg",
        "/assets/textures/earth/clouds_2k.jpg",
        "/assets/textures/earth/clouds.jpg",
        "/assets/textures/earth/earth_clouds.png",
      ],
      {
        colorSpace: THREE.SRGBColorSpace,
        flipY: false,
      },
    )) ?? createProceduralEarthCloudTexture();

  const cloudMaterial = new THREE.MeshStandardMaterial({
    map: cloudMap,
    alphaMap: cloudMap,
    color: new THREE.Color("#EAF6FF"),
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    roughness: 1.0,
    metalness: 0.0,
    emissive: new THREE.Color("#1A2A35"),
    emissiveIntensity: 0.03,
  });

  const cloudGeometry = new THREE.SphereGeometry(config.visualRadius * 1.007, 72, 72);
  const cloudLayer = new THREE.Mesh(cloudGeometry, cloudMaterial);
  cloudLayer.name = "earth-cloud-layer";
  cloudLayer.castShadow = false;
  cloudLayer.receiveShadow = false;
  cloudLayer.renderOrder = 2;
  return cloudLayer;
}

async function applyEarthNightLights(visual: THREE.Object3D): Promise<void> {
  const nightMap = await loadOptionalTexture(
    [
      "/assets/textures/earth/earth_night_lights_2k.jpg",
      "/assets/textures/earth/night_lights_2k.jpg",
      "/assets/textures/earth/night_lights.jpg",
      "/assets/textures/earth/earth_night_lights.png",
    ],
    {
      colorSpace: THREE.SRGBColorSpace,
      flipY: false,
    },
  );

  if (!nightMap) {
    return;
  }

  visual.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    const applyNightMap = (material: THREE.Material): void => {
      if (!(material instanceof THREE.MeshStandardMaterial) || material.emissiveMap) {
        return;
      }
      material.emissiveMap = nightMap;
      material.emissive = new THREE.Color("#C3DAFF");
      material.emissiveIntensity = 0.58;
      material.needsUpdate = true;
    };

    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(applyNightMap);
    } else {
      applyNightMap(mesh.material);
    }
  });
}

function applyBodyPbrTextures(
  visual: THREE.Object3D,
  config: BodyVisualConfig,
  textureSet: BodyPbrTextures,
): void {
  if (
    !textureSet.albedo &&
    !textureSet.normal &&
    !textureSet.roughness &&
    !textureSet.metalness &&
    !textureSet.specular
  ) {
    return;
  }

  visual.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    const applyToMaterial = (material: THREE.Material): void => {
      if (!(material instanceof THREE.MeshStandardMaterial)) {
        return;
      }

      if (!material.map && textureSet.albedo) {
        material.map = textureSet.albedo;
      }
      if (!material.normalMap && textureSet.normal) {
        material.normalMap = textureSet.normal;
      }
      if (!material.roughnessMap && textureSet.roughness) {
        material.roughnessMap = textureSet.roughness;
      }
      if (!material.metalnessMap && textureSet.metalness) {
        material.metalnessMap = textureSet.metalness;
      }

      if (textureSet.specular) {
        const physicalLike = material as THREE.MeshPhysicalMaterial & {
          specularIntensityMap?: THREE.Texture | null;
          specularIntensity?: number;
        };
        if ("specularIntensityMap" in physicalLike) {
          physicalLike.specularIntensityMap = textureSet.specular;
          physicalLike.specularIntensity = Math.max(physicalLike.specularIntensity ?? 0.35, 0.35);
        } else {
          material.envMapIntensity = Math.max(material.envMapIntensity, 0.35);
        }
      }

      if (config.id === "earth" && material.map) {
        material.normalScale.set(0.85, 0.85);
      }

      material.needsUpdate = true;
    };

    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(applyToMaterial);
    } else {
      applyToMaterial(mesh.material);
    }
  });
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

function applyTerminatorPatch(
  material: THREE.MeshStandardMaterial,
  config: BodyVisualConfig,
): void {
  if (config.id === "sun") {
    return;
  }

  const profile = TERMINATOR_PROFILES[config.id];
  if (!profile || material.userData.zbkTerminatorPatched === true) {
    return;
  }

  material.userData.zbkTerminatorPatched = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uZbkSunWorldPosition = { value: new THREE.Vector3(0, 0, 0) };
    shader.uniforms.uZbkSoftness = { value: profile.softness };
    shader.uniforms.uZbkDayGain = { value: profile.dayGain };
    shader.uniforms.uZbkNightFloor = { value: profile.nightFloor };
    shader.uniforms.uZbkTwilightBoost = { value: profile.twilightBoost };
    shader.uniforms.uZbkTwilightColor = { value: new THREE.Color(profile.twilightColor) };

    shader.vertexShader = `
varying vec3 vZbkWorldPosition;
varying vec3 vZbkWorldNormal;
${shader.vertexShader}
`;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
  vec4 zbkWorldPos = modelMatrix * vec4(transformed, 1.0);
  vZbkWorldPosition = zbkWorldPos.xyz;
  vZbkWorldNormal = normalize(mat3(modelMatrix) * transformedNormal);`,
    );

    shader.fragmentShader = `
uniform vec3 uZbkSunWorldPosition;
uniform float uZbkSoftness;
uniform float uZbkDayGain;
uniform float uZbkNightFloor;
uniform float uZbkTwilightBoost;
uniform vec3 uZbkTwilightColor;
varying vec3 vZbkWorldPosition;
varying vec3 vZbkWorldNormal;
${shader.fragmentShader}
`;

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      `vec3 zbkSunDir = normalize(uZbkSunWorldPosition - vZbkWorldPosition);
  float zbkNdotL = dot(normalize(vZbkWorldNormal), zbkSunDir);
  float zbkDayFactor = smoothstep(-uZbkSoftness, uZbkSoftness, zbkNdotL);
  float zbkTwilight = exp(-pow(zbkNdotL / max(uZbkSoftness * 1.2, 0.0001), 2.0));
  float zbkShade = mix(uZbkNightFloor, uZbkDayGain, zbkDayFactor);
  outgoingLight *= zbkShade;
  outgoingLight += uZbkTwilightColor * (zbkTwilight * uZbkTwilightBoost * (0.22 + 0.78 * zbkDayFactor));
  #include <dithering_fragment>`,
    );
  };

  const cacheKey = [
    "zbk-terminator",
    config.id,
    profile.softness.toFixed(4),
    profile.dayGain.toFixed(4),
    profile.nightFloor.toFixed(4),
    profile.twilightBoost.toFixed(4),
    profile.twilightColor.toString(),
  ].join(":");
  material.customProgramCacheKey = () => cacheKey;
  material.needsUpdate = true;
}

function tuneMeshMaterial(mesh: THREE.Mesh, config: BodyVisualConfig): void {
  const applyTuning = (material: THREE.Material): void => {
    if (!(material instanceof THREE.MeshStandardMaterial)) {
      return;
    }

    material.color = material.map ? new THREE.Color("#FFFFFF") : new THREE.Color(config.color);
    material.roughness = config.id === "sun" ? 0.74 : Math.min(material.roughness, 0.95);
    material.metalness = config.id === "sun" ? 0.0 : Math.min(material.metalness, 0.12);
    material.envMapIntensity = config.id === "sun" ? 0 : 0.8;

    if (config.id === "sun") {
      material.color = new THREE.Color("#FFD56D");
      material.emissive = new THREE.Color("#FFCD59");
      material.emissiveIntensity = 1.08;
    } else if (material.emissiveMap) {
      material.emissive = new THREE.Color("#FFFFFF");
      material.emissiveIntensity = 1.06;
    } else {
      material.emissive = new THREE.Color("#000000");
      material.emissiveIntensity = 0;
    }

    applyTerminatorPatch(material, config);
    material.needsUpdate = true;
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

    const isSun = config.id === "sun";
    mesh.castShadow = !isSun;
    mesh.receiveShadow = !isSun;
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
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = config.id !== "sun";
  mesh.receiveShadow = config.id !== "sun";
  tuneMeshMaterial(mesh, config);
  return mesh;
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

  if (!containsMesh(loadedVisual)) {
    return {
      visual: createFallbackSphere(config),
      loadState: "fallback",
    };
  }

  const pbrTextures = await getOrCreateBodyPbrTextures(config.id);
  applyBodyPbrTextures(loadedVisual, config, pbrTextures);
  applyVisualTuning(loadedVisual, config);
  normalizeModelToRadius(loadedVisual, config.visualRadius);

  if (config.modelScaleMultiplier && config.modelScaleMultiplier > 0) {
    loadedVisual.scale.multiplyScalar(config.modelScaleMultiplier);
  }

  if (config.id === "earth") {
    await applyEarthNightLights(loadedVisual);
    const cloudLayer = await createEarthCloudLayer(config);
    loadedVisual.add(cloudLayer);
  }

  if (config.orientationOffsetDeg) {
    const [xDeg, yDeg, zDeg] = config.orientationOffsetDeg;
    loadedVisual.rotation.set(degToRad(xDeg), degToRad(yDeg), degToRad(zDeg));
  }

  return { visual: loadedVisual, loadState: "loaded" };
}
