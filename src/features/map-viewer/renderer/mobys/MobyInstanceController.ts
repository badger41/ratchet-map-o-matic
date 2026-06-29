import * as THREE from 'three/webgpu';
import {
  float,
  texture,
  uv,
  vec3,
  vertexColor
} from 'three/tsl';
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
  DlMobyInstances
} from '../../../../services/wasm/ratchetPs2Wasm';
import {
  createInstancedGeometry,
  estimateTriangleCount,
  isMesh
} from '../shrubs/ShrubClassSource';
import { disposeObject3D } from '../RendererDisposal';
import {
  gltfToPs2BasisMatrix,
  ps2ToGltfBasisMatrix
} from '../shrubs/ShrubTypes';
import { LoadYieldController, numberValue } from '../ties/tieUtils';
import {
  configureModelMaterialTransparency,
  createModelOpacityNode,
  resolveModelMaterialInfo
} from '../model-materials/ModelMaterialNodes';
import {
  applyModelColorStrengthNode,
  applyModelDisplayModulateNode,
  applyShrubDisplayLiftNode,
  applyShrubFogNode,
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
}

interface MobyMeshBinding {
  mesh: THREE.InstancedMesh;
  material: THREE.Material | THREE.Material[];
}

interface PreparedMobyRecord {
  instanceMatrix: THREE.Matrix4;
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

export class MobyInstanceController {
  private group: MobyGroup | null = null;
  private stats: MobyStats = { ...emptyMobyStats };
  private meshBindings: MobyMeshBinding[] = [];
  private directionalLightBinding: ShrubDirectionalLightBinding | null = null;
  private options: ShrubRenderOptions = { ...defaultShrubRenderOptions };
  private modelDisplayOptions: ModelDisplayNodeOptions | null = null;
  private bundleEnabled = false;

  async load(
    parent: THREE.Object3D,
    mapPackage: LoadedMapPackage,
    loader: GLTFLoader,
    mobyInstances: DlMobyInstances | null,
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
    parent.add(group);
    this.group = group;
    this.applyBundleMode();
    this.directionalLightBinding = createShrubDirectionalLightBinding(mapPackage.directionalLights);

    const records = mobyInstances?.instances ?? [];
    if (records.length === 0 || mapPackage.mobyEntries.length === 0) {
      return this.getStats();
    }

    const entriesByClassId = buildMobyEntryMap(mapPackage.mobyEntries);
    const recordsByClassId = groupMobyRecordsByClassId(records);
    this.stats.classIds = recordsByClassId.size;
    this.stats.instances = records.length;

    await this.loadMobyClassGroups(group, mapPackage, loader, entriesByClassId, recordsByClassId, onProgress);
    return this.getStats();
  }

