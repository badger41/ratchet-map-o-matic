import * as THREE from 'three/webgpu';
import type { TieInstanceRecord } from '../../../../../../../services/mapPackages/mapPackageTypes';
import type { DlMobyInstance } from '../../../../../../../services/wasm/ratchetPs2Wasm';
import {
  MobyClass,
  type MobyClassContext,
  type MobyClassUpdate
} from '../../MobyClass';

export const tieGlowColorMobyClassId = 0x0ce9;

interface TieGlowColorConfig {
  tieGroupIndex: number;
  phaseRadiansPerStep: number;
  thresholdRadians: number;
  colorA: THREE.Color;
  colorB: THREE.Color;
  current: THREE.Color;
  phase: number;
  spatialPhaseVector: THREE.Vector3 | null;
}

const pvarByteLength = 0x26;
const spatialPvarByteLength = 0x80;
const degreesToRadians = Math.PI / 180;
const byteToColor = 1 / 255;
const glowDisplayGamma = 2.2;
const gameStepSeconds = 1 / 60;
const thresholdBlendAmount = 0.1;
const tau = Math.PI * 2;

export class TieGlowColorMobyClass extends MobyClass {
  private readonly scratchColor = new THREE.Color();

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
      config.phase = wrapAngle(config.phase + config.phaseRadiansPerStep * update.stepSeconds / gameStepSeconds);
      if (!config.spatialPhaseVector) {
        if (config.thresholdRadians === 0) {
          colorForPhase(config, config.phase, config.current);
        } else {
          config.current.lerp(
            config.phase > config.thresholdRadians ? config.colorB : config.colorA,
            thresholdBlendAmount * update.stepSeconds / gameStepSeconds
          );
        }
      }
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
      if (!config.spatialPhaseVector) {
        this.context.tieController.setTieGroupGlowColor(config.tieGroupIndex, config.current);
        continue;
      }

      this.context.tieController.setTieGroupGlowColorForRecords(
        config.tieGroupIndex,
        (record) => colorForPhase(config, spatialPhaseForRecord(config, record), this.scratchColor)
      );
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

  const colorA = readRgb(pvar, 0x20);
  return {
    tieGroupIndex,
    phaseRadiansPerStep: finiteOrZero(view.getFloat32(0x04, true)) * degreesToRadians * gameStepSeconds,
    thresholdRadians: wrapAngle(finiteOrZero(view.getFloat32(0x08, true)) * degreesToRadians),
    colorA,
    colorB: readRgb(pvar, 0x23),
    current: colorA.clone(),
    phase: wrapAngle(finiteOrZero(view.getFloat32(0x0c, true))),
    spatialPhaseVector: readSpatialPhaseVector(view, pvar.byteLength)
  };
}

function colorForPhase(config: TieGlowColorConfig, phase: number, target: THREE.Color): THREE.Color {
  if (config.thresholdRadians === 0) {
    return target.copy(config.colorA).lerp(config.colorB, Math.cos(phase) * 0.5 + 0.5);
  }

  return target.copy(phase > config.thresholdRadians ? config.colorB : config.colorA);
}

function spatialPhaseForRecord(config: TieGlowColorConfig, record: TieInstanceRecord): number {
  const vector = config.spatialPhaseVector;
  if (!vector) {
    return config.phase;
  }

  const row = record.matrixRows[2];
  return wrapAngle(config.phase - (row[0] * vector.x + row[1] * vector.y + row[2] * vector.z) * tau);
}

function readSpatialPhaseVector(view: DataView, byteLength: number): THREE.Vector3 | null {
  if (byteLength < spatialPvarByteLength || view.getInt32(0x1c, true) === 0) {
    return null;
  }

  const spatialScale = Math.abs(finiteOrZero(view.getFloat32(0x7c, true)));
  if (spatialScale === 0) {
    return null;
  }

  const vector = new THREE.Vector3(
    finiteOrZero(view.getFloat32(0x70, true)),
    finiteOrZero(view.getFloat32(0x74, true)),
    finiteOrZero(view.getFloat32(0x78, true))
  );
  if (vector.lengthSq() === 0) {
    return null;
  }

  return vector.normalize().multiplyScalar(1 / Math.sqrt(spatialScale));
}

function readRgb(bytes: Uint8Array, offset: number): THREE.Color {
  return new THREE.Color(
    pvarColorToRaw(bytes[offset]),
    pvarColorToRaw(bytes[offset + 1]),
    pvarColorToRaw(bytes[offset + 2])
  );
}

function pvarColorToRaw(value: number | undefined): number {
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
