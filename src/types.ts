export type BodyId =
  | "sun"
  | "mercury"
  | "venus"
  | "earth"
  | "mars"
  | "moon"
  | "phobos"
  | "deimos";

export type BodyKind = "star" | "planet" | "satellite";
export type QualityPreset = "1k" | "4k";
export type ModelLoadState = "loaded" | "fallback" | "error";

export interface BodyCardContent {
  id: BodyId;
  kind: BodyKind;
  titleRu: string;
  subtitleEn: string;
  summaryRu: string;
  facts: Array<{ labelEn: string; value: string }>;
}

export interface OrbitElements {
  epochJd: number;
  aKm: number;
  e: number;
  iDeg: number;
  raanDeg: number;
  argPeriapsisDeg: number;
  meanAnomalyDegAtEpoch: number;
  periodDays: number;
  centralBody: BodyId;
  orbitVisualScale?: number;
  orbitGapDegrees?: number;
}

export interface SpinConfig {
  axialTiltDeg: number;
  rotationPeriodHours: number;
  retrograde?: boolean;
}

export interface BodyVisualConfig {
  id: BodyId;
  name: string;
  modelPath1k: string;
  modelPath4k?: string;
  visualRadius: number;
  orbit: OrbitElements | null;
  spin: SpinConfig;
  color: string;
  orientationOffsetDeg?: [number, number, number];
  focusDistanceMultiplier?: number;
  modelScaleMultiplier?: number;
  satelliteVisualPriority?: number;
}

export interface SimulationState {
  currentDate: Date;
  timeScaleDaysPerSecond: number;
  paused: boolean;
  quality: QualityPreset;
}
