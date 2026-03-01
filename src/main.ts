import * as THREE from "three";
import { createSolarControls } from "./core/controls";
import { createEngine } from "./core/engine";
import { BODY_CARDS } from "./data/bodyCards";
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
} from "./types";
import "./styles/theme.css";

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

interface PointerClickState {
  active: boolean;
  pointerId: number | null;
  downX: number;
  downY: number;
  downTs: number;
}

interface FocusTransitionState {
  active: boolean;
  bodyId: BodyId | null;
  elapsedSec: number;
  durationSec: number;
  fromCamera: THREE.Vector3;
  fromTarget: THREE.Vector3;
}

interface HudRefs {
  viewport: HTMLElement;
  hudPanel: HTMLElement;
  cardRoot: HTMLElement;
  cardKind: HTMLElement;
  cardTitle: HTMLElement;
  cardSubtitle: HTMLElement;
  cardSummary: HTMLElement;
  cardFacts: HTMLElement;
  warningStripe: HTMLElement;
  hudToggleButton: HTMLButtonElement;
  dateValue: HTMLElement;
  scaleValue: HTMLElement;
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

const LEFT_COMPOSITION_SCREEN_X = 0.25;
const FOCUS_TRANSITION_SEC = 0.45;
const CLICK_MAX_DRAG_PX = 6;
const CLICK_MAX_DURATION_MS = 350;
const MIN_HIT_RADIUS_PX = 18;
const MAX_HIT_RADIUS_PX = 68;
const HIT_RADIUS_SCALE = 2.25;
const HUD_TOGGLE_IDLE_HIDE_MS = 2_000;

function createHud(app: HTMLElement): HudRefs {
  app.innerHTML = `
    <div id="viewport" class="viewport"></div>
    <button id="hud-visibility-toggle" type="button" class="hud-visibility-toggle">HUD: ON (H)</button>
    <aside class="hud">
      <div class="hud__brand" data-glitch="ZBK INC.">ZBK INC.</div>
      <div class="hud__title">ZBK &middot; ORBITAL ARCHIVE</div>
      <div class="hud__stats">
        <div class="hud__row"><span>UTC</span><span id="hud-date">--</span></div>
        <div class="hud__row"><span>TIME SCALE</span><span id="hud-scale">1 day/s</span></div>
        <div class="hud__row"><span>FOCUS</span><span id="hud-focus">FREE</span></div>
        <div class="hud__row"><span>FPS</span><span id="hud-fps">0</span></div>
      </div>
      <div class="hud__section-title">CELESTIAL BODIES</div>
      <div id="body-list" class="body-list"></div>
      <button id="focus-release" type="button" class="hud__release">Release Focus (Esc)</button>
      <div class="hud__hint">[ / ] RATE &middot; SPACE PAUSE &middot; H HUD &middot; DRAG ORBIT &middot; CLICK TARGET</div>
    </aside>
    <aside id="body-card" class="body-card body-card--hidden">
      <div class="body-card__band">OBJECT DOSSIER</div>
      <div id="card-kind" class="body-card__kind">--</div>
      <div id="card-title" class="body-card__title">--</div>
      <div id="card-subtitle" class="body-card__subtitle">--</div>
      <p id="card-summary" class="body-card__summary">--</p>
      <div id="card-facts" class="body-card__facts"></div>
    </aside>
    <div class="warning-stripe">CAUTION &middot; LIVE ORBIT TRACKING</div>
  `;

  const viewport = app.querySelector<HTMLElement>("#viewport");
  const hudPanel = app.querySelector<HTMLElement>(".hud");
  const cardRoot = app.querySelector<HTMLElement>("#body-card");
  const cardKind = app.querySelector<HTMLElement>("#card-kind");
  const cardTitle = app.querySelector<HTMLElement>("#card-title");
  const cardSubtitle = app.querySelector<HTMLElement>("#card-subtitle");
  const cardSummary = app.querySelector<HTMLElement>("#card-summary");
  const cardFacts = app.querySelector<HTMLElement>("#card-facts");
  const warningStripe = app.querySelector<HTMLElement>(".warning-stripe");
  const hudToggleButton = app.querySelector<HTMLButtonElement>("#hud-visibility-toggle");
  const dateValue = app.querySelector<HTMLElement>("#hud-date");
  const scaleValue = app.querySelector<HTMLElement>("#hud-scale");
  const fpsValue = app.querySelector<HTMLElement>("#hud-fps");
  const focusValue = app.querySelector<HTMLElement>("#hud-focus");
  const bodyList = app.querySelector<HTMLElement>("#body-list");
  const releaseFocusButton = app.querySelector<HTMLButtonElement>("#focus-release");

  if (
    !viewport ||
    !hudPanel ||
    !cardRoot ||
    !cardKind ||
    !cardTitle ||
    !cardSubtitle ||
    !cardSummary ||
    !cardFacts ||
    !warningStripe ||
    !hudToggleButton ||
    !dateValue ||
    !scaleValue ||
    !fpsValue ||
    !focusValue ||
    !bodyList ||
    !releaseFocusButton
  ) {
    throw new Error("HUD initialization failed.");
  }

  return {
    viewport,
    hudPanel,
    cardRoot,
    cardKind,
    cardTitle,
    cardSubtitle,
    cardSummary,
    cardFacts,
    warningStripe,
    hudToggleButton,
    dateValue,
    scaleValue,
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
): Promise<RuntimeBody> {
  const root = new THREE.Group();
  root.name = `${config.id}-root`;

  const tilt = new THREE.Group();
  tilt.name = `${config.id}-tilt`;
  tilt.rotation.z = degToRad(config.spin.axialTiltDeg);

  const spinner = new THREE.Group();
  spinner.name = `${config.id}-spinner`;

  const { visual, loadState } = await createBodyVisual(config, "1k");
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

  const runtimeBodyList = await Promise.all(BODY_LIST.map((config) => createRuntimeBody(config)));

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
      parentRuntime.root.add(orbitArc.line);
    } else {
      engine.scene.add(orbitArc.line);
    }
  }

