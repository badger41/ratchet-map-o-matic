import * as THREE from 'three/webgpu';

export const waterPlaneSize = 500;

const waterPatchFarDistance = waterPlaneSize * 3;
const waterPatchSegmentsX = 32;
const waterPatchNearStrips = 50;
const waterPatchMidStrips = 50;
const waterPatchFarStrips = 5;
const waterPatchMidEndRow = waterPatchNearStrips + waterPatchMidStrips;
const waterPatchSegmentsY = waterPatchMidEndRow + waterPatchFarStrips;
const waterRayPoint = new THREE.Vector3();
const waterRayDirection = new THREE.Vector3();
const waterCameraPosition = new THREE.Vector3();
const waterCameraForward = new THREE.Vector3();

export function createWaterPatchGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertexCount = (waterPatchSegmentsX + 1) * (waterPatchSegmentsY + 1);
  const indices: number[] = [];
  for (let y = 0; y < waterPatchSegmentsY; y += 1) {
    for (let x = 0; x < waterPatchSegmentsX; x += 1) {
      const i0 = y * (waterPatchSegmentsX + 1) + x;
      const i1 = i0 + 1;
      const i2 = i0 + waterPatchSegmentsX + 2;
      const i3 = i0 + waterPatchSegmentsX + 1;
      indices.push(i0, i1, i2, i0, i2, i3);
    }
  }

  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3).setUsage(THREE.DynamicDrawUsage)
  );
  geometry.setAttribute(
    'uv',
    new THREE.BufferAttribute(new Float32Array(vertexCount * 2), 2).setUsage(THREE.DynamicDrawUsage)
  );
  geometry.setAttribute('waterWaveBank0Scale', new THREE.Float32BufferAttribute(
    Array.from({ length: vertexCount }, (_, index) => (
      Math.min(1, Math.max(0, (waterPatchMidEndRow - Math.floor(index / (waterPatchSegmentsX + 1))) / waterPatchMidStrips))
    )),
    1
  ));
  geometry.setAttribute('waterWaveBank1Scale', new THREE.Float32BufferAttribute(
    Array.from({ length: vertexCount }, (_, index) => (
      Math.max(0, (waterPatchNearStrips - Math.floor(index / (waterPatchSegmentsX + 1))) / waterPatchNearStrips)
    )),
    1
  ));
  geometry.setIndex(indices);
  return geometry;
}

export function updateWaterPatchMesh(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  waterY: number,
  waveAmplitude: number
): void {
  updateWaterPatchGeometry(mesh.geometry, camera, waterY, Math.abs(waveAmplitude));
}

function updateWaterPatchGeometry(
  geometry: THREE.BufferGeometry,
  camera: THREE.Camera,
  waterY: number,
  waveAmplitude: number
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  camera.getWorldPosition(waterCameraPosition);
  camera.getWorldDirection(waterCameraForward);
  waterCameraForward.y = 0;
  if (waterCameraForward.lengthSq() <= 1e-8) {
    waterCameraForward.setFromMatrixColumn(camera.matrixWorld, 1);
    waterCameraForward.y = 0;
  }
  waterCameraForward.normalize();
  const waveTopY = waterY + waveAmplitude;
  const waveBottomY = waterY - waveAmplitude;
  waterRayPoint.set(0, -1, 1).unproject(camera);
  waterRayDirection.copy(waterRayPoint).sub(waterCameraPosition).normalize();
  const nearDistance = waterRayDirection.y < -1e-6
    ? (waveTopY - waterCameraPosition.y) / waterRayDirection.y
      * (waterRayDirection.x * waterCameraForward.x + waterRayDirection.z * waterCameraForward.z)
    : 0;
  let rowDistance = nearDistance;
  for (let yIndex = 0; yIndex <= waterPatchSegmentsY; yIndex += 1) {
    if (yIndex > 0) {
      rowDistance += yIndex <= waterPatchNearStrips
        ? 1
        : yIndex <= waterPatchMidEndRow
          ? 2
          : 200;
    }

    waterRayPoint.copy(waterCameraPosition).addScaledVector(
      waterCameraForward,
      Math.min(rowDistance, waterPatchFarDistance)
    );
    waterRayPoint.y = waveBottomY;
    const ndcY = waterRayPoint.project(camera).y;
    for (let xIndex = 0; xIndex <= waterPatchSegmentsX; xIndex += 1) {
      const ndcX = -1 + 2 * xIndex / waterPatchSegmentsX;
      waterRayPoint.set(ndcX, ndcY, 1).unproject(camera);
      waterRayDirection.copy(waterRayPoint).sub(waterCameraPosition).normalize();
      const horizontalLength = Math.hypot(waterRayDirection.x, waterRayDirection.z);
      const planeDistance = waterRayDirection.y < -1e-6
        ? (waveBottomY - waterCameraPosition.y) / waterRayDirection.y * horizontalLength
        : waterPatchFarDistance;
      const horizontalDistance = Math.min(Math.max(planeDistance, 0), waterPatchFarDistance);
      const distanceScale = horizontalLength > 1e-6 ? horizontalDistance / horizontalLength : 0;
      const localX = waterRayDirection.x * distanceScale;
      const localY = -waterRayDirection.z * distanceScale;
      setWaterPatchVertex(position, uv, yIndex * (waterPatchSegmentsX + 1) + xIndex, localX, localY);
    }
  }

  position.needsUpdate = true;
  uv.needsUpdate = true;
}

function setWaterPatchVertex(
  position: THREE.BufferAttribute,
  uv: THREE.BufferAttribute,
  index: number,
  localX: number,
  localY: number
): void {
  position.setXYZ(index, localX, localY, 0);
  uv.setXY(index, -localY / waterPlaneSize, localX / waterPlaneSize);
}
