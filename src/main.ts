import * as THREE from "three";
import { createSolarControls } from "./core/controls";
import { createEngine } from "./core/engine";
import { BODY_IDS, BODY_LIST } from "./data/bodies";
import { createBodyVisual } from "./render/bodyFactory";
import {
  createOrbitArcRuntime,
  setOrbitVisualResolution,
  updateOrbitArc,
  type OrbitArcRuntime,
} from "./render/orbitMeshes";
import { createPostProcessing } from "./render/postprocessing";
import { createStarfield } from "./render/starfield";
import { degToRad } from "./sim/orbitMath";
import { propagateSystem } from "./sim/propagator";
import { formatTimeScale, SimulationClock } from "./sim/time";
import type {
  BodyId,
  BodyVisualConfig,
  ModelLoadState,
  QualityPreset,
} from "./types";
import "./styles/theme.css";

const ORBIT_GAP_UPDATE_STEP_RAD = degToRad(0.15);

interface RuntimeBody {
  config: BodyVisualConfig;
  root: THREE.Group;
  tilt: THREE.Group;
  spinner: THREE.Group;
  visual: THREE.Object3D;
  modelLoadState: ModelLoadState;
}

interface BodyButtonEntry {
  button: HTMLButtonElement;
  status: HTMLSpanElement;
}

interface FocusRuntimeState {
  focusedBodyId: BodyId | null;
  focusLocked: boolean;
  lastFocusedWorldPosition: THREE.Vector3 | null;
}

interface HudRefs {
  viewport: HTMLElement;
  dateValue: HTMLElement;
  scaleValue: HTMLElement;
  qualityValue: HTMLElement;
  fpsValue: HTMLElement;
  focusValue: HTMLElement;
  bodyList: HTMLElement;
  releaseFocusButton: HTMLButtonElement;
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "UTC",
});

function createHud(app: HTMLElement): HudRefs {
  app.innerHTML = `
    <div id="viewport" class="viewport"></div>
    <aside class="hud">
      <div class="hud__brand" data-glitch="ZBK INC.">ZBK INC.</div>
      <div class="hud__title">APOLLO - MISSION CONTROL</div>
      <div class="hud__stats">
        <div class="hud__row"><span>T+</span><span id="hud-date">--</span></div>
        <div class="hud__row"><span>TIME SCALE</span><span id="hud-scale">1 day/s</span></div>
        <div class="hud__row"><span>MODEL LOD</span><span id="hud-quality">1k</span></div>
        <div class="hud__row"><span>FOCUS</span><span id="hud-focus">FREE</span></div>
        <div class="hud__row"><span>FPS</span><span id="hud-fps">0</span></div>
      </div>
      <div class="hud__section-title">CELESTIAL BODIES</div>
      <div id="body-list" class="body-list"></div>
      <button id="focus-release" type="button" class="hud__release">Release Focus (Esc)</button>
      <div class="hud__hint">[ / ] speed | Space pause | 1/4 quality | Drag to orbit</div>
    </aside>
    <div class="warning-stripe">CAUTION - LIVE ORBITAL SIMULATION</div>
  `;

  const viewport = app.querySelector<HTMLElement>("#viewport");
  const dateValue = app.querySelector<HTMLElement>("#hud-date");
  const scaleValue = app.querySelector<HTMLElement>("#hud-scale");
  const qualityValue = app.querySelector<HTMLElement>("#hud-quality");
  const fpsValue = app.querySelector<HTMLElement>("#hud-fps");
  const focusValue = app.querySelector<HTMLElement>("#hud-focus");
  const bodyList = app.querySelector<HTMLElement>("#body-list");
  const releaseFocusButton = app.querySelector<HTMLButtonElement>("#focus-release");

  if (
    !viewport ||
    !dateValue ||
    !scaleValue ||
    !qualityValue ||
    !fpsValue ||
    !focusValue ||
    !bodyList ||
    !releaseFocusButton
  ) {
    throw new Error("HUD initialization failed.");
  }

  return {
    viewport,
    dateValue,
    scaleValue,
    qualityValue,
    fpsValue,
    focusValue,
    bodyList,
    releaseFocusButton,
  };
}

