import * as THREE from "three";
import type { BodyId } from "../types";

interface RimProfile {
  color: THREE.ColorRepresentation;
  intensity: number;
  power: number;
  scale: number;
}

const RIM_PROFILES: Partial<Record<BodyId, RimProfile>> = {
  mercury: { color: "#9FB5D3", intensity: 0.22, power: 2.8, scale: 1.08 },
  venus: { color: "#FFD8A6", intensity: 0.34, power: 2.5, scale: 1.09 },
  earth: { color: "#6FC6FF", intensity: 0.48, power: 2.4, scale: 1.1 },
  mars: { color: "#FF9E73", intensity: 0.3, power: 2.6, scale: 1.09 },
  moon: { color: "#BFCBDA", intensity: 0.18, power: 2.9, scale: 1.07 },
  phobos: { color: "#C9B79F", intensity: 0.14, power: 3.1, scale: 1.08 },
  deimos: { color: "#D3C1A6", intensity: 0.14, power: 3.1, scale: 1.08 },
};

const RIM_VERTEX_SHADER = `
varying vec3 vWorldNormal;
varying vec3 vViewDirection;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
  vWorldNormal = worldNormal;
  vViewDirection = normalize(cameraPosition - worldPosition.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const RIM_FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uPower;

varying vec3 vWorldNormal;
varying vec3 vViewDirection;

void main() {
  float ndotv = max(dot(normalize(vWorldNormal), normalize(vViewDirection)), 0.0);
  float fresnel = pow(1.0 - ndotv, uPower);
  float alpha = fresnel * uIntensity;
  if (alpha <= 0.001) {
    discard;
  }
  gl_FragColor = vec4(uColor, alpha);
}
`;

export interface AtmosphereRimRuntime {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  dispose: () => void;
}

export function createAtmosphereRim(bodyId: BodyId, radius: number): AtmosphereRimRuntime | null {
  const profile = RIM_PROFILES[bodyId];
  if (!profile) {
    return null;
  }

  const geometry = new THREE.SphereGeometry(radius * profile.scale, 48, 48);
  const material = new THREE.ShaderMaterial({
    vertexShader: RIM_VERTEX_SHADER,
    fragmentShader: RIM_FRAGMENT_SHADER,
    uniforms: {
      uColor: { value: new THREE.Color(profile.color) },
      uIntensity: { value: profile.intensity },
      uPower: { value: profile.power },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.BackSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${bodyId}-atmosphere-rim`;
  mesh.renderOrder = 3;

  return {
    mesh,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

