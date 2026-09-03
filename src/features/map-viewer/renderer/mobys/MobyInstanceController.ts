import * as THREE from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  cameraViewMatrix,
  depth,
  float,
  floor,
  modelWorldMatrix,
  normalView,
  normalize,
  positionView,
  reflect,
  sRGBTransferOETF,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  vertexColor
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  dirnamePackagePath,
  joinPackagePath
} from '../../../../services/mapAssets/mapAssetPackage';
import {
  defaultShrubRenderOptions,
  type GltfExportEntry,
  type LoadedMapPackage,
  type MobyStats,
  type ShrubRenderOptions
} from '../../../../services/mapPackages/mapPackageTypes';
import type {
  DlMobyInstance,
  DlMobyMissionInstances,
  DlMobyInstances
} from '../../../../services/wasm/ratchetPs2Wasm';
import { mobyMissionVisible } from '../../../../services/mapLoading/dlMobyMissions';
import {
  createInstancedGeometry,
  estimateTriangleCount,
  isMesh
} from '../shrubs/ShrubClassSource';
import { disposeObject3D } from '../RendererDisposal';
import { LoadYieldController } from '../ties/tieUtils';
import { buildModelEntryMap, groupRecordsByClassId } from '../InstanceData';
import {
  configureModelMaterialTransparency,
  createModelOpacityNode,
  modelMaterialUsesAlphaBlend,
  resolveModelMaterialInfo,
  syncModelAlphaOpaquePass
} from '../model-materials/ModelMaterialNodes';
import {
  applyModelColorStrengthNode,
  applyModelDisplayTextureModulateNode,
  applyShrubDisplayLiftNode,
  applyShrubFogNode,
  configureModelDisplayTexture,
  type ModelDisplayNodeOptions
} from '../ModelFog';
import {
  createShrubDirectionalLightBinding,
  createShrubDirectionalLightNode,
  createShrubLightingUniforms,
  disposeShrubDirectionalLightBinding,
  updateShrubMaterialLightingUniforms
} from '../shrubs/ShrubLighting';
import {
  lightSelectorAttributeName,
  shrubLightingUniformsUserDataKey,
  type ShrubDirectionalLightBinding,
  type ShrubLightingUniforms
} from '../shrubs/ShrubTypes';
import {
  isMobyMetalObject,
  mobyMetalDepthBiasScale,
  mobyMetalFadeEnd,
  mobyMetalFadeStart,
  mobyPs2NeutralByte,
  mobyMetalReflectionScaleAttributeName,
  mobyReflectionOriginAttributeName,
  prepareMobyInstanceLighting,
  pruneMobyLods,
  refreshMobyInstanceBounds,
  resolveMobyMission,
  usesStoredMobyAmbient
} from './MobyGltfSupport';
import { buildMobyInstanceMatrix } from './MobyData';
import { mergeModelPrimitives } from '../ModelPrimitiveMerge';

type MobyGroup = THREE.Group & {
  isBundleGroup?: boolean;
  needsUpdate?: boolean;
};

interface MobyPrimitive {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrixWorld: THREE.Matrix4;
  renderOrder: number;
  metal: boolean;
}

interface MobyMeshBinding {
  classId: number;
  mission: number;
  mesh: THREE.InstancedMesh;
  material: THREE.Material | THREE.Material[];
  records: PreparedMobyRecord[];
  primitiveMatrixWorld: THREE.Matrix4;
  localBoundingSphereCenter: THREE.Vector3;
}

interface PreparedMobyRecord {
  source: DlMobyInstance;
  mission: number;
  instanceMatrix: THREE.Matrix4;
  ambientColor: [number, number, number];
  lightSelector: number;
}

interface MobyRecordBinding {
  binding: MobyMeshBinding;
  localIndex: number;
}

type MobyLoadProgressCallback = (loadedClasses: number, totalClasses: number) => void;

const emptyMobyStats: MobyStats = {
  classIds: 0,
  exportedClasses: 0,
  loadedClasses: 0,
  instances: 0,
  renderedInstances: 0,
  missingClasses: 0,
  batches: 0,
  primitives: 0,
  triangles: 0
};

const mobyClassLoadConcurrency = 2;
const mobyLoadFrameBudgetMs = 6;
const mobyInstanceChunkCellSize = 2400;
const mobyInstanceChunkMaxRecords = 768;
const mobyAmbientColorAttributeName = 'mobyAmbientColor';

