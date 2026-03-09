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
uniform float uDitherStrength;
varying vec3 vColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float radius = length(uv);
  if (radius > 1.0) {
    discard;
  }

  float softEdge = 1.0 - smoothstep(0.62, 1.0, radius);
  float coreGlow = 1.0 - smoothstep(0.0, 0.38, radius);
  float alpha = (softEdge * 0.76 + coreGlow * 0.24) * uOpacity;

  float dither = (hash12(gl_FragCoord.xy) - 0.5) * uDitherStrength;
  alpha *= (1.0 + dither);

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

interface NebulaLayerConfig {
  count: number;
  minRadius: number;
  maxRadius: number;
  minScale: number;
  maxScale: number;
  opacity: number;
  hueBase: number;
  hueSpread: number;
  parallaxFactor: number;
  rotY: number;
  rotX: number;
}

interface NebulaLayerRuntime {
  group: THREE.Group;
  parallaxFactor: number;
  rotY: number;
  rotX: number;
  materials: THREE.SpriteMaterial[];
  texture: THREE.CanvasTexture;
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
      uDitherStrength: { value: 0.08 },
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

function createNebulaTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to create nebula texture canvas context.");
  }

  context.clearRect(0, 0, size, size);
  const gradient = context.createRadialGradient(
    size * 0.5,
    size * 0.5,
    size * 0.08,
    size * 0.5,
    size * 0.5,
    size * 0.5,
  );
  gradient.addColorStop(0, "rgba(255,255,255,0.65)");
  gradient.addColorStop(0.35, "rgba(200,220,255,0.28)");
  gradient.addColorStop(1, "rgba(30,40,70,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  for (let i = 0; i < 260; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 1.6 + 0.25;
    const alpha = Math.random() * 0.075;
    context.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createNebulaLayer(config: NebulaLayerConfig): NebulaLayerRuntime {
  const texture = createNebulaTexture();
  const group = new THREE.Group();
  group.name = "nebula-layer";

  const materials: THREE.SpriteMaterial[] = [];

  for (let index = 0; index < config.count; index += 1) {
    const radialBlend = Math.pow(Math.random(), 0.45);
    const radius = config.minRadius + radialBlend * (config.maxRadius - config.minRadius);
    const position = randomSphericalPoint(radius);
    const scale = config.minScale + Math.random() * (config.maxScale - config.minScale);
    const hue = config.hueBase + (Math.random() - 0.5) * config.hueSpread;
    const saturation = 0.4 + Math.random() * 0.26;
    const lightness = 0.44 + Math.random() * 0.26;

    const material = new THREE.SpriteMaterial({
      map: texture,
      color: new THREE.Color().setHSL(hue, saturation, lightness),
      transparent: true,
      opacity: config.opacity * (0.82 + Math.random() * 0.28),
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    materials.push(material);

    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(scale, scale * (0.6 + Math.random() * 0.7), 1);
    sprite.material.rotation = Math.random() * Math.PI * 2;
    group.add(sprite);
  }

  return {
    group,
    parallaxFactor: config.parallaxFactor,
    rotY: config.rotY,
    rotX: config.rotX,
    materials,
    texture,
  };
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

  const nebulaFar = createNebulaLayer({
    count: 8,
    minRadius: 1_200,
    maxRadius: 2_600,
    minScale: 260,
    maxScale: 480,
    opacity: 0.2,
    hueBase: 0.62,
    hueSpread: 0.16,
    parallaxFactor: 0.16,
    rotY: 0.0012,
    rotX: 0.00042,
  });

  const nebulaNear = createNebulaLayer({
    count: 6,
    minRadius: 680,
    maxRadius: 1_420,
    minScale: 170,
    maxScale: 320,
    opacity: 0.22,
    hueBase: 0.56,
    hueSpread: 0.18,
    parallaxFactor: 0.34,
    rotY: -0.0016,
    rotX: 0.0007,
  });

  root.add(nebulaFar.group, nebulaNear.group, farLayer, nearLayer);

  let time = 0;
  const update = (deltaSeconds: number, cameraPosition: THREE.Vector3): void => {
    const stableDelta = Math.min(deltaSeconds, 1 / 30);
    time += stableDelta;

    farLayer.rotation.y = time * 0.00055;
    farLayer.rotation.x = time * 0.00014;
    nearLayer.rotation.y = -time * 0.0011;
    nearLayer.rotation.x = time * 0.00033;

    nebulaFar.group.position.copy(cameraPosition).multiplyScalar(nebulaFar.parallaxFactor);
    nebulaNear.group.position.copy(cameraPosition).multiplyScalar(nebulaNear.parallaxFactor);
    nebulaFar.group.rotation.y = time * nebulaFar.rotY;
    nebulaFar.group.rotation.x = time * nebulaFar.rotX;
    nebulaNear.group.rotation.y = time * nebulaNear.rotY;
    nebulaNear.group.rotation.x = time * nebulaNear.rotX;

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

    for (const nebulaLayer of [nebulaFar, nebulaNear]) {
      nebulaLayer.materials.forEach((material) => material.dispose());
      nebulaLayer.texture.dispose();
    }
  };

  return { root, update, dispose };
}

