import * as THREE from "three";
import type { SpacecraftRecord } from "../types";
import { KM_PER_SCENE_UNIT } from "../sim/constants";
import { sampleOrbitPointsKm } from "../sim/orbitMath";
import { createSpacecraftOrbitElements } from "../sim/spacecraftPropagator";

export interface SpacecraftBeaconsRuntime {
  group: THREE.Group;
  setVisible: (visible: boolean) => void;
  update: (deltaSeconds: number) => void;
  dispose: () => void;
}

const BEACON_COLORS = {
  periapsis: "#FFC56E",
  apoapsis: "#79C7FF",
  marker: "#F4F8FF",
};

function createBeacon(color: THREE.ColorRepresentation, radius: number): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, 14, 14);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
    toneMapped: false,
  });
  const beacon = new THREE.Mesh(geometry, material);
  beacon.renderOrder = 4;
  return beacon;
}

export function createSpacecraftBeacons(record: SpacecraftRecord): SpacecraftBeaconsRuntime {
  const points = sampleOrbitPointsKm(createSpacecraftOrbitElements(record), 360).map((pointKm) =>
    pointKm.multiplyScalar(1 / KM_PER_SCENE_UNIT),
  );
  const periPoint = points[0] ?? new THREE.Vector3();
  const apoPoint = points[180] ?? periPoint.clone();
  const markerPoint = points[90] ?? periPoint.clone();

  const sizeFactor = record.importance === 3 ? 1.2 : record.importance === 2 ? 1.0 : 0.86;
  const periBeacon = createBeacon(BEACON_COLORS.periapsis, 0.06 * sizeFactor);
  const apoBeacon = createBeacon(BEACON_COLORS.apoapsis, 0.055 * sizeFactor);
  const markerBeacon = createBeacon(BEACON_COLORS.marker, 0.048 * sizeFactor);

  periBeacon.position.copy(periPoint);
  apoBeacon.position.copy(apoPoint);
  markerBeacon.position.copy(markerPoint);

  const group = new THREE.Group();
  group.name = `${record.id}-mission-beacons`;
  group.add(periBeacon, apoBeacon, markerBeacon);

  let time = 0;
  const update = (deltaSeconds: number): void => {
    time += deltaSeconds;
    const pulseA = 0.6 + Math.sin(time * 3.2) * 0.22;
    const pulseB = 0.55 + Math.sin(time * 2.6 + 1.4) * 0.2;
    const pulseC = 0.5 + Math.sin(time * 2.9 + 2.2) * 0.18;
    (periBeacon.material as THREE.MeshBasicMaterial).opacity = pulseA;
    (apoBeacon.material as THREE.MeshBasicMaterial).opacity = pulseB;
    (markerBeacon.material as THREE.MeshBasicMaterial).opacity = pulseC;
  };

  const dispose = (): void => {
    [periBeacon, apoBeacon, markerBeacon].forEach((beacon) => {
      beacon.geometry.dispose();
      if (Array.isArray(beacon.material)) {
        beacon.material.forEach((material) => material.dispose());
      } else {
        beacon.material.dispose();
      }
    });
  };

  return {
    group,
    setVisible: (visible: boolean) => {
      group.visible = visible;
    },
    update,
    dispose,
  };
}

