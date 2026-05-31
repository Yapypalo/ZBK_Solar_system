export type EstimatorMethod = "boresight" | "panels" | "ekf";

export interface SatelliteStateMessage {
  type: "state";
  time: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  omegaX: number;
  omegaY: number;
  omegaZ: number;
  Bx: number;
  By: number;
  Bz: number;
  I_Xp: number;
  I_Xm: number;
  I_Yp: number;
  I_Ym: number;
  I_Zp: number;
  I_Zm: number;
  altitudeKm: number;
  semiMajorAxisKm: number;
  eccentricity: number;
  inclinationDeg: number;
  raanDeg: number;
  argPeriapsisDeg: number;
  meanAnomalyDeg: number;
  trueAnomalyDeg: number;
  trueAnomalyRad: number;
  meanMotionRadPerS: number;
  orbitalSpeedKmPerS: number;
  radiusKm: number;
  periodSeconds: number;
  estimatorMethod: EstimatorMethod;
  omegaEstimatedX: number;
  omegaEstimatedY: number;
  omegaEstimatedZ: number;
  omegaErrorX: number;
  omegaErrorY: number;
  omegaErrorZ: number;
  qEstimatedX: number;
  qEstimatedY: number;
  qEstimatedZ: number;
  qEstimatedW: number;
  qErrorAngleDeg: number;
}

export interface SatelliteSyncState {
  time: number;
  timeScale: number;
  paused: boolean;
}

export interface SatelliteSocketRuntime {
  syncNow: () => void;
  sendCommand: (payload: Record<string, unknown>) => void;
  dispose: () => void;
}

interface SatelliteSocketOptions {
  url: string;
  onState: (state: SatelliteStateMessage) => void;
  getSyncState: () => SatelliteSyncState;
  syncEnabled?: boolean;
}

const RECONNECT_DELAY_MS = 1_200;
const SYNC_INTERVAL_MS = 1_000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseSatelliteState(raw: unknown): SatelliteStateMessage | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Partial<SatelliteStateMessage>;
  const estimatorMethod = candidate.estimatorMethod;
  const numericFields: Array<keyof Omit<SatelliteStateMessage, "type">> = [
    "time",
    "x",
    "y",
    "z",
    "vx",
    "vy",
    "vz",
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
  if (
    candidate.type !== "state" ||
    (estimatorMethod !== "boresight" &&
      estimatorMethod !== "panels" &&
      estimatorMethod !== "ekf") ||
    numericFields.some((key) => !isFiniteNumber(candidate[key]))
  ) {
    return null;
  }

  return candidate as SatelliteStateMessage;
}

export function createSatelliteSocket(options: SatelliteSocketOptions): SatelliteSocketRuntime {
  let socket: WebSocket | null = null;
  let disposed = false;
  let reconnectTimer: number | null = null;
  let syncTimer: number | null = null;
  const syncEnabled = options.syncEnabled ?? true;

  const clearReconnectTimer = (): void => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const clearSyncTimer = (): void => {
    if (syncTimer !== null) {
      window.clearInterval(syncTimer);
      syncTimer = null;
    }
  };

  const sendSync = (): void => {
    if (!syncEnabled) {
      return;
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "sync",
        ...options.getSyncState(),
      }),
    );
  };

  const sendCommand = (payload: Record<string, unknown>): void => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(payload));
  };

  const scheduleReconnect = (): void => {
    if (disposed || reconnectTimer !== null) {
      return;
    }
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  };

  const connect = (): void => {
    if (disposed) {
      return;
    }

    clearReconnectTimer();
    clearSyncTimer();
    socket = new WebSocket(options.url);

    socket.addEventListener("open", () => {
      if (syncEnabled) {
        sendSync();
        syncTimer = window.setInterval(sendSync, SYNC_INTERVAL_MS);
      }
    });

    socket.addEventListener("message", (event) => {
      try {
        const parsed = parseSatelliteState(JSON.parse(String(event.data)));
        if (parsed) {
          options.onState(parsed);
        }
      } catch {
        // Ignore malformed diagnostic or partial messages.
      }
    });

    socket.addEventListener("close", () => {
      clearSyncTimer();
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      socket?.close();
    });
  };

  connect();

  return {
    syncNow: sendSync,
    sendCommand,
    dispose: () => {
      disposed = true;
      clearReconnectTimer();
      clearSyncTimer();
      socket?.close();
      socket = null;
    },
  };
}
