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

function getOrbitPeriapsisKm(aKm: number, e: number): number {
  const safeEccentricity = clamp(e, 0, 0.99);
  return aKm * (1 - safeEccentricity);
}

function getOrbitApoapsisKm(aKm: number, e: number): number {
  const safeEccentricity = clamp(e, 0, 0.99);
  return aKm * (1 + safeEccentricity);
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

export function getBodySoiKm(bodyId: BodyId): number {
  const bodyRadiusKm = BODY_RADIUS_KM[bodyId];
  return BODY_SOI_KM[bodyId] ?? bodyRadiusKm * 280;
}

export function getBodyVisualRadiusKm(bodyId: BodyId): number {
  return BODY_CONFIGS[bodyId].visualRadius * KM_PER_SCENE_UNIT;
}

export function computeMinVisualOrbitScale(
  attractorBodyId: BodyId,
  periapsisKm: number,
): number {
  const clampedPeriapsis = Math.max(periapsisKm, 1e-3);
  const visualRadiusKm = getBodyVisualRadiusKm(attractorBodyId);
  const rawScale = (visualRadiusKm * 1.15) / clampedPeriapsis;
  return clamp(rawScale, 1, 100_000);
}

function estimateDistanceToAttractorKm(
  bodyId: BodyId,
  attractorBodyId: BodyId,
): number | null {
  if (bodyId === attractorBodyId) {
    return 0;
  }

  const visited = new Set<BodyId>();
  let current: BodyId = bodyId;
  let totalDistance = 0;

  while (!visited.has(current)) {
    visited.add(current);
    const orbit = BODY_CONFIGS[current].orbit;
    if (!orbit) {
      return null;
    }

    totalDistance += orbit.aKm;
    if (orbit.centralBody === attractorBodyId) {
      return totalDistance;
    }

    current = orbit.centralBody;
  }

  return null;
}

function getMinimumOrbitAltitudeKm(bodyId: BodyId): number {
  const bodyRadiusKm = BODY_RADIUS_KM[bodyId];
  if (bodyId === "sun") {
    return bodyRadiusKm * 0.06;
  }
  return Math.max(20, bodyRadiusKm * 0.015);
}

function getMinimumOrbitRadiusKm(bodyId: BodyId): number {
  return BODY_RADIUS_KM[bodyId] + getMinimumOrbitAltitudeKm(bodyId);
}

function getMaximumOrbitRadiusInsideSoiKm(bodyId: BodyId): number {
  return getBodySoiKm(bodyId) * 0.92;
}

function getGeostationaryRadiusKm(bodyId: BodyId): number | null {
  const mu = BODY_MU_KM3_S2[bodyId];
  if (!mu || mu <= 0) {
    return null;
  }

  const rotationHours = Math.abs(BODY_CONFIGS[bodyId].spin.rotationPeriodHours);
  if (!Number.isFinite(rotationHours) || rotationHours <= 0) {
    return null;
  }

  const periodSeconds = rotationHours * 3_600;
  const radiusKm = Math.cbrt((mu * periodSeconds * periodSeconds) / (4 * Math.PI * Math.PI));
  return Number.isFinite(radiusKm) ? radiusKm : null;
}

function getEccentricityRange(importance: MissionImportance): [number, number] {
  if (importance === 1) {
    return [0, 0.35];
  }
  if (importance === 2) {
    return [0, 0.8];
  }
  return [0.55, 0.95];
}

function sampleInclinationDeg(
  importance: MissionImportance,
  rng: () => number,
): number {
  if (importance === 1) {
    return rng() < 0.5 ? randomRange(rng, 87, 97) : randomRange(rng, -15, 15);
  }
  if (importance === 2) {
    return randomRange(rng, -180, 180);
  }
  if (rng() < 0.65) {
    return randomRange(rng, 100, 180);
  }
  return randomRange(rng, -180, 180);
}

function pickTransferRadiiForEccentricity(
  innerTargetKm: number,
  outerTargetKm: number,
  eccentricity: number,
  minRadiusKm: number,
  maxRadiusKm: number,
): { rpKm: number; raKm: number } {
  const safeE = clamp(eccentricity, 0, 0.99);

  let rpA = clamp(innerTargetKm, minRadiusKm, maxRadiusKm * 0.999);
  let raA = rpA * (1 + safeE) / Math.max(1 - safeE, 1e-6);
  if (raA > maxRadiusKm) {
    raA = maxRadiusKm;
    rpA = raA * (1 - safeE) / (1 + safeE);
  }
  if (rpA < minRadiusKm) {
    rpA = minRadiusKm;
    raA = rpA * (1 + safeE) / Math.max(1 - safeE, 1e-6);
    raA = Math.min(raA, maxRadiusKm);
  }
  const errA =
    Math.abs(rpA - innerTargetKm) / Math.max(innerTargetKm, 1) +
    Math.abs(raA - outerTargetKm) / Math.max(outerTargetKm, 1);

  let raB = clamp(outerTargetKm, minRadiusKm * 1.01, maxRadiusKm);
  let rpB = raB * (1 - safeE) / (1 + safeE);
  if (rpB < minRadiusKm) {
    rpB = minRadiusKm;
    raB = rpB * (1 + safeE) / Math.max(1 - safeE, 1e-6);
  }
  if (raB > maxRadiusKm) {
    raB = maxRadiusKm;
    rpB = raB * (1 - safeE) / (1 + safeE);
  }
  const errB =
    Math.abs(rpB - innerTargetKm) / Math.max(innerTargetKm, 1) +
    Math.abs(raB - outerTargetKm) / Math.max(outerTargetKm, 1);

  if (errA <= errB) {
    return { rpKm: rpA, raKm: raA };
  }
  return { rpKm: rpB, raKm: raB };
}

function buildOrbiterOrbit(
  primaryBodyId: BodyId,
  importance: MissionImportance,
  rng: () => number,
): SpacecraftOrbitParams {
  const minRadiusKm = getMinimumOrbitRadiusKm(primaryBodyId);
  const maxRadiusKm = Math.max(
    minRadiusKm * 1.04,
    getMaximumOrbitRadiusInsideSoiKm(primaryBodyId),
  );
  const [eMin, eMax] = getEccentricityRange(importance);

  let rpKm = minRadiusKm;
  let raKm = minRadiusKm * 1.02;
  let e = 0;

  if (importance === 1) {
    const geoRadiusKm = getGeostationaryRadiusKm(primaryBodyId);
    const geoUsable =
      geoRadiusKm !== null &&
      geoRadiusKm > minRadiusKm * 1.01 &&
      geoRadiusKm < maxRadiusKm * 0.995;

    if (geoUsable && rng() < 0.2) {
      rpKm = geoRadiusKm;
      raKm = geoRadiusKm;
      e = 0;
    } else {
      e = randomRange(rng, eMin, eMax);
      const upperRadiusKm = geoUsable
        ? Math.min(geoRadiusKm as number, maxRadiusKm * 0.98)
        : maxRadiusKm * 0.7;
      rpKm = randomRange(rng, minRadiusKm, Math.max(minRadiusKm * 1.02, upperRadiusKm));
      raKm = rpKm * (1 + e) / Math.max(1 - e, 1e-6);
      if (raKm > upperRadiusKm) {
        raKm = upperRadiusKm;
        e = clamp((raKm - rpKm) / Math.max(raKm + rpKm, 1e-6), eMin, eMax);
      }
    }
  } else if (importance === 2) {
    e = randomRange(rng, eMin, eMax);
    rpKm = randomRange(rng, minRadiusKm, maxRadiusKm * 0.8);
    raKm = rpKm * (1 + e) / Math.max(1 - e, 1e-6);
    if (raKm > maxRadiusKm) {
      raKm = maxRadiusKm;
      e = clamp((raKm - rpKm) / Math.max(raKm + rpKm, 1e-6), eMin, eMax);
    }
  } else {
    rpKm = randomRange(rng, minRadiusKm, maxRadiusKm * 0.35);
    raKm = randomRange(rng, Math.max(rpKm * 1.2, maxRadiusKm * 0.68), maxRadiusKm);
    e = clamp((raKm - rpKm) / Math.max(raKm + rpKm, 1e-6), eMin, eMax);
    if (e < 0.62) {
      const targetE = randomRange(rng, 0.62, eMax);
      raKm = Math.min(maxRadiusKm, rpKm * (1 + targetE) / Math.max(1 - targetE, 1e-6));
      e = clamp((raKm - rpKm) / Math.max(raKm + rpKm, 1e-6), eMin, eMax);
    }
  }

  if (raKm > maxRadiusKm) {
    raKm = maxRadiusKm;
  }
  if (rpKm < minRadiusKm) {
    rpKm = minRadiusKm;
  }
  if (raKm <= rpKm) {
    raKm = Math.min(maxRadiusKm, rpKm * 1.02);
  }
  e = clamp((raKm - rpKm) / Math.max(raKm + rpKm, 1e-6), eMin, eMax);

  const aKm = (rpKm + raKm) / 2;
  const iDeg = sampleInclinationDeg(importance, rng);
  const orbitVisualScale = computeMinVisualOrbitScale(primaryBodyId, rpKm);

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
  const minRadiusKm = getMinimumOrbitRadiusKm(attractorBodyId);
  const maxRadiusKm = Math.max(
    minRadiusKm * 1.04,
    getMaximumOrbitRadiusInsideSoiKm(attractorBodyId),
  );
  const [eMin, eMax] = getEccentricityRange(importance);

  const rPrimaryKm = getBodyDistanceToAttractorKm(
    primaryBodyId,
    attractorBodyId,
    positionsScene,
  );
  const rSecondaryKm = getBodyDistanceToAttractorKm(
    secondaryBodyId,
    attractorBodyId,
    positionsScene,
  );
  const targetPrimaryKm = rPrimaryKm + getMinimumOrbitAltitudeKm(primaryBodyId);
  const targetSecondaryKm = rSecondaryKm + getMinimumOrbitAltitudeKm(secondaryBodyId);
  let innerTargetKm = Math.max(minRadiusKm, Math.min(targetPrimaryKm, targetSecondaryKm));
  let outerTargetKm = Math.min(maxRadiusKm, Math.max(targetPrimaryKm, targetSecondaryKm));
  if (outerTargetKm <= innerTargetKm * 1.01) {
    outerTargetKm = Math.min(maxRadiusKm, innerTargetKm * 1.05);
  }

  const eTarget = (outerTargetKm - innerTargetKm) / Math.max(outerTargetKm + innerTargetKm, 1e-6);
  let e = clamp(eTarget, eMin, eMax);
  if (importance === 3) {
    e = Math.max(e, randomRange(rng, 0.62, eMax));
  }
  const radii = pickTransferRadiiForEccentricity(
    innerTargetKm,
    outerTargetKm,
    e,
    minRadiusKm,
    maxRadiusKm,
  );
  let rpKm = radii.rpKm;
  let raKm = radii.raKm;

  if (raKm <= rpKm) {
    raKm = Math.min(maxRadiusKm, rpKm * 1.02);
  }
  if (rpKm < minRadiusKm) {
    rpKm = minRadiusKm;
  }
  if (raKm > maxRadiusKm) {
    raKm = maxRadiusKm;
  }

  e = clamp((raKm - rpKm) / Math.max(raKm + rpKm, 1e-6), eMin, eMax);
  const aKm = (rpKm + raKm) / 2;

  const referenceOrientation =
    getReferenceOrientation(primaryBodyId, attractorBodyId) ??
    getReferenceOrientation(secondaryBodyId, attractorBodyId);

  let iDeg = sampleInclinationDeg(importance, rng);
  if (referenceOrientation) {
    iDeg = clamp(
      referenceOrientation.iDeg + randomRange(rng, -8, 8),
      -180,
      180,
    );
    if (importance === 2) {
      iDeg = clamp(
        referenceOrientation.iDeg + randomRange(rng, -45, 45),
        -180,
        180,
      );
    }
    if (importance === 3 && rng() < 0.45) {
      iDeg = sampleInclinationDeg(importance, rng);
    }
  }

  const baseRaan = referenceOrientation?.raanDeg ?? randomRange(rng, 0, 360);
  const baseArg = referenceOrientation?.argPeriapsisDeg ?? randomRange(rng, 0, 360);
  const orbitVisualScale = computeMinVisualOrbitScale(attractorBodyId, rpKm);

  return {
    attractorBodyId,
    aKm,
    e,
    iDeg,
    raanDeg: (baseRaan + randomRange(rng, -12, 12) + 360) % 360,
    argPeriapsisDeg: (baseArg + randomRange(rng, -18, 18) + 360) % 360,
    meanAnomalyDegAtEpoch: randomRange(rng, -6, 6),
    periodDays: computeOrbitalPeriodDays(aKm, attractorBodyId),
    orbitVisualScale,
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

export function normalizeSpacecraftRecordForVisuals(
  record: SpacecraftRecord,
): SpacecraftRecord {
  let nextOrbit = { ...record.orbit };
  const attractorBodyId = nextOrbit.attractorBodyId;
  const minRadiusKm = getMinimumOrbitRadiusKm(attractorBodyId);
  const maxRadiusKm = Math.max(
    minRadiusKm * 1.04,
    getMaximumOrbitRadiusInsideSoiKm(attractorBodyId),
  );

  let rpKm = getOrbitPeriapsisKm(nextOrbit.aKm, nextOrbit.e);
  let raKm = getOrbitApoapsisKm(nextOrbit.aKm, nextOrbit.e);
  const [eMin, eMax] = getEccentricityRange(record.importance);

  if (record.kind === "transfer" && record.links.length >= 2) {
    const primaryLink = record.links.find((link) => link.role === "primary") ?? record.links[0];
    const secondaryLink = record.links.find((link) => link.role === "secondary") ?? record.links[1];
    const primaryDistanceKm =
      estimateDistanceToAttractorKm(primaryLink.bodyId, attractorBodyId) ?? rpKm;
    const secondaryDistanceKm =
      estimateDistanceToAttractorKm(secondaryLink.bodyId, attractorBodyId) ?? rpKm;
    let innerTargetKm = Math.max(
      minRadiusKm,
      Math.min(
        primaryDistanceKm + getMinimumOrbitAltitudeKm(primaryLink.bodyId),
        secondaryDistanceKm + getMinimumOrbitAltitudeKm(secondaryLink.bodyId),
      ),
    );
    let outerTargetKm = Math.min(
      maxRadiusKm,
      Math.max(
        primaryDistanceKm + getMinimumOrbitAltitudeKm(primaryLink.bodyId),
        secondaryDistanceKm + getMinimumOrbitAltitudeKm(secondaryLink.bodyId),
      ),
    );
    if (outerTargetKm <= innerTargetKm * 1.01) {
      outerTargetKm = Math.min(maxRadiusKm, innerTargetKm * 1.05);
    }

    const eTarget = clamp(
      (outerTargetKm - innerTargetKm) / Math.max(outerTargetKm + innerTargetKm, 1e-6),
      eMin,
      eMax,
    );
    const targetRadii = pickTransferRadiiForEccentricity(
      innerTargetKm,
      outerTargetKm,
      eTarget,
      minRadiusKm,
      maxRadiusKm,
    );
    rpKm = Math.max(rpKm, targetRadii.rpKm);
    raKm = Math.max(raKm, targetRadii.raKm);
  }

  rpKm = clamp(rpKm, minRadiusKm, maxRadiusKm * 0.999);
  raKm = clamp(raKm, rpKm * 1.01, maxRadiusKm);

  let e = (raKm - rpKm) / Math.max(raKm + rpKm, 1e-6);
  if (e < eMin || e > eMax) {
    const clampedE = clamp(e, eMin, eMax);
    raKm = rpKm * (1 + clampedE) / Math.max(1 - clampedE, 1e-6);
    if (raKm > maxRadiusKm) {
      raKm = maxRadiusKm;
      rpKm = raKm * (1 - clampedE) / (1 + clampedE);
    }
    rpKm = clamp(rpKm, minRadiusKm, maxRadiusKm * 0.999);
    raKm = clamp(raKm, rpKm * 1.01, maxRadiusKm);
    e = (raKm - rpKm) / Math.max(raKm + rpKm, 1e-6);
  }

  const adjustedA = (rpKm + raKm) / 2;
  nextOrbit.aKm = adjustedA;
  nextOrbit.e = clamp(e, 0, 0.99);
  nextOrbit.periodDays = computeOrbitalPeriodDays(adjustedA, attractorBodyId);

  const periapsisKm = rpKm;
  const minVisualScale = computeMinVisualOrbitScale(
    nextOrbit.attractorBodyId,
    periapsisKm,
  );
  const currentVisualScale = nextOrbit.orbitVisualScale ?? 1;
  const nextVisualScale = Math.max(currentVisualScale, minVisualScale);
  nextOrbit.orbitVisualScale = nextVisualScale;

  if (
    record.orbit.aKm === nextOrbit.aKm &&
    record.orbit.e === nextOrbit.e &&
    record.orbit.periodDays === nextOrbit.periodDays &&
    record.orbit.orbitVisualScale === nextOrbit.orbitVisualScale
  ) {
    return record;
  }

  return {
    ...record,
    orbit: nextOrbit,
  };
}

export function getBodyDisplayRadiusKm(bodyId: BodyId): number {
  return BODY_RADIUS_KM[bodyId];
}
