import * as THREE from "three";
import { createSolarControls } from "./core/controls";
import { createEngine } from "./core/engine";
import { BODY_IDS, BODY_LIST } from "./data/bodies";
import { createAtmosphereRim, type AtmosphereRimRuntime } from "./render/atmosphereRim";
import { createBodyVisual } from "./render/bodyFactory";
import {
  createOrbitArcRuntime,
  setOrbitVisualResolution,
  updateOrbitArc,
  type OrbitArcRuntime,
} from "./render/orbitMeshes";
import { createPostProcessing } from "./render/postprocessing";
import { createSatelliteVisual } from "./render/satelliteFactory";
import { createStarfieldRuntime } from "./render/starfield";
import { degToRad } from "./sim/orbitMath";
import { propagateSystem } from "./sim/propagator";
import {
  createSatelliteSocket,
  type EstimatorMethod,
  type SatelliteStateMessage,
  type SatelliteSocketRuntime,
} from "./sim/satelliteSocket";
import { SimulationClock } from "./sim/time";
import { createTelemetryPanel } from "./ui/telemetryPanel";
import type { BodyId, BodyVisualConfig, ModelLoadState, OrbitElements } from "./types";
import "./styles/theme.css";

interface RuntimeBody {
  config: BodyVisualConfig;
  root: THREE.Group;
  tilt: THREE.Group;
  spinner: THREE.Group;
  visual: THREE.Object3D;
  cloudLayer: THREE.Object3D | null;
  modelLoadState: ModelLoadState;
  rim: AtmosphereRimRuntime | null;
}

interface FocusRuntimeState {
  focusedTarget: BodyId | "satellite" | null;
  focusLocked: boolean;
  lastFocusedWorldPosition: THREE.Vector3 | null;
  cameraOffset: THREE.Vector3;
  targetOffset: THREE.Vector3;
}

interface PointerClickState {
  active: boolean;
  pointerId: number | null;
  downX: number;
  downY: number;
  downTs: number;
}

interface FocusTransitionState {
  active: boolean;
  bodyId: BodyId | "satellite" | null;
  elapsedSec: number;
  durationSec: number;
  fromCamera: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toCamera: THREE.Vector3;
  toTarget: THREE.Vector3;
}

const FOCUS_TRANSITION_SEC = 0.45;
const CLICK_MAX_DRAG_PX = 6;
const CLICK_MAX_DURATION_MS = 350;
const MIN_HIT_RADIUS_PX = 18;
const MAX_HIT_RADIUS_PX = 76;
const HIT_RADIUS_SCALE = 2.25;
const CINEMATIC_AUTO_EXPOSURE_SPEED = 2.2;
const SECONDS_PER_DAY = 86_400;
const INITIAL_TIME_SCALE_DAYS_PER_SECOND = 1 / SECONDS_PER_DAY;
const SATELLITE_WS_URL =
  import.meta.env.VITE_SATELLITE_WS_URL ?? "ws://127.0.0.1:8765";
const SATELLITE_ORBIT_INCLINATION_DEG = 45;
const SATELLITE_ORBIT_RAAN_DEG = 0;
const SATELLITE_SCENE_UNIT_SCALE = 1 / 1_000_000;
const SATELLITE_ORBIT_ALTITUDE_KM = 500;
const SATELLITE_ORBIT_EARTH_RADIUS_KM = 6_378.137;
const SATELLITE_ORBIT_MU_KM3_S2 = 398_600.4418;
const SATELLITE_ORBIT_RADIUS_KM =
  SATELLITE_ORBIT_EARTH_RADIUS_KM + SATELLITE_ORBIT_ALTITUDE_KM;
const SATELLITE_DISPLAY_GAP_SCENE = 0.18;
const FOCUS_SCREEN_SHIFT = 0.2;
const SATELLITE_POSE_FOLLOW_RATE_BASE = 9.0;
const SATELLITE_POSE_FOLLOW_RATE_SCALE = 0.08;


interface SceneShell {
  viewport: HTMLElement;
  uiRoot: HTMLElement;
}

function createSceneShell(app: HTMLElement): SceneShell {
  app.innerHTML =
    '<div id="viewport" class="viewport"></div><div id="scene-ui" class="scene-ui"></div>';
  const viewport = app.querySelector<HTMLElement>("#viewport");
  const uiRoot = app.querySelector<HTMLElement>("#scene-ui");
  if (!viewport) {
    throw new Error("Viewport initialization failed.");
  }
  if (!uiRoot) {
    throw new Error("Scene UI initialization failed.");
  }
  return { viewport, uiRoot };
}

function geoToSceneVector(geoVector: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(geoVector.x, geoVector.z, geoVector.y);
}

