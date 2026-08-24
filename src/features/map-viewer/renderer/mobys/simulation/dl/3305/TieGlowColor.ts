import * as THREE from 'three/webgpu';
import type { TieInstanceRecord } from '../../../../../../../services/mapPackages/mapPackageTypes';
import type { DlMobyInstance } from '../../../../../../../services/wasm/ratchetPs2Wasm';
import {
  MobyClass,
  type MobyClassContext
} from '../../MobyClass';
import {
  tieGlowDisplayByte,
  tieGlowRgbForPhase,
  wrapTieGlowAngle
} from './TieGlowColorMath';

export const tieGlowColorMobyClassId = 0x0ce9;

interface TieGlowColorConfig {
  tieGroupIndex: number;
  phaseRadiansPerStep: number;
  thresholdRadians: number;
  colorA: number;
  colorB: number;
  current: number;
  displayColor: THREE.Color;
  phase: number;
  spatialPhaseVector: THREE.Vector3 | null;
}

const pvarByteLength = 0x90;
const degreesToRadians = Math.PI / 180;
const byteToColor = 1 / 255;
const gameStepSeconds = 1 / 60;
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

  override update(): void {
    for (const config of this.configs) {
      config.phase = wrapTieGlowAngle(config.phase + config.phaseRadiansPerStep);
      if (!config.spatialPhaseVector) {
        config.current = colorForPhase(config, config.phase, false);
        setDisplayColor(config.displayColor, config.current);
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
        this.context.tieController.setTieGroupGlowColor(config.tieGroupIndex, config.displayColor);
        continue;
      }

      this.context.tieController.setTieGroupGlowColorForRecords(
        config.tieGroupIndex,
        (record) => setDisplayColor(
          this.scratchColor,
          colorForPhase(config, spatialPhaseForRecord(config, record), true)
        )
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
  if (tieGroupIndex < 0 || view.getInt32(0x1c, true) === 0 || view.getInt32(0x80, true) !== 0) {
    return null;
  }

  const colorA = readRgb(pvar, 0x20);
  const current = readRgb(pvar, 0x10);
  return {
    tieGroupIndex,
    phaseRadiansPerStep: finiteOrZero(view.getFloat32(0x04, true)) * degreesToRadians * gameStepSeconds,
    thresholdRadians: wrapTieGlowAngle(finiteOrZero(view.getFloat32(0x08, true)) * degreesToRadians),
    colorA,
    colorB: readRgb(pvar, 0x23),
    current,
    displayColor: setDisplayColor(new THREE.Color(), current),
    phase: wrapTieGlowAngle(finiteOrZero(view.getFloat32(0x0c, true))),
    spatialPhaseVector: readSpatialPhaseVector(view)
  };
}

function colorForPhase(config: TieGlowColorConfig, phase: number, spatial: boolean): number {
  return tieGlowRgbForPhase(
    config.current,
    config.colorA,
    config.colorB,
    phase,
    config.thresholdRadians,
    spatial
  );
}

function spatialPhaseForRecord(config: TieGlowColorConfig, record: TieInstanceRecord): number {
  const vector = config.spatialPhaseVector;
  if (!vector) {
    return config.phase;
  }

  const position = record.position;
  return wrapTieGlowAngle(
    config.phase - (position[0] * vector.x + position[1] * vector.y + position[2] * vector.z) * tau
  );
}

function readSpatialPhaseVector(view: DataView): THREE.Vector3 | null {
  const wavelength = finiteOrZero(view.getFloat32(0x7c, true));
  if (wavelength === 0) {
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

  return vector.normalize().multiplyScalar(1 / wavelength);
}

function readRgb(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
}

function setDisplayColor(target: THREE.Color, rgb: number): THREE.Color {
  return target.setRGB(
    tieGlowDisplayByte(rgb, 0) * byteToColor,
    tieGlowDisplayByte(rgb, 8) * byteToColor,
    tieGlowDisplayByte(rgb, 16) * byteToColor
  );
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
