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
  createLightSelectorInstanceAttribute,
  createShrubAmbientColorInstanceAttribute,
  createShrubDirectionalLightBinding,
  disposeShrubDirectionalLightBinding,
  updateShrubMaterialLightingUniforms
} from './ShrubLighting';
import { createShrubLightBasisInstanceAttributes } from './ShrubLightBasis';
import { cloneShrubMaterial } from './ShrubMaterials';
import type { ModelDisplayNodeOptions } from '../ModelFog';
import {
  modelMaterialUsesAlphaBlend,
  syncModelAlphaOpaquePass
} from '../model-materials/ModelMaterialNodes';
import {
  lightSelectorAttributeName,
  emptyShrubStats,
  instanceMirrorMatrix,
  shrubAmbientAttributeName,
  shrubClassLoadConcurrency,
  shrubLightBasisXAttributeName,
  shrubLightBasisYAttributeName,
  shrubLightBasisZAttributeName,
  shrubLoadFrameBudgetMs,
  type PreparedShrubRecord,
  type ShrubDirectionalLightBinding,
  type ShrubInstancedMeshBinding,
  type ShrubLoadProgressCallback,
  type ShrubPrimitive
} from './ShrubTypes';
import { LoadYieldController } from '../ties/tieUtils';
import {
  aboveWaterRenderOrder,
  belowWaterRenderOrder,
  createWaterSurfaceMaterialPasses,
  type WaterSurfaceMaterialPasses
} from '../WaterSurfacePass';

type ShrubGroup = THREE.Group & {
  isBundleGroup?: boolean;
  needsUpdate?: boolean;
};

export class ShrubInstanceController {
  private group: ShrubGroup | null = null;
  private alphaBlendGroup: ShrubGroup | null = null;
  private stats: ShrubStats = { ...emptyShrubStats };
  private meshBindings: ShrubInstancedMeshBinding[] = [];
  private directionalLightBinding: ShrubDirectionalLightBinding | null = null;
  private options: ShrubRenderOptions = { ...defaultShrubRenderOptions };
  private bundleEnabled = false;
  private modelDisplayOptions: ModelDisplayNodeOptions | null = null;
  private readonly lightSelectorsByChunk = new WeakMap<PreparedShrubRecord[], THREE.InstancedBufferAttribute>();
  private readonly ambientColorsByChunk = new WeakMap<PreparedShrubRecord[], THREE.InstancedBufferAttribute>();

