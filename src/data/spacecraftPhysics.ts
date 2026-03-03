import * as THREE from "three";
import { BODY_CONFIGS } from "./bodies";
import { KM_PER_SCENE_UNIT } from "../sim/constants";
import type {
  BodyId,
  MissionImportance,
  SpacecraftKind,
  SpacecraftLink,
  SpacecraftOrbitParams,
  SpacecraftRecord,
} from "../types";

export interface SpacecraftDraftInput {
  name: string;
  description?: string;
  importance: MissionImportance;
  primaryBodyId: BodyId;
  secondaryBodyId?: BodyId;
}

export interface SpacecraftBuildContext {
  currentDate: Date;
  bodyPositionsScene: Record<BodyId, THREE.Vector3>;
}

const BODY_MU_KM3_S2: Record<BodyId, number> = {
  sun: 1.32712440018e11,
  mercury: 2.2032e4,
  venus: 3.24859e5,
  earth: 3.986004418e5,
  mars: 4.282837e4,
  moon: 4.9048695e3,
  phobos: 7.11e-4,
  deimos: 9.8e-5,
};

const BODY_RADIUS_KM: Record<BodyId, number> = {
  sun: 695_700,
  mercury: 2_439.7,
  venus: 6_051.8,
  earth: 6_371.0,
  mars: 3_389.5,
  moon: 1_737.4,
  phobos: 11.2667,
  deimos: 6.2,
};

