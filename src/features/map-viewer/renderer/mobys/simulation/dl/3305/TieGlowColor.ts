import * as THREE from 'three/webgpu';
import type { DlMobyInstance } from '../../../../../../../services/wasm/ratchetPs2Wasm';
import {
  MobyClass,
  type MobyClassContext,
  type MobyClassUpdate
} from '../../MobyClass';

export const tieGlowColorMobyClassId = 0x0ce9;

interface TieGlowColorConfig {
  tieGroupIndex: number;
  phaseRadiansPerSecond: number;
  thresholdRadians: number;
  colorA: THREE.Color;
  colorB: THREE.Color;
  current: THREE.Color;
  phase: number;
}

const pvarByteLength = 0x26;
const degreesToRadians = Math.PI / 180;
const byteToColor = 1 / 255;
const glowDisplayGamma = 2.2;
const phaseSpeedScale = 1;
const tau = Math.PI * 2;

export class TieGlowColorMobyClass extends MobyClass {
  static async create(context: MobyClassContext): Promise<TieGlowColorMobyClass | null> {
    const configs = context.instances
      .map((instance) => parseTieGlowColorPvar(instance))
      .filter((config): config is TieGlowColorConfig => config !== null);
    if (configs.length === 0) {
      return null;
    }

    return new TieGlowColorMobyClass(context, configs);
  }

  private constructor(
    context: MobyClassContext,
    private readonly configs: TieGlowColorConfig[]
  ) {
    super(context, tieGlowColorMobyClassId);
    context.mobyController.setClassVisible(tieGlowColorMobyClassId, false);
  }

  override get instanceCount(): number {
    return this.configs.length;
  }

  override setEnabled(enabled: boolean): void {
    super.setEnabled(enabled);
    this.context.mobyController.setClassVisible(tieGlowColorMobyClassId, !enabled);
    if (enabled) {
      this.applyGlowColors();
    } else {
      this.resetGlowColors();
    }
  }

  override update(update: MobyClassUpdate): void {
    for (const config of this.configs) {
      config.phase = wrapAngle(config.phase + config.phaseRadiansPerSecond * update.stepSeconds * phaseSpeedScale);
      const amount = config.thresholdRadians === 0
        ? Math.sin(config.phase) * 0.5 + 0.5
        : (config.phase > config.thresholdRadians ? 1 : 0);
      config.current.copy(config.colorA).lerp(config.colorB, amount);
    }

    this.applyGlowColors();
  }

  override dispose(): void {
    this.resetGlowColors();
    this.context.mobyController.setClassVisible(tieGlowColorMobyClassId, true);
    super.dispose();
  }

  private applyGlowColors(): void {
    for (const config of this.configs) {
      this.context.tieController.setTieGroupGlowColor(config.tieGroupIndex, config.current);
    }
  }

  private resetGlowColors(): void {
    for (const config of this.configs) {
      this.context.tieController.setTieGroupGlowColor(config.tieGroupIndex, null);
    }
  }
}

function parseTieGlowColorPvar(instance: DlMobyInstance): TieGlowColorConfig | null {
  const pvar = instance.pvar?.data;
  if (!pvar || pvar.byteLength < pvarByteLength) {
    return null;
  }

  const view = new DataView(pvar.buffer, pvar.byteOffset, pvar.byteLength);
  const tieGroupIndex = view.getInt32(0x00, true);
  if (tieGroupIndex < 0) {
    return null;
  }

  // ponytail: local CE9 fixtures only exercise this non-spatial sine/threshold blend path.
  const colorA = readRgb(pvar, 0x20);
  return {
    tieGroupIndex,
    phaseRadiansPerSecond: finiteOrZero(view.getFloat32(0x04, true)) * degreesToRadians,
    thresholdRadians: Math.max(0, finiteOrZero(view.getFloat32(0x08, true)) * degreesToRadians),
    colorA,
    colorB: readRgb(pvar, 0x23),
    current: colorA.clone(),
    phase: 0
  };
}

function readRgb(bytes: Uint8Array, offset: number): THREE.Color {
  return new THREE.Color(
    pvarColorToRaw(bytes[offset]),
    pvarColorToRaw(bytes[offset + 1]),
    pvarColorToRaw(bytes[offset + 2])
  );
}

function pvarColorToRaw(value: number | undefined): number {
  // ponytail: keep the display curve that matched CE9 broadly; 9592 needs a separate base-glow fix.
  return Math.pow((((value ?? 255) >> 2) << 2) * byteToColor, glowDisplayGamma);
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function wrapAngle(value: number): number {
  const wrapped = value > tau || value < -tau
    ? value % tau
    : value;
  if (wrapped > Math.PI) {
    return wrapped - tau;
  }
  if (wrapped < -Math.PI) {
    return wrapped + tau;
  }

  return wrapped;
}
