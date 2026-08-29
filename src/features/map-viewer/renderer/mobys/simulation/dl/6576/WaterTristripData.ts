import * as THREE from 'three/webgpu';
import {
  readWaterTristripColor,
  type WaterTristripPvar
} from '../../WaterTristripData.ts';

export function parseWaterTristripPvar(data: Uint8Array | undefined): WaterTristripPvar | null {
  if (!data || data.byteLength < 0x70) {
    return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    splineIndex: view.getInt32(0x00, true),
    overlayFxTexId: view.getInt32(0x04, true),
    underlayColor: readWaterTristripColor(view, 0x08),
    overlayColor: readWaterTristripColor(view, 0x0c),
    invertOverlayColor: view.getInt32(0x10, true) !== 0,
    colorPassCount: 2,
    scrollSpeed: finiteNumber(view.getFloat32(0x14, true), 0),
    scrollOffsetSpeed: new THREE.Vector2(
      finiteNumber(view.getFloat32(0x18, true), 0),
      finiteNumber(view.getFloat32(0x1c, true), 0)
    ),
    oscillationAmplitude: finiteNumber(view.getFloat32(0x38, true), 0),
    oscillationPeriodTicks: view.getInt32(0x3c, true),
    directionalFadeStart: view.getUint8(0x20),
    directionalFadeEnd: view.getUint8(0x21)
  };
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
