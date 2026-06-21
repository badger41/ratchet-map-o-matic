import * as THREE from 'three/webgpu';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toStandaloneArrayBuffer } from '../../../../services/mapAssets/mapAssetPackage';
import {
  defaultTieRenderOptions,
  type GltfExportEntry,
  type LoadedMapPackage,
  type TieColorTable,
  type TieInstanceRecord,
  type TieRenderOptions,
  type TieStats
} from '../../../../services/mapPackages/mapPackageTypes';
import {
  parseTieClassIds,
  parseTieColorTable,
  parseTieInstanceRecords
} from '../../../../services/mapPackages/tiePackageParsers';
import {
  createTieAmbientRowAttribute,
  createTieAmbientTextureBinding
} from './TieAmbient';
import {
  collectTiePrimitives,
  createInstancedGeometry,
  estimateTriangleCount,
  loadTieClassSource,
  pruneToLod0
} from './TieClassSource';
import {
  buildTieEntryMap,
  chunkTieRecords,
  groupRecordsByClassId,
  prepareTieRecord
} from './TieData';
import {
  disposeInactiveMaterial,
  disposeObject3D
} from './tieDisposal';
import {
  createDlLightSelectorInstanceAttribute,
  createTieDirectionalLightBinding,
  disposeTieDirectionalLightBinding
} from './TieLighting';
import {
  applyTieRenderOptions,
  cloneTieMaterial
} from './TieMaterials';
import {
  dlLightSelectorAttributeName,
  emptyTieStats,
  instanceMirrorMatrix,
  tieAmbientInstanceRowAttributeName,
  tieClassLoadConcurrency,
  tieLoadFrameBudgetMs,
  type PreparedTieRecord,
  type TieDirectionalLightBinding,
  type TieInstancedMeshBinding,
  type TieLoadProgressCallback,
  type TieMaterialSet,
  type TiePrimitive
} from './TieTypes';
import { LoadYieldController } from './tieUtils';

export class TieInstanceController {
  private group: THREE.Group | null = null;
  private stats: TieStats = { ...emptyTieStats };
  private meshBindings: TieInstancedMeshBinding[] = [];
  private directionalLightBinding: TieDirectionalLightBinding | null = null;
  private skyboxReflectionTexture: THREE.Texture | null = null;
  private options: TieRenderOptions = { ...defaultTieRenderOptions };

  async load(
    parent: THREE.Object3D,
    mapPackage: LoadedMapPackage,
    loader: GLTFLoader,
    options: TieRenderOptions,
    skyboxReflectionTexture: THREE.Texture | null,
    onProgress?: TieLoadProgressCallback
  ): Promise<TieStats> {
    this.dispose();
    this.options = { ...defaultTieRenderOptions, ...options };
    this.skyboxReflectionTexture = skyboxReflectionTexture;
    this.stats = {
      ...emptyTieStats,
      exportedClasses: mapPackage.tieEntries.length
    };

    const group = new THREE.Group();
    group.name = 'tie_instances';
    parent.add(group);
    this.group = group;
    this.directionalLightBinding = createTieDirectionalLightBinding(mapPackage.directionalLights);

    if (!mapPackage.tieClassIdsPath || !mapPackage.tieInstancesPath || mapPackage.tieEntries.length === 0) {
      return this.getStats();
    }

    const [classIdsBytes, instancesBytes, colorBytes] = await Promise.all([
      mapPackage.assetPackage.readBytes(mapPackage.tieClassIdsPath),
      mapPackage.assetPackage.readBytes(mapPackage.tieInstancesPath),
      mapPackage.tieColorsPath
        ? mapPackage.assetPackage.readOptionalBytes(mapPackage.tieColorsPath)
        : Promise.resolve(null)
    ]);
    const classIds = parseTieClassIds(toStandaloneArrayBuffer(classIdsBytes));
    const records = parseTieInstanceRecords(
      toStandaloneArrayBuffer(instancesBytes),
      mapPackage.tieInstanceCountExpected
    );
    const colorTable = colorBytes
      ? parseTieColorTable(toStandaloneArrayBuffer(colorBytes))
      : null;
    const entriesByClassId = buildTieEntryMap(mapPackage.tieEntries);
    const recordsByClassId = groupRecordsByClassId(records);

    this.stats.classIds = classIds.length || mapPackage.tieClassCountExpected || 0;
    this.stats.instances = records.length;
    this.stats.colorEntries = colorTable?.entryCount ?? 0;

    await this.loadTieClassGroups(
      group,
      mapPackage,
      loader,
      entriesByClassId,
      recordsByClassId,
      colorTable,
      onProgress
    );

    return this.getStats();
  }

