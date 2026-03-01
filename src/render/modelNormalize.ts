import * as THREE from "three";

const EPSILON = 1e-6;

export function normalizeModelToRadius(root: THREE.Object3D, targetRadius: number): void {
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) {
    return;
  }

  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);

  const halfMaxExtent = Math.max(size.x, size.y, size.z) * 0.5;
  if (halfMaxExtent < EPSILON) {
    return;
  }

  root.position.sub(center);
  const scale = targetRadius / halfMaxExtent;
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
}
