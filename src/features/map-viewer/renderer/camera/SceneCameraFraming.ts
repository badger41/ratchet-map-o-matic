import * as THREE from 'three/webgpu';

export interface SceneCameraFrame {
  bounds: THREE.Box3;
  position: THREE.Vector3;
  target: THREE.Vector3;
  radius: number;
  near: number;
  far: number;
}

interface SceneMeasurement {
  bounds: THREE.Box3;
  instancedFocus: THREE.Vector3 | null;
  meshFocus: THREE.Vector3 | null;
}

const fallbackSceneRadius = 400;
const fallbackCameraPosition = new THREE.Vector3(0, 150, 300);
const fallbackCameraTarget = new THREE.Vector3(0, 0, 0);

export function createFallbackCameraFrame(): SceneCameraFrame {
  return {
    bounds: new THREE.Box3().setFromCenterAndSize(fallbackCameraTarget, new THREE.Vector3(1, 1, 1)),
    position: fallbackCameraPosition.clone(),
    target: fallbackCameraTarget.clone(),
    radius: fallbackSceneRadius,
    near: 0.1,
    far: 5000
  };
}

export function createInitialSceneCameraFrame(root: THREE.Object3D): SceneCameraFrame {
  root.updateWorldMatrix(true, true);

  const { bounds, instancedFocus, meshFocus } = measureScene(root);
  if (bounds.isEmpty()) {
    return createFallbackCameraFrame();
  }

  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5;
  const focus = instancedFocus ?? meshFocus ?? bounds.getCenter(new THREE.Vector3());
  const horizontalSpan = Math.max(size.x, size.z, 1);
  const horizontalOffset = clamp(horizontalSpan * 0.055, 160, 760);
  const elevation = clamp(Math.max(horizontalSpan * 0.035, size.y * 0.35), 120, 460);
  const position = new THREE.Vector3(
    focus.x + horizontalOffset,
    focus.y + elevation,
    focus.z + horizontalOffset
  );

  return {
    bounds,
    position,
    target: focus,
    radius,
    near: 0.1,
    far: Math.max(5000, radius * 20)
  };
}

function measureScene(root: THREE.Object3D): SceneMeasurement {
  const bounds = new THREE.Box3().makeEmpty();
  const instancedAverage = createVectorAverage();
  const meshAverage = createVectorAverage();
  const localBox = new THREE.Box3();
  const instanceMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  const placement = new THREE.Vector3();
  const center = new THREE.Vector3();

  root.traverse((object) => {
    if (!isMesh(object)) {
      return;
    }

    const objectBounds = getObjectLocalBounds(object, localBox);
    if (!objectBounds) {
      return;
    }

    localBox.applyMatrix4(object.matrixWorld);
    bounds.union(localBox);

    if (isInstancedMesh(object)) {
      for (let index = 0; index < object.count; index += 1) {
        object.getMatrixAt(index, instanceMatrix);
        worldMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
        placement.setFromMatrixPosition(worldMatrix);
        instancedAverage.add(placement);
      }
      return;
    }

    meshAverage.add(localBox.getCenter(center));
  });

  return {
    bounds,
    instancedFocus: instancedAverage.value(),
    meshFocus: meshAverage.value()
  };
}

function getObjectLocalBounds(object: THREE.Mesh, target: THREE.Box3): THREE.Box3 | null {
  if (isInstancedMesh(object)) {
    if (!object.boundingBox) {
      object.computeBoundingBox();
    }
    if (object.boundingBox) {
      return target.copy(object.boundingBox);
    }
  }

  const geometry = object.geometry;
  if (!geometry) {
    return null;
  }

  if (!geometry.boundingBox) {
    geometry.computeBoundingBox();
  }

  return geometry.boundingBox ? target.copy(geometry.boundingBox) : null;
}

function createVectorAverage(): { add: (value: THREE.Vector3) => void; value: () => THREE.Vector3 | null } {
  const sum = new THREE.Vector3();
  let count = 0;

  return {
    add: (value) => {
      if (!isFiniteVector(value)) {
        return;
      }

      sum.add(value);
      count += 1;
    },
    value: () => count > 0 ? sum.divideScalar(count) : null
  };
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

function isInstancedMesh(object: THREE.Object3D): object is THREE.InstancedMesh {
  return (object as THREE.InstancedMesh).isInstancedMesh === true;
}

function isFiniteVector(value: THREE.Vector3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
