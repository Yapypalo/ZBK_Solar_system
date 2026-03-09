import type { Vector3 } from "three";

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
export type MissionImportance = 1 | 2 | 3;
export type SpacecraftKind = "orbiter" | "transfer";

export interface BodyCardContent {
  id: BodyId;
  kind: BodyKind;
  titleRu: string;
  subtitleEn: string;
  summaryRu: string;
  facts: Array<{ labelEn: string; value: string }>;
}

export interface SpacecraftLink {
  bodyId: BodyId;
  role: "primary" | "secondary";
}

export interface SpacecraftOrbitParams {
  attractorBodyId: BodyId;
  aKm: number;
  e: number;
  iDeg: number;
  raanDeg: number;
  argPeriapsisDeg: number;
  meanAnomalyDegAtEpoch: number;
  periodDays: number;
  orbitVisualScale?: number;
}

export interface SpacecraftRecord {
  id: string;
  name: string;
  description?: string;
  importance: MissionImportance;
  kind: SpacecraftKind;
  links: SpacecraftLink[];
  createdAtIso: string;
  seed: number;
  orbit: SpacecraftOrbitParams;
}

export interface SpacecraftRuntimeSnapshot {
  positionScene: Vector3;
}

export interface SpacecraftExportPayload {
  version: string;
  exportedAtIso: string;
  missions: SpacecraftRecord[];
}

export interface ActiveMissionState {
  missionId: string | null;
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
