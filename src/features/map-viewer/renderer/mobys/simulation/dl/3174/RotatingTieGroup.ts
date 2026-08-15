import * as THREE from 'three/webgpu';
import type { DlMobyInstance } from '../../../../../../../services/wasm/ratchetPs2Wasm';
import {
  ps2ToGltfBasisMatrix,
  setViewerTieGroupRotation
} from '../../../../ties/TieTypes';
import {
  MobyClass,
  type MobyClassContext,
  type MobyClassUpdate
} from '../../MobyClass';

export const rotatingTieGroupMobyClassId = 0x0c66;

interface RotatingTieGroupConfig {
  tieGroupIndices: number[];
  rotateFromInstanceOrigins: boolean;
  rotationRadiansPerSecond: THREE.Vector3;
  controllerRotation: THREE.Matrix4;
  inverseControllerRotation: THREE.Matrix4;
  pivot: THREE.Vector3;
  angles: THREE.Vector3;
}

const c66PvarByteLength = 0x20;
const degreesToRadians = Math.PI / 180;
const tau = Math.PI * 2;

export class RotatingTieGroupMobyClass extends MobyClass {
  private readonly euler = new THREE.Euler();
  private readonly ps2RotationMatrix = new THREE.Matrix4();
  private readonly viewerRotationMatrix = new THREE.Matrix4();

  static async create(context: MobyClassContext): Promise<RotatingTieGroupMobyClass | null> {
    const configs = context.instances
      .map((instance) => parseRotatingTieGroupPvar(instance))
      .filter((config): config is RotatingTieGroupConfig => config !== null);
    if (configs.length === 0) {
      return null;
    }

    return new RotatingTieGroupMobyClass(context, configs);
  }

  private constructor(
    context: MobyClassContext,
    private readonly configs: RotatingTieGroupConfig[]
  ) {
    super(context, rotatingTieGroupMobyClassId);
    context.mobyController.setClassVisible(rotatingTieGroupMobyClassId, false);
  }

  override get instanceCount(): number {
    return this.configs.length;
  }

  override setEnabled(enabled: boolean): void {
    super.setEnabled(enabled);
    this.context.mobyController.setClassVisible(rotatingTieGroupMobyClassId, !enabled);
    if (enabled) {
      this.applyTieGroupTransforms();
    } else {
      this.resetTieGroupTransforms();
    }
  }

  override update(update: MobyClassUpdate): void {
    for (const config of this.configs) {
      config.angles.x = wrapAngle(config.angles.x + config.rotationRadiansPerSecond.x * update.stepSeconds);
      config.angles.y = wrapAngle(config.angles.y + config.rotationRadiansPerSecond.y * update.stepSeconds);
      config.angles.z = wrapAngle(config.angles.z + config.rotationRadiansPerSecond.z * update.stepSeconds);
    }

    this.applyTieGroupTransforms();
  }

  override dispose(): void {
    this.resetTieGroupTransforms();
    this.context.mobyController.setClassVisible(rotatingTieGroupMobyClassId, true);
    super.dispose();
  }

  private applyTieGroupTransforms(): void {
    for (const config of this.configs) {
      this.applyTieGroupTransform(config);
    }
  }

  private resetTieGroupTransforms(): void {
    for (const config of this.configs) {
      for (const tieGroupIndex of config.tieGroupIndices) {
        this.context.tieController.setTieGroupRotation(tieGroupIndex, null);
      }
    }
  }

  private applyTieGroupTransform(config: RotatingTieGroupConfig): void {
    this.euler.set(config.angles.x, config.angles.y, config.angles.z, 'XYZ');
    this.ps2RotationMatrix.makeRotationFromEuler(this.euler);
    setViewerTieGroupRotation(
      this.viewerRotationMatrix,
      this.ps2RotationMatrix,
      config.rotateFromInstanceOrigins ? null : config.controllerRotation,
      config.rotateFromInstanceOrigins ? null : config.inverseControllerRotation
    );
    for (const tieGroupIndex of config.tieGroupIndices) {
      this.context.tieController.setTieGroupRotation(
        tieGroupIndex,
        this.viewerRotationMatrix,
        config.rotateFromInstanceOrigins ? null : config.pivot
      );
    }
  }
}

function parseRotatingTieGroupPvar(instance: DlMobyInstance): RotatingTieGroupConfig | null {
  const pvar = instance.pvar?.data;
  if (!pvar || pvar.byteLength < c66PvarByteLength) {
    return null;
  }

  const view = new DataView(pvar.buffer, pvar.byteOffset, pvar.byteLength);
  const tieGroupIndices = uniqueValidTieGroupIndices([
    view.getInt32(0x00, true),
    view.getInt32(0x04, true),
    view.getInt32(0x08, true)
  ]);
  if (tieGroupIndices.length === 0) {
    return null;
  }

  const rotationRadiansPerSecond = new THREE.Vector3(
    finiteOrZero(view.getFloat32(0x10, true)) * degreesToRadians,
    finiteOrZero(view.getFloat32(0x14, true)) * degreesToRadians,
    finiteOrZero(view.getFloat32(0x18, true)) * degreesToRadians
  );
  const pivot = new THREE.Vector3(
    instance.position.x,
    instance.position.y,
    instance.position.z
  ).applyMatrix4(ps2ToGltfBasisMatrix);
  const controllerRotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
    finiteOrZero(instance.rotation.x),
    finiteOrZero(instance.rotation.y),
    finiteOrZero(instance.rotation.z),
    'ZYX'
  ));

  return {
    tieGroupIndices,
    rotateFromInstanceOrigins: view.getInt32(0x1c, true) !== 0,
    rotationRadiansPerSecond,
    controllerRotation,
    inverseControllerRotation: controllerRotation.clone().invert(),
    pivot,
    angles: new THREE.Vector3()
  };
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function uniqueValidTieGroupIndices(indices: number[]): number[] {
  const unique = new Set<number>();
  for (const index of indices) {
    if (Number.isInteger(index) && index >= 0) {
      unique.add(index);
    }
  }

  return [...unique];
}

function wrapAngle(value: number): number {
  return value > tau || value < -tau
    ? value % tau
    : value;
}
