import * as THREE from 'three/webgpu';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  defaultTieRenderOptions,
  type DirectionalLightRecord,
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
  parseTieGroupRecords,
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
  chunkTieRecords,
  prepareTieRecord
} from './TieData';
import { buildModelEntryMap, groupRecordsByClassId } from '../InstanceData';
import { hasTieBloomSourceNear } from './TieBloomRange';
import {
  disposeInactiveMaterial,
  disposeObject3D
} from './tieDisposal';
import {
  createLightSelectorInstanceAttribute,
  createTieDirectionalLightBinding,
  disposeTieDirectionalLightBinding
} from './TieLighting';
import {
  cloneTieMaterial,
  cloneTieTextureMaterial,
  tieMaterialUsesGlowEmission,
  tieMaterialUsesReflection
} from './TieMaterials';
import type { ModelDisplayNodeOptions } from '../ModelFog';
import type { SceneCameraStart } from '../camera/SceneCameraFraming';
import {
  modelMaterialUsesAlphaBlend,
  syncModelAlphaOpaquePass,
  tieReflectionOriginAttributeName
} from '../model-materials/ModelMaterialNodes';
import {
  lightSelectorAttributeName,
  emptyTieStats,
  instanceMirrorMatrix,
  tieAmbientInstanceRowAttributeName,
  tieAveragePositionUserDataKey,
  tieClassLoadConcurrency,
  tieEnvironmentNormalAttributeName,
  tieFirstRecordIndexUserDataKey,
  tieFirstRecordLocalIndexUserDataKey,
  tieFirstRecordPositionUserDataKey,
  tieGlowBloomLayer,
  tieGlowColorRowAttributeName,
  tieLoadFrameBudgetMs,
  type PreparedTieRecord,
  type TieDirectionalLightBinding,
  type TieGlowColorBinding,
  type TieInstancedMeshBinding,
  type TieLoadProgressCallback,
  type TieMaterialSet,
  type TieMaterialMode,
  type TiePrimitive
} from './TieTypes';
import {
  clampByte,
  LoadYieldController
} from './tieUtils';
import {
  createRc1TiePointLightAttributes,
  prepareRc1PointLights,
  rc1TiePointColorAttributeName,
  rc1TiePointDirectionAttributeName,
  type PreparedRc1PointLight,
  type Rc1TiePointLightAttributes
} from '../rc1/Rc1Lighting.ts';
import {
  aboveWaterRenderOrder,
  belowWaterRenderOrder,
  createWaterSurfaceMaterialPasses
} from '../WaterSurfacePass';

type TieGroup = THREE.Group & {
  isBundleGroup?: boolean;
  needsUpdate?: boolean;
};

type TieClassTimingStatus = 'loaded' | 'missing entry' | 'missing source' | 'empty' | 'failed';

interface TieClassTiming {
  classId: number;
  records: number;
  primitives: number;
  batches: number;
  elapsedMs: number;
  sourceMs: number;
  prepareMs: number;
  materialMs: number;
  instanceMs: number;
  status: TieClassTimingStatus;
}

interface TieClassTimingAccumulator {
  sourceMs: number;
  prepareMs: number;
  materialMs: number;
  instanceMs: number;
  classTimings: TieClassTiming[];
}

// ponytail: C66 local-origin ties sat slightly low; keep this fixed so rotation does not bounce.
const tieLocalOriginRotationLiftRatio = 0.0075;

export class TieInstanceController {
  private group: TieGroup | null = null;
  private alphaBlendGroup: TieGroup | null = null;
  private stats: TieStats = { ...emptyTieStats };
  private meshBindings: TieInstancedMeshBinding[] = [];
  private directionalLights: DirectionalLightRecord[] = [];
  private rc1PointLights: PreparedRc1PointLight[] = [];
  private isRc1 = false;
  private directionalLightBinding: TieDirectionalLightBinding | null = null;
  private skyboxReflectionTexture: THREE.Texture | null = null;
  private options: TieRenderOptions = { ...defaultTieRenderOptions };
  private materialMode: TieMaterialMode = 'full';
  private bundleEnabled = false;
  private plainMaterial: THREE.MeshBasicNodeMaterial | null = null;
  private modelDisplayOptions: ModelDisplayNodeOptions | null = null;
  private hasGlowBloom = false;
  private glowBloomCenters: number[] = [];
  private tieGroupByRecordIndex = new Map<number, number>();
  private startupCameraAnchor: THREE.Vector3 | null = null;
  private startupCameraAnchorRecordIndex = Number.POSITIVE_INFINITY;
  private readonly startupCameraLookAtSum = new THREE.Vector3();
  private startupCameraLookAtWeight = 0;
  private readonly composeMatrix = new THREE.Matrix4();
  private readonly groupTransformMatrix = new THREE.Matrix4();
  private readonly toPivotMatrix = new THREE.Matrix4();
  private readonly fromPivotMatrix = new THREE.Matrix4();
  private readonly instancePosition = new THREE.Vector3();
  private readonly instanceQuaternion = new THREE.Quaternion();
  private readonly instanceScale = new THREE.Vector3();
  private readonly rotationQuaternion = new THREE.Quaternion();
  private readonly baselineBox = new THREE.Box3();
  private readonly ambientRowsByChunk = new WeakMap<PreparedTieRecord[], THREE.InstancedBufferAttribute>();
  private readonly glowRowsByChunk = new WeakMap<PreparedTieRecord[], THREE.InstancedBufferAttribute>();
  private readonly lightSelectorsByChunk = new WeakMap<PreparedTieRecord[], THREE.InstancedBufferAttribute>();
  private readonly rc1PointLightsByChunk = new WeakMap<PreparedTieRecord[], Rc1TiePointLightAttributes>();
  private readonly reflectionOriginsByChunk = new WeakMap<PreparedTieRecord[], THREE.InstancedBufferAttribute>();
  private readonly mirroredReflectionOriginsByChunk = new WeakMap<PreparedTieRecord[], THREE.InstancedBufferAttribute>();

