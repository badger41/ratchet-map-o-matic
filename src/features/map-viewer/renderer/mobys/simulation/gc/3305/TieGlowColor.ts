import * as THREE from 'three/webgpu';
import {
  MobyClass,
  type MobyClassContext
} from '../../MobyClass';
import {
  tieGlowRgbForPhase,
  wrapTieGlowAngle
} from '../../dl/3305/TieGlowColorMath';
import {
  parseGcTieGlowColorPvar,
  type GcTieGlowColorPvar
} from './TieGlowColorPvar';

export const gcTieGlowColorMobyClassId = 0x0ce9;

interface TieGlowColorConfig extends GcTieGlowColorPvar {
  displayColor: THREE.Color;
}

const byteToColor = 1 / 255;

export class GcTieGlowColorMobyClass extends MobyClass {
  static async create(context: MobyClassContext): Promise<GcTieGlowColorMobyClass | null> {
    const configs = context.instances
      .map((instance) => parseGcTieGlowColorPvar(instance.pvar?.data))
      .filter((config): config is GcTieGlowColorPvar => config !== null)
      .map((config): TieGlowColorConfig => ({
        ...config,
        displayColor: setDisplayColor(new THREE.Color(), config.current)
      }));
    if (configs.length === 0) {
      return null;
    }

    return new GcTieGlowColorMobyClass(context, configs);
  }

  private constructor(
    context: MobyClassContext,
    private readonly configs: TieGlowColorConfig[]
  ) {
    super(context, gcTieGlowColorMobyClassId);
    context.mobyController.setClassVisible(gcTieGlowColorMobyClassId, false);
  }

  override get instanceCount(): number {
    return this.configs.length;
  }

  override setEnabled(enabled: boolean): void {
    super.setEnabled(enabled);
    this.context.mobyController.setClassVisible(gcTieGlowColorMobyClassId, !enabled);
    if (enabled) {
      this.applyGlowColors();
    } else {
      this.resetGlowColors();
    }
  }

  override update(): void {
    for (const config of this.configs) {
      config.phase = wrapTieGlowAngle(config.phase + config.phaseRadiansPerStep);
      config.current = tieGlowRgbForPhase(
        config.current,
        config.colorA,
        config.colorB,
        config.phase,
        config.thresholdRadians,
        false
      );
      setDisplayColor(config.displayColor, config.current);
    }

    this.applyGlowColors();
  }

  override dispose(): void {
    this.resetGlowColors();
    this.context.mobyController.setClassVisible(gcTieGlowColorMobyClassId, true);
    super.dispose();
  }

  private applyGlowColors(): void {
    for (const config of this.configs) {
      this.context.tieController.setTieGroupGlowColor(config.tieGroupIndex, config.displayColor);
    }
  }

  private resetGlowColors(): void {
    for (const config of this.configs) {
      this.context.tieController.setTieGroupGlowColor(config.tieGroupIndex, null);
    }
  }
}

function setDisplayColor(target: THREE.Color, rgb: number): THREE.Color {
  return target.setRGB(
    (rgb & 0xff) * byteToColor,
    (rgb >> 8 & 0xff) * byteToColor,
    (rgb >> 16 & 0xff) * byteToColor
  );
}