export class MobyInstanceController {
  private group: MobyGroup | null = null;
  private alphaBlendGroup: MobyGroup | null = null;
  private stats: MobyStats = { ...emptyMobyStats };
  private meshBindings: MobyMeshBinding[] = [];
  private directionalLightBinding: ShrubDirectionalLightBinding | null = null;
  private chromeTexture: THREE.Texture | null = null;
  private options: ShrubRenderOptions = { ...defaultShrubRenderOptions };
  private modelDisplayOptions: ModelDisplayNodeOptions | null = null;
  private bundleEnabled = false;
  private selectedMission: number | null = null;
  private hiddenClassIds = new Set<number>();
  private readonly lightSelectorsByChunk = new WeakMap<PreparedMobyRecord[], THREE.InstancedBufferAttribute>();
  private readonly ambientColorsByChunk = new WeakMap<PreparedMobyRecord[], THREE.InstancedBufferAttribute>();
  private readonly reflectionOriginsByChunk = new WeakMap<PreparedMobyRecord[], THREE.InstancedBufferAttribute>();
  private readonly instanceTransformMatrix = new THREE.Matrix4();
  private instanceBindings = new WeakMap<DlMobyInstance, MobyRecordBinding[]>();
  private readonly dirtyTransformBindings = new Set<MobyMeshBinding>();

  async load(
    parent: THREE.Object3D,
    mapPackage: LoadedMapPackage,
    loader: GLTFLoader,
    mobyInstances: DlMobyInstances | null,
    mobyMissions: DlMobyMissionInstances[],
    options: ShrubRenderOptions,
    modelDisplayOptions: ModelDisplayNodeOptions,
    onProgress?: MobyLoadProgressCallback
  ): Promise<MobyStats> {
    this.dispose();
    this.options = { ...defaultShrubRenderOptions, ...options };
    this.modelDisplayOptions = modelDisplayOptions;
    this.stats = {
      ...emptyMobyStats,
      exportedClasses: mapPackage.mobyEntries.length
    };

    const group = new THREE.BundleGroup() as MobyGroup;
    group.name = 'moby_instances';
    const alphaBlendGroup = new THREE.BundleGroup() as MobyGroup;
    alphaBlendGroup.name = 'moby_alpha_blend_instances';
    parent.add(group);
    parent.add(alphaBlendGroup);
    this.group = group;
    this.alphaBlendGroup = alphaBlendGroup;
    this.applyBundleMode();
    this.directionalLightBinding = createShrubDirectionalLightBinding(mapPackage.directionalLights);

    const records = [
      ...(mobyInstances?.instances ?? []),
      ...mobyMissions.flatMap((mission) => mission.mobyInstances.instances)
    ];
    if (records.length === 0 || mapPackage.mobyEntries.length === 0) {
      return this.getStats();
    }

    this.chromeTexture = await loadMobyChromeTexture(mapPackage, loader);

    const entriesByClassId = buildModelEntryMap(mapPackage.mobyEntries);
    const recordsByClassId = groupRecordsByClassId(records);
    this.stats.classIds = recordsByClassId.size;
    this.stats.instances = records.length;

    await this.loadMobyClassGroups(group, mapPackage, loader, entriesByClassId, recordsByClassId, onProgress);
    return this.getStats();
  }

