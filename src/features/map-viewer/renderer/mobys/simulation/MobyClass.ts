import * as THREE from 'three/webgpu';
import type { LoadedMapPackage } from '../../../../../services/mapPackages/mapPackageTypes';
import type { DlMobyInstance } from '../../../../../services/wasm/ratchetPs2Wasm';
import { disposeObject3D } from '../../RendererDisposal';
import type { MobyInstanceController } from '../MobyInstanceController';

export interface MobyClassContext {
  root: THREE.Group;
  mapPackage: LoadedMapPackage;
  mobyController: MobyInstanceController;
  camera: THREE.Camera;
  instances: DlMobyInstance[];
}

export interface MobyClassUpdate {
  stepSeconds: number;
  tick: number;
}

export interface MobyClassFrame {
  timeSeconds: number;
}

export abstract class MobyClass {
  readonly group: THREE.Group;
  private enabled = true;

  protected constructor(
    protected readonly context: MobyClassContext,
    readonly classId: number,
    group: THREE.Group = new THREE.Group()
  ) {
    this.group = group;
    this.group.name = `moby_sim_${classId.toString(16).padStart(4, '0')}`;
    context.root.add(this.group);
  }

  get instanceCount(): number {
    return this.context.instances.length;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.group.visible = enabled;
  }

  update(_update: MobyClassUpdate): void {
  }

  render(_frame: MobyClassFrame): void {
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    disposeObject3D(this.group);
  }
}

export type MobyClassFactory = (context: MobyClassContext) => Promise<MobyClass | null>;
