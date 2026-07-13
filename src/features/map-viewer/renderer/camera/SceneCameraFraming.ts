import * as THREE from 'three/webgpu';

export interface SceneCameraFrame {
  position: THREE.Vector3;
  target: THREE.Vector3;
  radius: number;
  near: number;
  far: number;
}

export interface SceneCameraStart {
  anchor: THREE.Vector3;
  lookAt: THREE.Vector3 | null;
}

const fallbackSceneRadius = 400;
const startupSceneRadius = 4000;
const startupCameraDistance = 90;
const startupCameraElevation = 36;
const startupTargetElevation = 24;
const startupFar = 80000;
const fallbackCameraPosition = new THREE.Vector3(0, 150, 300);
const fallbackCameraTarget = new THREE.Vector3(0, 0, 0);

export function createFallbackCameraFrame(): SceneCameraFrame {
  return {
    position: fallbackCameraPosition.clone(),
    target: fallbackCameraTarget.clone(),
    radius: fallbackSceneRadius,
    near: 0.1,
    far: 5000
  };
}

export function createInitialSceneCameraFrame(start: SceneCameraStart | null): SceneCameraFrame {
  if (!start || !isFiniteVector(start.anchor)) {
    return createFallbackCameraFrame();
  }

  const target = createStartupTarget(start);
  const position = createStartupCameraPosition(start.anchor, target);

  return {
    position,
    target,
    radius: startupSceneRadius,
    near: 0.1,
    far: startupFar
  };
}

function createStartupTarget(start: SceneCameraStart): THREE.Vector3 {
  const target = start.lookAt && isFiniteVector(start.lookAt) && !samePosition(start.anchor, start.lookAt)
    ? start.lookAt.clone()
    : start.anchor.clone().add(new THREE.Vector3(1, 0, 1));
  target.y = start.anchor.y + startupTargetElevation;
  return target;
}

function createStartupCameraPosition(anchor: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
  const direction = target.clone().sub(anchor);
  direction.y = 0;
  if (direction.lengthSq() < 1) {
    direction.set(1, 0, 1);
  }

  return anchor.clone()
    .addScaledVector(direction.normalize(), -startupCameraDistance)
    .add(new THREE.Vector3(0, startupCameraElevation, 0));
}

function isFiniteVector(value: THREE.Vector3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function samePosition(a: THREE.Vector3, b: THREE.Vector3): boolean {
  return a.distanceToSquared(b) < 0.0001;
}
