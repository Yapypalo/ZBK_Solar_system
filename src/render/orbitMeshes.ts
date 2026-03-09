import * as THREE from "three";
import type { BodyId, OrbitElements } from "../types";
import { KM_PER_SCENE_UNIT } from "../sim/constants";
import { degToRad, normalizeAngleRadians, sampleOrbitPointsKm } from "../sim/orbitMath";

const TAU = Math.PI * 2;
const BASE_OPACITY = 0.72;
const BASE_LINE_CORE_HALF_WIDTH_PX = 1.0;
const BASE_LINE_FEATHER_PX = 1.4;
const TRAIL_TOTAL_DEG = 329.0;
const TERMINAL_FADE_START = 0.97;

const ORBIT_VERTEX_SHADER = `
uniform vec2 uResolution;
uniform float uLineCoreHalfWidthPx;
uniform float uLineFeatherPx;

attribute vec3 previous;
attribute vec3 next;
attribute float side;
attribute float alpha;

varying float vAlpha;
varying float vSide;

vec2 safeNormalize(vec2 value) {
  float valueLength = length(value);
  if (valueLength < 1e-5) {
    return vec2(1.0, 0.0);
  }
  return value / valueLength;
}

void main() {
  vec4 currentView = modelViewMatrix * vec4(position, 1.0);
  vec4 currentClip = projectionMatrix * currentView;
  vec4 previousClip = projectionMatrix * modelViewMatrix * vec4(previous, 1.0);
  vec4 nextClip = projectionMatrix * modelViewMatrix * vec4(next, 1.0);

  vec2 currentNdc = currentClip.xy / max(abs(currentClip.w), 1e-5);
  vec2 previousNdc = previousClip.xy / max(abs(previousClip.w), 1e-5);
  vec2 nextNdc = nextClip.xy / max(abs(nextClip.w), 1e-5);

  vec2 prevDir = safeNormalize(currentNdc - previousNdc);
  vec2 nextDir = safeNormalize(nextNdc - currentNdc);
  vec2 tangent = safeNormalize(prevDir + nextDir);
  vec2 normal = vec2(-tangent.y, tangent.x);
  vec2 prevNormal = vec2(-prevDir.y, prevDir.x);
  float denom = max(abs(dot(normal, prevNormal)), 0.2);
  float miterLength = min(1.0 / denom, 2.0);

  vec2 pixelToNdc = vec2(2.0 / uResolution.x, 2.0 / uResolution.y);
  float totalHalfWidthPx = uLineCoreHalfWidthPx + uLineFeatherPx;
  vec2 offset = normal * side * totalHalfWidthPx * miterLength * pixelToNdc;

  currentClip.xy += offset * currentClip.w;

  gl_Position = currentClip;
  vAlpha = alpha;
  vSide = side;
}
`;

const ORBIT_FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uLineCoreHalfWidthPx;
uniform float uLineFeatherPx;
uniform float uDitherStrength;