  async load(
    parent: THREE.Object3D,
    mapPackage: LoadedMapPackage,
    loader: GLTFLoader,
    options: TieRenderOptions,
    skyboxReflectionTexture: THREE.Texture | null,
    modelDisplayOptions: ModelDisplayNodeOptions,
    onProgress?: TieLoadProgressCallback
  ): Promise<TieStats> {
    const loadStartMs = performance.now();
    logTieTimingStart('load');
    this.dispose();
    this.options = { ...defaultTieRenderOptions, ...options };
    this.skyboxReflectionTexture = skyboxReflectionTexture;
    this.modelDisplayOptions = modelDisplayOptions;
    this.hasGlowBloom = false;
    this.glowBloomCenters = [];
    this.stats = {
      ...emptyTieStats,
      exportedClasses: mapPackage.tieEntries.length
    };

    const group = new THREE.BundleGroup() as TieGroup;
    group.name = 'tie_instances';
    const alphaBlendGroup = new THREE.BundleGroup() as TieGroup;
    alphaBlendGroup.name = 'tie_alpha_blend_instances';
    parent.add(group);
    parent.add(alphaBlendGroup);
    this.group = group;
    this.alphaBlendGroup = alphaBlendGroup;
    this.applyBundleMode();
    this.directionalLights = mapPackage.directionalLights;
    this.directionalLightBinding = createTieDirectionalLightBinding(mapPackage.directionalLights);
    this.isRc1 = mapPackage.rootManifest.Game?.toUpperCase() === 'RC1';
    this.rc1PointLights = prepareRc1PointLights(mapPackage.rc1PointLights);

    if (!mapPackage.tieClassIdsPath || !mapPackage.tieInstancesPath || mapPackage.tieEntries.length === 0) {
      logTieTimingEnd('load skipped', loadStartMs);
      return this.getStats();
    }

    let stepStartMs = performance.now();
    const [classIdsBytes, instancesBytes, colorBytes, groupBytes] = await Promise.all([
      mapPackage.assetPackage.readBytes(mapPackage.tieClassIdsPath),
      mapPackage.assetPackage.readBytes(mapPackage.tieInstancesPath),
      mapPackage.tieColorsPath
        ? mapPackage.assetPackage.readOptionalBytes(mapPackage.tieColorsPath)
        : Promise.resolve(null),
      mapPackage.tieGroupsPath
        ? mapPackage.assetPackage.readOptionalBytes(mapPackage.tieGroupsPath)
        : Promise.resolve(null)
    ]);
    logTieTimingEnd('read records/colors/groups', stepStartMs);

    stepStartMs = performance.now();
    const classIds = parseTieClassIds(classIdsBytes);
    const records = parseTieInstanceRecords(instancesBytes, mapPackage.tieInstanceCountExpected);
    const colorTable = colorBytes
      ? parseTieColorTable(colorBytes)
      : null;
    this.tieGroupByRecordIndex = groupBytes
      ? buildTieGroupRecordIndex(parseTieGroupRecords(groupBytes, records.length))
      : new Map();
    const entriesByClassId = buildModelEntryMap(mapPackage.tieEntries);
    const recordsByClassId = groupRecordsByClassId(records);

    this.stats.classIds = classIds.length || mapPackage.tieClassCountExpected || 0;
    this.stats.instances = records.length;
    this.stats.colorEntries = colorTable?.entryCount ?? 0;
    logTieTimingEnd('parse and group records', stepStartMs);

    stepStartMs = performance.now();
    await this.loadTieClassGroups(
      group,
      mapPackage,
      loader,
      entriesByClassId,
      recordsByClassId,
      colorTable,
      onProgress
    );
    logTieTimingEnd(`load ${recordsByClassId.size.toLocaleString()} class groups`, stepStartMs);
    logTieTimingEnd('load total', loadStartMs);

    return this.getStats();
  }

  dispose(): void {
    const directionalLightBinding = this.directionalLightBinding;
    this.directionalLights = [];
    this.rc1PointLights = [];
    this.isRc1 = false;
    this.directionalLightBinding = null;
    this.skyboxReflectionTexture = null;
    this.modelDisplayOptions = null;
    this.clearStartupCameraStart();

    if (!this.group && !this.alphaBlendGroup) {
      this.meshBindings = [];
      this.tieGroupByRecordIndex = new Map();
      this.hasGlowBloom = false;
      this.glowBloomCenters = [];
      if (directionalLightBinding) {
        disposeTieDirectionalLightBinding(directionalLightBinding);
      }
      return;
    }

    const disposedMaterials = new Set<THREE.Material>();
    const disposedTextures = new Set<THREE.Texture>();
    for (const binding of this.meshBindings) {
      if (binding.flatMaterial) {
        disposeInactiveMaterial(binding.mesh.material, binding.flatMaterial, disposedMaterials, disposedTextures);
      }
      if (binding.coloredMaterial) {
        disposeInactiveMaterial(binding.mesh.material, binding.coloredMaterial, disposedMaterials, disposedTextures);
      }
      if (binding.textureMaterial) {
        disposeInactiveMaterial(binding.mesh.material, binding.textureMaterial, disposedMaterials, disposedTextures);
      }
    }

    if (this.group) {
      this.group.parent?.remove(this.group);
      disposeObject3D(this.group, disposedMaterials, disposedTextures);
      this.group.clear();
    }
    if (this.alphaBlendGroup) {
      this.alphaBlendGroup.parent?.remove(this.alphaBlendGroup);
      disposeObject3D(this.alphaBlendGroup, disposedMaterials, disposedTextures);
      this.alphaBlendGroup.clear();
    }
    if (directionalLightBinding) {
      disposeTieDirectionalLightBinding(directionalLightBinding);
    }
    this.group = null;
    this.alphaBlendGroup = null;
    this.meshBindings = [];
    this.tieGroupByRecordIndex = new Map();
    this.glowBloomCenters = [];
    this.plainMaterial?.dispose();
    this.plainMaterial = null;
    this.hasGlowBloom = false;
  }

