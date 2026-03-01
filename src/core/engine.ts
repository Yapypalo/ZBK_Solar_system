import * as THREE from "three";
import { getEffectivePixelRatio } from "../render/aaConfig";

export interface EngineContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  clock: THREE.Clock;
  setSize: (width: number, height: number) => void;
  dispose: () => void;
}

export function createEngine(mount: HTMLElement): EngineContext {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#02040A");

  const initialWidth = mount.clientWidth || window.innerWidth;
  const initialHeight = mount.clientHeight || window.innerHeight;

  const camera = new THREE.PerspectiveCamera(42, initialWidth / initialHeight, 0.01, 8_000);
  camera.position.set(0, 22, 92);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  const compatibilityRenderer = renderer as THREE.WebGLRenderer & {
    physicallyCorrectLights?: boolean;
    useLegacyLights?: boolean;
  };
  if (typeof compatibilityRenderer.physicallyCorrectLights === "boolean") {
    compatibilityRenderer.physicallyCorrectLights = true;
  }
  if (typeof compatibilityRenderer.useLegacyLights === "boolean") {
    compatibilityRenderer.useLegacyLights = false;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.setPixelRatio(getEffectivePixelRatio(window.devicePixelRatio));
  renderer.setSize(initialWidth, initialHeight);
  mount.appendChild(renderer.domElement);

  const ambientLight = new THREE.AmbientLight("#AFC8F0", 0.02);
  scene.add(ambientLight);

  const hemisphereLight = new THREE.HemisphereLight("#AFCBF5", "#060B13", 0.04);
  scene.add(hemisphereLight);

  const solarLight = new THREE.PointLight("#FFF5E3", 280_000, 0, 2);
  solarLight.position.set(0, 0, 0);
  scene.add(solarLight);

  const rimLight = new THREE.DirectionalLight("#7FA7FF", 0.06);
  rimLight.position.set(-220, 80, -130);
  scene.add(rimLight);

  const clock = new THREE.Clock();

  const setSize = (width: number, height: number): void => {
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);

    camera.aspect = safeWidth / safeHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(getEffectivePixelRatio(window.devicePixelRatio));
    renderer.setSize(safeWidth, safeHeight);
  };

  const handleResize = (): void => {
    setSize(mount.clientWidth || window.innerWidth, mount.clientHeight || window.innerHeight);
  };

  window.addEventListener("resize", handleResize);

  const dispose = (): void => {
    window.removeEventListener("resize", handleResize);
    renderer.dispose();
  };

  return { scene, camera, renderer, clock, setSize, dispose };
}
