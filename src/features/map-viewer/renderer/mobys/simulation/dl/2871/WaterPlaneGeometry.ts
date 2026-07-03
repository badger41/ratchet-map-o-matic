import * as THREE from 'three/webgpu';

export const waterPlaneSize = 500;

const waterPatchHalfWidth = waterPlaneSize * 3;
const waterPatchNearDistance = -waterPlaneSize * 0.5;
const waterPatchFarDistance = waterPlaneSize;
const waterPatchSegmentsX = 191;
const waterPatchSegmentsY = 96;
const waterPatchRect: WaterPatchRect = {
  x0: -waterPatchHalfWidth,
  x1: waterPatchHalfWidth,
  y0: waterPatchNearDistance,
  y1: waterPatchFarDistance
};

interface WaterPatchRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

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

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Array(vertexCount * 3).fill(0), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(vertexCount * 2).fill(0), 2));
  geometry.setIndex(indices);
  geometry.userData.mapOmaticWaterPatchRect = waterPatchRect;
  geometry.userData.mapOmaticWaterPatchSegmentsX = waterPatchSegmentsX;
  geometry.userData.mapOmaticWaterPatchSegmentsY = waterPatchSegmentsY;
  updateWaterPatchGeometry(geometry, waterPatchRect, new THREE.Vector2(1, 0), new THREE.Vector2(0, 1), 1);
  geometry.computeBoundingSphere();
  return geometry;
}

export function updateWaterPatchMesh(
  mesh: THREE.Mesh,
  right: THREE.Vector2,
  forward: THREE.Vector2,
  scale: number
): void {
  const rect = mesh.geometry.userData.mapOmaticWaterPatchRect as WaterPatchRect | undefined;
  if (!rect) {
    return;
  }

  updateWaterPatchGeometry(mesh.geometry, rect, right, forward, scale);
}

function updateWaterPatchGeometry(
  geometry: THREE.BufferGeometry,
  rect: WaterPatchRect,
  right: THREE.Vector2,
  forward: THREE.Vector2,
  scale: number
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!position) {
    return;
  }

  const segmentsX = positiveIntegerValue(geometry.userData.mapOmaticWaterPatchSegmentsX, 1);
  const segmentsY = positiveIntegerValue(geometry.userData.mapOmaticWaterPatchSegmentsY, 1);
  for (let yIndex = 0; yIndex <= segmentsY; yIndex += 1) {
    const y = rect.y0 + (rect.y1 - rect.y0) * yIndex / segmentsY;
    for (let xIndex = 0; xIndex <= segmentsX; xIndex += 1) {
      const x = rect.x0 + (rect.x1 - rect.x0) * xIndex / segmentsX;
      setWaterPatchVertex(
        position,
        uv,
        yIndex * (segmentsX + 1) + xIndex,
        x,
        y,
        right,
        forward,
        scale
      );
    }
  }

  position.needsUpdate = true;
  if (uv) {
    uv.needsUpdate = true;
  }
}

function setWaterPatchVertex(
  position: THREE.BufferAttribute,
  uv: THREE.BufferAttribute | undefined,
  index: number,
  x: number,
  y: number,
  right: THREE.Vector2,
  forward: THREE.Vector2,
  scale: number
): void {
  const scaledX = x * scale;
  const scaledY = y * scale;
  const localX = right.x * scaledX + forward.x * scaledY;
  const localY = right.y * scaledX + forward.y * scaledY;
  position.setXYZ(index, localX, localY, 0);
  uv?.setXY(index, -localY / waterPlaneSize, localX / waterPlaneSize);
}

function positiveIntegerValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}