function buildBodyDeltaQuaternion(
  omegaX: number,
  omegaY: number,
  omegaZ: number,
  dt: number,
): THREE.Quaternion {
  const omegaMagnitude = Math.hypot(omegaX, omegaY, omegaZ);
  if (omegaMagnitude <= 1e-9 || Math.abs(dt) <= 1e-9) {
    return new THREE.Quaternion(0, 0, 0, 1);
  }

  const halfAngle = 0.5 * omegaMagnitude * dt;
  const sinHalf = Math.sin(halfAngle);
  const scale = sinHalf / omegaMagnitude;
  return new THREE.Quaternion(
    omegaX * scale,
    omegaY * scale,
    omegaZ * scale,
    Math.cos(halfAngle),
  );
}



function computeSatelliteDisplayRadiusScene(earthVisualRadius: number): number {
  const physicalOrbitRadiusScene = SATELLITE_ORBIT_RADIUS_KM * SATELLITE_SCENE_UNIT_SCALE;
  const stretchedAltitudeScene = physicalOrbitRadiusScene * 35;
  return earthVisualRadius + Math.max(SATELLITE_DISPLAY_GAP_SCENE, stretchedAltitudeScene);
}

function buildSatelliteOrbitElements(orbitVisualScale: number): OrbitElements {
  return {
    epochJd: 2_451_545.0,
    aKm: SATELLITE_ORBIT_RADIUS_KM,
    e: 0,
    iDeg: SATELLITE_ORBIT_INCLINATION_DEG,
    raanDeg: SATELLITE_ORBIT_RAAN_DEG,
    argPeriapsisDeg: 0,
    meanAnomalyDegAtEpoch: 0,
    periodDays: (2 * Math.PI / Math.sqrt(SATELLITE_ORBIT_MU_KM3_S2 / (SATELLITE_ORBIT_RADIUS_KM ** 3))) / 86_400,
    centralBody: "earth",
    orbitVisualScale,
    orbitGapDegrees: 34,
  };
}

function buildSatelliteOrbitElementsFromState(
  state: SatelliteStateMessage,
  orbitVisualScale: number,
): OrbitElements {
  const aKm = state.semiMajorAxisKm || SATELLITE_ORBIT_RADIUS_KM;
  const meanMotionRadPerS = state.meanMotionRadPerS || Math.sqrt(SATELLITE_ORBIT_MU_KM3_S2 / (aKm ** 3));
  return {
    epochJd: 2_451_545.0,
    aKm,
    e: state.eccentricity,
    iDeg: state.inclinationDeg,
    raanDeg: state.raanDeg,
    argPeriapsisDeg: state.argPeriapsisDeg,
    meanAnomalyDegAtEpoch: state.meanAnomalyDeg,
    periodDays: (2 * Math.PI / meanMotionRadPerS) / 86_400,
    centralBody: "earth",
    orbitVisualScale,
    orbitGapDegrees: 34,
  };
}

async function createRuntimeBody(config: BodyVisualConfig): Promise<RuntimeBody> {
  const root = new THREE.Group();
  root.name = `${config.id}-root`;

  const tilt = new THREE.Group();
  tilt.name = `${config.id}-tilt`;
  tilt.rotation.z = degToRad(config.spin.axialTiltDeg);

  const spinner = new THREE.Group();
  spinner.name = `${config.id}-spinner`;

  const { visual, loadState } = await createBodyVisual(config, "1k");
  visual.name = `${config.id}-visual`;
  const cloudLayer = visual.getObjectByName("earth-cloud-layer") ?? null;
  const rim = config.id === "sun" ? null : createAtmosphereRim(config.id, config.visualRadius);

  spinner.add(visual);
  if (rim) {
    tilt.add(rim.root);
  }
  tilt.add(spinner);
  root.add(tilt);

  return {
    config,
    root,
    tilt,
    spinner,
    visual,
    cloudLayer,
    modelLoadState: loadState,
    rim,
  };
}


