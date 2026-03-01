import type { QualityPreset, SimulationState } from "../types";

const MIN_SCALE_DAYS_PER_SECOND = 1 / 64;
const MAX_SCALE_DAYS_PER_SECOND = 256;

function clampScale(value: number): number {
  return Math.min(Math.max(value, MIN_SCALE_DAYS_PER_SECOND), MAX_SCALE_DAYS_PER_SECOND);
}

export class SimulationClock {
  private state: SimulationState;

  constructor(initialState: SimulationState) {
    this.state = {
      currentDate: new Date(initialState.currentDate),
      timeScaleDaysPerSecond: clampScale(initialState.timeScaleDaysPerSecond),
      paused: initialState.paused,
      quality: initialState.quality,
    };
  }

  public tick(deltaSeconds: number): SimulationState {
    if (!this.state.paused) {
      const daysToAdvance = deltaSeconds * this.state.timeScaleDaysPerSecond;
      const milliseconds = daysToAdvance * 86_400_000;
      this.state.currentDate = new Date(this.state.currentDate.getTime() + milliseconds);
    }

    return this.getState();
  }

  public getState(): SimulationState {
    return {
      currentDate: new Date(this.state.currentDate),
      timeScaleDaysPerSecond: this.state.timeScaleDaysPerSecond,
      paused: this.state.paused,
      quality: this.state.quality,
    };
  }

  public togglePause(): void {
    this.state.paused = !this.state.paused;
  }

  public increaseScale(): void {
    this.state.timeScaleDaysPerSecond = clampScale(this.state.timeScaleDaysPerSecond * 2);
  }

  public decreaseScale(): void {
    this.state.timeScaleDaysPerSecond = clampScale(this.state.timeScaleDaysPerSecond / 2);
  }

  public setQuality(quality: QualityPreset): void {
    this.state.quality = quality;
  }
}

export function formatTimeScale(daysPerSecond: number): string {
  if (daysPerSecond >= 1) {
    return `${daysPerSecond.toFixed(daysPerSecond < 10 ? 2 : 1)} day/s`;
  }

  const secondsPerDay = 1 / daysPerSecond;
  return `1 day/${secondsPerDay.toFixed(secondsPerDay < 10 ? 2 : 1)}s`;
}
