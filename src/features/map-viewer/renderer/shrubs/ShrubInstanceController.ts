import * as THREE from 'three/webgpu';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  defaultShrubRenderOptions,
  type GltfExportEntry,
  type LoadedMapPackage,
  type ShrubInstanceRecord,
  type ShrubRenderOptions,
  type ShrubStats
} from '../../../../services/mapPackages/mapPackageTypes';
import {
  parseShrubClassIds,
  parseShrubInstanceRecords
} from '../../../../services/mapPackages/shrubPackageParsers';
import {
  collectShrubPrimitives,
  createInstancedGeometry,
  estimateTriangleCount,
  loadShrubClassSource
} from './ShrubClassSource';
import {
  buildShrubEntryMap,
  chunkShrubRecords,
  groupShrubRecordsByClassId,
  prepareShrubRecord
} from './ShrubData';
import { disposeObject3D } from './shrubDisposal';
import {
  createDlLightSelectorInstanceAttribute,
  createShrubAmbientColorInstanceAttribute,
  createShrubDirectionalLightBinding,
  disposeShrubDirectionalLightBinding,
  updateShrubMaterialLightingUniforms
} from './ShrubLighting';
import { cloneShrubMaterial } from './ShrubMaterials';
import {
  dlLightSelectorAttributeName,
  emptyShrubStats,
  instanceMirrorMatrix,
  shrubAmbientAttributeName,
  shrubClassLoadConcurrency,
  shrubLoadFrameBudgetMs,
  type PreparedShrubRecord,
  type ShrubDirectionalLightBinding,
  type ShrubInstancedMeshBinding,
  type ShrubLoadProgressCallback,
  type ShrubPrimitive
} from './ShrubTypes';
import { LoadYieldController } from '../ties/tieUtils';

export class ShrubInstanceController {
  private group: THREE.Group | null = null;
  private stats: ShrubStats = { ...emptyShrubStats };
  private meshBindings: ShrubInstancedMeshBinding[] = [];
  private directionalLightBinding: ShrubDirectionalLightBinding | null = null;
  private options: ShrubRenderOptions = { ...defaultShrubRenderOptions };

  async load(
    parent: THREE.Object3D,
    mapPackage: LoadedMapPackage,
    loader: GLTFLoader,
    options: ShrubRenderOptions,
    onProgress?: ShrubLoadProgressCallback
  ): Promise<ShrubStats> {
    this.dispose();
    this.options = { ...defaultShrubRenderOptions, ...options };
    this.stats = {
      ...emptyShrubStats,
      exportedClasses: mapPackage.shrubEntries.length
    };

    const group = new THREE.Group();
    group.name = 'shrub_instances';
    group.visible = this.options.visible;
    parent.add(group);
    this.group = group;
    this.directionalLightBinding = createShrubDirectionalLightBinding(mapPackage.directionalLights);

    if (!mapPackage.shrubClassIdsPath || !mapPackage.shrubInstancesPath || mapPackage.shrubEntries.length === 0) {
      return this.getStats();
    }

    const [classIdsBytes, instancesBytes] = await Promise.all([
      mapPackage.assetPackage.readBytes(mapPackage.shrubClassIdsPath),
      mapPackage.assetPackage.readBytes(mapPackage.shrubInstancesPath)
    ]);
    const classIds = parseShrubClassIds(classIdsBytes);
    const records = parseShrubInstanceRecords(instancesBytes, mapPackage.shrubInstanceCountExpected);
    const entriesByClassId = buildShrubEntryMap(mapPackage.shrubEntries);
    const recordsByClassId = groupShrubRecordsByClassId(records);

    this.stats.classIds = classIds.length || mapPackage.shrubClassCountExpected || 0;
    this.stats.instances = records.length;

    await this.loadShrubClassGroups(group, mapPackage, loader, entriesByClassId, recordsByClassId, onProgress);
    this.applyOptions(this.options);
    return this.getStats();
  }

  dispose(): void {
    const directionalLightBinding = this.directionalLightBinding;
    this.directionalLightBinding = null;

    if (!this.group) {
      if (directionalLightBinding) {
        disposeShrubDirectionalLightBinding(directionalLightBinding);
      }
      return;
    }

    this.group.parent?.remove(this.group);
    disposeObject3D(this.group);
    if (directionalLightBinding) {
      disposeShrubDirectionalLightBinding(directionalLightBinding);
    }

    this.group.clear();
    this.group = null;
    this.meshBindings = [];
  }

  getStats(): ShrubStats {
    return { ...this.stats };
  }

  setOptions(options: ShrubRenderOptions): ShrubStats | null {
    this.options = { ...defaultShrubRenderOptions, ...options };
    if (!this.group) {
      return null;
    }

    this.applyOptions(this.options);
    return this.getStats();
  }

  private applyOptions(options: ShrubRenderOptions): void {
    if (this.group) {
      this.group.visible = options.visible;
    }

    for (const binding of this.meshBindings) {
      binding.mesh.visible = options.visible && (!binding.isBillboard || options.billboardsVisible);
      updateShrubMaterialLightingUniforms(binding.material, options);
    }
  }