varying float vAlpha;
varying float vSide;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  float totalHalfWidthPx = uLineCoreHalfWidthPx + uLineFeatherPx;
  float distPx = abs(vSide) * totalHalfWidthPx;

  float featherMask = 1.0 - smoothstep(uLineCoreHalfWidthPx, totalHalfWidthPx, distPx);
  float aa = max(fwidth(distPx) * 1.5, 0.65);
  featherMask *= 1.0 - smoothstep(totalHalfWidthPx - aa, totalHalfWidthPx, distPx);

  float finalAlpha = vAlpha * uOpacity * pow(featherMask, 1.05);
  float dither = (hash12(gl_FragCoord.xy) - 0.5) * uDitherStrength;
  finalAlpha *= (1.0 + dither);

  if (finalAlpha <= 0.001) {
    discard;
  }

  gl_FragColor = vec4(uColor, finalAlpha);
}
`;

export interface OrbitArcRuntime {
  bodyId: BodyId;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  basePointsScene: Float32Array;
  basePointCount: number;
  trailPositions: Float32Array;
  trailAlpha: Float32Array;
  trailPointCount: number;
  totalTrailRad: number;
  fadeDegrees: number;
  ribbonPositions: Float32Array;
  ribbonPrevious: Float32Array;
  ribbonNext: Float32Array;
  ribbonAlpha: Float32Array;
  positionAttribute: THREE.BufferAttribute;
  previousAttribute: THREE.BufferAttribute;
  nextAttribute: THREE.BufferAttribute;
  alphaAttribute: THREE.BufferAttribute;
}

interface RibbonGeometryBuffers {
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
  previous: Float32Array;
  next: Float32Array;
  alpha: Float32Array;
  positionAttribute: THREE.BufferAttribute;
  previousAttribute: THREE.BufferAttribute;
  nextAttribute: THREE.BufferAttribute;
  alphaAttribute: THREE.BufferAttribute;
}

function createRibbonMaterial(color: THREE.ColorRepresentation): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: ORBIT_VERTEX_SHADER,
    fragmentShader: ORBIT_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: BASE_OPACITY },
      uLineCoreHalfWidthPx: { value: BASE_LINE_CORE_HALF_WIDTH_PX },
      uLineFeatherPx: { value: BASE_LINE_FEATHER_PX },
      uDitherStrength: { value: 0.06 },
      uResolution: {
        value: new THREE.Vector2(
          Math.max(1, window.innerWidth),
          Math.max(1, window.innerHeight),
        ),
      },
    },
  });
}

function createRibbonGeometry(pointCount: number): RibbonGeometryBuffers {
  const vertexCount = pointCount * 2;
  const positions = new Float32Array(vertexCount * 3);
  const previous = new Float32Array(vertexCount * 3);
  const next = new Float32Array(vertexCount * 3);
  const alpha = new Float32Array(vertexCount);
  const side = new Float32Array(vertexCount);
  const uv = new Float32Array(vertexCount * 2);
  const indices = new Uint16Array((pointCount - 1) * 6);

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const v = pointIndex / Math.max(1, pointCount - 1);
    const leftVertex = pointIndex * 2;
    const rightVertex = leftVertex + 1;

    side[leftVertex] = -1;
    side[rightVertex] = 1;

    uv[leftVertex * 2] = 0;
    uv[leftVertex * 2 + 1] = v;
    uv[rightVertex * 2] = 1;
    uv[rightVertex * 2 + 1] = v;
  }

  let indexOffset = 0;
  for (let segmentIndex = 0; segmentIndex < pointCount - 1; segmentIndex += 1) {
    const vertexIndex = segmentIndex * 2;
    indices[indexOffset] = vertexIndex;
    indices[indexOffset + 1] = vertexIndex + 1;
    indices[indexOffset + 2] = vertexIndex + 2;
    indices[indexOffset + 3] = vertexIndex + 2;
    indices[indexOffset + 4] = vertexIndex + 1;
    indices[indexOffset + 5] = vertexIndex + 3;
    indexOffset += 6;
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(
    THREE.DynamicDrawUsage,
  );
  const previousAttribute = new THREE.BufferAttribute(previous, 3).setUsage(
    THREE.DynamicDrawUsage,
  );
  const nextAttribute = new THREE.BufferAttribute(next, 3).setUsage(THREE.DynamicDrawUsage);
  const alphaAttribute = new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage);

  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("previous", previousAttribute);
  geometry.setAttribute("next", nextAttribute);
  geometry.setAttribute("side", new THREE.BufferAttribute(side, 1));
  geometry.setAttribute("alpha", alphaAttribute);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return {
    geometry,
    positions,
    previous,
    next,
    alpha,
    positionAttribute,
    previousAttribute,
    nextAttribute,
    alphaAttribute,
  };
}

function smoothstep01(value: number): number {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function dropDuplicateClosingPoint(points: THREE.Vector3[]): THREE.Vector3[] {
  if (points.length < 2) {
    return points;
  }

  const first = points[0];
  const last = points[points.length - 1];
  if (first.distanceToSquared(last) < 1e-12) {
    return points.slice(0, -1);
  }

  return points;
}

function sampleRingPoint(
  basePointsScene: Float32Array,
  pointCount: number,
  floatIndex: number,
  target: Float32Array,
  targetOffset: number,
): void {
  const wrapped = ((floatIndex % pointCount) + pointCount) % pointCount;
  const lowIndex = Math.floor(wrapped);
  const highIndex = (lowIndex + 1) % pointCount;
  const blend = wrapped - lowIndex;

  const lowOffset = lowIndex * 3;
  const highOffset = highIndex * 3;

  target[targetOffset] = THREE.MathUtils.lerp(
    basePointsScene[lowOffset],
    basePointsScene[highOffset],
    blend,
  );
  target[targetOffset + 1] = THREE.MathUtils.lerp(
    basePointsScene[lowOffset + 1],
    basePointsScene[highOffset + 1],
    blend,
  );
  target[targetOffset + 2] = THREE.MathUtils.lerp(
    basePointsScene[lowOffset + 2],
    basePointsScene[highOffset + 2],
    blend,
  );
}

export function createOrbitArcRuntime(
  bodyId: BodyId,
  orbit: OrbitElements,
  color: THREE.ColorRepresentation,
  samples = 1440,
): OrbitArcRuntime {
  const baseSampleCount = Math.max(2560, samples * 2);
  const sampled = dropDuplicateClosingPoint(sampleOrbitPointsKm(orbit, baseSampleCount));
  const basePointsScene = new Float32Array(sampled.length * 3);

  sampled.forEach((point, index) => {
    const scaled = point.multiplyScalar(1 / KM_PER_SCENE_UNIT);
    const offset = index * 3;
    basePointsScene[offset] = scaled.x;
    basePointsScene[offset + 1] = scaled.y;
    basePointsScene[offset + 2] = scaled.z;
  });

  const trailPointCount = Math.max(1536, samples);
  const material = createRibbonMaterial(color);
  const ribbonGeometry = createRibbonGeometry(trailPointCount);
  const mesh = new THREE.Mesh(ribbonGeometry.geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  return {
    bodyId,
    mesh,
    geometry: ribbonGeometry.geometry,
    material,
    basePointsScene,
    basePointCount: sampled.length,
    trailPositions: new Float32Array(trailPointCount * 3),
    trailAlpha: new Float32Array(trailPointCount),
    trailPointCount,
    totalTrailRad: degToRad(TRAIL_TOTAL_DEG),
    fadeDegrees: THREE.MathUtils.clamp(orbit.orbitGapDegrees ?? 45, 0, 359.5),
    ribbonPositions: ribbonGeometry.positions,
    ribbonPrevious: ribbonGeometry.previous,
    ribbonNext: ribbonGeometry.next,
    ribbonAlpha: ribbonGeometry.alpha,
    positionAttribute: ribbonGeometry.positionAttribute,
    previousAttribute: ribbonGeometry.previousAttribute,
    nextAttribute: ribbonGeometry.nextAttribute,
    alphaAttribute: ribbonGeometry.alphaAttribute,
  };
}

export function updateOrbitArc(
  runtime: OrbitArcRuntime,
  currentTrueAnomalyRad: number,
): void {
  if (runtime.basePointCount < 2 || runtime.trailPointCount < 2) {
    runtime.mesh.visible = false;
    return;
  }

  const headAnomaly = normalizeAngleRadians(currentTrueAnomalyRad);
  const fadeStartDeg = 360 - runtime.fadeDegrees;

  for (let pointIndex = 0; pointIndex < runtime.trailPointCount; pointIndex += 1) {
    const progress = pointIndex / Math.max(1, runtime.trailPointCount - 1);
    const angleBehind = progress * runtime.totalTrailRad;
    const sampleAnomaly = normalizeAngleRadians(headAnomaly - angleBehind);
    const floatIndex = (sampleAnomaly / TAU) * runtime.basePointCount;
    const targetOffset = pointIndex * 3;

    sampleRingPoint(
      runtime.basePointsScene,
      runtime.basePointCount,
      floatIndex,
      runtime.trailPositions,
      targetOffset,
    );

    let fade = 1;
    if (runtime.fadeDegrees > 0) {
      const trailDeg = progress * 360;
      if (trailDeg > fadeStartDeg) {
        const t = (trailDeg - fadeStartDeg) / runtime.fadeDegrees;
        fade = 1 - smoothstep01(t);
      }
    }

    if (progress > TERMINAL_FADE_START) {
      const terminalT = (progress - TERMINAL_FADE_START) / (1 - TERMINAL_FADE_START);
      const terminalFade = 1 - smoothstep01(terminalT);
      fade *= terminalFade;
    }

    runtime.trailAlpha[pointIndex] = fade;
  }

  for (let pointIndex = 0; pointIndex < runtime.trailPointCount; pointIndex += 1) {
    const currentOffset = pointIndex * 3;
    const previousOffset = Math.max(0, pointIndex - 1) * 3;
    const nextOffset = Math.min(runtime.trailPointCount - 1, pointIndex + 1) * 3;
    const pointAlpha = runtime.trailAlpha[pointIndex];

    const leftVertexOffset = pointIndex * 6;
    const rightVertexOffset = leftVertexOffset + 3;
    const leftVertexIndex = pointIndex * 2;
    const rightVertexIndex = leftVertexIndex + 1;

    runtime.ribbonPositions[leftVertexOffset] = runtime.trailPositions[currentOffset];
    runtime.ribbonPositions[leftVertexOffset + 1] = runtime.trailPositions[currentOffset + 1];
    runtime.ribbonPositions[leftVertexOffset + 2] = runtime.trailPositions[currentOffset + 2];
    runtime.ribbonPositions[rightVertexOffset] = runtime.trailPositions[currentOffset];
    runtime.ribbonPositions[rightVertexOffset + 1] = runtime.trailPositions[currentOffset + 1];
    runtime.ribbonPositions[rightVertexOffset + 2] = runtime.trailPositions[currentOffset + 2];

    runtime.ribbonPrevious[leftVertexOffset] = runtime.trailPositions[previousOffset];
    runtime.ribbonPrevious[leftVertexOffset + 1] = runtime.trailPositions[previousOffset + 1];
    runtime.ribbonPrevious[leftVertexOffset + 2] = runtime.trailPositions[previousOffset + 2];
    runtime.ribbonPrevious[rightVertexOffset] = runtime.trailPositions[previousOffset];
    runtime.ribbonPrevious[rightVertexOffset + 1] = runtime.trailPositions[previousOffset + 1];
    runtime.ribbonPrevious[rightVertexOffset + 2] = runtime.trailPositions[previousOffset + 2];

    runtime.ribbonNext[leftVertexOffset] = runtime.trailPositions[nextOffset];
    runtime.ribbonNext[leftVertexOffset + 1] = runtime.trailPositions[nextOffset + 1];
    runtime.ribbonNext[leftVertexOffset + 2] = runtime.trailPositions[nextOffset + 2];
    runtime.ribbonNext[rightVertexOffset] = runtime.trailPositions[nextOffset];
    runtime.ribbonNext[rightVertexOffset + 1] = runtime.trailPositions[nextOffset + 1];
    runtime.ribbonNext[rightVertexOffset + 2] = runtime.trailPositions[nextOffset + 2];

    runtime.ribbonAlpha[leftVertexIndex] = pointAlpha;
    runtime.ribbonAlpha[rightVertexIndex] = pointAlpha;
  }

  runtime.mesh.visible = true;
  runtime.positionAttribute.needsUpdate = true;
  runtime.previousAttribute.needsUpdate = true;
  runtime.nextAttribute.needsUpdate = true;
  runtime.alphaAttribute.needsUpdate = true;
}

export function setOrbitVisualResolution(
  orbit: OrbitArcRuntime,
  width: number,
  height: number,
): void {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const resolution = orbit.material.uniforms.uResolution.value as THREE.Vector2;
  resolution.set(safeWidth, safeHeight);
}
