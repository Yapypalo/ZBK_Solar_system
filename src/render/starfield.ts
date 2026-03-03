import * as THREE from "three";

const STARFIELD_VERTEX_SHADER = `
attribute float starSize;
varying vec3 vColor;

void main() {
  vColor = color;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = starSize;
}
`;

const STARFIELD_FRAGMENT_SHADER = `
uniform float uOpacity;
varying vec3 vColor;

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float radius = length(uv);
  if (radius > 1.0) {
    discard;
  }

  float softEdge = 1.0 - smoothstep(0.62, 1.0, radius);
  float coreGlow = 1.0 - smoothstep(0.0, 0.38, radius);
  float alpha = (softEdge * 0.76 + coreGlow * 0.24) * uOpacity;

  gl_FragColor = vec4(vColor, alpha);
}
`;

interface StarLayerConfig {
  count: number;
  minRadius: number;
  maxRadius: number;
  minSize: number;
  maxSize: number;
  opacity: number;
  hueOffset: number;
}

export interface StarfieldRuntime {
  root: THREE.Group;
  update: (deltaSeconds: number, cameraPosition: THREE.Vector3) => void;
  dispose: () => void;
}

function randomSphericalPoint(radius: number): THREE.Vector3 {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const sinPhi = Math.sin(phi);

  return new THREE.Vector3(
    radius * sinPhi * Math.cos(theta),
    radius * Math.cos(phi),
    radius * sinPhi * Math.sin(theta),
  );
}

function createStarLayer(config: StarLayerConfig): THREE.Points {
  const positions = new Float32Array(config.count * 3);
  const colors = new Float32Array(config.count * 3);
  const sizes = new Float32Array(config.count);

  for (let i = 0; i < config.count; i += 1) {
    const radialBlend = Math.pow(Math.random(), 0.38);
    const radius = config.minRadius + radialBlend * (config.maxRadius - config.minRadius);
    const point = randomSphericalPoint(radius);

    const positionIndex = i * 3;
    positions[positionIndex] = point.x;
    positions[positionIndex + 1] = point.y;
    positions[positionIndex + 2] = point.z;

    const warmBlend = Math.random();
    const starColor = new THREE.Color().setHSL(
      0.56 - warmBlend * 0.08 + config.hueOffset,
      0.18 + warmBlend * 0.2,
      0.7 + Math.random() * 0.25,
    );
    colors[positionIndex] = starColor.r;
    colors[positionIndex + 1] = starColor.g;
    colors[positionIndex + 2] = starColor.b;

    const sizeBlend = Math.pow(Math.random(), 1.7);
    sizes[i] = config.minSize + sizeBlend * (config.maxSize - config.minSize);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("starSize", new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: STARFIELD_VERTEX_SHADER,
    fragmentShader: STARFIELD_FRAGMENT_SHADER,
    uniforms: {
      uOpacity: { value: config.opacity },
    },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });

  const stars = new THREE.Points(geometry, material);
  stars.frustumCulled = false;
  return stars;
}

export function createStarfieldRuntime(): StarfieldRuntime {
  const root = new THREE.Group();
  root.name = "starfield-root";

  const farLayer = createStarLayer({
    count: 4_800,
    minRadius: 1_500,
    maxRadius: 4_200,
    minSize: 1.0,
    maxSize: 2.2,
    opacity: 0.8,
    hueOffset: -0.01,
  });
  farLayer.name = "starfield-far";

  const nearLayer = createStarLayer({
    count: 1_700,
    minRadius: 700,
    maxRadius: 1_600,
    minSize: 1.6,
    maxSize: 3.2,
    opacity: 0.56,
    hueOffset: 0.02,
  });
  nearLayer.name = "starfield-near";

  root.add(farLayer);
  root.add(nearLayer);

  let time = 0;
  const update = (deltaSeconds: number, cameraPosition: THREE.Vector3): void => {
    const stableDelta = Math.min(deltaSeconds, 1 / 30);
    time += stableDelta;

    farLayer.rotation.y = time * 0.00055;
    farLayer.rotation.x = time * 0.00014;
    nearLayer.rotation.y = -time * 0.0011;
    nearLayer.rotation.x = time * 0.00033;

    root.position.copy(cameraPosition);
  };

  const dispose = (): void => {
    for (const layer of [farLayer, nearLayer]) {
      layer.geometry.dispose();
      if (Array.isArray(layer.material)) {
        layer.material.forEach((material) => material.dispose());
      } else {
        layer.material.dispose();
      }
    }
  };

  return { root, update, dispose };
}
