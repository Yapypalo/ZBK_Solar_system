import * as THREE from "three";

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
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.75,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  });

  const stars = new THREE.Points(geometry, material);
  stars.frustumCulled = false;
  return stars;
}
