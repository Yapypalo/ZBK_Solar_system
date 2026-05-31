import type { BodyId, BodyVisualConfig } from "../types";
import { ORBITAL_ELEMENTS } from "./orbitalElements";

export const BODY_VISUAL_SCALE = 2.1;

export const BODY_IDS = ["sun", "earth"] as const satisfies readonly BodyId[];

export const BODY_CONFIGS = {
  sun: {
    id: "sun",
    name: "Sun",
    modelPath1k: "/assets/models/sun/sun.glb",
    modelPath4k: "/assets/models/sun/4k.glb",
    visualRadius: 5.2 * BODY_VISUAL_SCALE,
    orbit: null,
    spin: {
      axialTiltDeg: 7.25,
      rotationPeriodHours: 609.12,
    },
    color: "#FCB15A",
    focusDistanceMultiplier: 1.45,
  },
  earth: {
    id: "earth",
    name: "Earth",
    modelPath1k: "/assets/models/earth/earth.glb",
    modelPath4k: "/assets/models/earth/4k.glb",
    visualRadius: 0.36 * BODY_VISUAL_SCALE,
    orbit: ORBITAL_ELEMENTS.earth,
    spin: {
      axialTiltDeg: 23.44,
      rotationPeriodHours: 23.934,
    },
    color: "#6CA0FF",
    focusDistanceMultiplier: 10.2,
  },
} satisfies Record<BodyId, BodyVisualConfig>;

export const BODY_LIST: BodyVisualConfig[] = BODY_IDS.map((id) => BODY_CONFIGS[id]);