  async load(
    parent: THREE.Object3D,
    mapPackage: LoadedMapPackage,
    loader: GLTFLoader,
    options: ShrubRenderOptions,
    modelDisplayOptions: ModelDisplayNodeOptions,
    onProgress?: ShrubLoadProgressCallback
  ): Promise<ShrubStats> {
    this.dispose();
    this.options = { ...defaultShrubRenderOptions, ...options };
    this.modelDisplayOptions = modelDisplayOptions;
    this.stats = {
      ...emptyShrubStats,
      exportedClasses: mapPackage.shrubEntries.length
    };

    const group = new THREE.BundleGroup() as ShrubGroup;
    group.name = 'shrub_instances';
    group.visible = this.options.visible;
    const alphaBlendGroup = new THREE.BundleGroup() as ShrubGroup;
    alphaBlendGroup.name = 'shrub_alpha_blend_instances';
    alphaBlendGroup.visible = this.options.visible;
    parent.add(group);
    parent.add(alphaBlendGroup);
    this.group = group;
    this.alphaBlendGroup = alphaBlendGroup;
    this.applyBundleMode();
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
    this.modelDisplayOptions = null;

    if (!this.group && !this.alphaBlendGroup) {
      if (directionalLightBinding) {
        disposeShrubDirectionalLightBinding(directionalLightBinding);
      }
      return;
    }

    if (this.group) {
      this.group.parent?.remove(this.group);
      disposeObject3D(this.group);
      this.group.clear();
    }
    if (this.alphaBlendGroup) {
      this.alphaBlendGroup.parent?.remove(this.alphaBlendGroup);
      disposeObject3D(this.alphaBlendGroup);
      this.alphaBlendGroup.clear();
    }
    if (directionalLightBinding) {
      disposeShrubDirectionalLightBinding(directionalLightBinding);
    }

    this.group = null;
    this.alphaBlendGroup = null;
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

  updateLightingOptions(options: ShrubRenderOptions): void {
    this.options = { ...defaultShrubRenderOptions, ...options };
    if (!this.group) {
      return;
    }

    for (const binding of this.meshBindings) {
      updateShrubMaterialLightingUniforms(binding.material, this.options);
    }
  }

  setBundleEnabled(enabled: boolean): void {
    this.bundleEnabled = enabled;
    this.applyBundleMode();
  }

  moveAlphaBlendPassToEnd(): void {
    if (this.alphaBlendGroup?.parent) {
      this.alphaBlendGroup.parent.add(this.alphaBlendGroup);
      this.markBundleNeedsUpdate();
    }
  }

  private applyOptions(options: ShrubRenderOptions): void {
    if (this.group) {
      this.group.visible = options.visible;
    }
    if (this.alphaBlendGroup) {
      this.alphaBlendGroup.visible = options.visible;
    }

    for (const binding of this.meshBindings) {
      binding.mesh.visible = options.visible && (!binding.isBillboard || options.billboardsVisible);
      updateShrubMaterialLightingUniforms(binding.material, options);
    }
    this.markBundleNeedsUpdate();
  }

  private applyBundleMode(): void {
    if (!this.group) {
      return;
    }

    this.group.isBundleGroup = this.bundleEnabled;
    if (this.alphaBlendGroup) {
      this.alphaBlendGroup.isBundleGroup = this.bundleEnabled;
    }
    for (const binding of this.meshBindings) {
      binding.mesh.frustumCulled = !this.bundleEnabled;
    }

    this.markBundleNeedsUpdate();
  }

  private markBundleNeedsUpdate(): void {
    if (this.group?.needsUpdate !== undefined) {
      this.group.needsUpdate = true;
    }
    if (this.alphaBlendGroup?.needsUpdate !== undefined) {
      this.alphaBlendGroup.needsUpdate = true;
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
      const normalChunks = chunkShrubRecords(normalRecords);
      const mirroredChunks = chunkShrubRecords(mirroredRecords);

      for (const primitive of primitives) {
        const displayOptions = this.modelDisplayOptions;
        if (!displayOptions) {
          throw new Error('Shrub material display options are not initialized.');
        }

        const material = cloneShrubMaterial(primitive.material, this.directionalLightBinding, this.options, displayOptions);
        const materialPasses = createWaterSurfaceMaterialPasses(material);
        for (const [chunkIndex, records] of normalChunks.entries()) {
          this.addInstancedPrimitive(group, classId, 'normal', records, primitive, chunkIndex, material, materialPasses);
        }

        for (const [chunkIndex, records] of mirroredChunks.entries()) {
          this.addInstancedPrimitive(group, classId, 'mirrored', records, primitive, chunkIndex, material, materialPasses);
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
    material: THREE.Material | THREE.Material[],
    materialPasses: WaterSurfaceMaterialPasses | null
  ): void {
    const fullMirrored = records[0].isMirrored !== (primitive.matrixWorld.determinant() < 0);
    const geometry = createInstancedGeometry(primitive.geometry);
    geometry.setAttribute(
      lightSelectorAttributeName,
      this.getChunkAttribute(this.lightSelectorsByChunk, records, () => createLightSelectorInstanceAttribute(records))
    );
    geometry.setAttribute(
      shrubAmbientAttributeName,
      this.getChunkAttribute(this.ambientColorsByChunk, records, () => createShrubAmbientColorInstanceAttribute(records))
    );
    const lightBasis = createShrubLightBasisInstanceAttributes(records, primitive.matrixWorld);
    geometry.setAttribute(shrubLightBasisXAttributeName, lightBasis.x);
    geometry.setAttribute(shrubLightBasisYAttributeName, lightBasis.y);
    geometry.setAttribute(shrubLightBasisZAttributeName, lightBasis.z);
    const mesh = new THREE.InstancedMesh(geometry, materialPasses?.above ?? material, records.length);
    mesh.name = `shrub_${String(classId).padStart(5, '0')}_${mirroredKey}_c${chunkIndex}_${primitive.name}`;
    mesh.renderOrder = primitive.renderOrder;
    mesh.frustumCulled = !this.bundleEnabled;
    mesh.static = true;
    mesh.matrixAutoUpdate = false;
    mesh.visible = this.options.visible && (!primitive.isBillboard || this.options.billboardsVisible);

    if (fullMirrored) {
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
    // Three sorts instanced meshes by geometry bounds, so use this batch's actual center.
    geometry.boundingSphere!.center.copy(mesh.boundingSphere!.center);
    const targetGroup = this.alphaBlendGroup && modelMaterialUsesAlphaBlend(material)
      ? this.alphaBlendGroup
      : group;
    if (materialPasses) {
      mesh.renderOrder = aboveWaterRenderOrder;
      const belowWaterMesh = mesh.clone(false);
      belowWaterMesh.name = `${mesh.name}_below_water`;
      belowWaterMesh.material = materialPasses.below;
      belowWaterMesh.instanceMatrix = mesh.instanceMatrix;
      belowWaterMesh.renderOrder = belowWaterRenderOrder;
      targetGroup.add(belowWaterMesh);
      syncModelAlphaOpaquePass(belowWaterMesh);
      this.meshBindings.push({
        mesh: belowWaterMesh,
        material: materialPasses.below,
        isBillboard: primitive.isBillboard
      });
    }
    targetGroup.add(mesh);
    syncModelAlphaOpaquePass(mesh);
    this.meshBindings.push({ mesh, material: materialPasses?.above ?? material, isBillboard: primitive.isBillboard });

    this.stats.batches += 1;
    this.stats.billboardBatches += primitive.isBillboard ? 1 : 0;
    this.stats.triangles += estimateTriangleCount(geometry) * records.length;
  }

  private getChunkAttribute(
    cache: WeakMap<PreparedShrubRecord[], THREE.InstancedBufferAttribute>,
    records: PreparedShrubRecord[],
    create: () => THREE.InstancedBufferAttribute
  ): THREE.InstancedBufferAttribute {
    const existing = cache.get(records);
    if (existing) {
      return existing;
    }

    const attribute = create();
    cache.set(records, attribute);
    return attribute;
  }
}
