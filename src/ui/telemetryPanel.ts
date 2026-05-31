import { createScalarTelemetryChart, type ScalarTelemetryChartRuntime } from "../render/telemetryCharts";
import type { EstimatorMethod, SatelliteStateMessage } from "../sim/satelliteSocket";

export interface TelemetryPanelRuntime {
  element: HTMLElement;
  pushState: (state: SatelliteStateMessage) => void;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  dispose: () => void;
}

export interface TelemetryPanelOptions {
  onEstimatorMethodChange?: (method: EstimatorMethod) => void;
  onBodyRateChange?: (omega: { x: number; y: number; z: number }) => void;
  onOrbitChange?: (orbit: {
    altitudeKm: number;
    inclinationDeg: number;
    raanDeg: number;
    trueAnomalyDeg: number;
  }) => void;
  initialEstimatorMethod?: EstimatorMethod;
  initialBodyRate?: { x: number; y: number; z: number };
  initialOrbit?: {
    altitudeKm: number;
    inclinationDeg: number;
    raanDeg: number;
    trueAnomalyDeg: number;
  };
}

interface ChartGroup {
  title: string;
  description: string;
  items: Array<{
    key: NumericSatelliteField;
    title: string;
    unit: string;
    color: string;
    decimals?: number;
  }>;
}

type NumericSatelliteField = Exclude<keyof SatelliteStateMessage, "type" | "estimatorMethod">;

type TelemetryRecord = SatelliteStateMessage;

const TELEMETRY_EXPORT_COLUMNS: Array<keyof SatelliteStateMessage> = [
  "time",
  "estimatorMethod",
  "x",
  "y",
  "z",
  "qx",
  "qy",
  "qz",
  "qw",
  "omegaX",
  "omegaY",
  "omegaZ",
  "Bx",
  "By",
  "Bz",
  "I_Xp",
  "I_Xm",
  "I_Yp",
  "I_Ym",
  "I_Zp",
  "I_Zm",
  "altitudeKm",
  "semiMajorAxisKm",
  "eccentricity",
  "inclinationDeg",
  "raanDeg",
  "argPeriapsisDeg",
  "meanAnomalyDeg",
  "trueAnomalyDeg",
  "trueAnomalyRad",
  "meanMotionRadPerS",
  "orbitalSpeedKmPerS",
  "radiusKm",
  "periodSeconds",
  "omegaEstimatedX",
  "omegaEstimatedY",
  "omegaEstimatedZ",
  "omegaErrorX",
  "omegaErrorY",
  "omegaErrorZ",
  "qEstimatedX",
  "qEstimatedY",
  "qEstimatedZ",
  "qEstimatedW",
  "qErrorAngleDeg",
];

function formatTelemetryText(records: TelemetryRecord[]): string {
  const columns = TELEMETRY_EXPORT_COLUMNS;

  const headerLines = [
    "# Satellite telemetry export",
    `# Exported at ${new Date().toISOString()}`,
    `# Samples: ${records.length}`,
    `# Columns: ${columns.join("\t")}`,
  ];

  const dataLines = records.map((record) => columns.map((column) => String(record[column])).join("\t"));
  return [...headerLines, ...dataLines].join("\n");
}

