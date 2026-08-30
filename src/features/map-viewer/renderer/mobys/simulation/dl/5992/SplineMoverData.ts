import * as THREE from 'three/webgpu';
import type {
  DlMobyInstance,
  DlMobyInstances
} from '../../../../../../../services/wasm/ratchetPs2Wasm';
import { wrapRadians } from '../../SimulationMath.ts';

export interface SplineMoverPvar {
  splineIndex: number;
  targetMobyClassId: number;
  targetMobyIndex: number;
  rotationStiffness: number;
  rotationDamping: number;
  speed: number;
  startPointIndex: number;
}

const pvarByteLength = 0x15c;
const splineMoverMobyClassId = 0x1768;
const spawnedTargets = new WeakSet<DlMobyInstance>();
const spawnTargetsByController = new WeakMap<DlMobyInstance, DlMobyInstance>();

export function stepSplineMoverAngle(
  state: { value: number; velocity: number },
  target: number,
  stiffness: number,
  damping: number
): void {
  const error = wrapRadians(target - state.value);
  const limit = Math.abs(error);
  state.velocity = THREE.MathUtils.clamp(state.velocity, -limit, limit);
  state.velocity += stiffness * error - damping * state.velocity;
  state.velocity = THREE.MathUtils.clamp(state.velocity, -limit, limit);
  state.value = wrapRadians(state.value + state.velocity);
}

export function parseSplineMoverPvar(pvar: Uint8Array | undefined): SplineMoverPvar | null {
  if (!pvar || pvar.byteLength < pvarByteLength) {
    return null;
  }

  const view = new DataView(pvar.buffer, pvar.byteOffset, pvar.byteLength);
  const speed = view.getFloat32(0x130, true);
  return {
    splineIndex: view.getInt32(0xe8, true),
    targetMobyClassId: view.getInt32(0x114, true),
    targetMobyIndex: view.getInt32(0x118, true),
    rotationStiffness: view.getFloat32(0x128, true),
    rotationDamping: view.getFloat32(0x12c, true),
    speed: Number.isFinite(speed) ? speed : 0,
    startPointIndex: view.getInt32(0x13c, true)
  };
}

export function materializeSplineMoverSpawnTargets(source: DlMobyInstances): DlMobyInstances {
  const spawned: DlMobyInstance[] = [];
  for (const instance of source.instances) {
    if (instance.classId !== splineMoverMobyClassId) {
      continue;
    }

    const pvar = parseSplineMoverPvar(instance.pvar?.data);
    if (!pvar || pvar.targetMobyIndex >= 0 || pvar.targetMobyClassId < 0) {
      continue;
    }

    const template = source.instances.find((candidate) => candidate.classId === pvar.targetMobyClassId) ?? instance;
    const target: DlMobyInstance = {
      ...template,
      mission: instance.mission,
      uid: -1,
      classId: pvar.targetMobyClassId,
      position: { ...instance.position },
      rotation: { ...instance.rotation },
      pvarIndex: -1,
      pvar: null
    };
    spawnedTargets.add(target);
    spawnTargetsByController.set(instance, target);
    spawned.push(target);
  }

  return spawned.length === 0
    ? source
    : {
      ...source,
      instances: [...source.instances, ...spawned]
    };
}

export function isSplineMoverSpawnTarget(instance: DlMobyInstance): boolean {
  return spawnedTargets.has(instance);
}

export function resolveSplineMoverTarget(
  controller: DlMobyInstance,
  pvar: SplineMoverPvar,
  indexedInstances: DlMobyInstance[]
): DlMobyInstance | undefined {
  return spawnTargetsByController.get(controller) ?? indexedInstances[pvar.targetMobyIndex];
}
