import * as THREE from "three";

export const AA_PROFILE = "balanced" as const;
export const AA_RENDER_SCALE = 1.25;
export const AA_MAX_PIXEL_RATIO = 2.5;
export const AA_MSAA_MAX_SAMPLES = 8;

export function getEffectivePixelRatio(devicePixelRatio: number): number {
  return THREE.MathUtils.clamp(devicePixelRatio * AA_RENDER_SCALE, 1, AA_MAX_PIXEL_RATIO);
}
