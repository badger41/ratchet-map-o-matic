import * as THREE from 'three/webgpu';
import type { DlMobyInstance } from '../../../../../../../services/wasm/ratchetPs2Wasm';
import { buildMobyInstanceMatrix } from '../../../MobyData';
import {
  createGameplaySplinePath,
  sampleGameplaySplinePath,
  type GameplaySplinePath
} from '../../GameplaySplinePath';
import {
  MobyClass,
  type MobyClassContext,
  type MobyClassUpdate
} from '../../MobyClass';
import {
  isSplineMoverSpawnTarget,
  parseSplineMoverPvar,
  resolveSplineMoverTarget,
  stepSplineMoverAngle
} from './SplineMoverData';

export const splineMoverMobyClassId = 0x1768;

interface SplineMoverConfig {
  target: DlMobyInstance;
  path: GameplaySplinePath;
  distance: number;
  speed: number;
  rotationStiffness: number;
  rotationDamping: number;
  pitch: { value: number; velocity: number };
  yaw: { value: number; velocity: number };
  rotationInitialized: boolean;
  spawned: boolean;
  transform: THREE.Matrix4;
}

const hiddenInstanceTransform = new THREE.Matrix4().makeScale(0, 0, 0);

export class SplineMoverMobyClass extends MobyClass {
  private readonly position = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();

  static async create(context: MobyClassContext): Promise<SplineMoverMobyClass | null> {
    const paths = new Map<number, GameplaySplinePath>();
    for (const spline of context.splines) {
      const path = createGameplaySplinePath(spline);
      if (path) {
        paths.set(spline.index, path);
      }
    }
    const configs = context.instances.flatMap((instance): SplineMoverConfig[] => {
      const pvar = parseSplineMoverPvar(instance.pvar?.data);
      const path = pvar && paths.get(pvar.splineIndex);
      const target = pvar && resolveSplineMoverTarget(instance, pvar, context.indexedInstances);
      if (!pvar || !target || !path) {
        return [];
      }

      const startPointIndex = Math.max(0, Math.min(path.points.length - 1, pvar.startPointIndex));
      return [{
        target,
        path,
        distance: path.cumulativeDistances[startPointIndex],
        speed: pvar.speed,
        rotationStiffness: pvar.rotationStiffness,
        rotationDamping: pvar.rotationDamping,
        pitch: { value: 0, velocity: 0 },
        yaw: { value: 0, velocity: 0 },
        rotationInitialized: false,
        spawned: isSplineMoverSpawnTarget(target),
        transform: new THREE.Matrix4()
      }];
    });
    return configs.length > 0 ? new SplineMoverMobyClass(context, configs) : null;
  }

  private constructor(
    context: MobyClassContext,
    private readonly configs: SplineMoverConfig[]
  ) {
    super(context, splineMoverMobyClassId);
  }

  override get instanceCount(): number {
    return this.configs.length;
  }

  override setEnabled(enabled: boolean): void {
    super.setEnabled(enabled);
    this.context.mobyController.setClassVisible(splineMoverMobyClassId, !enabled);
    if (enabled) {
      this.applyTransforms(0);
    } else {
      this.resetTransforms();
    }
  }

  override update(update: MobyClassUpdate): void {
    this.applyTransforms(update.stepSeconds);
  }

  override dispose(): void {
    this.resetTransforms();
    this.context.mobyController.setClassVisible(splineMoverMobyClassId, true);
    super.dispose();
  }

  private applyTransforms(stepSeconds: number): void {
    for (const config of this.configs) {
      config.distance = sampleGameplaySplinePath(
        config.path,
        config.distance + config.speed * stepSeconds,
        this.position,
        this.tangent
      );
      const horizontalLength = Math.hypot(this.tangent.x, this.tangent.y);
      const targetPitch = -Math.atan2(this.tangent.z, horizontalLength);
      const targetYaw = Math.atan2(this.tangent.y, this.tangent.x);
      if (!config.rotationInitialized) {
        config.pitch.value = targetPitch;
        config.yaw.value = targetYaw;
        config.rotationInitialized = true;
      } else if (stepSeconds > 0) {
        stepSplineMoverAngle(
          config.pitch,
          targetPitch,
          config.rotationStiffness,
          config.rotationDamping
        );
        stepSplineMoverAngle(
          config.yaw,
          targetYaw,
          config.rotationStiffness,
          config.rotationDamping
        );
      }
      config.transform.copy(buildMobyInstanceMatrix({
        ...config.target,
        position: { x: this.position.x, y: this.position.y, z: this.position.z },
        rotation: {
          x: 0,
          y: config.pitch.value,
          z: config.yaw.value
        }
      }));
      this.context.mobyController.setInstanceTransform(config.target, config.transform);
    }
  }

  private resetTransforms(): void {
    for (const config of this.configs) {
      this.context.mobyController.setInstanceTransform(
        config.target,
        config.spawned ? hiddenInstanceTransform : null
      );
    }
  }
}
