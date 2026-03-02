import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { getEffectivePixelRatio } from "./aaConfig";

export interface PostProcessingPipeline {
  composer: EffectComposer;
  setSize: (width: number, height: number) => void;
  render: () => void;
  dispose: () => void;
}

export function createPostProcessing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): PostProcessingPipeline {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());

  const setSize = (width: number, height: number): void => {
    composer.setPixelRatio(getEffectivePixelRatio(window.devicePixelRatio));
    composer.setSize(Math.max(1, width), Math.max(1, height));
  };

  const render = (): void => {
    composer.render();
  };

  const dispose = (): void => {
    composer.dispose();
  };

  return { composer, setSize, render, dispose };
}
