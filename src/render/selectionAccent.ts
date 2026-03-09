import * as THREE from "three";

const ACCENT_VERTEX_SHADER = `
varying vec3 vWorldNormal;
varying vec3 vViewDirection;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewDirection = normalize(cameraPosition - worldPosition.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const ACCENT_FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform float uPulse;

varying vec3 vWorldNormal;
varying vec3 vViewDirection;

void main() {
  float fresnel = pow(1.0 - max(dot(normalize(vWorldNormal), normalize(vViewDirection)), 0.0), 2.4);
  float alpha = fresnel * (0.24 + uPulse * 0.16);
  if (alpha <= 0.001) {
    discard;
  }
  gl_FragColor = vec4(uColor, alpha);
}
`;

export interface SelectionAccentRuntime {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  setTarget: (position: THREE.Vector3, radius: number) => void;
  clear: () => void;
  update: (deltaSeconds: number) => void;
  dispose: () => void;
}

export function createSelectionAccent(): SelectionAccentRuntime {
  const geometry = new THREE.SphereGeometry(1, 48, 48);
  const material = new THREE.ShaderMaterial({
    vertexShader: ACCENT_VERTEX_SHADER,
    fragmentShader: ACCENT_FRAGMENT_SHADER,
    uniforms: {
      uColor: { value: new THREE.Color("#59C5FF") },
      uPulse: { value: 0.5 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false;
  mesh.renderOrder = 4;

  let time = 0;
  const setTarget = (position: THREE.Vector3, radius: number): void => {
    mesh.visible = true;
    mesh.position.copy(position);
    const scale = Math.max(0.001, radius * 1.42);
    mesh.scale.setScalar(scale);
  };

  const clear = (): void => {
    mesh.visible = false;
  };

  const update = (deltaSeconds: number): void => {
    time += deltaSeconds;
    material.uniforms.uPulse.value = 0.5 + Math.sin(time * 3.5) * 0.5;
  };

  return {
    mesh,
    setTarget,
    clear,
    update,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

