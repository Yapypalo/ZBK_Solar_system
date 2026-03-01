import type { BodyId, BodyVisualConfig } from "../types";
import { ORBITAL_ELEMENTS } from "./orbitalElements";

export const BODY_VISUAL_SCALE = 2.1;

export const BODY_IDS: BodyId[] = [
  "sun",
  "mercury",
  "venus",
  "earth",
  "mars",
  "moon",
  "phobos",
  "deimos",
];

export const BODY_CONFIGS: Record<BodyId, BodyVisualConfig> = {
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
  mercury: {
    id: "mercury",
    name: "Mercury",
    modelPath1k: "/assets/models/mercury/mercury.glb",
    modelPath4k: "/assets/models/mercury/4k.glb",
    visualRadius: 0.3 * BODY_VISUAL_SCALE,
    orbit: ORBITAL_ELEMENTS.mercury,
    spin: {
      axialTiltDeg: 0.034,
      rotationPeriodHours: 1407.6,
    },
    color: "#A4A6A8",
    focusDistanceMultiplier: 11.4,
  },
  venus: {
    id: "venus",
    name: "Venus",
    modelPath1k: "/assets/models/venus/venus.glb",
    modelPath4k: "/assets/models/venus/4k.glb",
    visualRadius: 0.46 * BODY_VISUAL_SCALE,
    orbit: ORBITAL_ELEMENTS.venus,
    spin: {
      axialTiltDeg: 177.36,
      rotationPeriodHours: 5832.5,
      retrograde: true,
    },
    color: "#CFB46F",
    focusDistanceMultiplier: 10.4,
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
  mars: {
    id: "mars",
    name: "Mars",
    modelPath1k: "/assets/models/mars/mars.glb",
    modelPath4k: "/assets/models/mars/4k.glb",
    visualRadius: 0.34 * BODY_VISUAL_SCALE,
    orbit: ORBITAL_ELEMENTS.mars,
    spin: {
      axialTiltDeg: 25.19,
      rotationPeriodHours: 24.623,
    },
    color: "#C17054",
    focusDistanceMultiplier: 10.8,
  },
  moon: {
    id: "moon",
    name: "Moon",
    modelPath1k: "/assets/models/moon/moon.glb",
    modelPath4k: "/assets/models/moon/4k.glb",
    visualRadius: 0.14 * BODY_VISUAL_SCALE,
    orbit: ORBITAL_ELEMENTS.moon,
    spin: {
      axialTiltDeg: 6.68,
      rotationPeriodHours: 655.728,
    },
    color: "#BDC0C5",
    focusDistanceMultiplier: 12.5,
  },
  phobos: {
    id: "phobos",
    name: "Phobos",
    modelPath1k: "/assets/models/phobos/phobos.glb",
    modelPath4k: "/assets/models/phobos/4k.glb",
    visualRadius: 0.08 * BODY_VISUAL_SCALE,
    orbit: ORBITAL_ELEMENTS.phobos,
    spin: {
      axialTiltDeg: 0.0,
      rotationPeriodHours: 7.66,
    },
    color: "#A99A85",
    focusDistanceMultiplier: 13.5,
  },
  deimos: {
    id: "deimos",
    name: "Deimos",
    modelPath1k: "/assets/models/deimos/deimos.glb",
    modelPath4k: "/assets/models/deimos/4k.glb",
    visualRadius: 0.085 * BODY_VISUAL_SCALE,
    orbit: ORBITAL_ELEMENTS.deimos,
    spin: {
      axialTiltDeg: 0.0,
      rotationPeriodHours: 30.35,
    },
    color: "#8F8980",
    focusDistanceMultiplier: 14.5,
  },
};

export const BODY_LIST: BodyVisualConfig[] = BODY_IDS.map((id) => BODY_CONFIGS[id]);
