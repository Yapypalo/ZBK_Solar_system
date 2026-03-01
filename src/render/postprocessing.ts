import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { AA_MSAA_MAX_SAMPLES, getEffectivePixelRatio } from "./aaConfig";

export interface PostProcessingPipeline {
  composer: EffectComposer;
  smaaPass: SMAAPass;
  setSize: (width: number, height: number) => void;
  render: () => void;
}

export function createPostProcessing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): PostProcessingPipeline {
  const renderSize = renderer.getSize(new THREE.Vector2());
  const supportsMsaa = renderer.capabilities.isWebGL2;
  const msaaSamples = supportsMsaa
    ? Math.min(renderer.capabilities.maxSamples ?? 4, AA_MSAA_MAX_SAMPLES)
    : 0;

  const renderTarget = new THREE.WebGLRenderTarget(renderSize.x, renderSize.y, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    stencilBuffer: false,
    samples: msaaSamples,
  });

  const composer = new EffectComposer(renderer, renderTarget);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.04,
    0.16,
    1.2,
  );
  composer.addPass(bloomPass);
  const smaaPass = new SMAAPass();
  composer.addPass(smaaPass);
  composer.addPass(new OutputPass());

  const setSize = (width: number, height: number): void => {
    composer.setPixelRatio(getEffectivePixelRatio(window.devicePixelRatio));
    composer.setSize(Math.max(1, width), Math.max(1, height));
  };

  const render = (): void => {
    composer.render();
  };

  return { composer, smaaPass, setSize, render };
}