  getStats(): TieStats {
    return { ...this.stats };
  }

  getStartupCameraStart(): SceneCameraStart | null {
    const anchor = this.startupCameraAnchor;
    if (!anchor) {
      return null;
    }

    const lookAt = this.startupCameraLookAtWeight > 0
      ? this.startupCameraLookAtSum.clone().multiplyScalar(1 / this.startupCameraLookAtWeight)
      : null;

    return {
      anchor: anchor.clone(),
      lookAt: lookAt && lookAt.distanceToSquared(anchor) > 1 ? lookAt : null
    };
  }

  private clearStartupCameraStart(): void {
    this.startupCameraAnchor = null;
    this.startupCameraAnchorRecordIndex = Number.POSITIVE_INFINITY;
    this.startupCameraLookAtSum.set(0, 0, 0);
    this.startupCameraLookAtWeight = 0;
  }

  private captureStartupCameraStart(
    firstRecord: { recordIndex: number; position: THREE.Vector3 } | null,
    batchAverage: THREE.Vector3,
    weight: number
  ): void {
    if (firstRecord && firstRecord.recordIndex < this.startupCameraAnchorRecordIndex) {
      this.startupCameraAnchorRecordIndex = firstRecord.recordIndex;
      this.startupCameraAnchor = firstRecord.position.clone();
    }

    if (weight > 0) {
      this.startupCameraLookAtSum.addScaledVector(batchAverage, weight);
      this.startupCameraLookAtWeight += weight;
    }
  }

  setOptions(options: TieRenderOptions): TieStats | null {
    this.options = { ...defaultTieRenderOptions, ...options };
    if (!this.group) {
      return null;
    }

    for (const binding of this.meshBindings) {
      this.applyBindingMaterial(binding);
    }
    this.markBundleNeedsUpdate();

    return this.getStats();
  }

  setVisible(visible: boolean): void {
    if (this.group) {
      this.group.visible = visible;
    }
    if (this.alphaBlendGroup) {
      this.alphaBlendGroup.visible = visible;
    }
  }

