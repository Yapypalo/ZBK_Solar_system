import type { BodyCardContent, BodyId } from "../types";

export const BODY_CARDS: Record<BodyId, BodyCardContent> = {
  sun: {
    id: "sun",
    kind: "star",
    titleRu: "Солнце",
    subtitleEn: "G2V MAIN-SEQUENCE STAR",
    summaryRu:
      "Центральный энергетический узел системы. Формирует световой профиль сцены и задает базовую динамику для всех орбитальных тел.",
    facts: [
      { labelEn: "MEAN RADIUS", value: "695,700 km" },
      { labelEn: "SURFACE TEMP", value: "5,500 C" },
      { labelEn: "ROTATION", value: "~25 days (equator)" },
      { labelEn: "MASS SHARE", value: "99.86% of Solar System" },
      { labelEn: "SPECTRAL CLASS", value: "G2V" },
    ],
  },
  mercury: {
    id: "mercury",
    kind: "planet",
    titleRu: "Меркурий",
    subtitleEn: "INNER ROCKY PLANET",
    summaryRu:
      "Самая близкая к Солнцу планета. Имеет резкие перепады температур и плотную связь орбитальной скорости с близостью к звезде.",
    facts: [
      { labelEn: "MEAN RADIUS", value: "2,440 km" },
      { labelEn: "ORBIT PERIOD", value: "87.97 days" },
      { labelEn: "ROTATION", value: "58.65 days" },
      { labelEn: "GRAVITY", value: "3.7 m/s^2" },
      { labelEn: "ATMOSPHERE", value: "Extremely thin exosphere" },
    ],
  },
  venus: {
    id: "venus",
    kind: "planet",
    titleRu: "Венера",
    subtitleEn: "RETROGRADE PLANET",
    summaryRu:
      "Планета с плотной атмосферой и ретроградным вращением. Визуально яркий объект, но с экстремально суровыми условиями на поверхности.",
    facts: [
      { labelEn: "MEAN RADIUS", value: "6,052 km" },
      { labelEn: "ORBIT PERIOD", value: "224.70 days" },
      { labelEn: "ROTATION", value: "243 days (retrograde)" },
      { labelEn: "SURFACE TEMP", value: "~465 C" },
      { labelEn: "PRESSURE", value: "~92 bar" },
    ],
  },
  earth: {
    id: "earth",
    kind: "planet",
    titleRu: "Земля",
    subtitleEn: "HABITABLE REFERENCE WORLD",
    summaryRu:
      "Опорная планета для масштабов и ориентации системы. Имеет активную атмосферу, магнитное поле и стабильный спутник для динамики сцены.",
    facts: [
      { labelEn: "MEAN RADIUS", value: "6,371 km" },
      { labelEn: "ORBIT PERIOD", value: "365.26 days" },
      { labelEn: "ROTATION", value: "23h 56m" },
      { labelEn: "GRAVITY", value: "9.81 m/s^2" },
      { labelEn: "SATELLITES", value: "1 natural moon" },
    ],
  },
  mars: {
    id: "mars",
    kind: "planet",
    titleRu: "Марс",
    subtitleEn: "OUTER ROCKY PLANET",
    summaryRu:
      "Планета с выраженной эллиптичностью орбиты и двумя малыми спутниками. Ключевой узел для демонстрации локальных спутниковых орбит.",
    facts: [
      { labelEn: "MEAN RADIUS", value: "3,390 km" },
      { labelEn: "ORBIT PERIOD", value: "686.98 days" },
      { labelEn: "ROTATION", value: "24h 37m" },
      { labelEn: "GRAVITY", value: "3.71 m/s^2" },
      { labelEn: "SATELLITES", value: "Phobos, Deimos" },
    ],
  },
  moon: {
    id: "moon",
    kind: "satellite",
    titleRu: "Луна",
    subtitleEn: "EARTH NATURAL SATELLITE",
    summaryRu:
      "Крупный спутник Земли с синхронным вращением. В системе служит примером вложенной орбиты с собственным периодом и наклонением.",
    facts: [
      { labelEn: "MEAN RADIUS", value: "1,737 km" },
      { labelEn: "ORBIT PERIOD", value: "27.32 days" },
      { labelEn: "ROTATION", value: "27.32 days (tidal lock)" },
      { labelEn: "DISTANCE TO EARTH", value: "~384,400 km" },
      { labelEn: "GRAVITY", value: "1.62 m/s^2" },
    ],
  },
  phobos: {
    id: "phobos",
    kind: "satellite",
    titleRu: "Фобос",
    subtitleEn: "INNER MARTIAN MOON",
    summaryRu:
      "Быстрый внутренний спутник Марса. На орбите движется очень динамично и хорошо показывает поведение близких к планете траекторий.",
    facts: [
      { labelEn: "MEAN RADIUS", value: "~11 km" },
      { labelEn: "ORBIT PERIOD", value: "7h 39m" },
      { labelEn: "SEMI-MAJOR AXIS", value: "~9,376 km from Mars center" },
      { labelEn: "ROTATION", value: "Synchronous" },
      { labelEn: "SURFACE", value: "Heavily cratered" },
    ],
  },
  deimos: {
    id: "deimos",
    kind: "satellite",
    titleRu: "Деймос",
    subtitleEn: "OUTER MARTIAN MOON",
    summaryRu:
      "Внешний малый спутник Марса с более спокойной орбитальной динамикой. Используется как контраст к быстрому движению Фобоса.",
    facts: [
      { labelEn: "MEAN RADIUS", value: "~6 km" },
      { labelEn: "ORBIT PERIOD", value: "30h 18m" },
      { labelEn: "SEMI-MAJOR AXIS", value: "~23,460 km from Mars center" },
      { labelEn: "ROTATION", value: "Synchronous" },
      { labelEn: "ALBEDO", value: "Low, dark surface" },
    ],
  },
};
