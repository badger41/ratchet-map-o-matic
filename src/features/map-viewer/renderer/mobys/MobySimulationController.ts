import * as THREE from 'three/webgpu';
import type { LoadedMapPackage } from '../../../../services/mapPackages/mapPackageTypes';
import type {
  DlMobyInstances,
  DlMobyMissionInstances,
  GameplayCuboid,
  GameplaySpline
} from '../../../../services/wasm/ratchetPs2Wasm';
import { mobyMissionVisible } from '../../../../services/mapLoading/dlMobyMissions';
import { disposeObject3D } from '../RendererDisposal';
import { groupRecordsByClassId } from '../InstanceData';
import type { MobyInstanceController } from './MobyInstanceController';
import { isDeadlockedGame } from './MobyGltfSupport';
import type { TieInstanceController } from '../ties/TieInstanceController';
import {
  type MobyClass,
  type MobyClassFactory,
  type MobyClassFrame,
  type MobyClassUpdate
} from './simulation/MobyClass';
import { dlMobyClassFactories } from './simulation/dl/dlMobyClasses';
import { isSplineMoverSpawnTarget } from './simulation/dl/5992/SplineMoverData';
import { gcMobyClassFactories } from './simulation/gc/gcMobyClasses';
import { uyaMobyClassFactories } from './simulation/uya/uyaMobyClasses';

export interface MobySimulationStats {
  registeredClasses: number;
  activeSimulators: number;
  simulatedInstances: number;
  fixedTicks: number;
}

interface MobySimulationClass {
  mission: number | null;
  mobyClass: MobyClass;
}

export class MobySimulationController {
  private root: THREE.Group | null = null;
  private classes: MobySimulationClass[] = [];
  private enabled = true;
  private selectedMission: number | null = null;
  private fixedTicks = 0;
  private registeredClasses = 0;

  async load(
    parent: THREE.Object3D,
    mapPackage: LoadedMapPackage,
    mobyInstances: DlMobyInstances | null,
    mobyMissions: DlMobyMissionInstances[],
    mobyController: MobyInstanceController,
    tieController: TieInstanceController,
    camera: THREE.Camera,
    cuboids: GameplayCuboid[],
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
    const coreInstances = mobyInstances?.instances ?? [];
    const indexedCoreInstances = coreInstances.filter((instance) => !isSplineMoverSpawnTarget(instance));
    const instanceSets = [
      { mission: null, instances: coreInstances, indexedInstances: indexedCoreInstances },
      ...mobyMissions.map(({ missionIndex, mobyInstances: missionInstances }) => ({
        mission: missionIndex,
        instances: missionInstances.instances,
        indexedInstances: [
          ...indexedCoreInstances,
          ...missionInstances.instances.filter((instance) => !isSplineMoverSpawnTarget(instance))
        ]
      }))
    ];
    for (const instanceSet of instanceSets) {
      const recordsByClassId = groupRecordsByClassId(instanceSet.instances);
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
          indexedInstances: instanceSet.indexedInstances,
          cuboids,
          splines
        });
        if (mobyClass) {
          this.classes.push({ mission: instanceSet.mission, mobyClass });
        }
      }
    }
    this.applyEnabledClasses();

    return this.getStats();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.root) {
      this.root.visible = enabled;
    }
    this.applyEnabledClasses();
  }

  setMission(mission: number | null): void {
    if (this.selectedMission === mission) {
      return;
    }

    this.selectedMission = mission;
    this.applyEnabledClasses();
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
    for (const simulation of this.classes) {
      if (this.isClassEnabled(simulation)) {
        simulation.mobyClass.update(update);
      }
    }
  }

  renderUpdate(timeSeconds: number): void {
    if (!this.enabled || this.classes.length === 0) {
      return;
    }

    const frame: MobyClassFrame = { timeSeconds };
    for (const simulation of this.classes) {
      if (this.isClassEnabled(simulation)) {
        simulation.mobyClass.render(frame);
      }
    }
  }

  getStats(): MobySimulationStats {
    const activeClasses = this.classes.filter((simulation) => this.isClassEnabled(simulation));
    return {
      registeredClasses: this.registeredClasses,
      activeSimulators: activeClasses.length,
      simulatedInstances: activeClasses.reduce(
        (total, simulation) => total + simulation.mobyClass.instanceCount,
        0
      ),
      fixedTicks: this.fixedTicks
    };
  }

  dispose(): void {
    for (const simulation of this.classes) {
      simulation.mobyClass.dispose();
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

  private isClassEnabled(simulation: MobySimulationClass): boolean {
    return this.enabled && mobyMissionVisible(simulation.mission ?? -1, this.selectedMission);
  }

  private applyEnabledClasses(): void {
    // Disable inactive missions first so active ones restore any shared class visibility last.
    for (const simulation of this.classes) {
      if (!this.isClassEnabled(simulation)) {
        simulation.mobyClass.setEnabled(false);
      }
    }
    for (const simulation of this.classes) {
      if (this.isClassEnabled(simulation)) {
        simulation.mobyClass.setEnabled(true);
      }
    }
  }
}

function getMobyClassFactoriesForGame(game: unknown): Map<number, MobyClassFactory> {
  const key = typeof game === 'string' ? game.toLowerCase() : '';
  if (isDeadlockedGame(game)) {
    return dlMobyClassFactories;
  }

  if (key === 'gc') {
    return gcMobyClassFactories;
  }

  return key === 'uya' ? uyaMobyClassFactories : new Map();
}
