import * as THREE from 'three/webgpu';
import {
  readWaterTristripColor,
  type WaterTristripPvar
} from '../../WaterTristripData.ts';

const uyaWaterTristripPvarByteLength = 0xa0;

export function parseUyaWaterTristripPvar(data: Uint8Array | undefined): WaterTristripPvar | null {
  if (!data || data.byteLength < uyaWaterTristripPvarByteLength) {
    return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fadePairs = Math.max(0, view.getInt32(0x5c, true));
  const angularStep = finiteNumber(view.getFloat32(0x2c, true), 0);
  return {
    splineIndex: view.getInt32(0x3c, true),
    overlayFxTexId: view.getInt32(0x18, true),
    underlayColor: readWaterTristripColor(view, 0x00),
    overlayColor: readWaterTristripColor(view, 0x08),
    invertOverlayColor: view.getInt32(0x34, true) !== 0,
    colorPassCount: Math.min(Math.max(view.getInt32(0x14, true), 0), 2),
    scrollSpeed: finiteNumber(view.getFloat32(0x24, true), 0),
    scrollOffsetSpeed: new THREE.Vector2(
      finiteNumber(view.getFloat32(0x54, true), 0),
      finiteNumber(view.getFloat32(0x58, true), 0)
    ),
    oscillationAmplitude: finiteNumber(view.getFloat32(0x28, true), 0),
    oscillationPeriodTicks: angularStep === 0 ? 0 : Math.abs(2 * Math.PI / angularStep),
    directionalFadeStart: fadePairs,
    directionalFadeEnd: fadePairs
  };
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