  setMaterialMode(mode: TieMaterialMode): void {
    this.materialMode = mode;
    for (const binding of this.meshBindings) {
      this.applyBindingMaterial(binding);
    }
    this.markBundleNeedsUpdate();
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

  hasGlowBloomSources(): boolean {
    return this.hasGlowBloom;
  }

  getGlowBloomSourceCount(): number {
    return this.glowBloomCenters.length / 4;
  }

  hasGlowBloomSourceNear(position: THREE.Vector3, distance: number): boolean {
    if (this.group?.visible !== true && this.alphaBlendGroup?.visible !== true) {
      return false;
    }

    return hasTieBloomSourceNear(this.glowBloomCenters, position, distance);
  }

  setTieGroupRotation(groupIndex: number, rotation: THREE.Matrix4 | null, pivot: THREE.Vector3 | null = null): void {
    if (!this.group || groupIndex < 0) {
      return;
    }

    let changed = false;
    for (const binding of this.meshBindings) {
      const localIndices = binding.tieGroupRecordIndices.get(groupIndex);
      if (!localIndices || localIndices.length === 0) {
        continue;
      }

      for (const localIndex of localIndices) {
        this.writeTieInstanceMatrix(binding, localIndex, rotation, pivot);
      }

      binding.mesh.instanceMatrix.needsUpdate = true;
      binding.mesh.computeBoundingBox();
      binding.mesh.computeBoundingSphere();
      changed = true;
    }

    if (changed) {
      this.markBundleNeedsUpdate();
    }
  }

  setTieGroupGlowColor(groupIndex: number, color: THREE.Color | null): void {
    if (!this.group || groupIndex < 0) {
      return;
    }

    const r = clampByte((color?.r ?? 1) * 255);
    const g = clampByte((color?.g ?? 1) * 255);
    const b = clampByte((color?.b ?? 1) * 255);
    const a = color ? 255 : 0;
    let changed = false;
    const updatedChunks = new Set<PreparedTieRecord[]>();
    const updatedBindings = new Set<TieGlowColorBinding>();
    for (const binding of this.meshBindings) {
      const glowColorBinding = binding.glowColorBinding;
      if (!glowColorBinding || updatedChunks.has(binding.records)) {
        continue;
      }

      const localIndices = binding.tieGroupRecordIndices.get(groupIndex);
      if (!localIndices || localIndices.length === 0) {
        continue;
      }
      updatedChunks.add(binding.records);

      for (const localIndex of localIndices) {
        const row = glowColorBinding.rowByRecord.get(binding.records[localIndex]);
        if (row === undefined) {
          continue;
        }

        const offset = row * 4;
        glowColorBinding.data[offset] = r;
        glowColorBinding.data[offset + 1] = g;
        glowColorBinding.data[offset + 2] = b;
        glowColorBinding.data[offset + 3] = a;
      }

      updatedBindings.add(glowColorBinding);
      changed = true;
    }

    for (const binding of updatedBindings) {
      binding.texture.needsUpdate = true;
    }

    if (changed) {
      this.markBundleNeedsUpdate();
    }
  }

  setTieGroupGlowColorForRecords(
    groupIndex: number,
    resolveColor: (record: TieInstanceRecord) => THREE.Color | null
  ): void {
    if (!this.group || groupIndex < 0) {
      return;
    }

    let changed = false;
    const updatedChunks = new Set<PreparedTieRecord[]>();
    const updatedBindings = new Set<TieGlowColorBinding>();
    for (const binding of this.meshBindings) {
      const glowColorBinding = binding.glowColorBinding;
      if (!glowColorBinding || updatedChunks.has(binding.records)) {
        continue;
      }

      const localIndices = binding.tieGroupRecordIndices.get(groupIndex);
      if (!localIndices || localIndices.length === 0) {
        continue;
      }
      updatedChunks.add(binding.records);

      for (const localIndex of localIndices) {
        const record = binding.records[localIndex];
        const row = glowColorBinding.rowByRecord.get(record);
        if (row === undefined) {
          continue;
        }

        const color = resolveColor(record.source);
        const offset = row * 4;
        glowColorBinding.data[offset] = clampByte((color?.r ?? 1) * 255);
        glowColorBinding.data[offset + 1] = clampByte((color?.g ?? 1) * 255);
        glowColorBinding.data[offset + 2] = clampByte((color?.b ?? 1) * 255);
        glowColorBinding.data[offset + 3] = color ? 255 : 0;
      }

      updatedBindings.add(glowColorBinding);
      changed = true;
    }

    for (const binding of updatedBindings) {
      binding.texture.needsUpdate = true;
    }

    if (changed) {
      this.markBundleNeedsUpdate();
    }
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
    const { ambientBinding, glowColorBinding, flatMaterial, coloredMaterial, textureMaterial } = materialSet;
    const initialMaterial = coloredMaterial ?? flatMaterial;
    if (!initialMaterial) {
      throw new Error('Tie material set has no display material.');
    }
    const usesGlowBloom = materialSet.usesGlowEmission;
    if (ambientBinding) {
      geometry.setAttribute(
        tieAmbientInstanceRowAttributeName,
        this.getChunkAttribute(this.ambientRowsByChunk, records, () => createTieAmbientRowAttribute(records, ambientBinding))
      );
    }

    if (!primitive.isGlowOverlay && this.directionalLightBinding) {
      geometry.setAttribute(
        lightSelectorAttributeName,
        this.getChunkAttribute(this.lightSelectorsByChunk, records, () => createLightSelectorInstanceAttribute(records))
      );
    }
    if (!primitive.isGlowOverlay && this.rc1PointLights.length > 0) {
      let attributes = this.rc1PointLightsByChunk.get(records);
      if (!attributes) {
        attributes = createRc1TiePointLightAttributes(records, this.rc1PointLights);
        this.rc1PointLightsByChunk.set(records, attributes);
      }
      geometry.setAttribute(rc1TiePointDirectionAttributeName, attributes.direction);
      geometry.setAttribute(rc1TiePointColorAttributeName, attributes.color);
    }
    if (glowColorBinding) {
      geometry.setAttribute(
        tieGlowColorRowAttributeName,
        this.getChunkAttribute(this.glowRowsByChunk, records, () => createTieGlowRowAttribute(records, glowColorBinding))
      );
    }
    if (tieMaterialUsesReflection(initialMaterial)) {
      const environmentNormal = geometry.getAttribute(tieEnvironmentNormalAttributeName);
      const position = geometry.getAttribute('position');
      if (environmentNormal?.itemSize === 3 && environmentNormal.count === position?.count) {
        geometry.setAttribute('normal', environmentNormal);
      }
      geometry.setAttribute(
        tieReflectionOriginAttributeName,
        this.getChunkAttribute(
          fullMirrored ? this.mirroredReflectionOriginsByChunk : this.reflectionOriginsByChunk,
          records,
          () => createTieReflectionOriginAttribute(records, fullMirrored)
        )
      );
    }

    const mesh = new THREE.InstancedMesh(
      geometry,
      initialMaterial,
      records.length
    );
    mesh.name = `tie_${String(classId).padStart(5, '0')}_${mirroredKey}_c${chunkIndex}_${primitive.name}`;
    const firstRecord = findEarliestTieRecord(records);
    if (firstRecord) {
      mesh.userData[tieFirstRecordIndexUserDataKey] = firstRecord.recordIndex;
      mesh.userData[tieFirstRecordLocalIndexUserDataKey] = firstRecord.localIndex;
      mesh.userData[tieFirstRecordPositionUserDataKey] = firstRecord.position.toArray();
    }
    mesh.renderOrder = primitive.renderOrder;
    mesh.frustumCulled = !this.bundleEnabled;
    mesh.static = !glowColorBinding;
    mesh.matrixAutoUpdate = false;
    if (usesGlowBloom) {
      this.hasGlowBloom = true;
      mesh.layers.enable(tieGlowBloomLayer);
    }

    if (fullMirrored) {
      mesh.matrix.copy(instanceMirrorMatrix);
      mesh.matrixWorldNeedsUpdate = true;
    }

    const composeMatrix = new THREE.Matrix4();
    const bloomSphere = usesGlowBloom ? resolveGeometryBoundingSphere(geometry) : null;
    const bloomCenter = new THREE.Vector3();
    const averagePosition = new THREE.Vector3();
    for (let index = 0; index < records.length; index += 1) {
      averagePosition.add(setFromMatrixPosition(records[index].instanceMatrix, bloomCenter));
      composeMatrix.multiplyMatrices(records[index].instanceMatrix, primitive.matrixWorld);
      if (fullMirrored) {
        composeMatrix.premultiply(instanceMirrorMatrix);
      }

      mesh.setMatrixAt(index, composeMatrix);
      if (bloomSphere) {
        bloomCenter.copy(bloomSphere.center).applyMatrix4(composeMatrix);
        this.glowBloomCenters.push(
          bloomCenter.x,
          bloomCenter.y,
          bloomCenter.z,
          bloomSphere.radius * composeMatrix.getMaxScaleOnAxis()
        );
      }
    }

    const batchAverage = averagePosition.multiplyScalar(1 / records.length);
    mesh.userData[tieAveragePositionUserDataKey] = batchAverage.toArray();
    this.captureStartupCameraStart(firstRecord, batchAverage, records.length);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    const targetGroup = this.alphaBlendGroup && tieMaterialSetUsesAlphaBlend(materialSet)
      ? this.alphaBlendGroup
      : group;
    targetGroup.add(mesh);
    const binding: TieInstancedMeshBinding = {
      mesh,
      belowWaterMesh: null,
      sourceRenderOrder: primitive.renderOrder,
      records,
      primitiveMatrixWorld: primitive.matrixWorld.clone(),
      fullMirrored,
      tieGroupRecordIndices: this.buildTieGroupRecordIndices(records),
      glowColorBinding,
      flatMaterial,
      coloredMaterial,
      textureMaterial,
      ambientBinding
    };
    this.meshBindings.push(binding);
    this.applyBindingMaterial(binding);

    this.stats.batches += 1;
    this.stats.ambientBatches += ambientBinding ? 1 : 0;
    if (ambientBinding && !ambientBinding.statsCounted) {
      ambientBinding.statsCounted = true;
      this.stats.ambientRecipes += ambientBinding.recipeCount;
      this.stats.ambientRecipeSamples += ambientBinding.recipeSamples;
      this.stats.ambientValidSamples += ambientBinding.validSamples;
    }

    this.stats.triangles += estimateTriangleCount(geometry) * records.length;
  }

  private buildTieGroupRecordIndices(records: PreparedTieRecord[]): Map<number, number[]> {
    const groups = new Map<number, number[]>();
    for (let localIndex = 0; localIndex < records.length; localIndex += 1) {
      const groupIndex = this.tieGroupByRecordIndex.get(records[localIndex].source.index);
      if (groupIndex === undefined) {
        continue;
      }

      const indices = groups.get(groupIndex);
      if (indices) {
        indices.push(localIndex);
      } else {
        groups.set(groupIndex, [localIndex]);
      }
    }

    return groups;
  }

  private writeTieInstanceMatrix(
    binding: TieInstancedMeshBinding,
    localIndex: number,
    rotation: THREE.Matrix4 | null,
    pivot: THREE.Vector3 | null
  ): void {
    const record = binding.records[localIndex];
    const matrix = this.composeMatrix.copy(record.instanceMatrix);
    if (rotation) {
      if (pivot) {
        this.toPivotMatrix.makeTranslation(pivot.x, pivot.y, pivot.z);
        this.fromPivotMatrix.makeTranslation(-pivot.x, -pivot.y, -pivot.z);
        this.groupTransformMatrix
          .copy(this.toPivotMatrix)
          .multiply(rotation)
          .multiply(this.fromPivotMatrix);
        matrix.premultiply(this.groupTransformMatrix);
      } else {
        const baselineMatrix = this.groupTransformMatrix
          .copy(record.instanceMatrix)
          .multiply(binding.primitiveMatrixWorld);
        this.rotationQuaternion.setFromRotationMatrix(rotation);
        matrix.decompose(this.instancePosition, this.instanceQuaternion, this.instanceScale);
        this.instanceQuaternion.multiply(this.rotationQuaternion);
        matrix.compose(this.instancePosition, this.instanceQuaternion, this.instanceScale);
        this.updateTieReflectionOrigin(binding, localIndex, matrix);
        matrix.multiply(binding.primitiveMatrixWorld);
        matrix.elements[12] = baselineMatrix.elements[12];
        matrix.elements[13] = baselineMatrix.elements[13] + this.getLocalOriginRotationLift(binding, baselineMatrix);
        matrix.elements[14] = baselineMatrix.elements[14];
        if (binding.fullMirrored) {
          matrix.premultiply(instanceMirrorMatrix);
        }

        binding.mesh.setMatrixAt(localIndex, matrix);
        return;
      }
    }

    this.updateTieReflectionOrigin(binding, localIndex, matrix);
    matrix.multiply(binding.primitiveMatrixWorld);
    if (binding.fullMirrored) {
      matrix.premultiply(instanceMirrorMatrix);
    }

    binding.mesh.setMatrixAt(localIndex, matrix);
  }

  private updateTieReflectionOrigin(
    binding: TieInstancedMeshBinding,
    localIndex: number,
    matrix: THREE.Matrix4
  ): void {
    const attribute = binding.mesh.geometry.getAttribute(tieReflectionOriginAttributeName);
    if (!(attribute instanceof THREE.InstancedBufferAttribute)) {
      return;
    }

    const elements = matrix.elements;
    attribute.setXYZ(localIndex, binding.fullMirrored ? -elements[12] : elements[12], elements[13], elements[14]);
    attribute.needsUpdate = true;
  }

  private getLocalOriginRotationLift(
    binding: TieInstancedMeshBinding,
    baselineMatrix: THREE.Matrix4
  ): number {
    const geometry = binding.mesh.geometry;
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }
    if (!geometry.boundingBox) {
      return 0;
    }

    this.baselineBox.copy(geometry.boundingBox).applyMatrix4(baselineMatrix);
    return (this.baselineBox.max.y - this.baselineBox.min.y) * tieLocalOriginRotationLiftRatio;
  }