function escapeCsvValue(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatTelemetryCsv(records: TelemetryRecord[]): string {
  const columns = TELEMETRY_EXPORT_COLUMNS;
  const headerLine = columns.map((column) => escapeCsvValue(column)).join(",");
  const dataLines = records.map((record) =>
    columns.map((column) => escapeCsvValue(record[column])).join(","),
  );
  return [headerLine, ...dataLines].join("\n");
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createSection(titleText: string, descriptionText: string): { section: HTMLElement; grid: HTMLElement } {
  const section = document.createElement("section");
  section.className = "telemetry-section";

  const header = document.createElement("div");
  header.className = "telemetry-section__header";

  const title = document.createElement("h2");
  title.className = "telemetry-section__title";
  title.textContent = titleText;

  const description = document.createElement("p");
  description.className = "telemetry-section__description";
  description.textContent = descriptionText;

  const grid = document.createElement("div");
  grid.className = "telemetry-grid";

  header.append(title, description);
  section.append(header, grid);

  return { section, grid };
}

function chartForKey(
  title: string,
  unit: string,
  color: string,
  decimals = 3,
): ScalarTelemetryChartRuntime {
  return createScalarTelemetryChart({
    title,
    unit,
    color,
    decimals,
    maxSamples: 720,
  });
}

function createNumberField(
  labelText: string,
  value: number,
  step: number,
  min?: number,
  max?: number,
): { field: HTMLElement; input: HTMLInputElement } {
  const field = document.createElement("label");
  field.className = "telemetry-control-field";

  const label = document.createElement("span");
  label.className = "telemetry-control-field__label";
  label.textContent = labelText;

  const input = document.createElement("input");
  input.className = "telemetry-control-field__input";
  input.type = "number";
  input.step = String(step);
  if (min !== undefined) {
    input.min = String(min);
  }
  if (max !== undefined) {
    input.max = String(max);
  }
  input.value = String(value);

  field.append(label, input);
  return { field, input };
}

export function createTelemetryPanel(options: TelemetryPanelOptions = {}): TelemetryPanelRuntime {
  const root = document.createElement("aside");
  root.className = "telemetry-drawer";
  root.setAttribute("aria-hidden", "true");
  root.dataset.open = "false";

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "telemetry-drawer__backdrop";
  backdrop.setAttribute("aria-label", "Закрыть телеметрию");

  const panel = document.createElement("section");
  panel.className = "telemetry-drawer__panel";

  const topBar = document.createElement("header");
  topBar.className = "telemetry-topbar";

  const headingBlock = document.createElement("div");
  headingBlock.className = "telemetry-topbar__heading";

  const title = document.createElement("h1");
  title.className = "telemetry-topbar__title";
  title.textContent = "Телеметрия спутника";

  const subtitle = document.createElement("p");
  subtitle.className = "telemetry-topbar__subtitle";
  subtitle.textContent =
    "Поток орбиты, ориентации, магнитометра и солнечных панелей из Python-сервера.";

  headingBlock.append(title, subtitle);

  const actions = document.createElement("div");
  actions.className = "telemetry-topbar__actions";

  const sampleCounter = document.createElement("div");
  sampleCounter.className = "telemetry-topbar__counter";
  sampleCounter.textContent = "0 сэмплов";
  actions.append(sampleCounter);

  const methodSelect = document.createElement("select");
  methodSelect.className = "telemetry-select";
  for (const [value, label] of [
    ["boresight", "Магнитометр"],
    ["panels", "Панели"],
    ["ekf", "EKF"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    methodSelect.append(option);
  }
  methodSelect.value = options.initialEstimatorMethod ?? "ekf";
  methodSelect.addEventListener("change", () => {
    options.onEstimatorMethodChange?.(methodSelect.value as EstimatorMethod);
  });
  actions.append(methodSelect);

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "telemetry-button";
  exportButton.textContent = "Экспорт .txt";
  actions.append(exportButton);
  const exportCsvButton = document.createElement("button");
  exportCsvButton.type = "button";
  exportCsvButton.className = "telemetry-button";
  exportCsvButton.textContent = "Р­РєСЃРїРѕСЂС‚ CSV";
  actions.append(exportCsvButton);

  const status = document.createElement("div");
  status.className = "telemetry-status telemetry-status--подключение";
  status.textContent = "подключение";
  actions.append(status);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "telemetry-button telemetry-button--icon";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "Закрыть телеметрию");
  actions.append(closeButton);

  topBar.append(headingBlock, actions);

  const content = document.createElement("div");
  content.className = "telemetry-drawer__content";

  const controlSection = document.createElement("section");
  controlSection.className = "telemetry-section telemetry-section--controls";
  const controlHeader = document.createElement("div");
  controlHeader.className = "telemetry-section__header";
  const controlTitle = document.createElement("h2");
  controlTitle.className = "telemetry-section__title";
  controlTitle.textContent = "Управление симуляцией";
  const controlDescription = document.createElement("p");
  controlDescription.className = "telemetry-section__description";
  controlDescription.textContent = "Ручная установка угловой скорости и орбиты, отправляемая в Python.";
  controlHeader.append(controlTitle, controlDescription);

  const controlGrid = document.createElement("div");
  controlGrid.className = "telemetry-control-grid";

  const omegaInitial = options.initialBodyRate ?? { x: 0, y: 0, z: 0.5 };
  const orbitInitial = options.initialOrbit ?? {
    altitudeKm: 500,
    inclinationDeg: 45,
    raanDeg: 0,
    trueAnomalyDeg: 0,
  };

  const omegaFields = {
    x: createNumberField("ω X", omegaInitial.x, 0.01, -10, 10),
    y: createNumberField("ω Y", omegaInitial.y, 0.01, -10, 10),
    z: createNumberField("ω Z", omegaInitial.z, 0.01, -10, 10),
  };
  const orbitFields = {
    altitudeKm: createNumberField("Высота, км", orbitInitial.altitudeKm, 1, 120, 2000),
    inclinationDeg: createNumberField("Наклонение, °", orbitInitial.inclinationDeg, 0.1, 0, 180),
    raanDeg: createNumberField("RAAN, °", orbitInitial.raanDeg, 0.1, 0, 360),
    trueAnomalyDeg: createNumberField("Ист. аном., °", orbitInitial.trueAnomalyDeg, 0.1, 0, 360),
  };

  const omegaApply = document.createElement("button");
  omegaApply.type = "button";
  omegaApply.className = "telemetry-button telemetry-button--wide";
  omegaApply.textContent = "Применить ω";
  omegaApply.addEventListener("click", () => {
    options.onBodyRateChange?.({
      x: Number.parseFloat(omegaFields.x.input.value),
      y: Number.parseFloat(omegaFields.y.input.value),
      z: Number.parseFloat(omegaFields.z.input.value),
    });
  });

  const orbitApply = document.createElement("button");
  orbitApply.type = "button";
  orbitApply.className = "telemetry-button telemetry-button--wide";
  orbitApply.textContent = "Применить орбиту";
  orbitApply.addEventListener("click", () => {
    options.onOrbitChange?.({
      altitudeKm: Number.parseFloat(orbitFields.altitudeKm.input.value),
      inclinationDeg: Number.parseFloat(orbitFields.inclinationDeg.input.value),
      raanDeg: Number.parseFloat(orbitFields.raanDeg.input.value),
      trueAnomalyDeg: Number.parseFloat(orbitFields.trueAnomalyDeg.input.value),
    });
  });

  const omegaBlock = document.createElement("div");
  omegaBlock.className = "telemetry-control-block";
  omegaBlock.append(
    omegaFields.x.field,
    omegaFields.y.field,
    omegaFields.z.field,
    omegaApply,
  );

  const orbitBlock = document.createElement("div");
  orbitBlock.className = "telemetry-control-block";
  orbitBlock.append(
    orbitFields.altitudeKm.field,
    orbitFields.inclinationDeg.field,
    orbitFields.raanDeg.field,
    orbitFields.trueAnomalyDeg.field,
    orbitApply,
  );

  controlGrid.append(omegaBlock, orbitBlock);
  controlSection.append(controlHeader, controlGrid);

  panel.append(topBar, content);
  root.append(backdrop, panel);
  content.append(controlSection);

  const chartGroups: ChartGroup[] = [
    {
      title: "Параметры орбиты",
      description: "Все орбитальные скаляры аппарата, обновляемые на каждом пакете.",
      items: [
        { key: "altitudeKm", title: "Высота", unit: "км", color: "#7DC6FF", decimals: 3 },
        { key: "semiMajorAxisKm", title: "Большая полуось", unit: "км", color: "#8ED081", decimals: 3 },
        { key: "eccentricity", title: "Эксцентриситет", unit: "", color: "#F7B267", decimals: 6 },
        { key: "inclinationDeg", title: "Наклонение", unit: "°", color: "#D9A7FF", decimals: 3 },
        { key: "raanDeg", title: "RAAN", unit: "°", color: "#F9A03F", decimals: 3 },
        { key: "argPeriapsisDeg", title: "Арг. перицентра", unit: "°", color: "#F06292", decimals: 3 },
        { key: "meanAnomalyDeg", title: "Средняя аномалия", unit: "°", color: "#4DD0E1", decimals: 3 },
        { key: "trueAnomalyDeg", title: "Истинная аномалия", unit: "°", color: "#FFB4A2", decimals: 3 },
        { key: "meanMotionRadPerS", title: "Среднее движение", unit: "рад/с", color: "#90CAF9", decimals: 6 },
        { key: "orbitalSpeedKmPerS", title: "Орбитальная скорость", unit: "км/с", color: "#B8F2E6", decimals: 4 },
        { key: "radiusKm", title: "Радиус", unit: "км", color: "#A7D7FF", decimals: 3 },
        { key: "periodSeconds", title: "Период", unit: "с", color: "#C9C9FF", decimals: 3 },
      ],
    },
    {
      title: "Угловая скорость",
      description: "Истинная, оценённая и ошибка по компонентам в системе тела.",
      items: [
        { key: "omegaX", title: "ω X", unit: "рад/с", color: "#FF7A7A", decimals: 3 },
        { key: "omegaY", title: "ω Y", unit: "рад/с", color: "#77E4A6", decimals: 3 },
        { key: "omegaZ", title: "ω Z", unit: "рад/с", color: "#76A9FF", decimals: 3 },
        { key: "omegaEstimatedX", title: "ω est X", unit: "рад/с", color: "#FFD43B", decimals: 3 },
        { key: "omegaEstimatedY", title: "ω est Y", unit: "рад/с", color: "#FFA94D", decimals: 3 },
        { key: "omegaEstimatedZ", title: "ω est Z", unit: "рад/с", color: "#66D9E8", decimals: 3 },
        { key: "omegaErrorX", title: "Ошибка X", unit: "рад/с", color: "#F783AC", decimals: 4 },
        { key: "omegaErrorY", title: "Ошибка Y", unit: "рад/с", color: "#B197FC", decimals: 4 },
        { key: "omegaErrorZ", title: "Ошибка Z", unit: "рад/с", color: "#74C0FC", decimals: 4 },
      ],
    },
    {
      title: "Оценка ориентации",
      description: "Кватернион EKF и угол ошибки ориентации.",
      items: [
        { key: "qEstimatedX", title: "q est X", unit: "", color: "#FFD43B", decimals: 4 },
        { key: "qEstimatedY", title: "q est Y", unit: "", color: "#FFA94D", decimals: 4 },
        { key: "qEstimatedZ", title: "q est Z", unit: "", color: "#66D9E8", decimals: 4 },
        { key: "qEstimatedW", title: "q est W", unit: "", color: "#B197FC", decimals: 4 },
        { key: "qErrorAngleDeg", title: "Ошибка ориентации", unit: "°", color: "#FF8787", decimals: 3 },
      ],
    },
    {
      title: "Магнитометр",
      description: "Магнитное поле IGRF-14 в системе тела аппарата.",
      items: [
        { key: "Bx", title: "B X", unit: "нТл", color: "#FF6B6B", decimals: 2 },
        { key: "By", title: "B Y", unit: "нТл", color: "#51CF66", decimals: 2 },
        { key: "Bz", title: "B Z", unit: "нТл", color: "#4DABF7", decimals: 2 },
      ],
    },
    {
      title: "Солнечные панели",
      description: "Проекция солнечного потока на шесть граней CubeSat.",
      items: [
        { key: "I_Xp", title: "+X грань", unit: "Вт/м2", color: "#FF8787", decimals: 2 },
        { key: "I_Xm", title: "-X грань", unit: "Вт/м2", color: "#FFA94D", decimals: 2 },
        { key: "I_Yp", title: "+Y грань", unit: "Вт/м2", color: "#69DB7C", decimals: 2 },
        { key: "I_Ym", title: "-Y грань", unit: "Вт/м2", color: "#38D9A9", decimals: 2 },
        { key: "I_Zp", title: "+Z грань", unit: "Вт/м2", color: "#74C0FC", decimals: 2 },
        { key: "I_Zm", title: "-Z грань", unit: "Вт/м2", color: "#9775FA", decimals: 2 },
      ],
    },
  ];

  const chartMap = new Map<NumericSatelliteField, ScalarTelemetryChartRuntime>();
  const chartList: ScalarTelemetryChartRuntime[] = [];
  const telemetryRecords: TelemetryRecord[] = [];

  for (const group of chartGroups) {
    const section = createSection(group.title, group.description);
    content.append(section.section);
    for (const item of group.items) {
      const chart = chartForKey(item.title, item.unit, item.color, item.decimals);
      chartMap.set(item.key, chart);
      chartList.push(chart);
      section.grid.append(chart.element);
    }
  }

  let sampleCount = 0;
  const updateStatus = (text: string, kind: string): void => {
    status.className = `telemetry-status telemetry-status--${kind}`;
    status.textContent = text;
  };

  const setMethodValue = (method: EstimatorMethod): void => {
    methodSelect.value = method;
  };

  const setOpen = (open: boolean): void => {
    root.dataset.open = open ? "true" : "false";
    root.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      window.requestAnimationFrame(() => {
        for (const chart of chartList) {
          chart.refresh();
        }
      });
    }
  };

  const pushState = (state: SatelliteStateMessage): void => {
    sampleCount += 1;
    sampleCounter.textContent = `${sampleCount} сэмплов`;
    updateStatus("онлайн", "онлайн");
    setMethodValue(state.estimatorMethod);
    const storedState = structuredClone(state);
    telemetryRecords.push(storedState);
    for (const [key, chart] of chartMap) {
      chart.push(storedState.time, storedState[key]);
    }
    if (root.dataset.open === "true") {
      window.requestAnimationFrame(() => {
        for (const chart of chartList) {
          chart.refresh();
        }
      });
    }
  };

  exportButton.addEventListener("click", () => {
    if (telemetryRecords.length === 0) {
      updateStatus("нет данных", "подключение");
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadTextFile(`satellite-telemetry-${stamp}.txt`, formatTelemetryText(telemetryRecords));
  });

  exportCsvButton.addEventListener("click", () => {
    if (telemetryRecords.length === 0) {
      updateStatus("РЅРµС‚ РґР°РЅРЅС‹С…", "РїРѕРґРєР»СЋС‡РµРЅРёРµ");
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadTextFile(`satellite-telemetry-${stamp}.csv`, formatTelemetryCsv(telemetryRecords));
  });

  const toggleOpen = (): void => {
    setOpen(root.dataset.open !== "true");
  };

  backdrop.addEventListener("click", () => setOpen(false));
  closeButton.addEventListener("click", () => setOpen(false));
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Escape" && root.dataset.open === "true") {
      setOpen(false);
    }
  };
  window.addEventListener("keydown", onKeyDown);

  return {
    element: root,
    pushState,
    setOpen,
    toggleOpen,
    dispose: () => {
      window.removeEventListener("keydown", onKeyDown);
      root.remove();
    },
  };
}