  private async loadShrubClassGroups(
    group: THREE.Group,
    mapPackage: LoadedMapPackage,
    loader: GLTFLoader,
    entriesByClassId: Map<number, GltfExportEntry>,
    recordsByClassId: Map<number, ShrubInstanceRecord[]>,
    onProgress?: ShrubLoadProgressCallback
  ): Promise<void> {
    const classGroups = Array.from(recordsByClassId);
    let nextGroupIndex = 0;
    let completedGroups = 0;
    const workerCount = Math.min(shrubClassLoadConcurrency, classGroups.length);
    const yieldController = new LoadYieldController(shrubLoadFrameBudgetMs);
    onProgress?.(0, classGroups.length);

    const loadNext = async () => {
      while (nextGroupIndex < classGroups.length) {
        const groupIndex = nextGroupIndex;
        nextGroupIndex += 1;
        const [classId, classRecords] = classGroups[groupIndex];
        await this.loadShrubClassGroup(
          group,
          mapPackage,
          loader,
          entriesByClassId,
          classId,
          classRecords,
          yieldController
        );
        completedGroups += 1;
        onProgress?.(completedGroups, classGroups.length);
        await yieldController.maybeYield();
      }
    };

    await Promise.all(Array.from({ length: workerCount }, loadNext));
  }

  private async loadShrubClassGroup(
    group: THREE.Group,
    mapPackage: LoadedMapPackage,
    loader: GLTFLoader,
    entriesByClassId: Map<number, GltfExportEntry>,
    classId: number,
    classRecords: ShrubInstanceRecord[],
    yieldController: LoadYieldController
  ): Promise<void> {
    const entry = entriesByClassId.get(classId);
    if (!entry) {
      this.stats.missingClasses += classRecords.length;
      return;
    }

    const source = await loadShrubClassSource(loader, mapPackage, entry);
    if (!source) {
      this.stats.missingClasses += classRecords.length;
      return;
    }

    try {
      const primitives = collectShrubPrimitives(source);
      if (primitives.length === 0) {
        this.stats.missingClasses += classRecords.length;
        return;
      }

      this.stats.loadedClasses += 1;
      this.stats.primitives += primitives.length;
      const preparedRecords = classRecords.map(prepareShrubRecord);
      const normalRecords = preparedRecords.filter((record) => record.mirroredKey === 'normal');
      const mirroredRecords = preparedRecords.filter((record) => record.mirroredKey === 'mirrored');

      for (const primitive of primitives) {
        const material = cloneShrubMaterial(primitive.material, this.directionalLightBinding, this.options);
        for (const [chunkIndex, records] of chunkShrubRecords(normalRecords).entries()) {
          this.addInstancedPrimitive(group, classId, 'normal', records, primitive, chunkIndex, material);
        }

        for (const [chunkIndex, records] of chunkShrubRecords(mirroredRecords).entries()) {
          this.addInstancedPrimitive(group, classId, 'mirrored', records, primitive, chunkIndex, material);
        }

        await yieldController.maybeYield();
      }

      this.stats.renderedInstances += classRecords.length;
    } finally {
      disposeObject3D(source);
    }
  }

  private addInstancedPrimitive(
    group: THREE.Group,
    classId: number,
    mirroredKey: 'normal' | 'mirrored',
    records: PreparedShrubRecord[],
    primitive: ShrubPrimitive,
    chunkIndex: number,
    material: THREE.Material | THREE.Material[]
  ): void {
    const fullMirrored = records[0].isMirrored !== (primitive.matrixWorld.determinant() < 0);
    const geometry = createInstancedGeometry(primitive.geometry);
    geometry.setAttribute(dlLightSelectorAttributeName, createDlLightSelectorInstanceAttribute(records));
    geometry.setAttribute(shrubAmbientAttributeName, createShrubAmbientColorInstanceAttribute(records));

    const mesh = new THREE.InstancedMesh(geometry, material, records.length);
    mesh.name = `shrub_${String(classId).padStart(5, '0')}_${mirroredKey}_c${chunkIndex}_${primitive.name}`;
    mesh.renderOrder = primitive.renderOrder;
    mesh.frustumCulled = true;
    mesh.visible = this.options.visible && (!primitive.isBillboard || this.options.billboardsVisible);

    if (fullMirrored) {
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(instanceMirrorMatrix);
      mesh.matrixWorldNeedsUpdate = true;
    }

    const composeMatrix = new THREE.Matrix4();
    for (let index = 0; index < records.length; index += 1) {
      composeMatrix.multiplyMatrices(records[index].instanceMatrix, primitive.matrixWorld);
      if (fullMirrored) {
        composeMatrix.premultiply(instanceMirrorMatrix);
      }

      mesh.setMatrixAt(index, composeMatrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
    this.meshBindings.push({ mesh, material, isBillboard: primitive.isBillboard });

    this.stats.batches += 1;
    this.stats.billboardBatches += primitive.isBillboard ? 1 : 0;
    this.stats.triangles += estimateTriangleCount(geometry) * records.length;
  }
}