  dispose(): void {
    const directionalLightBinding = this.directionalLightBinding;
    this.directionalLightBinding = null;
    this.skyboxReflectionTexture = null;

    if (!this.group) {
      if (directionalLightBinding) {
        disposeTieDirectionalLightBinding(directionalLightBinding);
      }
      return;
    }

    const disposedMaterials = new Set<THREE.Material>();
    const disposedTextures = new Set<THREE.Texture>();
    for (const binding of this.meshBindings) {
      disposeInactiveMaterial(binding.mesh.material, binding.flatMaterial, disposedMaterials, disposedTextures);
      if (binding.coloredMaterial) {
        disposeInactiveMaterial(binding.mesh.material, binding.coloredMaterial, disposedMaterials, disposedTextures);
      }
    }

    this.group.parent?.remove(this.group);
    disposeObject3D(this.group, disposedMaterials, disposedTextures);
    if (directionalLightBinding) {
      disposeTieDirectionalLightBinding(directionalLightBinding);
    }
    this.group.clear();
    this.group = null;
    this.meshBindings = [];
  }

  getStats(): TieStats {
    return { ...this.stats };
  }

  setOptions(options: TieRenderOptions): TieStats | null {
    this.options = { ...defaultTieRenderOptions, ...options };
    if (!this.group) {
      return null;
    }

    for (const binding of this.meshBindings) {
      applyTieRenderOptions(binding, this.options);
    }

    return this.getStats();
  }

  private addInstancedPrimitive(
    group: THREE.Group,
    classId: number,
    mirroredKey: 'normal' | 'mirrored',
    records: PreparedTieRecord[],
    primitive: TiePrimitive,
    chunkIndex: number,
    materialSet: TieMaterialSet
  ): void {
    const fullMirrored = records[0].isMirrored !== (primitive.matrixWorld.determinant() < 0);
    const geometry = createInstancedGeometry(primitive.geometry);
    const { ambientBinding, flatMaterial, coloredMaterial } = materialSet;
    if (ambientBinding) {
      geometry.setAttribute(
        tieAmbientInstanceRowAttributeName,
        new THREE.InstancedBufferAttribute(createTieAmbientRowAttribute(records, ambientBinding), 1)
      );
    }

    if (!primitive.isGlowOverlay && this.directionalLightBinding) {
      geometry.setAttribute(dlLightSelectorAttributeName, createDlLightSelectorInstanceAttribute(records));
    }

    const mesh = new THREE.InstancedMesh(
      geometry,
      this.options.colorsEnabled && coloredMaterial ? coloredMaterial : flatMaterial,
      records.length
    );
    mesh.name = `tie_${String(classId).padStart(5, '0')}_${mirroredKey}_c${chunkIndex}_${primitive.name}`;
    mesh.renderOrder = primitive.renderOrder;
    mesh.frustumCulled = true;

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
    this.meshBindings.push({
      mesh,
      records,
      flatMaterial,
      coloredMaterial,
      ambientBinding
    });

    this.stats.batches += 1;
    this.stats.ambientBatches += coloredMaterial ? 1 : 0;
    if (ambientBinding && !ambientBinding.statsCounted) {
      ambientBinding.statsCounted = true;
      this.stats.ambientRecipes += ambientBinding.recipeCount;
      this.stats.ambientRecipeSamples += ambientBinding.recipeSamples;
      this.stats.ambientValidSamples += ambientBinding.validSamples;
    }

    this.stats.triangles += estimateTriangleCount(geometry) * records.length;
  }

