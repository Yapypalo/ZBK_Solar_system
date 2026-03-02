import * as THREE from "three";

export const AA_PROFILE = "balanced" as const;
export const PERF_MAX_PIXEL_RATIO = 1.25;

export function getEffectivePixelRatio(devicePixelRatio: number): number {
  return THREE.MathUtils.clamp(devicePixelRatio, 1, PERF_MAX_PIXEL_RATIO);
}