function setBodyButtonVisualState(
  entry: BodyButtonEntry,
  state: ModelLoadState,
  isActive: boolean,
): void {
  entry.button.dataset.modelState = state;
  entry.button.dataset.active = isActive ? "true" : "false";
  entry.status.textContent = state.toUpperCase();
}

function createBodyButtons(
  host: HTMLElement,
  onSelectBody: (bodyId: BodyId) => void,
): Map<BodyId, BodyButtonEntry> {
  const result = new Map<BodyId, BodyButtonEntry>();

  for (const body of BODY_LIST) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "body-list__item";
    button.dataset.bodyId = body.id;

    const label = document.createElement("span");
    label.className = "body-list__name";
    label.textContent = body.name.toUpperCase();

    const status = document.createElement("span");
    status.className = "body-list__status";
    status.textContent = "PENDING";

    button.append(label, status);
    button.addEventListener("click", () => onSelectBody(body.id));
    host.appendChild(button);
    result.set(body.id, { button, status });
  }

  return result;
}

async function createRuntimeBody(
  config: BodyVisualConfig,
  quality: QualityPreset,
): Promise<RuntimeBody> {
  const root = new THREE.Group();
  root.name = `${config.id}-root`;

  const tilt = new THREE.Group();
  tilt.name = `${config.id}-tilt`;
  tilt.rotation.z = degToRad(config.spin.axialTiltDeg);

  const spinner = new THREE.Group();
  spinner.name = `${config.id}-spinner`;

  const { visual, loadState } = await createBodyVisual(config, quality);
  visual.name = `${config.id}-visual`;

  spinner.add(visual);
  tilt.add(spinner);
  root.add(tilt);

  return { config, root, tilt, spinner, visual, modelLoadState: loadState };
}

