import { wrapTieGlowAngle } from '../../dl/3305/TieGlowColorMath.ts';

export interface GcTieGlowColorPvar {
  tieGroupIndex: number;
  phaseRadiansPerStep: number;
  thresholdRadians: number;
  colorA: number;
  colorB: number;
  current: number;
  phase: number;
}

const pvarByteLength = 0x70;
const degreesToRadians = Math.PI / 180;
const gameStepSeconds = 1 / 60;

export function parseGcTieGlowColorPvar(pvar: Uint8Array | undefined): GcTieGlowColorPvar | null {
  if (!pvar || pvar.byteLength < pvarByteLength) {
    return null;
  }

  const view = new DataView(pvar.buffer, pvar.byteOffset, pvar.byteLength);
  const tieGroupIndex = view.getInt32(0x00, true);
  if (tieGroupIndex < 0) {
    return null;
  }

  // ponytail: approximate GC's projected-overlay mode with group RGB until the viewer can draw that overlay.
  return {
    tieGroupIndex,
    phaseRadiansPerStep: finiteOrZero(view.getFloat32(0x04, true)) * degreesToRadians * gameStepSeconds,
    thresholdRadians: wrapTieGlowAngle(finiteOrZero(view.getFloat32(0x08, true)) * degreesToRadians),
    colorA: readRgb(pvar, 0x20),
    colorB: readRgb(pvar, 0x23),
    current: readRgb(pvar, 0x10),
    phase: wrapTieGlowAngle(finiteOrZero(view.getFloat32(0x0c, true)))
  };
}

function readRgb(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