  private applyBindingMaterial(binding: TieInstancedMeshBinding): void {
    let material: THREE.Material | THREE.Material[];
    if (this.materialMode === 'plain') {
      material = this.getPlainMaterial();
    } else if (this.materialMode === 'texture') {
      binding.textureMaterial ??= cloneTieTextureMaterial(this.getBindingMaterialSource(binding));
      material = binding.textureMaterial;
    } else {
      const ambientBinding = this.options.colorsEnabled ? binding.ambientBinding : null;
      if (ambientBinding) {
        binding.coloredMaterial ??= this.cloneBindingDisplayMaterial(binding, ambientBinding);
        material = binding.coloredMaterial;
      } else {
        binding.flatMaterial ??= this.cloneBindingDisplayMaterial(binding, null);
        material = binding.flatMaterial;
      }
    }

    this.applyBindingWaterPasses(binding, material);
  }

  private applyBindingWaterPasses(
    binding: TieInstancedMeshBinding,
    material: THREE.Material | THREE.Material[]
  ): void {
    const passes = createWaterSurfaceMaterialPasses(material);
    binding.mesh.material = passes?.above ?? material;
    binding.mesh.renderOrder = passes ? aboveWaterRenderOrder : binding.sourceRenderOrder;
    syncModelAlphaOpaquePass(binding.mesh);
    if (!passes) {
      if (binding.belowWaterMesh) {
        binding.belowWaterMesh.visible = false;
      }
      return;
    }

    let belowWaterMesh = binding.belowWaterMesh;
    if (!belowWaterMesh) {
      belowWaterMesh = binding.mesh.clone(false);
      belowWaterMesh.name = `${binding.mesh.name}_below_water`;
      belowWaterMesh.instanceMatrix = binding.mesh.instanceMatrix;
      belowWaterMesh.boundingBox = binding.mesh.boundingBox;
      belowWaterMesh.boundingSphere = binding.mesh.boundingSphere;
      binding.mesh.parent?.add(belowWaterMesh);
      binding.belowWaterMesh = belowWaterMesh;
    }
    belowWaterMesh.material = passes.below;
    belowWaterMesh.renderOrder = belowWaterRenderOrder;
    belowWaterMesh.visible = true;
    syncModelAlphaOpaquePass(belowWaterMesh);
  }

