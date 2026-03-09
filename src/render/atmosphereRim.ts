import * as THREE from "three";
import type { BodyId } from "../types";

interface RimLayerProfile {
  dayColor: THREE.ColorRepresentation;
  twilightColor: THREE.ColorRepresentation;
  nightColor: THREE.ColorRepresentation;
  scale: number;
  rimPower: number;
  dayIntensity: number;
  twilightIntensity: number;
  nightIntensity: number;
  twilightWidth: number;
  miePower: number;
  mieStrength: number;
}

interface RimProfile {
  layers: RimLayerProfile[];
}

const RIM_PROFILES: Partial<Record<BodyId, RimProfile>> = {
  mercury: {
    layers: [
      {
        dayColor: "#B7C7D8",
        twilightColor: "#D9B28A",
        nightColor: "#6F7B88",
        scale: 1.02,
        rimPower: 3.3,
        dayIntensity: 0.07,
        twilightIntensity: 0.05,
        nightIntensity: 0.008,
        twilightWidth: 0.11,
        miePower: 6.5,
        mieStrength: 0.018,
      },
    ],
  },
  venus: {
    layers: [
      {
        dayColor: "#FFE8BE",
        twilightColor: "#FFBE82",
        nightColor: "#8A7A61",
        scale: 1.082,
        rimPower: 2.35,
        dayIntensity: 0.48,
        twilightIntensity: 0.4,
        nightIntensity: 0.07,
        twilightWidth: 0.23,
        miePower: 2.5,
        mieStrength: 0.2,
      },
    ],
  },
  earth: {
    layers: [
      // Основной Rayleigh-слой
      {
        dayColor: "#7FD7FF",
        twilightColor: "#FFAA70",
        nightColor: "#274E71",
        scale: 0.85,
        rimPower: 1.95,
        dayIntensity: 0.29,
        twilightIntensity: 0.16,
        nightIntensity: 0.012,
        twilightWidth: 0.165,
        miePower: 3.6,
        mieStrength: 0.06,
      },
      // Верхний мягкий haze для глубины атмосферы
      {
        dayColor: "#CFEFFF",
        twilightColor: "#FFD1A6",
        nightColor: "#10243A",
        scale: 0.9,
        rimPower: 3.6,
        dayIntensity: 0.045,
        twilightIntensity: 0.05,
        nightIntensity: 0.0015,
        twilightWidth: 0.14,
        miePower: 2.9,
        mieStrength: 0.032,
      },
    ],
  },
  mars: {
    layers: [
      {
        dayColor: "#FFB998",
        twilightColor: "#FF9467",
        nightColor: "#5D433D",
        scale: 1.02,
        rimPower: 30.1,
        dayIntensity: 0.83,
        twilightIntensity: 0.25,
        nightIntensity: 0.02,
        twilightWidth: 0.15,
        miePower: 6.1,
        mieStrength: 1.08,
      },
    ],
  },
};

const RIM_VERTEX_SHADER = `
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec3 vViewDirection;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewDirection = normalize(cameraPosition - worldPosition.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const RIM_FRAGMENT_SHADER = `
uniform vec3 uSunWorldPosition;
uniform vec3 uDayColor;
uniform vec3 uTwilightColor;
uniform vec3 uNightColor;
uniform float uRimPower;
uniform float uDayIntensity;
uniform float uTwilightIntensity;
uniform float uNightIntensity;
uniform float uTwilightWidth;
uniform float uMiePower;
uniform float uMieStrength;

varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec3 vViewDirection;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(vViewDirection);
  vec3 L = normalize(uSunWorldPosition - vWorldPosition);

  float ndotv = clamp(dot(N, V), 0.0, 1.0);
  float ndotl = clamp(dot(N, L), -1.0, 1.0);

  float rim = pow(1.0 - ndotv, uRimPower);
  float dayFactor = smoothstep(-0.1, 0.34, ndotl);
  float twilight = exp(-pow(ndotl / max(uTwilightWidth, 0.0001), 2.0));

  float viewSun = clamp(dot(V, L), 0.0, 1.0);
  float mie = pow(viewSun, uMiePower) * uMieStrength;

  float intensity = rim * (
    uNightIntensity +
    dayFactor * uDayIntensity +
    twilight * uTwilightIntensity
  );
  intensity *= (1.0 + mie);

  vec3 baseColor = mix(uNightColor, uDayColor, dayFactor);
  float twilightMix = clamp(twilight * (0.78 + 0.22 * dayFactor), 0.0, 1.0);
  vec3 finalColor = mix(baseColor, uTwilightColor, twilightMix);

  float alpha = clamp(intensity, 0.0, 1.0);
  if (alpha <= 0.001) {
    discard;
  }

  gl_FragColor = vec4(finalColor, alpha);
}
`;

export interface AtmosphereRimRuntime {
  root: THREE.Object3D;
  dispose: () => void;
}

function createRimLayer(radius: number, profile: RimLayerProfile): THREE.Mesh<
  THREE.SphereGeometry,
  THREE.ShaderMaterial
> {
  const geometry = new THREE.SphereGeometry(radius * profile.scale, 56, 56);
  const material = new THREE.ShaderMaterial({
    vertexShader: RIM_VERTEX_SHADER,
    fragmentShader: RIM_FRAGMENT_SHADER,
    uniforms: {
      uSunWorldPosition: { value: new THREE.Vector3(0, 0, 0) },
      uDayColor: { value: new THREE.Color(profile.dayColor) },
      uTwilightColor: { value: new THREE.Color(profile.twilightColor) },
      uNightColor: { value: new THREE.Color(profile.nightColor) },
      uRimPower: { value: profile.rimPower },
      uDayIntensity: { value: profile.dayIntensity },
      uTwilightIntensity: { value: profile.twilightIntensity },
      uNightIntensity: { value: profile.nightIntensity },
      uTwilightWidth: { value: profile.twilightWidth },
      uMiePower: { value: profile.miePower },
      uMieStrength: { value: profile.mieStrength },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.BackSide,
  });

  return new THREE.Mesh(geometry, material);
}

export function createAtmosphereRim(bodyId: BodyId, radius: number): AtmosphereRimRuntime | null {
  const profile = RIM_PROFILES[bodyId];
  if (!profile || profile.layers.length === 0) {
    return null;
  }

  const root = new THREE.Group();
  root.name = `${bodyId}-atmosphere-rim`;

  const layers: Array<THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>> = [];
  profile.layers.forEach((layerProfile, index) => {
    const layer = createRimLayer(radius, layerProfile);
    layer.renderOrder = 3 + index;
    root.add(layer);
    layers.push(layer);
  });

  return {
    root,
    dispose: () => {
      layers.forEach((layer) => {
        layer.geometry.dispose();
        layer.material.dispose();
      });
    },
  };
}
