import * as THREE from "three";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { getEffectivePixelRatio } from "./aaConfig";

interface CinematicProfile {
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  grainIntensity: number;
  ditherIntensity: number;
}

const DEFAULT_PROFILE: CinematicProfile = {
  bloomStrength: 0.18,
  bloomRadius: 0.42,
  bloomThreshold: 1.05,
  grainIntensity: 0.01,
  ditherIntensity: 0.008,
};

const COLOR_GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uTime: { value: 0 },
    uContrast: { value: 1.07 },
    uSaturation: { value: 1.05 },
    uTemperature: { value: 0.025 },
    uLift: { value: 0.008 },
    uGamma: { value: 0.985 },
    uGain: { value: 1.018 },
    uGrainIntensity: { value: DEFAULT_PROFILE.grainIntensity },
    uDitherIntensity: { value: DEFAULT_PROFILE.ditherIntensity },
    uMotionDir: { value: new THREE.Vector2(0, 0) },
    uMotionStrength: { value: 0 },
  },
  vertexShader: `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
  fragmentShader: `
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uTime;
uniform float uContrast;
uniform float uSaturation;
uniform float uTemperature;
uniform float uLift;
uniform float uGamma;
uniform float uGain;
uniform float uGrainIntensity;
uniform float uDitherIntensity;
uniform vec2 uMotionDir;
uniform float uMotionStrength;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 applyMotionBlur(vec2 uv) {
  vec2 px = 1.0 / max(uResolution, vec2(1.0));
  vec2 motion = normalize(uMotionDir + vec2(1e-6)) * px * (uMotionStrength * 2.8);
  float mixFactor = clamp(uMotionStrength * 1.35, 0.0, 0.34);

  vec3 c0 = texture2D(tDiffuse, uv).rgb;
  vec3 c1 = texture2D(tDiffuse, clamp(uv - motion * 1.2, 0.0, 1.0)).rgb;
  vec3 c2 = texture2D(tDiffuse, clamp(uv - motion * 2.4, 0.0, 1.0)).rgb;
  vec3 blurred = c0 * 0.58 + c1 * 0.29 + c2 * 0.13;
  return mix(c0, blurred, mixFactor);
}

void main() {
  vec4 source = texture2D(tDiffuse, vUv);
  vec3 color = applyMotionBlur(vUv);

  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luminance), color, uSaturation);
  color = (color - 0.5) * uContrast + 0.5;
  color += vec3(uTemperature * 0.7, uTemperature * 0.15, -uTemperature * 0.75);

  color = (color + vec3(uLift)) * vec3(uGain);
  color = pow(max(color, vec3(0.0)), vec3(uGamma));

  float grainSeed = hash12(gl_FragCoord.xy + vec2(uTime * 173.1, uTime * 97.7));
  float grain = (grainSeed - 0.5) * uGrainIntensity;
  float dither = (hash12(gl_FragCoord.xy + vec2(31.7, 13.1)) - 0.5) * uDitherIntensity;

  color += vec3(grain + dither);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), source.a);
}
`,
};

export interface PostProcessingPipeline {
  composer: EffectComposer;
  setSize: (width: number, height: number) => void;
  render: (deltaSeconds: number) => void;
  setDofEnabled: (enabled: boolean, focusDistance?: number) => void;
  setBloomEnabled: (enabled: boolean) => void;
  setMotionBlur: (direction: THREE.Vector2, strength: number) => void;
  dispose: () => void;
}

export function createPostProcessing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): PostProcessingPipeline {
  const composer = new EffectComposer(renderer);

  const renderPass = new RenderPass(scene, camera);

  const initialWidth = Math.max(1, window.innerWidth);
  const initialHeight = Math.max(1, window.innerHeight);
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(initialWidth, initialHeight),
    DEFAULT_PROFILE.bloomStrength,
    DEFAULT_PROFILE.bloomRadius,
    DEFAULT_PROFILE.bloomThreshold,
  );

  const bokehPass = new BokehPass(scene, camera, {
    focus: 60,
    aperture: 0.000012,
    maxblur: 0.0025,
  });
  bokehPass.enabled = false;

  const gradePass = new ShaderPass(COLOR_GRADE_SHADER);
  const smaaPass = new SMAAPass();
  const outputPass = new OutputPass();

  composer.addPass(renderPass);
  composer.addPass(bokehPass);
  composer.addPass(bloomPass);
  composer.addPass(gradePass);
  composer.addPass(smaaPass);
  composer.addPass(outputPass);

  const setDofEnabled = (enabled: boolean, focusDistance?: number): void => {
    bokehPass.enabled = enabled;
    if (!enabled || typeof focusDistance !== "number") {
      return;
    }

    const uniforms = bokehPass.materialBokeh.uniforms as Record<
      string,
      THREE.IUniform<number>
    >;
    uniforms.focus.value = Math.max(0.1, focusDistance);
    uniforms.maxblur.value = 0.0028;
    uniforms.aperture.value = 0.000013;
  };

  const setBloomEnabled = (enabled: boolean): void => {
    bloomPass.enabled = enabled;
  };

  const setMotionBlur = (direction: THREE.Vector2, strength: number): void => {
    const dirUniform = gradePass.uniforms.uMotionDir.value as THREE.Vector2;
    if (direction.lengthSq() > 0.000001) {
      dirUniform.copy(direction).normalize();
    } else {
      dirUniform.set(0, 0);
    }
    gradePass.uniforms.uMotionStrength.value = THREE.MathUtils.clamp(strength, 0, 0.28);
  };

  const setSize = (width: number, height: number): void => {
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);
    const dpr = getEffectivePixelRatio(window.devicePixelRatio);
    composer.setPixelRatio(dpr);
    composer.setSize(safeWidth, safeHeight);
    smaaPass.setSize(safeWidth * dpr, safeHeight * dpr);
    bokehPass.setSize(safeWidth, safeHeight);
    bloomPass.setSize(safeWidth, safeHeight);
    const resolution = gradePass.uniforms.uResolution.value as THREE.Vector2;
    resolution.set(safeWidth * dpr, safeHeight * dpr);
  };

  const render = (deltaSeconds: number): void => {
    gradePass.uniforms.uTime.value += Math.max(0, deltaSeconds);
    composer.render();
  };

  const dispose = (): void => {
    composer.dispose();
  };

  return {
    composer,
    setSize,
    render,
    setDofEnabled,
    setBloomEnabled,
    setMotionBlur,
    dispose,
  };
}