async function bootstrap(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("Missing #app mount point.");
  }

  const hud = createHud(app);
  const engine = createEngine(hud.viewport);
  const controls = createSolarControls(engine.camera, engine.renderer.domElement);
  const postProcessing = createPostProcessing(engine.renderer, engine.scene, engine.camera);

  const starfield = createStarfield();
  engine.scene.add(starfield);

  const simClock = new SimulationClock({
    currentDate: new Date(),
    timeScaleDaysPerSecond: 1,
    paused: false,
    quality: "1k",
  });

  const runtimeBodies = new Map<BodyId, RuntimeBody>();
  const orbitArcs = new Map<BodyId, OrbitArcRuntime>();
  const latestPositions = {} as Record<BodyId, THREE.Vector3>;
  for (const bodyId of BODY_IDS) {
    latestPositions[bodyId] = new THREE.Vector3();
  }

  let viewportWidth = hud.viewport.clientWidth || window.innerWidth;
  let viewportHeight = hud.viewport.clientHeight || window.innerHeight;

  const initialQuality = simClock.getState().quality;
  const runtimeBodyList = await Promise.all(
    BODY_LIST.map((config) => createRuntimeBody(config, initialQuality)),
  );

  for (const runtimeBody of runtimeBodyList) {
    runtimeBodies.set(runtimeBody.config.id, runtimeBody);
    engine.scene.add(runtimeBody.root);
  }

  for (const config of BODY_LIST) {
    if (!config.orbit) {
      continue;
    }

    const orbitArc = createOrbitArcRuntime(config.id, config.orbit, config.color, 1440);
    orbitArcs.set(config.id, orbitArc);

    const parentRuntime = runtimeBodies.get(config.orbit.centralBody);
    if (parentRuntime) {
      parentRuntime.root.add(orbitArc.segmentA);
      parentRuntime.root.add(orbitArc.segmentB);
    } else {
      engine.scene.add(orbitArc.segmentA);
      engine.scene.add(orbitArc.segmentB);
    }
  }

  const focusState: FocusRuntimeState = {
    focusedBodyId: null,
    focusLocked: false,
    lastFocusedWorldPosition: null,
  };

  const bodyButtons = createBodyButtons(hud.bodyList, (bodyId) => {
    const runtimeBody = runtimeBodies.get(bodyId);
    if (!runtimeBody) {
      return;
    }

    const focusedPosition = latestPositions[bodyId].clone();
    const direction = engine.camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 0.0001) {
      direction.set(1, 0.3, 1);
    }
    direction.normalize();

    const distanceMultiplier = runtimeBody.config.focusDistanceMultiplier ?? 12;
    const focusDistance = Math.max(
      runtimeBody.config.visualRadius * distanceMultiplier,
      runtimeBody.config.visualRadius * 3 + 1.2,
    );

    engine.camera.position.copy(focusedPosition).addScaledVector(direction, focusDistance);
    controls.target.copy(focusedPosition);
    controls.update();

    focusState.focusedBodyId = bodyId;
    focusState.focusLocked = true;
    focusState.lastFocusedWorldPosition = focusedPosition.clone();
  });

  const updateFocusUi = (): void => {
    const focusedBodyId = focusState.focusedBodyId;
    if (!focusState.focusLocked || !focusedBodyId) {
      hud.focusValue.textContent = "FREE";
    } else {
      const runtimeBody = runtimeBodies.get(focusedBodyId);
      hud.focusValue.textContent = runtimeBody ? runtimeBody.config.name.toUpperCase() : "FREE";
    }

    for (const bodyId of BODY_IDS) {
      const runtimeBody = runtimeBodies.get(bodyId);
      const entry = bodyButtons.get(bodyId);
      if (!runtimeBody || !entry) {
        continue;
      }

      setBodyButtonVisualState(
        entry,
        runtimeBody.modelLoadState,
        focusState.focusLocked && focusState.focusedBodyId === bodyId,
      );
    }
  };

  const releaseFocus = (): void => {
    focusState.focusLocked = false;
    focusState.focusedBodyId = null;
    focusState.lastFocusedWorldPosition = null;
    updateFocusUi();
  };

  hud.releaseFocusButton.addEventListener("click", releaseFocus);
  updateFocusUi();

  let qualityChangeInProgress = false;

  const switchQuality = async (quality: QualityPreset): Promise<void> => {
    if (qualityChangeInProgress || simClock.getState().quality === quality) {
      return;
    }

    qualityChangeInProgress = true;
    simClock.setQuality(quality);

    try {
      for (const bodyId of BODY_IDS) {
        const runtimeBody = runtimeBodies.get(bodyId);
        if (!runtimeBody) {
          continue;
        }

        runtimeBody.spinner.remove(runtimeBody.visual);
        const { visual, loadState } = await createBodyVisual(runtimeBody.config, quality);
        visual.name = `${runtimeBody.config.id}-visual`;
        runtimeBody.visual = visual;
        runtimeBody.modelLoadState = loadState;
        runtimeBody.spinner.add(visual);
      }
    } finally {
      qualityChangeInProgress = false;
      updateFocusUi();
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Space") {
      event.preventDefault();
      simClock.togglePause();
      return;
    }

    if (event.code === "BracketLeft") {
      simClock.decreaseScale();
      return;
    }

    if (event.code === "BracketRight") {
      simClock.increaseScale();
      return;
    }

    if (event.code === "Digit1") {
      void switchQuality("1k");
      return;
    }

    if (event.code === "Digit4") {
      void switchQuality("4k");
      return;
    }

    if (event.code === "Escape") {
      releaseFocus();
    }
  };

  window.addEventListener("keydown", onKeyDown);

  const onResize = (): void => {
    viewportWidth = hud.viewport.clientWidth || window.innerWidth;
    viewportHeight = hud.viewport.clientHeight || window.innerHeight;
    engine.setSize(viewportWidth, viewportHeight);
    postProcessing.setSize(viewportWidth, viewportHeight);

    for (const orbitArc of orbitArcs.values()) {
      setOrbitVisualResolution(orbitArc, viewportWidth, viewportHeight);
    }
  };

  window.addEventListener("resize", onResize);
  onResize();

  let animationFrameId = 0;
  let smoothedFps = 60;
  let hudTimeAccumulator = 0;

  const animate = (): void => {
    animationFrameId = window.requestAnimationFrame(animate);
    const deltaSeconds = engine.clock.getDelta();

    simClock.tick(deltaSeconds);
    const state = simClock.getState();
    const snapshot = propagateSystem(BODY_LIST, state.currentDate);

    for (const runtimeBody of runtimeBodies.values()) {
      const bodyId = runtimeBody.config.id;
      const currentPosition = snapshot.positionsScene[bodyId];
      runtimeBody.root.position.copy(currentPosition);
      latestPositions[bodyId].copy(currentPosition);
      runtimeBody.tilt.rotation.z = degToRad(runtimeBody.config.spin.axialTiltDeg);
      runtimeBody.spinner.rotation.y = snapshot.spinAnglesRad[bodyId];
    }

    for (const [bodyId, orbitArc] of orbitArcs) {
      const bodyConfig = runtimeBodies.get(bodyId)?.config;
      if (!bodyConfig?.orbit) {
        continue;
      }

      const trueAnomaly = snapshot.trueAnomaliesRad[bodyId] ?? 0;
      const gapDegrees = bodyConfig.orbit.orbitGapDegrees ?? 0;
      updateOrbitArc(
        orbitArc,
        trueAnomaly,
        gapDegrees,
        viewportWidth,
        viewportHeight,
        ORBIT_GAP_UPDATE_STEP_RAD,
      );
    }

    if (focusState.focusLocked && focusState.focusedBodyId) {
      const focusedPosition = latestPositions[focusState.focusedBodyId];
      if (!focusState.lastFocusedWorldPosition) {
        focusState.lastFocusedWorldPosition = focusedPosition.clone();
      } else {
        const delta = focusedPosition.clone().sub(focusState.lastFocusedWorldPosition);
        if (delta.lengthSq() > 0) {
          engine.camera.position.add(delta);
          controls.target.add(delta);
          focusState.lastFocusedWorldPosition.copy(focusedPosition);
        }
      }
    }

    starfield.rotation.y += deltaSeconds * 0.0018;
    starfield.rotation.x += deltaSeconds * 0.00045;

    controls.update();
    postProcessing.render();

    if (deltaSeconds > 0) {
      const instantaneousFps = 1 / deltaSeconds;
      smoothedFps = THREE.MathUtils.lerp(smoothedFps, instantaneousFps, 0.1);
    }

    hudTimeAccumulator += deltaSeconds;
    if (hudTimeAccumulator > 0.15) {
      hudTimeAccumulator = 0;
      hud.dateValue.textContent = `${dateFormatter.format(state.currentDate)} UTC`;
      hud.scaleValue.textContent = formatTimeScale(state.timeScaleDaysPerSecond);
      hud.qualityValue.textContent = state.quality.toUpperCase();
      hud.fpsValue.textContent = smoothedFps.toFixed(1);
      updateFocusUi();
    }
  };

  animate();

  const onBeforeUnload = (): void => {
    window.cancelAnimationFrame(animationFrameId);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("beforeunload", onBeforeUnload);
    hud.releaseFocusButton.removeEventListener("click", releaseFocus);
    controls.dispose();
    postProcessing.smaaPass.dispose();
    postProcessing.composer.dispose();
    engine.dispose();

    for (const orbitArc of orbitArcs.values()) {
      orbitArc.segmentA.geometry.dispose();
      orbitArc.segmentB.geometry.dispose();
      orbitArc.segmentA.material.dispose();
      orbitArc.segmentB.material.dispose();
    }
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