  private createTieMaterialSet(records: PreparedTieRecord[], primitive: TiePrimitive): TieMaterialSet {
    const ambientBinding = createTieAmbientTextureBinding(records, primitive);
    return {
      flatMaterial: cloneTieMaterial(
        primitive.material,
        primitive.geometry,
        null,
        this.directionalLightBinding,
        this.skyboxReflectionTexture,
        this.options),
      coloredMaterial: ambientBinding
        ? cloneTieMaterial(
          primitive.material,
          primitive.geometry,
          ambientBinding,
          this.directionalLightBinding,
          this.skyboxReflectionTexture,
          this.options)
        : null,
      ambientBinding
    };
  }

  private async loadTieClassGroups(
    group: THREE.Group,
    mapPackage: LoadedMapPackage,
    loader: GLTFLoader,
    entriesByClassId: Map<number, GltfExportEntry>,
    recordsByClassId: Map<number, TieInstanceRecord[]>,
    colorTable: TieColorTable | null,
    onProgress?: TieLoadProgressCallback
  ): Promise<void> {
    const classGroups = Array.from(recordsByClassId);
    let nextGroupIndex = 0;
    let completedGroups = 0;
    const workerCount = Math.min(tieClassLoadConcurrency, classGroups.length);
    const yieldController = new LoadYieldController(tieLoadFrameBudgetMs);
    onProgress?.(0, classGroups.length);

    const loadNext = async () => {
      while (nextGroupIndex < classGroups.length) {
        const groupIndex = nextGroupIndex;
        nextGroupIndex += 1;
        const [classId, classRecords] = classGroups[groupIndex];
        await this.loadTieClassGroup(
          group,
          mapPackage,
          loader,
          entriesByClassId,
          colorTable,
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

  private async loadTieClassGroup(
    group: THREE.Group,
    mapPackage: LoadedMapPackage,
    loader: GLTFLoader,
    entriesByClassId: Map<number, GltfExportEntry>,
    colorTable: TieColorTable | null,
    classId: number,
    classRecords: TieInstanceRecord[],
    yieldController: LoadYieldController
  ): Promise<void> {
    const entry = entriesByClassId.get(classId);
    if (!entry) {
      this.stats.missingClasses += classRecords.length;
      return;
    }

    const source = await loadTieClassSource(loader, mapPackage, entry);
    if (!source) {
      this.stats.missingClasses += classRecords.length;
      return;
    }

    try {
      pruneToLod0(source);
      const primitives = collectTiePrimitives(source);
      if (primitives.length === 0) {
        this.stats.missingClasses += classRecords.length;
        return;
      }

      this.stats.loadedClasses += 1;
      this.stats.primitives += primitives.length;
      const preparedRecords = classRecords.map((record) => prepareTieRecord(record, colorTable));
      this.stats.coloredInstances += preparedRecords.filter((record) => record.colorEntry !== null).length;
      const normalRecords = preparedRecords.filter((record) => record.mirroredKey === 'normal');
      const mirroredRecords = preparedRecords.filter((record) => record.mirroredKey === 'mirrored');

      for (const primitive of primitives) {
        const materialSet = this.createTieMaterialSet(preparedRecords, primitive);
        if (normalRecords.length > 0) {
          for (const [chunkIndex, records] of chunkTieRecords(normalRecords).entries()) {
            this.addInstancedPrimitive(group, classId, 'normal', records, primitive, chunkIndex, materialSet);
          }
        }

        if (mirroredRecords.length > 0) {
          for (const [chunkIndex, records] of chunkTieRecords(mirroredRecords).entries()) {
            this.addInstancedPrimitive(group, classId, 'mirrored', records, primitive, chunkIndex, materialSet);
          }
        }

        await yieldController.maybeYield();
      }

      this.stats.renderedInstances += classRecords.length;
    } finally {
      disposeObject3D(source);
    }
  }
}