  dispose(): void {
    const directionalLightBinding = this.directionalLightBinding;
    this.directionalLightBinding = null;
    this.modelDisplayOptions = null;

    if (!this.group) {
      if (directionalLightBinding) {
        disposeShrubDirectionalLightBinding(directionalLightBinding);
      }
      this.meshBindings = [];
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

  getStats(): MobyStats {
    return { ...this.stats };
  }

  setVisible(visible: boolean): void {
    if (this.group) {
      this.group.visible = visible;
    }
  }

  setBundleEnabled(enabled: boolean): void {
    this.bundleEnabled = enabled;
    this.applyBundleMode();
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
    for (const binding of this.meshBindings) {
      binding.mesh.frustumCulled = !this.bundleEnabled;
    }

    this.markBundleNeedsUpdate();
  }

  private markBundleNeedsUpdate(): void {
    if (this.group?.needsUpdate !== undefined) {
      this.group.needsUpdate = true;
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
      const primitives = collectMobyPrimitives(source);
      if (primitives.length === 0) {
        this.stats.missingClasses += classRecords.length;
        return;
      }

      this.stats.loadedClasses += 1;
      this.stats.primitives += primitives.length;
      const preparedRecords = classRecords.map(prepareMobyRecord);

      for (const primitive of primitives) {
        const displayOptions = this.modelDisplayOptions;
        if (!displayOptions) {
          throw new Error('Moby material display options are not initialized.');
      }

        const material = cloneMaterial(primitive, this.directionalLightBinding, this.options, displayOptions);
        for (const [chunkIndex, records] of chunkMobyRecords(preparedRecords).entries()) {
          this.addInstancedPrimitive(group, classId, records, primitive, chunkIndex, material);
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
    material: THREE.Material | THREE.Material[]
  ): void {
    const geometry = createMobyInstancedGeometry(primitive.geometry);
    geometry.setAttribute(lightSelectorAttributeName, createMobyLightSelectorInstanceAttribute(records));

    const mesh = new THREE.InstancedMesh(geometry, material, records.length);
    mesh.name = `moby_${String(classId).padStart(5, '0')}_c${chunkIndex}_${primitive.name}`;
    mesh.renderOrder = primitive.renderOrder;
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
    group.add(mesh);
    this.meshBindings.push({ mesh, material });

    this.stats.batches += 1;
    this.stats.triangles += estimateTriangleCount(geometry) * records.length;
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
      renderOrder: object.renderOrder
    });
  });

  return primitives;
}

function buildMobyEntryMap(entries: GltfExportEntry[]): Map<number, GltfExportEntry> {
  const map = new Map<number, GltfExportEntry>();
  for (const entry of entries) {
    const modelId = numberValue(entry.ModelId);
    if (modelId !== null) {
      map.set(modelId, entry);
    }
  }

  return map;
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

function prepareMobyRecord(record: DlMobyInstance): PreparedMobyRecord {
  return {
    instanceMatrix: buildMobyInstanceMatrix(record)
  };
}

function buildMobyInstanceMatrix(record: DlMobyInstance): THREE.Matrix4 {
  const position = new THREE.Vector3(
    finiteNumber(record.position.x),
    finiteNumber(record.position.y),
    finiteNumber(record.position.z)
  ).applyMatrix4(ps2ToGltfBasisMatrix);
  const sourceRotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
    finiteNumber(record.rotation.x),
    finiteNumber(record.rotation.y),
    finiteNumber(record.rotation.z),
    'ZYX'
  ));
  const rotationMatrix = new THREE.Matrix4()
    .copy(ps2ToGltfBasisMatrix)
    .multiply(sourceRotation)
    .multiply(gltfToPs2BasisMatrix);
  const rotation = new THREE.Quaternion().setFromRotationMatrix(rotationMatrix);
  const scale = finitePositive(record.scale, 1);

  return new THREE.Matrix4().compose(
    position,
    rotation,
    new THREE.Vector3(scale, scale, scale)
  );
}

function chunkMobyRecords(records: PreparedMobyRecord[]): PreparedMobyRecord[][] {
  if (records.length === 0) {
    return [];
  }

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

const defaultMobyLightSelector = 0;
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
  directionalLightBinding: ShrubDirectionalLightBinding | null,
  options: ShrubRenderOptions,
  displayOptions: ModelDisplayNodeOptions
): THREE.Material | THREE.Material[] {
  return Array.isArray(primitive.material)
    ? primitive.material.map((item) => createMobyMaterial(item, primitive.geometry, directionalLightBinding, options, displayOptions))
    : createMobyMaterial(primitive.material, primitive.geometry, directionalLightBinding, options, displayOptions);
}

function createMobyMaterial(
  source: THREE.Material,
  geometry: THREE.BufferGeometry,
  directionalLightBinding: ShrubDirectionalLightBinding | null,
  options: ShrubRenderOptions,
  displayOptions: ModelDisplayNodeOptions
): THREE.Material {
  const sourceMaterial = source as Partial<THREE.MeshStandardMaterial>;
  const modelMaterialInfo = resolveModelMaterialInfo(source, 'moby');
  const map = sourceMaterial.map ?? sourceMaterial.emissiveMap ?? null;
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
    side: source.side,
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
    material.map.colorSpace = THREE.SRGBColorSpace;
  }

  if (material.alphaMap) {
    material.alphaMap.colorSpace = THREE.SRGBColorSpace;
  }

  configureModelMaterialTransparency(material, modelMaterialInfo);
  material.colorNode = createMobyColorNode(
    material,
    geometry.hasAttribute('color'),
    directionalLightBinding,
    uniforms,
    options,
    displayOptions);
  material.opacityNode = createModelOpacityNode(material, modelMaterialInfo);
  return material;
}

function createMobyColorNode(
  material: THREE.MeshBasicNodeMaterial,
  hasVertexColors: boolean,
  directionalLightBinding: ShrubDirectionalLightBinding | null,
  uniforms: ShrubLightingUniforms,
  options: ShrubRenderOptions,
  displayOptions: ModelDisplayNodeOptions
) {
  const materialColorNode = vec3(material.color.r, material.color.g, material.color.b);
  const textureColorNode = material.map
    ? texture(material.map, uv()).rgb.mul(materialColorNode)
    : materialColorNode;
  const baseColorNode = hasVertexColors
    ? textureColorNode.mul(vertexColor().rgb)
    : textureColorNode;
  const ambientTermNode = vec3(mobyAmbientScale, mobyAmbientScale, mobyAmbientScale)
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
      .mul(float(0.5))
    : vec3(0, 0, 0);
  const litColorNode = applyModelDisplayModulateNode(
    baseColorNode,
    ambientTermNode.add(directionalTermNode).clamp(0, 1)
  ).saturate();
  const exposureNode = displayOptions.dynamic ? uniforms.exposureScale : float(Math.max(0, options.exposure));
  return applyShrubFogNode(
    applyShrubDisplayLiftNode(litColorNode.mul(exposureNode).saturate(), displayOptions),
    displayOptions
  );
}

function createMobyLightSelectorInstanceAttribute(records: PreparedMobyRecord[]): THREE.InstancedBufferAttribute {
  const selectors = new Float32Array(records.length);
  selectors.fill(defaultMobyLightSelector);

  return new THREE.InstancedBufferAttribute(selectors, 1);
}

function finiteNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && Math.abs(value) > 1e-8 ? value : fallback;
}
