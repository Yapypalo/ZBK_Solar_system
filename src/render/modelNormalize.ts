import * as THREE from "three";

const EPSILON = 1e-6;

export function normalizeModelToRadius(root: THREE.Object3D, targetRadius: number): void {
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) {
    return;
  }

  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  if (sphere.radius < EPSILON) {
    return;
  }

  root.position.sub(sphere.center);
  const scale = targetRadius / sphere.radius;
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
}