  private cloneBindingDisplayMaterial(
    binding: TieInstancedMeshBinding,
    ambientBinding: TieInstancedMeshBinding['ambientBinding']
  ): THREE.Material | THREE.Material[] {
    const displayOptions = this.modelDisplayOptions;
    if (!displayOptions) {
      throw new Error('Tie material display options are not initialized.');
    }

    return cloneTieMaterial(
      this.getBindingMaterialSource(binding),
      binding.mesh.geometry,
      ambientBinding,
      binding.glowColorBinding,
      this.directionalLightBinding,
      this.skyboxReflectionTexture,
      displayOptions,
      binding.mesh.geometry.hasAttribute(rc1TiePointColorAttributeName));
  }

  private getBindingMaterialSource(binding: TieInstancedMeshBinding): THREE.Material | THREE.Material[] {
    const source = binding.coloredMaterial ?? binding.flatMaterial ?? binding.textureMaterial;
    if (!source) {
      throw new Error('Tie material binding has no source material.');
    }
    return source;
  }

  private getPlainMaterial(): THREE.MeshBasicNodeMaterial {
    if (!this.plainMaterial) {
      this.plainMaterial = new THREE.MeshBasicNodeMaterial({
        name: 'tie_plain_debug_material',
        color: 0xd8d8d8,
        side: THREE.FrontSide,
        toneMapped: false
      });
    }

    return this.plainMaterial;
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
      if (binding.belowWaterMesh) {
        binding.belowWaterMesh.frustumCulled = !this.bundleEnabled;
      }
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

  private getChunkAttribute(
    cache: WeakMap<PreparedTieRecord[], THREE.InstancedBufferAttribute>,
    records: PreparedTieRecord[],
    create: () => Float32Array | THREE.InstancedBufferAttribute
  ): THREE.InstancedBufferAttribute {
    const existing = cache.get(records);
    if (existing) {
      return existing;
    }

    const value = create();
    const attribute = value instanceof THREE.InstancedBufferAttribute
      ? value
      : new THREE.InstancedBufferAttribute(value, 1);
    cache.set(records, attribute);
    return attribute;
  }

  private createTieMaterialSet(
    records: PreparedTieRecord[],
    primitive: TiePrimitive,
    glowColorBinding: TieGlowColorBinding | null,
    usesGlowEmission: boolean
  ): TieMaterialSet {
    const hasRc1PointLights = this.rc1PointLights.length > 0;
    const ambientBinding = createTieAmbientTextureBinding(records, primitive, this.directionalLights, this.isRc1);
    const displayOptions = this.modelDisplayOptions;
    if (!displayOptions) {
      throw new Error('Tie material display options are not initialized.');
    }

    const coloredMaterial = ambientBinding && this.options.colorsEnabled
      ? cloneTieMaterial(
          primitive.material,
          primitive.geometry,
          ambientBinding,
          glowColorBinding,
          this.directionalLightBinding,
          this.skyboxReflectionTexture,
          displayOptions,
          hasRc1PointLights && !usesGlowEmission)
      : null;
    return {
      flatMaterial: coloredMaterial
        ? null
        : cloneTieMaterial(
          primitive.material,
          primitive.geometry,
          null,
          glowColorBinding,
          this.directionalLightBinding,
          this.skyboxReflectionTexture,
          displayOptions,
          hasRc1PointLights && !usesGlowEmission),
      coloredMaterial,
      textureMaterial: null,
      ambientBinding,
      glowColorBinding,
      usesGlowEmission
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
    const timingAccumulator: TieClassTimingAccumulator = {
      sourceMs: 0,
      prepareMs: 0,
      materialMs: 0,
      instanceMs: 0,
      classTimings: []
    };
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
          yieldController,
          timingAccumulator
        );
        completedGroups += 1;
        onProgress?.(completedGroups, classGroups.length);
        await yieldController.maybeYield();
      }
    };