async function bootstrap(): Promise<void> {
  document.body.dataset.view = "scene";
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("Missing #app mount point.");
  }

  const { viewport, uiRoot } = createSceneShell(app);
  const engine = createEngine(viewport);
  const controls = createSolarControls(engine.camera, engine.renderer.domElement);
  const postProcessing = createPostProcessing(engine.renderer, engine.scene, engine.camera);
  postProcessing.setBloomEnabled(true);

  let satelliteSocket: SatelliteSocketRuntime | null = null;
  const telemetryPanel = createTelemetryPanel({
    initialEstimatorMethod: "ekf",
    initialBodyRate: { x: 0.0, y: 0.0, z: 0.5 },
    initialOrbit: {
      altitudeKm: SATELLITE_ORBIT_ALTITUDE_KM,
      inclinationDeg: SATELLITE_ORBIT_INCLINATION_DEG,
      raanDeg: SATELLITE_ORBIT_RAAN_DEG,
      trueAnomalyDeg: 0,
    },
    onEstimatorMethodChange: (method: EstimatorMethod) => {
      satelliteSocket?.sendCommand({
        type: "set_estimator",
        method,
      });
    },
    onBodyRateChange: (omega) => {
      satelliteSocket?.sendCommand({
        type: "set_body_rate",
        omegaX: omega.x,
        omegaY: omega.y,
        omegaZ: omega.z,
      });
    },
    onOrbitChange: (orbit) => {
      satelliteSocket?.sendCommand({
        type: "set_orbit",
        ...orbit,
      });
    },
  });
  telemetryPanel.setOpen(false);
  uiRoot.append(telemetryPanel.element);

  const sceneToolbar = document.createElement("div");
  sceneToolbar.className = "scene-toolbar";

  const telemetryToggle = document.createElement("button");
  telemetryToggle.type = "button";
  telemetryToggle.className = "scene-toolbar__button";
  telemetryToggle.textContent = "▤";
  telemetryToggle.title = "Телеметрия";
  telemetryToggle.setAttribute("aria-label", "Телеметрия");
  telemetryToggle.addEventListener("click", () => telemetryPanel.toggleOpen());
  sceneToolbar.append(telemetryToggle);
  uiRoot.append(sceneToolbar);

  const starfieldRuntime = createStarfieldRuntime();
  engine.scene.add(starfieldRuntime.root);

  const satelliteVisual = createSatelliteVisual();
  satelliteVisual.root.visible = false;
  satelliteVisual.estimatedAxesRoot.visible = false;
  engine.scene.add(satelliteVisual.root);
  const satelliteGeoPosition = new THREE.Vector3();
  const satelliteSceneOffset = new THREE.Vector3();
  const satelliteRenderedPosition = new THREE.Vector3();
  const satelliteRenderedQuaternion = new THREE.Quaternion();
  const satelliteRenderedEstimatedQuaternion = new THREE.Quaternion();
  let satelliteOrbitArc: OrbitArcRuntime | null = null;
  let satelliteOrbitSignature = "";

  const simClock = new SimulationClock({
    currentDate: new Date(),
    timeScaleDaysPerSecond: INITIAL_TIME_SCALE_DAYS_PER_SECOND,
    paused: false,
    quality: "1k",
  });

  const runtimeBodies = new Map<BodyId, RuntimeBody>();
  const orbitArcs = new Map<BodyId, OrbitArcRuntime>();
  const latestPositions = {} as Record<BodyId, THREE.Vector3>;
  for (const bodyId of BODY_IDS) {
    latestPositions[bodyId] = new THREE.Vector3();
  }

  const buildSatelliteOrbitSignature = (state: SatelliteStateMessage): string => [
    state.altitudeKm.toFixed(6),
    state.semiMajorAxisKm.toFixed(6),
    state.eccentricity.toFixed(8),
    state.inclinationDeg.toFixed(6),
    state.raanDeg.toFixed(6),
    state.argPeriapsisDeg.toFixed(6),
    state.trueAnomalyDeg.toFixed(6),
    state.meanMotionRadPerS.toFixed(9),
  ].join("|");

  const syncSatelliteOrbitArc = (state: SatelliteStateMessage): void => {
    const earthRuntime = runtimeBodies.get("earth");
    if (!earthRuntime) {
      return;
    }

    const signature = buildSatelliteOrbitSignature(state);
    if (signature === satelliteOrbitSignature && satelliteOrbitArc) {
      return;
    }

    const satelliteDisplayRadiusScene = computeSatelliteDisplayRadiusScene(earthRuntime.config.visualRadius);
    const semiMajorAxisKm = state.semiMajorAxisKm || SATELLITE_ORBIT_RADIUS_KM;
    const satelliteOrbitVisualScale =
      satelliteDisplayRadiusScene / (semiMajorAxisKm * SATELLITE_SCENE_UNIT_SCALE);

    if (satelliteOrbitArc) {
      earthRuntime.root.remove(satelliteOrbitArc.mesh);
      satelliteOrbitArc.geometry.dispose();
      satelliteOrbitArc.material.dispose();
    }

    satelliteOrbitArc = createOrbitArcRuntime(
      "satellite",
      buildSatelliteOrbitElementsFromState(state, satelliteOrbitVisualScale),
      "#C9D8FF",
      1024,
    );
    earthRuntime.root.add(satelliteOrbitArc.mesh);
    satelliteOrbitSignature = signature;
  };

  
  let exposureValue = 1.2;
  const previousCameraPosition = engine.camera.position.clone();
  const previousCameraQuaternion = engine.camera.quaternion.clone();
  const cameraDelta = new THREE.Vector3();
  const cameraMotionView = new THREE.Vector3();
  const cameraMotionDirection = new THREE.Vector2();
  const inverseCameraQuaternion = new THREE.Quaternion();
  let latestSatelliteState: SatelliteStateMessage | null = null;
  const latestSatelliteScenePosition = new THREE.Vector3();
  const latestSatelliteQuaternion = new THREE.Quaternion();
  const latestEstimatedQuaternion = new THREE.Quaternion();
  let hasLatestSatelliteQuaternion = false;
  let hasLatestEstimatedQuaternion = false;
  let hasRenderedSatellitePose = false;
  let hasRenderedEstimatedPose = false;
  let visualElapsedSeconds = 0;
  let latestTimeScaleSecondsPerSecond =
    INITIAL_TIME_SCALE_DAYS_PER_SECOND * SECONDS_PER_DAY;
  let latestPaused = false;

  satelliteSocket = createSatelliteSocket({
    url: SATELLITE_WS_URL,
    onState: (state) => {
      const incomingQuat = new THREE.Quaternion(state.qx, state.qy, state.qz, state.qw);
      if (hasLatestSatelliteQuaternion && latestSatelliteQuaternion.dot(incomingQuat) < 0) {
        incomingQuat.x *= -1;
        incomingQuat.y *= -1;
        incomingQuat.z *= -1;
        incomingQuat.w *= -1;
      }

      latestSatelliteQuaternion.copy(incomingQuat);
      hasLatestSatelliteQuaternion = true;
      const estimatedQuat = new THREE.Quaternion(
        state.qEstimatedX,
        state.qEstimatedY,
        state.qEstimatedZ,
        state.qEstimatedW,
      );
      if (hasLatestEstimatedQuaternion && latestEstimatedQuaternion.dot(estimatedQuat) < 0) {
        estimatedQuat.x *= -1;
        estimatedQuat.y *= -1;
        estimatedQuat.z *= -1;
        estimatedQuat.w *= -1;
      }
      latestEstimatedQuaternion.copy(estimatedQuat);
      hasLatestEstimatedQuaternion = true;
      latestSatelliteState = {
        ...state,
        qx: incomingQuat.x,
        qy: incomingQuat.y,
        qz: incomingQuat.z,
        qw: incomingQuat.w,
      };
      syncSatelliteOrbitArc(state);
      telemetryPanel.pushState(state);
    },
    getSyncState: () => ({
      time: visualElapsedSeconds,
      timeScale: latestTimeScaleSecondsPerSecond,
      paused: latestPaused,
    }),
    syncEnabled: true,
  });

  const runtimeBodyList = await Promise.all(BODY_LIST.map((config) => createRuntimeBody(config)));
  for (const runtimeBody of runtimeBodyList) {
    runtimeBodies.set(runtimeBody.config.id, runtimeBody);
    engine.scene.add(runtimeBody.root);
  }

  const initialSnapshot = propagateSystem(BODY_LIST, simClock.getState().currentDate);
  for (const runtimeBody of runtimeBodyList) {
    const bodyId = runtimeBody.config.id;
    const currentPosition = initialSnapshot.positionsScene[bodyId];
    runtimeBody.root.position.copy(currentPosition);
    latestPositions[bodyId].copy(currentPosition);
    runtimeBody.tilt.rotation.z = degToRad(runtimeBody.config.spin.axialTiltDeg);
    runtimeBody.spinner.rotation.y = initialSnapshot.spinAnglesRad[bodyId];
  }

  const earthRuntime = runtimeBodies.get("earth");
  if (earthRuntime) {
    const satelliteDisplayRadiusScene = computeSatelliteDisplayRadiusScene(
      earthRuntime.config.visualRadius,
    );
    const satelliteOrbitVisualScale =
      satelliteDisplayRadiusScene / (SATELLITE_ORBIT_RADIUS_KM * SATELLITE_SCENE_UNIT_SCALE);
    satelliteOrbitArc = createOrbitArcRuntime(
      "satellite",
      buildSatelliteOrbitElements(satelliteOrbitVisualScale),
      "#C9D8FF",
      1024,
    );
    earthRuntime.root.add(satelliteOrbitArc.mesh);
  }

  for (const config of BODY_LIST) {
    if (!config.orbit) {
      continue;
    }

    const orbitArc = createOrbitArcRuntime(config.id, config.orbit, config.color, 1024);
    orbitArcs.set(config.id, orbitArc);

    const parentRuntime = runtimeBodies.get(config.orbit.centralBody);
    if (parentRuntime) {
      parentRuntime.root.add(orbitArc.mesh);
    } else {
      engine.scene.add(orbitArc.mesh);
    }
  }

  const focusState: FocusRuntimeState = {
    focusedTarget: null,
    focusLocked: false,
    lastFocusedWorldPosition: null,
    cameraOffset: new THREE.Vector3(),
    targetOffset: new THREE.Vector3(),
  };

  const pointerState: PointerClickState = {
    active: false,
    pointerId: null,
    downX: 0,
    downY: 0,
    downTs: 0,
  };

  const focusTransition: FocusTransitionState = {
    active: false,
    bodyId: null,
    elapsedSec: 0,
    durationSec: FOCUS_TRANSITION_SEC,
    fromCamera: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    toCamera: new THREE.Vector3(),
    toTarget: new THREE.Vector3(),
  };

  const computeDesiredFocusPose = (
    targetId: BodyId | "satellite",
  ): { cameraPos: THREE.Vector3; targetPos: THREE.Vector3 } | null => {
    const focusedPosition =
      targetId === "satellite"
        ? latestSatelliteScenePosition.clone()
        : latestPositions[targetId].clone();
    const direction = engine.camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 0.000001) {
      direction.set(1, 0.3, 1);
    }
    direction.normalize();

    const runtimeBody = targetId === "satellite" ? undefined : runtimeBodies.get(targetId);
    const focusDistance =
      targetId === "satellite"
        ? 2.25
        : Math.max(
            (runtimeBody?.config.focusDistanceMultiplier ?? 12) *
              (runtimeBody?.config.visualRadius ?? 0.5),
            (runtimeBody?.config.visualRadius ?? 0.5) * 3 + 1.2,
          );
    const screenRight = new THREE.Vector3().crossVectors(direction, engine.camera.up);
    if (screenRight.lengthSq() < 1e-9) {
      screenRight.set(1, 0, 0);
    } else {
      screenRight.normalize();
    }

    return {
      cameraPos: focusedPosition.clone().addScaledVector(direction, focusDistance),
      targetPos: focusedPosition.clone().addScaledVector(screenRight, -focusDistance * FOCUS_SCREEN_SHIFT),
    };
  };

  const pickBodyByScreenProximity = (clientX: number, clientY: number): BodyId | null => {
    const viewportRect = viewport.getBoundingClientRect();
    if (viewportRect.width <= 0 || viewportRect.height <= 0) {
      return null;
    }

    const localX = clientX - viewportRect.left;
    const localY = clientY - viewportRect.top;
    if (
      localX < 0 ||
      localY < 0 ||
      localX > viewportRect.width ||
      localY > viewportRect.height
    ) {
      return null;
    }

    const fovRad = THREE.MathUtils.degToRad(engine.camera.fov);
    let bestBodyId: BodyId | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestDepth = Number.POSITIVE_INFINITY;

    for (const bodyId of BODY_IDS) {
      const runtimeBody = runtimeBodies.get(bodyId);
      if (!runtimeBody) {
        continue;
      }

      const worldPos = latestPositions[bodyId];
      const cameraSpace = worldPos.clone().applyMatrix4(engine.camera.matrixWorldInverse);
      const depth = -cameraSpace.z;
      if (depth <= 0) {
        continue;
      }

      const projected = worldPos.clone().project(engine.camera);
      const screenX = (projected.x * 0.5 + 0.5) * viewportRect.width;
      const screenY = (-projected.y * 0.5 + 0.5) * viewportRect.height;
      const distPx = Math.hypot(screenX - localX, screenY - localY);

      const pxPerWorldY = viewportRect.height / (2 * Math.tan(fovRad / 2) * depth);
      const projectedRadiusPx = runtimeBody.config.visualRadius * pxPerWorldY;
      const hitRadiusPx = THREE.MathUtils.clamp(
        Math.max(projectedRadiusPx * HIT_RADIUS_SCALE, MIN_HIT_RADIUS_PX),
        MIN_HIT_RADIUS_PX,
        MAX_HIT_RADIUS_PX,
      );

      if (distPx > hitRadiusPx) {
        continue;
      }

      const score = distPx + depth * 0.002;
      if (score < bestScore || (Math.abs(score - bestScore) < 0.001 && depth < bestDepth)) {
        bestScore = score;
        bestDepth = depth;
        bestBodyId = bodyId;
      }
    }

    return bestBodyId;
  };

  const startFocus = (targetId: BodyId | "satellite"): void => {
    if (targetId !== "satellite" && !runtimeBodies.get(targetId)) {
      return;
    }

    focusTransition.active = true;
    focusTransition.bodyId = targetId;
    focusTransition.elapsedSec = 0;
    focusTransition.durationSec = FOCUS_TRANSITION_SEC;
    focusTransition.fromCamera.copy(engine.camera.position);
    focusTransition.fromTarget.copy(controls.target);

    const desiredPose = computeDesiredFocusPose(targetId);
    if (desiredPose) {
      focusState.cameraOffset.copy(desiredPose.cameraPos).sub(
        targetId === "satellite" ? latestSatelliteScenePosition : latestPositions[targetId],
      );
      focusState.targetOffset.copy(desiredPose.targetPos).sub(
        targetId === "satellite" ? latestSatelliteScenePosition : latestPositions[targetId],
      );
      focusTransition.toCamera.copy(desiredPose.cameraPos);
      focusTransition.toTarget.copy(desiredPose.targetPos);
    } else {
      focusState.cameraOffset.set(0, 0, 0);
      focusState.targetOffset.set(0, 0, 0);
      focusTransition.toCamera.copy(engine.camera.position);
      focusTransition.toTarget.copy(controls.target);
    }

    focusState.focusedTarget = targetId;
    focusState.focusLocked = false;
    focusState.lastFocusedWorldPosition = null;
  };

  const releaseFocus = (): void => {
    focusTransition.active = false;
    focusTransition.bodyId = null;
    focusTransition.elapsedSec = 0;
    focusTransition.durationSec = FOCUS_TRANSITION_SEC;
    focusState.focusLocked = false;
    focusState.focusedTarget = null;
    focusState.lastFocusedWorldPosition = null;
    focusState.cameraOffset.set(0, 0, 0);
    focusState.targetOffset.set(0, 0, 0);
  };

  const updateSatellitePose = (deltaSeconds: number): void => {
    const earthRuntime = runtimeBodies.get("earth");
    if (!earthRuntime) {
      satelliteVisual.root.visible = false;
      return;
    }

    const currentState = latestSatelliteState;
    if (!currentState) {
      satelliteVisual.root.visible = false;
      return;
    }

    const predictionDt = latestPaused ? 0 : visualElapsedSeconds - currentState.time;
    const clampedPredictionDt = THREE.MathUtils.clamp(predictionDt, -0.35, 0.35);
    const predictedQuat = latestSatelliteQuaternion
      .clone()
      .multiply(
        buildBodyDeltaQuaternion(
          currentState.omegaX,
          currentState.omegaY,
          currentState.omegaZ,
          clampedPredictionDt,
        ),
      );

    satelliteGeoPosition.set(
      currentState.x + currentState.vx * clampedPredictionDt,
      currentState.y + currentState.vy * clampedPredictionDt,
      currentState.z + currentState.vz * clampedPredictionDt,
    );
    satelliteSceneOffset.copy(geoToSceneVector(satelliteGeoPosition));
    if (satelliteSceneOffset.lengthSq() > 0) {
      satelliteSceneOffset.normalize();
    } else {
      satelliteSceneOffset.set(0, 1, 0);
    }

    const satelliteDisplayRadiusScene = computeSatelliteDisplayRadiusScene(earthRuntime.config.visualRadius);
    satelliteVisual.root.position.copy(latestPositions.earth).addScaledVector(
      satelliteSceneOffset,
      satelliteDisplayRadiusScene,
    );
    const targetSatellitePosition = satelliteVisual.root.position.clone();
    const targetSatelliteQuaternion = predictedQuat.clone();
    const followRate = SATELLITE_POSE_FOLLOW_RATE_BASE + Math.min(
      18.0,
      latestTimeScaleSecondsPerSecond * SATELLITE_POSE_FOLLOW_RATE_SCALE,
    );
    const followAlpha = hasRenderedSatellitePose
      ? 1 - Math.exp(-followRate * deltaSeconds)
      : 1;
    if (!hasRenderedSatellitePose) {
      satelliteRenderedPosition.copy(targetSatellitePosition);
      satelliteRenderedQuaternion.copy(targetSatelliteQuaternion);
      hasRenderedSatellitePose = true;
    } else {
      satelliteRenderedPosition.lerp(targetSatellitePosition, followAlpha);
      satelliteRenderedQuaternion.slerp(targetSatelliteQuaternion, followAlpha);
    }
    satelliteVisual.root.position.copy(satelliteRenderedPosition);
    satelliteVisual.root.quaternion.copy(satelliteRenderedQuaternion);
    satelliteVisual.estimatedAxesRoot.visible =
      currentState.estimatorMethod === "ekf" && hasLatestEstimatedQuaternion;
    if (satelliteVisual.estimatedAxesRoot.visible) {
      const relativeEstimatedQuaternion = latestSatelliteQuaternion
        .clone()
        .invert()
        .multiply(latestEstimatedQuaternion);
      if (!hasRenderedEstimatedPose) {
        satelliteRenderedEstimatedQuaternion.copy(relativeEstimatedQuaternion);
        hasRenderedEstimatedPose = true;
      } else {
        satelliteRenderedEstimatedQuaternion.slerp(relativeEstimatedQuaternion, followAlpha);
      }
      satelliteVisual.estimatedAxesRoot.quaternion.copy(satelliteRenderedEstimatedQuaternion);
    }
    satelliteVisual.root.visible = true;

    latestSatelliteScenePosition.copy(satelliteVisual.root.position);
  };

  const resetPointerState = (): void => {
    pointerState.active = false;
    pointerState.pointerId = null;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }

    pointerState.active = true;
    pointerState.pointerId = event.pointerId;
    pointerState.downX = event.clientX;
    pointerState.downY = event.clientY;
    pointerState.downTs = performance.now();
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!pointerState.active || pointerState.pointerId !== event.pointerId) {
      return;
    }

    const dragPx = Math.hypot(
      event.clientX - pointerState.downX,
      event.clientY - pointerState.downY,
    );
    const durationMs = performance.now() - pointerState.downTs;
    resetPointerState();

    if (dragPx > CLICK_MAX_DRAG_PX || durationMs > CLICK_MAX_DURATION_MS) {
      return;
    }

    const pickedBody = pickBodyByScreenProximity(event.clientX, event.clientY);
    if (pickedBody) {
      startFocus(pickedBody);
    }
  };

  const onPointerCancel = (): void => {
    resetPointerState();
  };

  const onWindowBlur = (): void => {
    resetPointerState();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Space") {
      event.preventDefault();
      simClock.togglePause();
      satelliteSocket.syncNow();
      return;
    }

    if (event.code === "BracketLeft" || event.code === "Minus") {
      simClock.decreaseScale();
      satelliteSocket.syncNow();
      return;
    }

    if (event.code === "BracketRight" || event.code === "Equal") {
      simClock.increaseScale();
      satelliteSocket.syncNow();
      return;
    }

    if (event.code === "Digit1") {
      startFocus("sun");
      return;
    }

    if (event.code === "Digit2") {
      startFocus("earth");
      return;
    }

    if (event.code === "Digit3") {
      startFocus("satellite");
      return;
    }

    if (event.code === "Escape") {
      releaseFocus();
    }
  };

  const onResize = (): void => {
    const viewportWidth = viewport.clientWidth || window.innerWidth;
    const viewportHeight = viewport.clientHeight || window.innerHeight;
    engine.setSize(viewportWidth, viewportHeight);
    postProcessing.setSize(viewportWidth, viewportHeight);

    for (const orbitArc of orbitArcs.values()) {
      setOrbitVisualResolution(orbitArc, viewportWidth, viewportHeight);
    }
    if (satelliteOrbitArc) {
      setOrbitVisualResolution(satelliteOrbitArc, viewportWidth, viewportHeight);
    }
  };

  const rendererDomElement = engine.renderer.domElement;
  rendererDomElement.addEventListener("pointerdown", onPointerDown);
  rendererDomElement.addEventListener("pointerup", onPointerUp);
  rendererDomElement.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", onResize);
  onResize();

  let animationFrameId = 0;

  const animate = (): void => {
    animationFrameId = window.requestAnimationFrame(animate);
    const deltaSeconds = engine.clock.getDelta();

    simClock.tick(deltaSeconds);
    const state = simClock.getState();
    latestTimeScaleSecondsPerSecond = state.timeScaleDaysPerSecond * SECONDS_PER_DAY;
    latestPaused = state.paused;
    if (!state.paused) {
      visualElapsedSeconds += deltaSeconds * latestTimeScaleSecondsPerSecond;
    }

    const snapshot = propagateSystem(BODY_LIST, state.currentDate);

    for (const runtimeBody of runtimeBodies.values()) {
      const bodyId = runtimeBody.config.id;
      const currentPosition = snapshot.positionsScene[bodyId];
      runtimeBody.root.position.copy(currentPosition);
      latestPositions[bodyId].copy(currentPosition);
      runtimeBody.tilt.rotation.z = degToRad(runtimeBody.config.spin.axialTiltDeg);
      runtimeBody.spinner.rotation.y = snapshot.spinAnglesRad[bodyId];
      if (runtimeBody.cloudLayer) {
        runtimeBody.cloudLayer.rotation.y += deltaSeconds * 0.04;
      }
    }

    for (const [bodyId, orbitArc] of orbitArcs) {
      const trueAnomaly = snapshot.trueAnomaliesRad[bodyId] ?? 0;
      updateOrbitArc(orbitArc, trueAnomaly);
    }

    updateSatellitePose(deltaSeconds);
    if (satelliteOrbitArc) {
      const trueAnomaly =
        latestSatelliteState?.trueAnomalyRad ??
        Math.sqrt(SATELLITE_ORBIT_MU_KM3_S2 / (SATELLITE_ORBIT_RADIUS_KM ** 3)) * visualElapsedSeconds;
      updateOrbitArc(satelliteOrbitArc, trueAnomaly);
    }

    if (focusTransition.active && focusTransition.bodyId) {
      focusTransition.elapsedSec += deltaSeconds;
      const transitionProgress = THREE.MathUtils.clamp(
        focusTransition.elapsedSec / focusTransition.durationSec,
        0,
        1,
      );
      const easedProgress =
        transitionProgress * transitionProgress * (3 - 2 * transitionProgress);
      engine.camera.position.lerpVectors(
        focusTransition.fromCamera,
        focusTransition.toCamera,
        easedProgress,
      );
      controls.target.lerpVectors(
        focusTransition.fromTarget,
        focusTransition.toTarget,
        easedProgress,
      );

      if (transitionProgress >= 1) {
        focusTransition.active = false;
        focusTransition.bodyId = null;
        focusTransition.elapsedSec = 0;
        focusTransition.durationSec = FOCUS_TRANSITION_SEC;
        focusState.focusLocked = true;
        const lockedTarget = focusState.focusedTarget;
        focusState.lastFocusedWorldPosition =
          lockedTarget === "satellite"
            ? latestSatelliteScenePosition.clone()
            : lockedTarget
              ? latestPositions[lockedTarget].clone()
              : null;
      }
    } else if (focusState.focusLocked && focusState.focusedTarget) {
      const focusedPosition =
        focusState.focusedTarget === "satellite"
          ? latestSatelliteScenePosition
          : latestPositions[focusState.focusedTarget];
      if (!focusState.lastFocusedWorldPosition) {
        focusState.lastFocusedWorldPosition = focusedPosition.clone();
      }
      focusState.lastFocusedWorldPosition.copy(focusedPosition);
      controls.target.copy(focusedPosition).add(focusState.targetOffset);
    }

    controls.update();
    starfieldRuntime.update(deltaSeconds, engine.camera.position);

    cameraDelta.subVectors(engine.camera.position, previousCameraPosition);
    inverseCameraQuaternion.copy(engine.camera.quaternion).invert();
    cameraMotionView.copy(cameraDelta).applyQuaternion(inverseCameraQuaternion);

    cameraMotionDirection.set(-cameraMotionView.x, cameraMotionView.y);
    if (cameraMotionDirection.lengthSq() > 0.0000001) {
      cameraMotionDirection.normalize();
    } else {
      cameraMotionDirection.set(0, 0);
    }

    const quaternionDot = THREE.MathUtils.clamp(
      Math.abs(previousCameraQuaternion.dot(engine.camera.quaternion)),
      0,
      1,
    );
    const rotationDelta = 2 * Math.acos(quaternionDot);
    const motionStrength = THREE.MathUtils.clamp(
      cameraDelta.length() * 0.36 + rotationDelta * 0.58,
      0,
      0.24,
    );
    postProcessing.setMotionBlur(cameraMotionDirection, motionStrength);

    previousCameraPosition.copy(engine.camera.position);
    previousCameraQuaternion.copy(engine.camera.quaternion);

    const cameraDistanceToSun = engine.camera.position.length();
    const targetExposure = THREE.MathUtils.clamp(
      1.62 - Math.log2(cameraDistanceToSun + 1) * 0.17,
      0.82,
      1.55,
    );
    const exposureLerp = 1 - Math.exp(-CINEMATIC_AUTO_EXPOSURE_SPEED * deltaSeconds);
    exposureValue = THREE.MathUtils.lerp(exposureValue, targetExposure, exposureLerp);
    engine.setExposure(exposureValue);

    const hasFocus = focusTransition.active || (focusState.focusLocked && !!focusState.focusedTarget);
    const focusDistance = hasFocus
      ? Math.max(1.0, engine.camera.position.distanceTo(controls.target))
      : undefined;
    postProcessing.setDofEnabled(hasFocus, focusDistance);
    postProcessing.render(deltaSeconds);
  };

  updateSatellitePose(0);
  animate();

  const onBeforeUnload = (): void => {
    window.cancelAnimationFrame(animationFrameId);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("blur", onWindowBlur);
    window.removeEventListener("beforeunload", onBeforeUnload);
    rendererDomElement.removeEventListener("pointerdown", onPointerDown);
    rendererDomElement.removeEventListener("pointerup", onPointerUp);
    rendererDomElement.removeEventListener("pointercancel", onPointerCancel);
    controls.dispose();
    satelliteSocket?.dispose();
    telemetryPanel.dispose();
    starfieldRuntime.dispose();
    postProcessing.dispose();
    engine.dispose();

    for (const orbitArc of orbitArcs.values()) {
      orbitArc.geometry.dispose();
      orbitArc.material.dispose();
    }
    if (satelliteOrbitArc) {
      satelliteOrbitArc.geometry.dispose();
      satelliteOrbitArc.material.dispose();
    }

    for (const runtimeBody of runtimeBodies.values()) {
      runtimeBody.rim?.dispose();
    }

    satelliteVisual.dispose();
  };

  window.addEventListener("beforeunload", onBeforeUnload);
}

void bootstrap().catch((error: unknown) => {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (app) {
    app.innerHTML = `
      <main class="boot-error">
        <h1>BOOT FAILURE</h1>
        <p>${error instanceof Error ? error.message : "Unknown startup error."}</p>
      </main>
    `;
  }

  console.error(error);
});
