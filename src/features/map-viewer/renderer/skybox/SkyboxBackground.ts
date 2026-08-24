import * as THREE from 'three/webgpu';
import type { DlLevelSettings, DlRgb96 } from '../../../../services/wasm/ratchetPs2Wasm.ts';

const fallbackColor = 0x070a0d;

export function mapLinearColorFromRgb96(color: DlRgb96): THREE.Color {
  return new THREE.Color().setRGB(
    normalizeColorChannel(color.red),
    normalizeColorChannel(color.green),
    normalizeColorChannel(color.blue),
    THREE.SRGBColorSpace
  );
}

export function skyboxEncodedBackgroundColor(levelSettings: DlLevelSettings | null): THREE.Color {
  const color = levelSettings
    ? mapLinearColorFromRgb96(levelSettings.backgroundColor)
    : new THREE.Color(fallbackColor);
  return color.convertLinearToSRGB();
}

function normalizeColorChannel(value: number): number {
  const numeric = Number.isFinite(value) ? value : 0;
  return Math.min(Math.max(numeric > 1 ? numeric / 255 : numeric, 0), 1);
}
