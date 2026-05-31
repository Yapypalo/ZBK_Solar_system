import * as THREE from "three";
import type { BodyId } from "../types";

interface AtmosphereLayerProfile {
  scale: number;
  rayleighColor: THREE.ColorRepresentation;
  mieColor: THREE.ColorRepresentation;
  twilightColor: THREE.ColorRepresentation;
  nightColor: THREE.ColorRepresentation;
  blendMode?: "additive" | "normal";
  rayleighStrength: number;
  mieStrength: number;
  mieG: number;
  twilightStrength: number;
  densityFalloff: number;
  twilightWidth: number;
  opacity: number;
}

interface AtmosphereProfile {
  layers: AtmosphereLayerProfile[];
}

const ATMOSPHERE_PROFILES: Partial<Record<BodyId, AtmosphereProfile>> = {
  earth: {
    layers: [
      {
        scale: 0.85,
        rayleighColor: "#5FD8FF",
        mieColor: "#A8DEFF",
        twilightColor: "#FFC39A",
        nightColor: "#1A3E68",
        blendMode: "normal",
        rayleighStrength: 0.52,
        mieStrength: 0.07,
        mieG: 0.64,
        twilightStrength: 0.28,
        densityFalloff: 5.1,
        twilightWidth: 0.24,
        opacity: 0.28,
      },
      {
        scale: 0.89,
        rayleighColor: "#7BE7FF",
        mieColor: "#C2EEFF",
        twilightColor: "#FFD2A9",
        nightColor: "#12345A",
        blendMode: "additive",
        rayleighStrength: 0.32,
        mieStrength: 0.06,
        mieG: 0.74,
        twilightStrength: 0.2,
        densityFalloff: 7.9,
        twilightWidth: 0.26,
        opacity: 0.12,
      },
    ],
  },
};

const ATMOSPHERE_VERTEX_SHADER = `
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec3 vViewDirection;
varying vec3 vBodyCenter;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewDirection = normalize(cameraPosition - worldPosition.xyz);
  vBodyCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const ATMOSPHERE_FRAGMENT_SHADER = `
uniform vec3 uSunWorldPosition;
uniform vec3 uRayleighColor;
uniform vec3 uMieColor;
uniform vec3 uTwilightColor;
uniform vec3 uNightColor;
uniform float uPlanetRadius;
uniform float uAtmosphereHeight;
uniform float uRayleighStrength;
uniform float uMieStrength;
uniform float uMieG;
uniform float uTwilightStrength;
uniform float uDensityFalloff;
uniform float uTwilightWidth;
uniform float uOpacity;

varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec3 vViewDirection;
varying vec3 vBodyCenter;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(vViewDirection);
  vec3 L = normalize(uSunWorldPosition - vWorldPosition);

  float ndotv = clamp(dot(N, V), 0.0, 1.0);
  float ndotl = clamp(dot(N, L), -1.0, 1.0);
  float vdotl = clamp(dot(V, L), -1.0, 1.0);

  float horizon = pow(1.0 - ndotv, 1.35);
  float geometricLimb = pow(horizon, 1.08);
  float dayFactor = smoothstep(-0.25, 0.35, ndotl);
  float sunVisibility = clamp(ndotl * 0.5 + 0.5, 0.0, 1.0);
  float twilight = exp(-pow(ndotl / max(uTwilightWidth, 0.0001), 2.0));

  float altitude = max(length(vWorldPosition - vBodyCenter) - uPlanetRadius, 0.0);
  float normalizedAltitude = altitude / max(uAtmosphereHeight, 0.0001);
  float density = exp(-normalizedAltitude * uDensityFalloff);
  density = max(density, 0.34);

  float rayleighPhase = 0.75 * (1.0 + vdotl * vdotl);
  float rayleighScatter = geometricLimb * density * uRayleighStrength * rayleighPhase;
  rayleighScatter *= (0.38 + sunVisibility * 0.62);

  float g = clamp(uMieG, -0.95, 0.95);
  float mieDenom = max(1.0 + g * g - 2.0 * g * vdotl, 0.001);
  float miePhase = (1.0 - g * g) / pow(mieDenom, 1.5);
  float mieScatter = geometricLimb * sqrt(max(density, 0.0)) * uMieStrength * miePhase * 0.14;
  mieScatter *= (0.08 + sunVisibility * 0.92);

  // Keep a continuous atmosphere ring around the whole limb, not only near terminator.
  float baseLimb = geometricLimb * pow(max(density, 0.0), 0.82) * (0.18 + uRayleighStrength * 0.14);
  float dayLimb = baseLimb * (0.62 + 0.38 * sunVisibility);
  float nightLimb = baseLimb * (0.22 + 0.24 * (1.0 - sunVisibility));

  float ambientHaze = geometricLimb * pow(max(density, 0.0), 0.8) * uRayleighStrength;
  ambientHaze *= (0.06 + sunVisibility * 0.04);

  vec3 baseColor = mix(uNightColor, uRayleighColor, dayFactor);
  vec3 twilightBandColor = mix(uTwilightColor, uMieColor, 0.35 + dayFactor * 0.65);

  float twilightBand = twilight * pow(geometricLimb, 0.92) * uTwilightStrength * 0.54;
  vec3 color = baseColor * (rayleighScatter + mieScatter * 0.45);
  color += mix(uNightColor, uRayleighColor, sunVisibility) * dayLimb;
  color += uNightColor * nightLimb * 0.75;
  color += mix(uNightColor, uRayleighColor, sunVisibility) * ambientHaze;
  color += twilightBandColor * twilightBand;

  float alpha = clamp(
    rayleighScatter * 0.75 +
    mieScatter * 0.85 +
    dayLimb +
    nightLimb +
    ambientHaze +
    twilightBand * 0.48,
    0.0,
    1.0
  );
  alpha *= uOpacity;
  if (alpha <= 0.001) {
    discard;
  }

  gl_FragColor = vec4(color, alpha);
}
`;

export interface AtmosphereRimRuntime {
  root: THREE.Object3D;
  dispose: () => void;
}

function createAtmosphereLayer(
  radius: number,
  profile: AtmosphereLayerProfile,
): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.SphereGeometry(radius * profile.scale, 48, 48);
  const atmosphereHeight = Math.max(radius * (profile.scale - 1), radius * 0.004);
  const useAdditive = (profile.blendMode ?? "additive") === "additive";
  const material = new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERTEX_SHADER,
    fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
    uniforms: {
      uSunWorldPosition: { value: new THREE.Vector3(0, 0, 0) },
      uRayleighColor: { value: new THREE.Color(profile.rayleighColor) },
      uMieColor: { value: new THREE.Color(profile.mieColor) },
      uTwilightColor: { value: new THREE.Color(profile.twilightColor) },
      uNightColor: { value: new THREE.Color(profile.nightColor) },
      uPlanetRadius: { value: radius },
      uAtmosphereHeight: { value: atmosphereHeight },
      uRayleighStrength: { value: profile.rayleighStrength },
      uMieStrength: { value: profile.mieStrength },
      uMieG: { value: profile.mieG },
      uTwilightStrength: { value: profile.twilightStrength },
      uDensityFalloff: { value: profile.densityFalloff },
      uTwilightWidth: { value: profile.twilightWidth },
      uOpacity: { value: profile.opacity },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: useAdditive ? THREE.AdditiveBlending : THREE.NormalBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  const layer = new THREE.Mesh(geometry, material);
  layer.frustumCulled = false;
  return layer;
}

export function createAtmosphereRim(bodyId: BodyId, radius: number): AtmosphereRimRuntime | null {
  const profile = ATMOSPHERE_PROFILES[bodyId];
  if (!profile || profile.layers.length === 0) {
    return null;
  }

  const root = new THREE.Group();
  root.name = `${bodyId}-atmosphere-layered`;
  const layers: Array<THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>> = [];

  profile.layers.forEach((layerProfile, layerIndex) => {
    const layer = createAtmosphereLayer(radius, layerProfile);
    layer.name = `${bodyId}-atmosphere-layer-${layerIndex}`;
    layer.renderOrder = 3 + layerIndex;
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
