import * as THREE from "three";

const STAR_VERTEX_SHADER = `
attribute float starSize;
varying vec3 vColor;

void main() {
  vColor = color;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = starSize;
}
`;

const STAR_FRAGMENT_SHADER = `
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

export function createStarfield(
  count = 7_000,
  minRadius = 800,
  maxRadius = 3_400,
): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const radialBlend = Math.pow(Math.random(), 0.38);
    const radius = minRadius + radialBlend * (maxRadius - minRadius);
    const point = randomSphericalPoint(radius);

    const positionIndex = i * 3;
    positions[positionIndex] = point.x;
    positions[positionIndex + 1] = point.y;
    positions[positionIndex + 2] = point.z;

    const warmBlend = Math.random();
    const starColor = new THREE.Color().setHSL(
      0.56 - warmBlend * 0.08,
      0.18 + warmBlend * 0.2,
      0.7 + Math.random() * 0.25,
    );
    colors[positionIndex] = starColor.r;
    colors[positionIndex + 1] = starColor.g;
    colors[positionIndex + 2] = starColor.b;

    sizes[i] = 1.15 + Math.pow(Math.random(), 1.8) * 1.95;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("starSize", new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: STAR_VERTEX_SHADER,
    fragmentShader: STAR_FRAGMENT_SHADER,
    uniforms: {
      uOpacity: { value: 0.93 },
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
