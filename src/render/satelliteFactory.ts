import * as THREE from "three";

export interface SatelliteVisualRuntime {
  root: THREE.Group;
  estimatedAxesRoot: THREE.Group;
  dispose: () => void;
}

const BODY_LENGTH = 0.042;
const BODY_WIDTH = BODY_LENGTH / 3;
const AXIS_LENGTH = 0.072;

interface LabelRuntime {
  sprite: THREE.Sprite;
  texture: THREE.CanvasTexture;
  material: THREE.SpriteMaterial;
}

function disableDepthForObject(object: THREE.Object3D): void {
  object.traverse((node) => {
    const objectWithMaterial = node as THREE.Object3D & {
      material?: THREE.Material | THREE.Material[];
    };
    if (!objectWithMaterial.material) {
      return;
    }

    const materials = Array.isArray(objectWithMaterial.material)
      ? objectWithMaterial.material
      : [objectWithMaterial.material];
    materials.forEach((material) => {
      material.depthTest = false;
      material.depthWrite = false;
      material.needsUpdate = true;
    });
  });
}

function createAxisLabel(
  text: string,
  color: string,
): LabelRuntime {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create satellite axis label canvas context.");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = 'bold 64px "IBM Plex Mono", "Segoe UI", sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(4, 8, 16, 0.72)";
  context.fillRect(28, 24, 200, 80);
  context.strokeStyle = "rgba(255,255,255,0.16)";
  context.lineWidth = 4;
  context.strokeRect(28, 24, 200, 80);
  context.fillStyle = color;
  context.fillText(text, 128, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 14;

  return { sprite, texture, material };
}

export function createSatelliteVisual(): SatelliteVisualRuntime {
  const root = new THREE.Group();
  root.name = "satellite-root";

  const bodyGeometry = new THREE.BoxGeometry(BODY_LENGTH, BODY_WIDTH, BODY_WIDTH);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#D8DEE8"),
    emissive: new THREE.Color("#4C87FF"),
    emissiveIntensity: 0.18,
    roughness: 0.42,
    metalness: 0.34,
    depthTest: false,
    depthWrite: false,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.name = "satellite-cubesat-body";
  body.renderOrder = 10;

  const edgeGeometry = new THREE.EdgesGeometry(bodyGeometry);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: "#FFFFFF",
    transparent: true,
    opacity: 0.72,
    depthTest: false,
    depthWrite: false,
  });
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edges.name = "satellite-cubesat-edges";
  edges.renderOrder = 11;

  const axes = new THREE.AxesHelper(AXIS_LENGTH);
  axes.name = "satellite-orientation-axes";
  axes.renderOrder = 12;
  disableDepthForObject(axes);

  const axisLabels = [
    { text: "+X", color: "#FF5F5F", position: new THREE.Vector3(AXIS_LENGTH * 1.08, 0, 0) },
    { text: "+Y", color: "#4EEA7D", position: new THREE.Vector3(0, AXIS_LENGTH * 1.08, 0) },
    { text: "+Z", color: "#4C87FF", position: new THREE.Vector3(0, 0, AXIS_LENGTH * 1.08) },
  ].map((entry) => {
    const label = createAxisLabel(entry.text, entry.color);
    label.sprite.position.copy(entry.position);
    label.sprite.scale.set(0.032, 0.016, 1);
    label.sprite.name = `satellite-axis-label-${entry.text.slice(1).toLowerCase()}`;
    disableDepthForObject(label.sprite);
    return label;
  });

  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(BODY_LENGTH * 1.05, BODY_WIDTH * 1.05, BODY_WIDTH * 1.05),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color("#8FB7FF"),
      transparent: true,
      opacity: 0.08,
      depthTest: false,
      depthWrite: false,
    }),
  );
  glow.name = "satellite-cubesat-glow";
  glow.renderOrder = 9;

  root.add(glow, body, edges, axes, ...axisLabels.map((entry) => entry.sprite));

  const estimatedAxesRoot = new THREE.Group();
  estimatedAxesRoot.name = "satellite-estimated-axes";
  estimatedAxesRoot.position.set(0, 0, 0);
  estimatedAxesRoot.visible = false;
  const estimatedAxes = new THREE.AxesHelper(AXIS_LENGTH * 0.92);
  estimatedAxes.name = "satellite-estimated-axes-helper";
  estimatedAxes.renderOrder = 13;
  disableDepthForObject(estimatedAxes);
  estimatedAxesRoot.add(estimatedAxes);
  const estimatedLabels = [
    { text: "+X", color: "#FFB84D", position: new THREE.Vector3(AXIS_LENGTH * 1.0, 0, 0) },
    { text: "+Y", color: "#D8A2FF", position: new THREE.Vector3(0, AXIS_LENGTH * 1.0, 0) },
    { text: "+Z", color: "#6BE7FF", position: new THREE.Vector3(0, 0, AXIS_LENGTH * 1.0) },
  ].map((entry) => {
    const label = createAxisLabel(entry.text, entry.color);
    label.sprite.position.copy(entry.position);
    label.sprite.scale.set(0.028, 0.014, 1);
    label.sprite.name = `satellite-estimated-axis-label-${entry.text.slice(1).toLowerCase()}`;
    disableDepthForObject(label.sprite);
    return label;
  });
  estimatedAxesRoot.add(...estimatedLabels.map((entry) => entry.sprite));
  root.add(estimatedAxesRoot);

  return {
    root,
    estimatedAxesRoot,
    dispose: () => {
      bodyGeometry.dispose();
      bodyMaterial.dispose();
      edgeGeometry.dispose();
      edgeMaterial.dispose();
      glow.geometry.dispose();
      (glow.material as THREE.Material).dispose();
      axes.dispose();
      axisLabels.forEach((entry) => {
        entry.texture.dispose();
        entry.material.dispose();
      });
      estimatedLabels.forEach((entry) => {
        entry.texture.dispose();
        entry.material.dispose();
      });
      estimatedAxes.dispose();
    },
  };
}
