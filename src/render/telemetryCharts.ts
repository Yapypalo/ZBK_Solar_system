export interface ScalarTelemetryChartOptions {
  title: string;
  unit: string;
  color: string;
  decimals?: number;
  maxSamples?: number;
}

export interface ScalarTelemetryChartRuntime {
  element: HTMLElement;
  push: (time: number, value: number) => void;
  clear: () => void;
  refresh: () => void;
}

interface Sample {
  time: number;
  value: number;
}

function resizeCanvasToDisplaySize(canvas: HTMLCanvasElement): void {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * ratio));
  const height = Math.max(1, Math.floor(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function niceRange(minValue: number, maxValue: number): [number, number] {
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return [-1, 1];
  }
  if (Math.abs(maxValue - minValue) < 1e-9) {
    const pad = Math.max(1, Math.abs(minValue) * 0.1);
    return [minValue - pad, maxValue + pad];
  }
  const padding = (maxValue - minValue) * 0.12;
  return [minValue - padding, maxValue + padding];
}

export function createScalarTelemetryChart(
  options: ScalarTelemetryChartOptions,
): ScalarTelemetryChartRuntime {
  const maxSamples = options.maxSamples ?? 480;
  const decimals = options.decimals ?? 3;
  const samples: Sample[] = [];

  const element = document.createElement("article");
  element.className = "telemetry-card";

  const header = document.createElement("div");
  header.className = "telemetry-card__header";

  const title = document.createElement("div");
  title.className = "telemetry-card__title";
  title.textContent = options.title;

  const value = document.createElement("div");
  value.className = "telemetry-card__value";
  value.textContent = `0.${"0".repeat(Math.max(0, decimals))} ${options.unit}`.trim();

  header.append(title, value);

  const canvas = document.createElement("canvas");
  canvas.className = "telemetry-card__chart";

  element.append(header, canvas);

  const render = (): void => {
    resizeCanvasToDisplaySize(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "rgba(7, 10, 18, 0.88)";
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (let index = 0; index <= 4; index += 1) {
      const y = Math.round((height * index) / 4) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    for (let index = 0; index <= 5; index += 1) {
      const x = Math.round((width * index) / 5) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    if (samples.length < 2) {
      return;
    }

    let minValue = samples[0].value;
    let maxValue = samples[0].value;
    for (const sample of samples) {
      minValue = Math.min(minValue, sample.value);
      maxValue = Math.max(maxValue, sample.value);
    }
    [minValue, maxValue] = niceRange(minValue, maxValue);
    const minTime = samples[0].time;
    const maxTime = samples[samples.length - 1].time;
    const timeSpan = Math.max(1e-6, maxTime - minTime);
    const valueSpan = Math.max(1e-6, maxValue - minValue);

    ctx.strokeStyle = options.color;
    ctx.lineWidth = Math.max(2.5 * (window.devicePixelRatio || 1), 2);
    ctx.shadowColor = options.color;
    ctx.shadowBlur = 6 * (window.devicePixelRatio || 1);
    ctx.beginPath();
    samples.forEach((sample, index) => {
      const x = ((sample.time - minTime) / timeSpan) * width;
      const y = height - ((sample.value - minValue) / valueSpan) * height;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

    const latest = samples[samples.length - 1];
    const latestNormalized = (latest.value - minValue) / valueSpan;
    const latestY = height - latestNormalized * height;
    ctx.fillStyle = options.color;
    ctx.beginPath();
    ctx.arc(width - 6 * (window.devicePixelRatio || 1), latestY, 3.5 * (window.devicePixelRatio || 1), 0, Math.PI * 2);
    ctx.fill();
  };

  const onResize = (): void => {
    render();
  };

  window.addEventListener("resize", onResize);
  const resizeObserver = new ResizeObserver(() => {
    render();
  });
  resizeObserver.observe(element);

  const push = (time: number, nextValue: number): void => {
    if (!Number.isFinite(time) || !Number.isFinite(nextValue)) {
      return;
    }
    samples.push({ time, value: nextValue });
    while (samples.length > maxSamples) {
      samples.shift();
    }
    value.textContent = `${nextValue.toFixed(decimals)} ${options.unit}`.trim();
    render();
  };

  render();

  return {
    element,
    push,
    clear: () => {
      samples.length = 0;
      value.textContent = `0.${"0".repeat(Math.max(0, decimals))} ${options.unit}`.trim();
      render();
    },
    refresh: render,
  };
}