  const focusState: FocusRuntimeState = {
    focusedBodyId: null,
    focusLocked: false,
    lastFocusedWorldPosition: null,
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
  };

  const computeDesiredFocusPose = (
    bodyId: BodyId,
  ): { cameraPos: THREE.Vector3; targetPos: THREE.Vector3 } | null => {
    const runtimeBody = runtimeBodies.get(bodyId);
    if (!runtimeBody) {
      return null;
    }

    const focusedPosition = latestPositions[bodyId].clone();
    const direction = engine.camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 0.000001) {
      direction.set(1, 0.3, 1);
    }
    direction.normalize();

    const distanceMultiplier = runtimeBody.config.focusDistanceMultiplier ?? 12;
    const focusDistance = Math.max(
      runtimeBody.config.visualRadius * distanceMultiplier,
      runtimeBody.config.visualRadius * 3 + 1.2,
    );

    const cameraBase = focusedPosition.clone().addScaledVector(direction, focusDistance);

    return {
      cameraPos: cameraBase,
      targetPos: focusedPosition,
    };
  };

  const applyFocusComposition = (bodyId: BodyId): void => {
    const bodyPosition = latestPositions[bodyId];
    const toBody = bodyPosition.clone().sub(engine.camera.position);
    const distance = toBody.length();
    if (distance < 0.000001) {
      return;
    }

    const forward = toBody.normalize();
    const right = new THREE.Vector3().crossVectors(forward, engine.camera.up);
    if (right.lengthSq() < 0.000001) {
      right.set(1, 0, 0);
    } else {
      right.normalize();
    }

    const desiredNdcX = LEFT_COMPOSITION_SCREEN_X * 2 - 1;
    const fovRad = THREE.MathUtils.degToRad(engine.camera.fov);
    const shift = -desiredNdcX * Math.tan(fovRad / 2) * engine.camera.aspect * distance;
    const targetPosition = bodyPosition.clone().addScaledVector(right, shift);
    engine.camera.lookAt(targetPosition);
  };

  const pickBodyByScreenProximity = (clientX: number, clientY: number): BodyId | null => {
    const viewportRect = hud.viewport.getBoundingClientRect();
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

      const score = distPx / hitRadiusPx;
      const scoreIsSimilar = Math.abs(score - bestScore) < 0.03;
      if (score < bestScore || (scoreIsSimilar && depth < bestDepth)) {
        bestBodyId = bodyId;
        bestScore = score;
        bestDepth = depth;
      }
    }

    return bestBodyId;
  };

  const setCardVisible = (visible: boolean): void => {
    hud.cardRoot.classList.toggle("body-card--hidden", !visible);
  };

  const clearCard = (): void => {
    hud.cardKind.textContent = "--";
    hud.cardTitle.textContent = "--";
    hud.cardSubtitle.textContent = "--";
    hud.cardSummary.textContent = "--";
    hud.cardFacts.innerHTML = "";
  };

  const renderCard = (bodyId: BodyId): void => {
    const card = BODY_CARDS[bodyId];
    if (!card) {
      clearCard();
      return;
    }

    hud.cardKind.textContent = card.kind.toUpperCase();
    hud.cardTitle.textContent = card.titleRu;
    hud.cardSubtitle.textContent = card.subtitleEn;
    hud.cardSummary.textContent = card.summaryRu;
    hud.cardFacts.innerHTML = "";

    for (const fact of card.facts) {
      const row = document.createElement("div");
      row.className = "body-card__fact";

      const label = document.createElement("span");
      label.className = "body-card__fact-label";
      label.textContent = fact.labelEn;

      const value = document.createElement("span");
      value.className = "body-card__fact-value";
      value.textContent = fact.value;

      row.append(label, value);
      hud.cardFacts.appendChild(row);
    }
  };

  const startFocus = (bodyId: BodyId): void => {
    if (!runtimeBodies.get(bodyId)) {
      return;
    }

    focusTransition.active = true;
    focusTransition.bodyId = bodyId;
    focusTransition.elapsedSec = 0;
    focusTransition.durationSec = FOCUS_TRANSITION_SEC;
    focusTransition.fromCamera.copy(engine.camera.position);
    focusTransition.fromTarget.copy(controls.target);

    focusState.focusedBodyId = bodyId;
    focusState.focusLocked = false;
    focusState.lastFocusedWorldPosition = null;
    renderCard(bodyId);
    setCardVisible(true);
    updateFocusUi();
  };

  const bodyButtons = createBodyButtons(hud.bodyList, (bodyId) => {
    startFocus(bodyId);
  });

  const updateFocusUi = (): void => {
    const focusedBodyId = focusState.focusedBodyId;
    if (!focusedBodyId || (!focusState.focusLocked && !focusTransition.active)) {
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
    focusTransition.active = false;
    focusTransition.bodyId = null;
    focusTransition.elapsedSec = 0;
    focusTransition.durationSec = FOCUS_TRANSITION_SEC;
    focusState.focusLocked = false;
    focusState.focusedBodyId = null;
    focusState.lastFocusedWorldPosition = null;
    clearCard();
    setCardVisible(false);
    updateFocusUi();
  };

  hud.releaseFocusButton.addEventListener("click", releaseFocus);
  clearCard();
  setCardVisible(false);
  updateFocusUi();

  let hudHidden = false;
  let hudToggleHideTimer: number | null = null;

  const setHudToggleGhosted = (ghosted: boolean): void => {
    hud.hudToggleButton.classList.toggle("hud-visibility-toggle--ghost", ghosted);
  };

  const clearHudToggleHideTimer = (): void => {
    if (hudToggleHideTimer !== null) {
      window.clearTimeout(hudToggleHideTimer);
      hudToggleHideTimer = null;
    }
  };

  const scheduleHudToggleHide = (): void => {
    clearHudToggleHideTimer();
    if (!hudHidden) {
      return;
    }

    hudToggleHideTimer = window.setTimeout(() => {
      hudToggleHideTimer = null;
      if (hudHidden) {
        setHudToggleGhosted(true);
      }
    }, HUD_TOGGLE_IDLE_HIDE_MS);
  };

  const registerHudHiddenActivity = (): void => {
    if (!hudHidden) {
      return;
    }
    setHudToggleGhosted(false);
    scheduleHudToggleHide();
  };

  const setHudHidden = (hidden: boolean): void => {
    hudHidden = hidden;
    app.classList.toggle("hud-hidden", hidden);
    hud.hudToggleButton.textContent = hidden ? "HUD: OFF (H)" : "HUD: ON (H)";
    if (hidden) {
      setHudToggleGhosted(false);
      scheduleHudToggleHide();
    } else {
      clearHudToggleHideTimer();
      setHudToggleGhosted(false);
    }
  };

  const onToggleHud = (): void => {
    setHudHidden(!hudHidden);
  };
  hud.hudToggleButton.addEventListener("click", onToggleHud);

  const rendererDomElement = engine.renderer.domElement;
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

  const onGlobalPointerMove = (): void => {
    registerHudHiddenActivity();
  };

  const onGlobalPointerDown = (): void => {
    registerHudHiddenActivity();
  };

  rendererDomElement.addEventListener("pointerdown", onPointerDown);
  rendererDomElement.addEventListener("pointerup", onPointerUp);
  rendererDomElement.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("pointermove", onGlobalPointerMove, { passive: true });
  window.addEventListener("pointerdown", onGlobalPointerDown, { passive: true });

  const onKeyDown = (event: KeyboardEvent): void => {
    registerHudHiddenActivity();

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

    if (event.code === "KeyH") {
      onToggleHud();
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
      const trueAnomaly = snapshot.trueAnomaliesRad[bodyId] ?? 0;
      updateOrbitArc(orbitArc, trueAnomaly);
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
      const targetBodyId = focusTransition.bodyId;
      const desiredPose = computeDesiredFocusPose(targetBodyId);

      if (desiredPose) {
        engine.camera.position.lerpVectors(
          focusTransition.fromCamera,
          desiredPose.cameraPos,
          easedProgress,
        );
        controls.target.lerpVectors(
          focusTransition.fromTarget,
          desiredPose.targetPos,
          easedProgress,
        );
      }

      if (transitionProgress >= 1) {
        focusTransition.active = false;
        focusTransition.bodyId = null;
        focusTransition.elapsedSec = 0;
        focusTransition.durationSec = FOCUS_TRANSITION_SEC;
        focusState.focusLocked = true;
        focusState.lastFocusedWorldPosition = latestPositions[targetBodyId].clone();
      }
    } else if (focusState.focusLocked && focusState.focusedBodyId) {
      const focusedPosition = latestPositions[focusState.focusedBodyId];
      if (!focusState.lastFocusedWorldPosition) {
        focusState.lastFocusedWorldPosition = focusedPosition.clone();
        controls.target.copy(focusedPosition);
      } else {
        const delta = focusedPosition.clone().sub(focusState.lastFocusedWorldPosition);
        if (delta.lengthSq() > 0) {
          engine.camera.position.add(delta);
        }
        controls.target.copy(focusedPosition);
        focusState.lastFocusedWorldPosition.copy(focusedPosition);
      }
    }

    starfield.rotation.y += deltaSeconds * 0.0018;
    starfield.rotation.x += deltaSeconds * 0.00045;

    controls.update();
    if (focusTransition.active && focusTransition.bodyId) {
      applyFocusComposition(focusTransition.bodyId);
    } else if (focusState.focusLocked && focusState.focusedBodyId) {
      applyFocusComposition(focusState.focusedBodyId);
    }
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
      hud.fpsValue.textContent = smoothedFps.toFixed(1);
      updateFocusUi();
    }
  };

  animate();

  const onBeforeUnload = (): void => {
    window.cancelAnimationFrame(animationFrameId);
    clearHudToggleHideTimer();
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("blur", onWindowBlur);
    window.removeEventListener("pointermove", onGlobalPointerMove);
    window.removeEventListener("pointerdown", onGlobalPointerDown);
    window.removeEventListener("beforeunload", onBeforeUnload);
    hud.releaseFocusButton.removeEventListener("click", releaseFocus);
    hud.hudToggleButton.removeEventListener("click", onToggleHud);
    rendererDomElement.removeEventListener("pointerdown", onPointerDown);
    rendererDomElement.removeEventListener("pointerup", onPointerUp);
    rendererDomElement.removeEventListener("pointercancel", onPointerCancel);
    controls.dispose();
    postProcessing.smaaPass.dispose();
    postProcessing.composer.dispose();
    engine.dispose();

    for (const orbitArc of orbitArcs.values()) {
      orbitArc.geometry.dispose();
      orbitArc.material.dispose();
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