    await Promise.all(Array.from({ length: workerCount }, loadNext));
    logTieClassTimingSummary(timingAccumulator);
  }

  private async loadTieClassGroup(
    group: THREE.Group,
    mapPackage: LoadedMapPackage,
    loader: GLTFLoader,
    entriesByClassId: Map<number, GltfExportEntry>,
    colorTable: TieColorTable | null,
    classId: number,
    classRecords: TieInstanceRecord[],
    yieldController: LoadYieldController,
    timingAccumulator: TieClassTimingAccumulator
  ): Promise<void> {
    const classStartMs = performance.now();
    const timing: TieClassTiming = {
      classId,
      records: classRecords.length,
      primitives: 0,
      batches: 0,
      elapsedMs: 0,
      sourceMs: 0,
      prepareMs: 0,
      materialMs: 0,
      instanceMs: 0,
      status: 'failed'
    };
    try {
      const entry = entriesByClassId.get(classId);
      if (!entry) {
        this.stats.missingClasses += classRecords.length;
        timing.status = 'missing entry';
        return;
      }

      let stepStartMs = performance.now();
      let source: THREE.Object3D | null = null;
      try {
        source = await loadTieClassSource(loader, mapPackage, entry);
      } finally {
        timing.sourceMs += elapsedDurationMs(stepStartMs);
      }
      if (!source) {
        this.stats.missingClasses += classRecords.length;
        timing.status = 'missing source';
        return;
      }

      try {
        stepStartMs = performance.now();
        pruneToLod0(source);
        const primitives = collectTiePrimitives(source);
        timing.primitives = primitives.length;
        if (primitives.length === 0) {
          this.stats.missingClasses += classRecords.length;
          timing.status = 'empty';
          return;
        }

        this.stats.loadedClasses += 1;
        this.stats.primitives += primitives.length;
        const preparedRecords = classRecords.map((record) => prepareTieRecord(record, colorTable));
        this.stats.coloredInstances += preparedRecords.filter((record) => record.colorEntry !== null).length;
        const normalRecords = preparedRecords.filter((record) => record.mirroredKey === 'normal');
        const mirroredRecords = preparedRecords.filter((record) => record.mirroredKey === 'mirrored');
        const normalChunks = chunkTieRecords(normalRecords);
        const mirroredChunks = chunkTieRecords(mirroredRecords);
        const glowEmissionByPrimitive = new Map(
          primitives.map((primitive) => [primitive, tieMaterialUsesGlowEmission(primitive.material)] as const)
        );
        const glowColorBinding = [...glowEmissionByPrimitive.values()].some(Boolean)
          ? createTieGlowColorBinding(preparedRecords)
          : null;
        timing.prepareMs += elapsedDurationMs(stepStartMs);

        for (const primitive of primitives) {
          stepStartMs = performance.now();
          const usesGlowEmission = glowEmissionByPrimitive.get(primitive) === true;
          const materialSet = this.createTieMaterialSet(
            preparedRecords,
            primitive,
            usesGlowEmission ? glowColorBinding : null,
            usesGlowEmission);
          timing.materialMs += elapsedDurationMs(stepStartMs);

          if (normalChunks.length > 0) {
            for (const [chunkIndex, records] of normalChunks.entries()) {
              stepStartMs = performance.now();
              this.addInstancedPrimitive(group, classId, 'normal', records, primitive, chunkIndex, materialSet);
              timing.instanceMs += elapsedDurationMs(stepStartMs);
              timing.batches += 1;
            }
          }

          if (mirroredChunks.length > 0) {
            for (const [chunkIndex, records] of mirroredChunks.entries()) {
              stepStartMs = performance.now();
              this.addInstancedPrimitive(group, classId, 'mirrored', records, primitive, chunkIndex, materialSet);
              timing.instanceMs += elapsedDurationMs(stepStartMs);
              timing.batches += 1;
            }
          }

          await yieldController.maybeYield();
        }

        this.stats.renderedInstances += classRecords.length;
        timing.status = 'loaded';
      } finally {
        disposeObject3D(source);
      }
    } finally {
      timing.elapsedMs = elapsedDurationMs(classStartMs);
      recordTieClassTiming(timingAccumulator, timing);
    }
  }
}

function tieMaterialSetUsesAlphaBlend(materialSet: TieMaterialSet): boolean {
  const material = materialSet.coloredMaterial ?? materialSet.flatMaterial;
  return material ? modelMaterialUsesAlphaBlend(material) : false;
}