const BODY_SOI_KM: Partial<Record<BodyId, number>> = {
  mercury: 112_000,
  venus: 616_000,
  earth: 925_000,
  mars: 577_000,
  moon: 66_000,
  phobos: 20,
  deimos: 35,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function xfnv1aHash(input: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randomRange(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

function getAncestorChain(bodyId: BodyId): BodyId[] {
  const chain: BodyId[] = [bodyId];
  let current: BodyId = bodyId;
  while (true) {
    const orbit = BODY_CONFIGS[current].orbit;
    if (!orbit) {
      break;
    }
    const parent = orbit.centralBody;
    chain.push(parent);
    current = parent;
  }
  return chain;
}

export function resolveCommonAttractor(primary: BodyId, secondary: BodyId): BodyId {
  if (primary === secondary) {
    return primary;
  }

  const primaryOrbit = BODY_CONFIGS[primary].orbit;
  if (primaryOrbit?.centralBody === secondary) {
    return secondary;
  }

  const secondaryOrbit = BODY_CONFIGS[secondary].orbit;
  if (secondaryOrbit?.centralBody === primary) {
    return primary;
  }

  const secondaryAncestors = new Set(getAncestorChain(secondary));
  for (const candidate of getAncestorChain(primary)) {
    if (secondaryAncestors.has(candidate)) {
      return candidate;
    }
  }

  return "sun";
}

function getReferenceOrientation(
  bodyId: BodyId,
  attractorBodyId: BodyId,
): Pick<SpacecraftOrbitParams, "iDeg" | "raanDeg" | "argPeriapsisDeg"> | null {
  const orbit = BODY_CONFIGS[bodyId].orbit;
  if (orbit && orbit.centralBody === attractorBodyId) {
    return {
      iDeg: orbit.iDeg,
      raanDeg: orbit.raanDeg,
      argPeriapsisDeg: orbit.argPeriapsisDeg,
    };
  }
  return null;
}

function computeOrbitalPeriodDays(aKm: number, attractorBodyId: BodyId): number {
  const mu = BODY_MU_KM3_S2[attractorBodyId] ?? BODY_MU_KM3_S2.earth;
  const periodSeconds = 2 * Math.PI * Math.sqrt((aKm ** 3) / mu);
  return periodSeconds / 86_400;
}

function getBodyDistanceToAttractorKm(
  bodyId: BodyId,
  attractorBodyId: BodyId,
  positionsScene: Record<BodyId, THREE.Vector3>,
): number {
  if (bodyId === attractorBodyId) {
    return Math.max(BODY_RADIUS_KM[bodyId] * 6, 50_000);
  }

  const bodyPos = positionsScene[bodyId];
  const attractorPos = positionsScene[attractorBodyId];
  return bodyPos.distanceTo(attractorPos) * KM_PER_SCENE_UNIT;
}

function buildOrbiterOrbit(
  primaryBodyId: BodyId,
  importance: MissionImportance,
  rng: () => number,
): SpacecraftOrbitParams {
  const bodyRadiusKm = BODY_RADIUS_KM[primaryBodyId];
  const bodySoiKm = BODY_SOI_KM[primaryBodyId] ?? bodyRadiusKm * 280;
  const visualRadiusKm = BODY_CONFIGS[primaryBodyId].visualRadius * KM_PER_SCENE_UNIT;

  const eccentricityRanges: Record<MissionImportance, [number, number]> = {
    1: [0.01, 0.12],
    2: [0.1, 0.35],
    3: [0.35, 0.72],
  };
  const inclinationRanges: Record<MissionImportance, [number, number]> = {
    1: [0, 18],
    2: [10, 45],
    3: [25, 85],
  };

  const pericenterFactorRanges: Record<MissionImportance, [number, number]> = {
    1: [1.12, 1.85],
    2: [1.4, 3.2],
    3: [2.4, 9.4],
  };

  const rpMin = bodyRadiusKm * 1.25;
  const rp = rpMin * randomRange(rng, ...pericenterFactorRanges[importance]);
  let e = randomRange(rng, ...eccentricityRanges[importance]);
  let ra = (rp * (1 + e)) / (1 - e);

  let raMax = Math.min(bodySoiKm * 0.7, bodyRadiusKm * 120);
  if (raMax <= rp * 1.05) {
    raMax = rp * 1.35;
  }
  if (ra > raMax) {
    ra = raMax;
    e = clamp((ra - rp) / (ra + rp), eccentricityRanges[importance][0], eccentricityRanges[importance][1]);
  }

  const aKm = (rp + ra) / 2;
  let iDeg = randomRange(rng, ...inclinationRanges[importance]);
  if (importance === 3 && rng() < 0.25) {
    iDeg = randomRange(rng, 98, 155);
  }

  const orbitVisualScale = clamp((visualRadiusKm * 1.2) / rp, 1, 400);

  return {
    attractorBodyId: primaryBodyId,
    aKm,
    e,
    iDeg,
    raanDeg: randomRange(rng, 0, 360),
    argPeriapsisDeg: randomRange(rng, 0, 360),
    meanAnomalyDegAtEpoch: randomRange(rng, 0, 360),
    periodDays: computeOrbitalPeriodDays(aKm, primaryBodyId),
    orbitVisualScale,
  };
}

function buildTransferOrbit(
  primaryBodyId: BodyId,
  secondaryBodyId: BodyId,
  importance: MissionImportance,
  rng: () => number,
  positionsScene: Record<BodyId, THREE.Vector3>,
): SpacecraftOrbitParams {
  const attractorBodyId = resolveCommonAttractor(primaryBodyId, secondaryBodyId);
  const rPrimaryKm = getBodyDistanceToAttractorKm(primaryBodyId, attractorBodyId, positionsScene);
  const rSecondaryKm = getBodyDistanceToAttractorKm(secondaryBodyId, attractorBodyId, positionsScene);
  const minR = Math.min(rPrimaryKm, rSecondaryKm);
  const maxR = Math.max(rPrimaryKm, rSecondaryKm);

  const eAdjust: Record<MissionImportance, number> = { 1: 0.02, 2: 0.08, 3: 0.15 };
  let e = clamp(Math.abs(maxR - minR) / (maxR + minR) + eAdjust[importance], 0.02, 0.82);
  let aKm = minR / (1 - e);
  let ra = aKm * (1 + e);

  const soiCap = BODY_SOI_KM[attractorBodyId];
  if (soiCap && attractorBodyId !== "sun") {
    const raCap = soiCap * 0.8;
    if (ra > raCap) {
      ra = raCap;
      e = clamp((ra - minR) / (ra + minR), 0.02, 0.82);
      aKm = minR / (1 - e);
    }
  }

  const referenceOrientation =
    getReferenceOrientation(primaryBodyId, attractorBodyId) ??
    getReferenceOrientation(secondaryBodyId, attractorBodyId);

  const inclinationJitterByImportance: Record<MissionImportance, number> = {
    1: 4,
    2: 12,
    3: 28,
  };
  const baseI = referenceOrientation?.iDeg ?? randomRange(rng, 0, 24);
  let iDeg = clamp(
    baseI + randomRange(rng, -inclinationJitterByImportance[importance], inclinationJitterByImportance[importance]),
    0,
    175,
  );
  if (importance === 3 && rng() < 0.25) {
    iDeg = clamp(randomRange(rng, 100, 160), 100, 170);
  }

  const baseRaan = referenceOrientation?.raanDeg ?? randomRange(rng, 0, 360);
  const baseArg = referenceOrientation?.argPeriapsisDeg ?? randomRange(rng, 0, 360);
  const startAtPeri = rPrimaryKm <= rSecondaryKm;

  return {
    attractorBodyId,
    aKm,
    e,
    iDeg,
    raanDeg: (baseRaan + randomRange(rng, -12, 12) + 360) % 360,
    argPeriapsisDeg: (baseArg + randomRange(rng, -18, 18) + 360) % 360,
    meanAnomalyDegAtEpoch: (startAtPeri ? 0 : 180) + randomRange(rng, -10, 10),
    periodDays: computeOrbitalPeriodDays(aKm, attractorBodyId),
  };
}

function createLinks(primaryBodyId: BodyId, secondaryBodyId?: BodyId): SpacecraftLink[] {
  if (!secondaryBodyId) {
    return [{ bodyId: primaryBodyId, role: "primary" }];
  }
  return [
    { bodyId: primaryBodyId, role: "primary" },
    { bodyId: secondaryBodyId, role: "secondary" },
  ];
}

function validateDraft(input: SpacecraftDraftInput): void {
  const trimmedName = input.name.trim();
  if (trimmedName.length < 2 || trimmedName.length > 64) {
    throw new Error("Mission name must contain 2-64 characters.");
  }
  if (input.secondaryBodyId && input.secondaryBodyId === input.primaryBodyId) {
    throw new Error("Linked Body A and Linked Body B must be different.");
  }
}

export function buildSpacecraftRecord(
  input: SpacecraftDraftInput,
  context: SpacecraftBuildContext,
): SpacecraftRecord {
  validateDraft(input);
  const kind: SpacecraftKind = input.secondaryBodyId ? "transfer" : "orbiter";
  const createdAtIso = context.currentDate.toISOString();
  const seed = xfnv1aHash(
    `${input.name.trim()}|${input.primaryBodyId}|${input.secondaryBodyId ?? ""}|${input.importance}|${createdAtIso}`,
  );
  const rng = mulberry32(seed);

  const orbit =
    kind === "orbiter"
      ? buildOrbiterOrbit(input.primaryBodyId, input.importance, rng)
      : buildTransferOrbit(
          input.primaryBodyId,
          input.secondaryBodyId as BodyId,
          input.importance,
          rng,
          context.bodyPositionsScene,
        );

  return {
    id: `sc-${seed.toString(36)}-${Math.floor(context.currentDate.getTime() / 1000).toString(36)}`,
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    importance: input.importance,
    kind,
    links: createLinks(input.primaryBodyId, input.secondaryBodyId),
    createdAtIso,
    seed,
    orbit,
  };
}

export function getBodyDisplayRadiusKm(bodyId: BodyId): number {
  return BODY_RADIUS_KM[bodyId];
}