  dispose(): void {
    this.chromeTexture?.dispose();
    this.chromeTexture = null;
    const directionalLightBinding = this.directionalLightBinding;
    this.directionalLightBinding = null;
    this.modelDisplayOptions = null;
    this.instanceBindings = new WeakMap();
    this.dirtyTransformBindings.clear();

    if (!this.group && !this.alphaBlendGroup) {
      if (directionalLightBinding) {
        disposeShrubDirectionalLightBinding(directionalLightBinding);
      }
      this.meshBindings = [];
      this.hiddenClassIds.clear();
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
    this.hiddenClassIds.clear();
  }

  getStats(): MobyStats {
    return { ...this.stats };
  }

  setVisible(visible: boolean): void {
    if (this.group) {
      this.group.visible = visible;
    }
    if (this.alphaBlendGroup) {
      this.alphaBlendGroup.visible = visible;
    }
  }

  setClassVisible(classId: number, visible: boolean): void {
    if (visible) {
      this.hiddenClassIds.delete(classId);
    } else {
      this.hiddenClassIds.add(classId);
    }

    for (const binding of this.meshBindings) {
      if (binding.classId === classId) {
        binding.mesh.visible = visible && mobyMissionVisible(binding.mission, this.selectedMission);
      }
    }
    this.markBundleNeedsUpdate();
  }

  setInstanceTransform(instance: DlMobyInstance, transform: THREE.Matrix4 | null): void {
    for (const { binding, localIndex } of this.instanceBindings.get(instance) ?? []) {
      const instanceMatrix = transform ?? binding.records[localIndex].instanceMatrix;
      this.instanceTransformMatrix.multiplyMatrices(instanceMatrix, binding.primitiveMatrixWorld);
      binding.mesh.setMatrixAt(localIndex, this.instanceTransformMatrix);
      binding.mesh.instanceMatrix.needsUpdate = true;
      this.dirtyTransformBindings.add(binding);
      const reflectionOrigin = binding.mesh.geometry.getAttribute(mobyReflectionOriginAttributeName);
      if (reflectionOrigin instanceof THREE.InstancedBufferAttribute) {
        const elements = instanceMatrix.elements;
        reflectionOrigin.setXYZ(localIndex, elements[12], elements[13], elements[14]);
        reflectionOrigin.needsUpdate = true;
      }
    }
  }

  flushInstanceTransforms(): void {
    if (this.dirtyTransformBindings.size === 0) {
      return;
    }

    for (const binding of this.dirtyTransformBindings) {
      refreshMobyInstanceBounds(binding.mesh, binding.localBoundingSphereCenter);
    }
    this.dirtyTransformBindings.clear();
    this.markBundleNeedsUpdate();
  }

  setMission(mission: number | null): void {
    this.selectedMission = mission;
    for (const binding of this.meshBindings) {
      binding.mesh.visible = !this.hiddenClassIds.has(binding.classId)
        && mobyMissionVisible(binding.mission, mission);
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

  updateLightingOptions(options: ShrubRenderOptions): void {
    this.options = { ...defaultShrubRenderOptions, ...options };
    for (const binding of this.meshBindings) {
      updateShrubMaterialLightingUniforms(binding.material, this.options);
    }
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

  private async loadMobyClassGroups(
    group: THREE.Group,
    mapPackage: LoadedMapPackage,
    loader: GLTFLoader,
    entriesByClassId: Map<number, GltfExportEntry>,
    recordsByClassId: Map<number, DlMobyInstance[]>,
    onProgress?: MobyLoadProgressCallback
  ): Promise<void> {
    const classGroups = Array.from(recordsByClassId);
    let nextGroupIndex = 0;
    let completedGroups = 0;
    const workerCount = Math.min(mobyClassLoadConcurrency, classGroups.length);
    const yieldController = new LoadYieldController(mobyLoadFrameBudgetMs);
    onProgress?.(0, classGroups.length);

    const loadNext = async () => {
      while (nextGroupIndex < classGroups.length) {
        const groupIndex = nextGroupIndex;
        nextGroupIndex += 1;
        const [classId, classRecords] = classGroups[groupIndex];
        await this.loadMobyClassGroup(
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

  private async loadMobyClassGroup(
    group: THREE.Group,
    mapPackage: LoadedMapPackage,
    loader: GLTFLoader,
    entriesByClassId: Map<number, GltfExportEntry>,
    classId: number,
    classRecords: DlMobyInstance[],
    yieldController: LoadYieldController
  ): Promise<void> {
    const entry = entriesByClassId.get(classId);
    if (!entry) {
      this.stats.missingClasses += classRecords.length;
      return;
    }

    const source = await loadMobyClassSource(loader, mapPackage, entry);
    if (!source) {
      this.stats.missingClasses += classRecords.length;
      return;
    }

    try {
      pruneMobyLods(source);
      const primitives = collectMobyPrimitives(source);
      if (primitives.length === 0) {
        this.stats.missingClasses += classRecords.length;
        return;
      }

      this.stats.loadedClasses += 1;
      this.stats.primitives += primitives.length;
      const game = mapPackage.rootManifest.Game;
      const useStoredAmbient = usesStoredMobyAmbient(game);
      const preparedRecords = classRecords.map((record) => prepareMobyRecord(record, game));
      const chunks = chunkMobyRecords(preparedRecords);

      for (const primitive of primitives) {
        if (primitive.metal && !this.chromeTexture) {
          continue;
        }

        const displayOptions = this.modelDisplayOptions;
        if (!displayOptions) {
          throw new Error('Moby material display options are not initialized.');
        }

        const material = cloneMaterial(
          primitive,
          primitive.metal ? this.chromeTexture : null,
          this.directionalLightBinding,
          this.options,
          displayOptions,
          useStoredAmbient);
        for (const [chunkIndex, records] of chunks.entries()) {
          this.addInstancedPrimitive(group, classId, records, primitive, chunkIndex, material, useStoredAmbient);
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
    records: PreparedMobyRecord[],
    primitive: MobyPrimitive,
    chunkIndex: number,
    material: THREE.Material | THREE.Material[],
    useStoredAmbient: boolean
  ): void {
    const geometry = createMobyInstancedGeometry(primitive.geometry);
    geometry.setAttribute(
      lightSelectorAttributeName,
      this.getChunkAttribute(
        this.lightSelectorsByChunk,
        records,
        () => createMobyLightSelectorInstanceAttribute(records))
    );
    if (useStoredAmbient) {
      geometry.setAttribute(
        mobyAmbientColorAttributeName,
        this.getChunkAttribute(this.ambientColorsByChunk, records, () => createMobyAmbientColorInstanceAttribute(records))
      );
    }
    if (primitive.metal && this.chromeTexture) {
      geometry.setAttribute(
        mobyReflectionOriginAttributeName,
        this.getChunkAttribute(
          this.reflectionOriginsByChunk,
          records,
          () => createMobyReflectionOriginAttribute(records))
      );
    }
    const mesh = new THREE.InstancedMesh(geometry, material, records.length);
    const mission = records[0]?.mission ?? -1;
    mesh.name = `moby_${String(classId).padStart(5, '0')}_c${chunkIndex}_${primitive.name}`;
    mesh.renderOrder = primitive.renderOrder + (primitive.metal ? 1 : 0);
    mesh.visible = !this.hiddenClassIds.has(classId) && mobyMissionVisible(mission, this.selectedMission);
    mesh.frustumCulled = !this.bundleEnabled;
    mesh.static = true;
    mesh.matrixAutoUpdate = false;

    const composeMatrix = new THREE.Matrix4();
    for (let index = 0; index < records.length; index += 1) {
      composeMatrix.multiplyMatrices(records[index].instanceMatrix, primitive.matrixWorld);
      mesh.setMatrixAt(index, composeMatrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    const localBoundingSphereCenter = geometry.boundingSphere!.center.clone();
    // Three sorts instanced meshes by geometry bounds, so use this batch's actual center.
    geometry.boundingSphere!.center.copy(mesh.boundingSphere!.center);
    const targetGroup = this.alphaBlendGroup && modelMaterialUsesAlphaBlend(material)
      ? this.alphaBlendGroup
      : group;
    targetGroup.add(mesh);
    if (!primitive.metal) {
      syncModelAlphaOpaquePass(mesh);
    }
    const binding: MobyMeshBinding = {
      classId,
      mission,
      mesh,
      material,
      records,
      primitiveMatrixWorld: primitive.matrixWorld.clone(),
      localBoundingSphereCenter
    };
    this.meshBindings.push(binding);
    for (const [localIndex, record] of records.entries()) {
      const bindings = this.instanceBindings.get(record.source);
      const recordBinding = { binding, localIndex };
      if (bindings) {
        bindings.push(recordBinding);
      } else {
        this.instanceBindings.set(record.source, [recordBinding]);
      }
    }

    this.stats.batches += 1;
    this.stats.triangles += estimateTriangleCount(geometry) * records.length;
  }

  private getChunkAttribute(
    cache: WeakMap<PreparedMobyRecord[], THREE.InstancedBufferAttribute>,
    records: PreparedMobyRecord[],
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

async function loadMobyClassSource(
  loader: GLTFLoader,
  mapPackage: LoadedMapPackage,
  entry: GltfExportEntry
): Promise<THREE.Object3D | null> {
  if (!entry.GltfPath) {
    return null;
  }

  const path = joinPackagePath(dirnamePackagePath(mapPackage.assetManifestPath), entry.GltfPath);
  const url = await mapPackage.assetPackage.resolveUrl(path);
  try {
    const gltf = await loader.loadAsync(url);
    gltf.scene.name = `moby_class_${String(entry.ModelId ?? 'unknown').padStart(5, '0')}`;
    return gltf.scene;
  } catch (error) {
    console.warn(`Failed to load moby class ${entry.ModelId ?? 'unknown'} from ${url}`, error);
    return null;
  }
}

async function loadMobyChromeTexture(
  mapPackage: LoadedMapPackage,
  loader: GLTFLoader
): Promise<THREE.Texture | null> {
  if (!mapPackage.chromeTextureUrl) {
    return null;
  }

  try {
    const chrome = await new THREE.TextureLoader(loader.manager).loadAsync(mapPackage.chromeTextureUrl);
    chrome.name = 'level_chrome';
    configureModelDisplayTexture(chrome);
    chrome.flipY = false;
    chrome.wrapS = THREE.RepeatWrapping;
    chrome.wrapT = THREE.RepeatWrapping;
    chrome.needsUpdate = true;
    return chrome;
  } catch (error) {
    console.warn(`Failed to load level chrome texture from ${mapPackage.chromeTextureUrl}`, error);
    return null;
  }
}

function collectMobyPrimitives(source: THREE.Object3D): MobyPrimitive[] {
  source.updateMatrixWorld(true);
  const primitives: MobyPrimitive[] = [];

  source.traverse((object) => {
    if (!isMesh(object) || !object.geometry || !object.material) {
      return;
    }

    primitives.push({
      name: object.name || 'moby_primitive',
      geometry: object.geometry,
      material: object.material,
      matrixWorld: object.matrixWorld.clone(),
      renderOrder: object.renderOrder,
      metal: isMobyMetalObject(object)
    });
  });

  return mergeModelPrimitives(primitives, (left, right) => left.metal === right.metal);
}

function prepareMobyRecord(record: DlMobyInstance, game: string | null | undefined): PreparedMobyRecord {
  return {
    source: record,
    mission: resolveMobyMission(record.mission, game),
    instanceMatrix: buildMobyInstanceMatrix(record),
    ...prepareMobyInstanceLighting(record)
  };
}

function chunkMobyRecords(records: PreparedMobyRecord[]): PreparedMobyRecord[][] {
  if (records.length === 0) {
    return [];
  }

  const recordsByMission = new Map<number, PreparedMobyRecord[]>();
  for (const record of records) {
    const missionRecords = recordsByMission.get(record.mission);
    if (missionRecords) {
      missionRecords.push(record);
    } else {
      recordsByMission.set(record.mission, [record]);
    }
  }

  return [...recordsByMission.values()].flatMap(chunkMobyMissionRecords);
}

function chunkMobyMissionRecords(records: PreparedMobyRecord[]): PreparedMobyRecord[][] {
  const recordsByCell = new Map<string, PreparedMobyRecord[]>();
  for (const record of records) {
    const cellKey = mobyRecordCellKey(record);
    const cellRecords = recordsByCell.get(cellKey);
    if (cellRecords) {
      cellRecords.push(record);
    } else {
      recordsByCell.set(cellKey, [record]);
    }
  }

  const chunks: PreparedMobyRecord[][] = [];
  for (const cellRecords of recordsByCell.values()) {
    const sortedRecords = cellRecords.length > mobyInstanceChunkMaxRecords
      ? [...cellRecords].sort(compareMobyRecordPosition)
      : cellRecords;
    for (let index = 0; index < sortedRecords.length; index += mobyInstanceChunkMaxRecords) {
      chunks.push(sortedRecords.slice(index, index + mobyInstanceChunkMaxRecords));
    }
  }

  return chunks;
}

function mobyRecordCellKey(record: PreparedMobyRecord): string {
  const elements = record.instanceMatrix.elements;
  return [
    Math.floor(elements[12] / mobyInstanceChunkCellSize),
    Math.floor(elements[13] / mobyInstanceChunkCellSize),
    Math.floor(elements[14] / mobyInstanceChunkCellSize)
  ].join(',');
}

function compareMobyRecordPosition(left: PreparedMobyRecord, right: PreparedMobyRecord): number {
  const leftElements = left.instanceMatrix.elements;
  const rightElements = right.instanceMatrix.elements;
  return (leftElements[12] - rightElements[12])
    || (leftElements[14] - rightElements[14])
    || (leftElements[13] - rightElements[13]);
}

const mobyAmbientScale = 0.65;

function createMobyInstancedGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = createInstancedGeometry(source);
  if (!geometry.hasAttribute('normal') && geometry.hasAttribute('position')) {
    geometry.computeVertexNormals();
  }

  return geometry;
}

function cloneMaterial(
  primitive: MobyPrimitive,
  chromeTexture: THREE.Texture | null,
  directionalLightBinding: ShrubDirectionalLightBinding | null,
  options: ShrubRenderOptions,
  displayOptions: ModelDisplayNodeOptions,
  useStoredAmbient: boolean
): THREE.Material | THREE.Material[] {
  return Array.isArray(primitive.material)
    ? primitive.material.map((item) => createMobyMaterial(item, primitive.geometry, chromeTexture, directionalLightBinding, options, displayOptions, useStoredAmbient))
    : createMobyMaterial(primitive.material, primitive.geometry, chromeTexture, directionalLightBinding, options, displayOptions, useStoredAmbient);
}

function createMobyMaterial(
  source: THREE.Material,
  geometry: THREE.BufferGeometry,
  chromeTexture: THREE.Texture | null,
  directionalLightBinding: ShrubDirectionalLightBinding | null,
  options: ShrubRenderOptions,
  displayOptions: ModelDisplayNodeOptions,
  useStoredAmbient: boolean
): THREE.Material {
  const sourceMaterial = source as Partial<THREE.MeshStandardMaterial>;
  const modelMaterialInfo = resolveModelMaterialInfo(source, 'moby');
  const map = chromeTexture ? null : sourceMaterial.map ?? sourceMaterial.emissiveMap ?? null;
  const chromeSampleNode = chromeTexture
    ? createMobyChromeTextureSampleNode(chromeTexture, geometry)
    : null;
  const uniforms = createShrubLightingUniforms(options);
  const material = new THREE.MeshBasicNodeMaterial({
    name: `${source.name || 'moby'}_map_omatic_unlit`,
    color: sourceMaterial.color?.clone?.() ?? new THREE.Color(1, 1, 1),
    map,
    alphaMap: sourceMaterial.alphaMap ?? null,
    vertexColors: false,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    depthTest: source.depthTest,
    depthWrite: source.depthWrite,
    side: chromeSampleNode ? THREE.DoubleSide : source.side,
    toneMapped: false,
    userData: {
      ...source.userData,
      mapOmaticMobyMaterial: true,
      mapOmaticMobyDirectionalLightMaterial: directionalLightBinding !== null,
      mapOmaticModelMaterialInfo: modelMaterialInfo,
      [shrubLightingUniformsUserDataKey]: uniforms
    }
  });

  if (material.map) {
    configureModelDisplayTexture(material.map);
  }

  if (material.alphaMap) {
    configureModelDisplayTexture(material.alphaMap);
  }

  configureModelMaterialTransparency(material, modelMaterialInfo);
  if (chromeSampleNode) {
    // Moby_Gif_Regs writes GS ALPHA 0x0000008000000044: standard source-alpha blending.
    material.transparent = true;
    material.blending = THREE.NormalBlending;
    material.depthWrite = false;
    material.alphaTest = 0;
    material.depthNode = depth.sub(
      float(mobyMetalDepthBiasScale).div(positionView.z.negate()));
  }
  material.colorNode = createMobyColorNode(
    material,
    geometry.hasAttribute('color'),
    directionalLightBinding,
    uniforms,
    options,
    displayOptions,
    useStoredAmbient,
    chromeSampleNode?.rgb ?? null);
  material.opacityNode = chromeSampleNode
    ? chromeSampleNode.a.div(float(127 / 255)).clamp(0, 1)
    : createModelOpacityNode(material, modelMaterialInfo);
  return material;
}

function createMobyChromeTextureSampleNode(
  textureSource: THREE.Texture,
  geometry: THREE.BufferGeometry
) {
  const instanceOriginWorld = modelWorldMatrix
    .mul(vec4(attribute<'vec3'>(mobyReflectionOriginAttributeName, 'vec3'), 1))
    .xyz;
  const originView = cameraViewMatrix
    .mul(vec4(instanceOriginWorld.sub(cameraPosition), 0))
    .xyz;
  const incidentView = normalize(originView);
  const reflectionScale = geometry.hasAttribute(mobyMetalReflectionScaleAttributeName)
    ? attribute<'float'>(mobyMetalReflectionScaleAttributeName, 'float')
    : float(0.3);
  // MobyProc builds a Householder matrix from the camera direction, then applies
  // it to the authored vector; reflect(vector, cameraDirection) is the same operation.
  const reflectedView = reflect(normalView.mul(reflectionScale), incidentView);
  const generatedUv = reflectedView.xy.mul(vec2(1, -1))
    .add(vec2(0.5, 0.5))
    .toVarying('mobyMetalReflectionUv');
  const distanceFade = float(mobyMetalFadeEnd)
    .sub(originView.z.negate())
    .div(float(mobyMetalFadeEnd - mobyMetalFadeStart))
    .clamp(0, 1);
  const sample = texture(textureSource, generatedUv);
  return vec4(sample.rgb, sample.a.mul(distanceFade));
}

function createMobyColorNode(
  material: THREE.MeshBasicNodeMaterial,
  hasVertexColors: boolean,
  directionalLightBinding: ShrubDirectionalLightBinding | null,
  uniforms: ShrubLightingUniforms,
  options: ShrubRenderOptions,
  displayOptions: ModelDisplayNodeOptions,
  useStoredAmbient: boolean,
  chromeColorNode: Node<'vec3'> | null
) {
  const displayMaterialColorNode = sRGBTransferOETF(
    uniform(new THREE.Vector3(material.color.r, material.color.g, material.color.b))
  ) as Node<'vec3'>;
  const textureDisplayColorNode = material.map
    ? texture(material.map, uv()).rgb.mul(displayMaterialColorNode)
    : displayMaterialColorNode;
  const baseDisplayColorNode = chromeColorNode ?? (hasVertexColors
    ? textureDisplayColorNode.mul(vertexColor().rgb)
    : textureDisplayColorNode);
  const ambientTermNode = (useStoredAmbient
    ? attribute<'vec3'>(mobyAmbientColorAttributeName, 'vec3')
    : vec3(mobyAmbientScale, mobyAmbientScale, mobyAmbientScale))
    .mul(uniforms.ambientScale);
  const directionalLightNode = directionalLightBinding
    ? createShrubDirectionalLightNode(
      directionalLightBinding,
      uniforms,
      displayOptions.dynamic ? undefined : options)
    : null;
  const directionalTermNode = directionalLightNode
    ? applyModelColorStrengthNode(
      directionalLightNode.rgb,
      displayOptions.dynamic ? uniforms.directionalColorStrength : options.directionalColorStrength)
      .mul(uniforms.directionalScale)
    : vec3(0, 0, 0);
  const lightTermNode = ambientTermNode.add(directionalTermNode);
  const litColorNode = applyModelDisplayTextureModulateNode(
    baseDisplayColorNode,
    quantizeMobyLightTermNode(lightTermNode)
  ).saturate();
  const exposureNode = displayOptions.dynamic ? uniforms.exposureScale : float(Math.max(0, options.exposure));
  return applyShrubFogNode(
    applyShrubDisplayLiftNode(litColorNode.mul(exposureNode).saturate(), displayOptions),
    displayOptions
  );
}

function createMobyLightSelectorInstanceAttribute(records: PreparedMobyRecord[]): THREE.InstancedBufferAttribute {
  const selectors = new Float32Array(records.length);
  for (let index = 0; index < records.length; index += 1) {
    selectors[index] = records[index].lightSelector;
  }

  return new THREE.InstancedBufferAttribute(selectors, 1);
}

function createMobyAmbientColorInstanceAttribute(records: PreparedMobyRecord[]): THREE.InstancedBufferAttribute {
  const colors = new Float32Array(records.length * 3);
  for (let index = 0; index < records.length; index += 1) {
    const color = records[index].ambientColor;
    const offset = index * 3;
    colors[offset] = color[0];
    colors[offset + 1] = color[1];
    colors[offset + 2] = color[2];
  }

  return new THREE.InstancedBufferAttribute(colors, 3);
}

function createMobyReflectionOriginAttribute(records: PreparedMobyRecord[]): THREE.InstancedBufferAttribute {
  const positions = new Float32Array(records.length * 3);
  for (let index = 0; index < records.length; index += 1) {
    const elements = records[index].instanceMatrix.elements;
    positions[index * 3] = elements[12];
    positions[index * 3 + 1] = elements[13];
    positions[index * 3 + 2] = elements[14];
  }

  return new THREE.InstancedBufferAttribute(positions, 3);
}

function quantizeMobyLightTermNode(lightTermNode: Node<'vec3'>): Node<'vec3'> {
  return floor(
    lightTermNode.clamp(0, 255 / mobyPs2NeutralByte)
      .mul(float(mobyPs2NeutralByte))
      .add(float(0.5))
  ).div(float(mobyPs2NeutralByte));
}
