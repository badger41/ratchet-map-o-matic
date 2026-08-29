import * as THREE from 'three/webgpu';
import type { GameplaySpline } from '../../../../../services/wasm/ratchetPs2Wasm.ts';

export interface WaterTristripColor {
  color: THREE.Color;
  opacity: number;
}

export interface WaterTristripPvar {
  splineIndex: number;
  overlayFxTexId: number;
  underlayColor: WaterTristripColor;
  overlayColor: WaterTristripColor;
  invertOverlayColor: boolean;
  colorPassCount: number;
  scrollSpeed: number;
  scrollOffsetSpeed: THREE.Vector2;
  oscillationAmplitude: number;
  oscillationPeriodTicks: number;
  directionalFadeStart: number;
  directionalFadeEnd: number;
}

export type WaterTristripPvarParser = (data: Uint8Array | undefined) => WaterTristripPvar | null;

export const waterTristripColorPasses = [
  {
    uvScale: 5 / 80,
    direction: [-0.01, 0.05] as const,
    alphaUvScale: 4 / 80,
    alphaDirection: [-0.01, -0.05] as const
  },
  {
    uvScale: 3 / 80,
    direction: [0.01, -0.0175] as const,
    alphaUvScale: 2 / 80,
    alphaDirection: [0.01, 0.0175] as const
  }
] as const;

export function advanceWaterTristripOffset(
  offset: THREE.Vector2,
  direction: readonly [number, number],
  scrollSpeed: number,
  scrollOffsetSpeed: THREE.Vector2,
  oscillationAmplitude: number,
  oscillationPeriodTicks: number,
  tick: number,
  stepSeconds: number
): void {
  let x = offset.x + direction[0] * scrollSpeed * stepSeconds + scrollOffsetSpeed.x * stepSeconds;
  let y = offset.y + direction[1] * scrollSpeed * stepSeconds + scrollOffsetSpeed.y * stepSeconds;
  if (oscillationAmplitude !== 0 && oscillationPeriodTicks > 0) {
    const phase = ((tick % oscillationPeriodTicks) / oscillationPeriodTicks * 2 - 1) * Math.PI;
    x += direction[0] * oscillationAmplitude * Math.cos(phase);
    y += direction[1] * oscillationAmplitude * Math.sin(phase);
  }
  offset.set(wrapUnit(x), wrapUnit(y));
}

export function createWaterTristripFade(
  pointCount: number,
  startPairs: number,
  endPairs: number
): Float32Array {
  const fade = new Float32Array(pointCount).fill(1);
  for (let index = 0; index < pointCount; index += 1) {
    if (startPairs > 0 && index <= startPairs * 2) {
      fade[index] = Math.floor(index / 2) / startPairs;
    } else if (endPairs > 0 && index >= pointCount - endPairs * 2) {
      fade[index] = Math.floor((pointCount - index - 1) / 2) / endPairs;
    }
  }
  return fade;
}

export function createWaterTristripGeometry(
  spline: GameplaySpline,
  uvScale = 1,
  alphaUvScale = uvScale,
  fadeStart = 0,
  fadeEnd = 0
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(spline.points.length * 3);
  const uvs = new Float32Array(spline.points.length * 2);
  const alphaUvs = new Float32Array(spline.points.length * 2);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of spline.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;

  for (const [index, point] of spline.points.entries()) {
    positions.set([point.x, point.z, -point.y], index * 3);
    uvs.set([(point.x - centerX) * uvScale, (point.y - centerY) * uvScale], index * 2);
    alphaUvs.set([(point.x - centerX) * alphaUvScale, (point.y - centerY) * alphaUvScale], index * 2);
  }

  const indices: number[] = [];
  for (let index = 0; index < spline.points.length - 2; index += 1) {
    indices.push(...(index % 2 === 0
      ? [index, index + 1, index + 2]
      : [index + 1, index, index + 2]));
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('uv1', new THREE.BufferAttribute(alphaUvs, 2));
  geometry.setAttribute(
    'waterTristripFade',
    new THREE.BufferAttribute(createWaterTristripFade(spline.points.length, fadeStart, fadeEnd), 1)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function readWaterTristripColor(view: DataView, offset: number): WaterTristripColor {
  return {
    color: new THREE.Color(
      view.getUint8(offset) / 0xff,
      view.getUint8(offset + 1) / 0xff,
      view.getUint8(offset + 2) / 0xff
    ),
    opacity: Math.min(view.getUint8(offset + 3) / 0x80, 1)
  };
}

function wrapUnit(value: number): number {
  return value - Math.floor(value);
}
