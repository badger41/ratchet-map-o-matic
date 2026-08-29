import * as THREE from 'three/webgpu';
import type { LoadedMapPackage } from '../../../../services/mapPackages/mapPackageTypes';
import type {
  DlMobyInstance,
  DlMobyInstances,
  GameplaySpline
} from '../../../../services/wasm/ratchetPs2Wasm';
import { disposeObject3D } from '../RendererDisposal';
import type { MobyInstanceController } from './MobyInstanceController';
import type { TieInstanceController } from '../ties/TieInstanceController';
import {
  type MobyClass,
  type MobyClassFactory,
  type MobyClassFrame,
  type MobyClassUpdate
} from './simulation/MobyClass';
import { dlMobyClassFactories } from './simulation/dl/dlMobyClasses';
import { gcMobyClassFactories } from './simulation/gc/gcMobyClasses';
import { uyaMobyClassFactories } from './simulation/uya/uyaMobyClasses';

export interface MobySimulationStats {
  registeredClasses: number;
  activeSimulators: number;
  simulatedInstances: number;
  fixedTicks: number;
}

export class MobySimulationController {
  private root: THREE.Group | null = null;
  private classes: MobyClass[] = [];
  private enabled = true;
  private fixedTicks = 0;
  private registeredClasses = 0;

  async load(
    parent: THREE.Object3D,
    mapPackage: LoadedMapPackage,
    mobyInstances: DlMobyInstances | null,
    mobyController: MobyInstanceController,
    tieController: TieInstanceController,
    camera: THREE.Camera,
    splines: GameplaySpline[]
  ): Promise<MobySimulationStats> {
    this.dispose();

    const root = new THREE.Group();
    root.name = 'moby_simulation';
    root.visible = this.enabled;
    parent.add(root);
    this.root = root;

    const classFactories = getMobyClassFactoriesForGame(mapPackage.rootManifest.Game);
    this.registeredClasses = classFactories.size;
    const recordsByClassId = groupMobyRecordsByClassId(mobyInstances?.instances ?? []);
    for (const [classId, createClass] of classFactories) {
      const instances = recordsByClassId.get(classId) ?? [];
      if (instances.length === 0) {
        continue;
      }

      const mobyClass = await createClass({
        root,
        mapPackage,
        mobyController,
        tieController,
        camera,
        instances,
        splines
      });
      if (mobyClass) {
        mobyClass.setEnabled(this.enabled);
        this.classes.push(mobyClass);
      }
    }

    return this.getStats();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.root) {
      this.root.visible = enabled;
    }
    for (const mobyClass of this.classes) {
      mobyClass.setEnabled(enabled);
    }
  }

  fixedUpdate(stepSeconds: number): void {
    if (!this.enabled || this.classes.length === 0) {
      return;
    }

    this.fixedTicks += 1;
    const update: MobyClassUpdate = {
      stepSeconds,
      tick: this.fixedTicks
    };
    for (const mobyClass of this.classes) {
      mobyClass.update(update);
    }
  }

  renderUpdate(timeSeconds: number): void {
    if (!this.enabled || this.classes.length === 0) {
      return;
    }

    const frame: MobyClassFrame = { timeSeconds };
    for (const mobyClass of this.classes) {
      mobyClass.render(frame);
    }
  }

  getStats(): MobySimulationStats {
    return {
      registeredClasses: this.registeredClasses,
      activeSimulators: this.classes.length,
      simulatedInstances: this.classes.reduce((total, mobyClass) => total + mobyClass.instanceCount, 0),
      fixedTicks: this.fixedTicks
    };
  }

  dispose(): void {
    for (const mobyClass of this.classes) {
      mobyClass.dispose();
    }

    this.classes = [];
    this.registeredClasses = 0;
    this.fixedTicks = 0;
    if (this.root) {
      this.root.parent?.remove(this.root);
      disposeObject3D(this.root);
      this.root = null;
    }
  }
}

function groupMobyRecordsByClassId(records: DlMobyInstance[]): Map<number, DlMobyInstance[]> {
  const groups = new Map<number, DlMobyInstance[]>();
  for (const record of records) {
    const group = groups.get(record.classId);
    if (group) {
      group.push(record);
    } else {
      groups.set(record.classId, [record]);
    }
  }

  return groups;
}

function getMobyClassFactoriesForGame(game: unknown): Map<number, MobyClassFactory> {
  const key = typeof game === 'string' ? game.toLowerCase() : '';
  if (key === 'dl' || key.includes('deadlocked')) {
    return dlMobyClassFactories;
  }

  if (key === 'gc') {
    return gcMobyClassFactories;
  }

  return key === 'uya' ? uyaMobyClassFactories : new Map();
}