function findEarliestTieRecord(records: PreparedTieRecord[]): { recordIndex: number; localIndex: number; position: THREE.Vector3 } | null {
  let first: { recordIndex: number; localIndex: number; position: THREE.Vector3 } | null = null;
  for (let localIndex = 0; localIndex < records.length; localIndex += 1) {
    const recordIndex = records[localIndex].source.index;
    if (!Number.isFinite(recordIndex)) {
      continue;
    }

    if (!first || recordIndex < first.recordIndex) {
      first = {
        recordIndex,
        localIndex,
        position: setFromMatrixPosition(records[localIndex].instanceMatrix, new THREE.Vector3())
      };
    }
  }

  return first;
}

function setFromMatrixPosition(matrix: THREE.Matrix4, target: THREE.Vector3): THREE.Vector3 {
  const elements = matrix.elements;
  return target.set(elements[12], elements[13], elements[14]);
}

function createTieReflectionOriginAttribute(
  records: PreparedTieRecord[],
  mirrored: boolean
): THREE.InstancedBufferAttribute {
  const positions = new Float32Array(records.length * 3);
  for (let index = 0; index < records.length; index += 1) {
    const elements = records[index].instanceMatrix.elements;
    positions[index * 3] = mirrored ? -elements[12] : elements[12];
    positions[index * 3 + 1] = elements[13];
    positions[index * 3 + 2] = elements[14];
  }
  return new THREE.InstancedBufferAttribute(positions, 3);
}

function resolveGeometryBoundingSphere(geometry: THREE.BufferGeometry): THREE.Sphere | null {
  if (!geometry.boundingSphere) {
    geometry.computeBoundingSphere();
  }

  return geometry.boundingSphere;
}

function logTieTimingStart(label: string): void {
  console.log(`[TieInstanceController timing] ${label} started`);
}

function logTieTimingEnd(label: string, startMs: number): void {
  console.log(`[TieInstanceController timing] ${label}: ${formatElapsedMs(startMs)}`);
}

function logTieClassTimingSummary(timingAccumulator: TieClassTimingAccumulator): void {
  if (timingAccumulator.classTimings.length === 0) {
    return;
  }

  console.log(
    `[TieInstanceController timing] class groups cumulative: source ${formatDurationMs(timingAccumulator.sourceMs)}, `
    + `prepare ${formatDurationMs(timingAccumulator.prepareMs)}, `
    + `materials ${formatDurationMs(timingAccumulator.materialMs)}, `
    + `instances ${formatDurationMs(timingAccumulator.instanceMs)}`
  );

  const slowest = [...timingAccumulator.classTimings]
    .sort((left, right) => right.elapsedMs - left.elapsedMs)
    .slice(0, 8)
    .map(formatTieClassTiming);
  if (slowest.length > 0) {
    console.log(`[TieInstanceController timing] slowest classes: ${slowest.join('; ')}`);
  }
}

function recordTieClassTiming(timingAccumulator: TieClassTimingAccumulator, timing: TieClassTiming): void {
  timingAccumulator.sourceMs += timing.sourceMs;
  timingAccumulator.prepareMs += timing.prepareMs;
  timingAccumulator.materialMs += timing.materialMs;
  timingAccumulator.instanceMs += timing.instanceMs;
  timingAccumulator.classTimings.push(timing);
}

function formatTieClassTiming(timing: TieClassTiming): string {
  return [
    `class ${timing.classId}`,
    formatDurationMs(timing.elapsedMs),
    `${timing.records.toLocaleString()} records`,
    `${timing.primitives.toLocaleString()} primitives`,
    `${timing.batches.toLocaleString()} batches`,
    timing.status
  ].join(' / ');
}

function formatElapsedMs(startMs: number): string {
  return formatDurationMs(elapsedDurationMs(startMs));
}

function elapsedDurationMs(startMs: number): number {
  return performance.now() - startMs;
}

function formatDurationMs(durationMs: number): string {
  return `${Math.round(durationMs).toLocaleString()} ms`;
}

function createTieGlowColorBinding(records: PreparedTieRecord[]): TieGlowColorBinding {
  const instanceCount = Math.max(1, records.length);
  const data = new Uint8Array(instanceCount * 4);
  const texture = new THREE.DataTexture(data, 1, instanceCount, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = `tie_glow_runtime_${records[0]?.source.classId ?? 'empty'}_${records[0]?.source.index ?? 0}`;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return {
    texture,
    data,
    instanceCount,
    rowByRecord: createTieGlowRowMap(records)
  };
}

function createTieGlowRowAttribute(
  records: PreparedTieRecord[],
  binding: TieGlowColorBinding
): Float32Array {
  const rows = new Float32Array(records.length);
  for (let index = 0; index < records.length; index += 1) {
    rows[index] = binding.rowByRecord.get(records[index]) ?? 0;
  }

  return rows;
}

function createTieGlowRowMap(records: PreparedTieRecord[]): WeakMap<PreparedTieRecord, number> {
  const rowByRecord = new WeakMap<PreparedTieRecord, number>();
  for (let index = 0; index < records.length; index += 1) {
    rowByRecord.set(records[index], index);
  }

  return rowByRecord;
}

function buildTieGroupRecordIndex(groups: number[][]): Map<number, number> {
  const byRecordIndex = new Map<number, number>();
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    for (const recordIndex of groups[groupIndex]) {
      byRecordIndex.set(recordIndex, groupIndex);
    }
  }

  return byRecordIndex;
}
