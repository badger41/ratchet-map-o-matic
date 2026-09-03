import * as THREE from 'three/webgpu';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { attribute, float, texture, uv, vec3, vertexStage } from 'three/tsl';
import type { DirectionalLightRecord, TfragStats, Vec4 } from '../../../services/mapPackages/mapPackageTypes';
import type { Rc1PointLightRecord } from '../../../services/mapPackages/rc1/Rc1PointLights.ts';
import {
  applyModelDisplayTextureModulateNode,
  applyTfragFogNode,
  configureModelDisplayTexture,
  type ModelDisplayNodeOptions
} from './ModelFog';
import type { SceneCameraStart } from './camera/SceneCameraFraming';
import {
  canRemapTfragAtlasUvs,
  createTfragAtlas,
  remapTfragAtlasUv,
  type TfragAtlas,
  type TfragAtlasRegion
} from './TfragAtlas';
import {
  decodeTfragRgb5Color,
  evaluatePs2DirectionalLight,
  resolveTfragAlphaState,
  scaleTfragVertexColor
} from './TfragMaterialState';
import {
  aboveWaterRenderOrder,
  belowWaterRenderOrder,
  createWaterSurfaceMaterialPasses
} from './WaterSurfacePass';
import {
  evaluateRc1PointLighting,
  prepareRc1PointLights,
  type PreparedRc1PointLight
} from './rc1/Rc1Lighting.ts';

type AnyAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
type TypedArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint8ClampedArray
  | Uint16Array
  | Uint32Array;

type GeometryWithAttributes = THREE.BufferGeometry & {
  attributes: Record<string, AnyAttribute | undefined>;
};

type PositionAttribute = Pick<THREE.BufferAttribute | THREE.InterleavedBufferAttribute, 'count' | 'getX' | 'getY' | 'getZ'>;

interface PreparedTfrag {
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  belowWaterMesh: THREE.Mesh | null;
  sourcePrimitives: number;
}

interface TfragGeometryBatch {
  target: THREE.Object3D;
  material: THREE.Material;
  geometries: THREE.BufferGeometry[];
  sourcePrimitives: number;
}

interface BakeContext {
  directionalLights: PreparedDirectionalLightRecord[];
  rc1PointLights: PreparedRc1PointLight[];
}

interface PreparedDirectionalLightRecord {
  topColor: Vec4;
  topDirection: [number, number, number];
  inverseColor: Vec4;
  inverseDirection: [number, number, number];
}

const selectorAttributeNames = [
  'modelLightSelector',
  'dlLightSelector',
  '_DL_LIGHT_SELECTOR',
  '_dl_light_selector',
  '_tfrag_light_selector',
  '_TFRAG_LIGHT_SELECTOR'
];

const baseColorAttributeNames = [
  'modelLightBaseColor',
  'dlLightBaseColor',
  '_DL_LIGHT_BASE_COLOR',
  '_dl_light_base_color',
  '_tfrag_light_base_color',
  '_TFRAG_LIGHT_BASE_COLOR'
];

const lightNormalAttributeNames = [
  'modelLightNormal',
  'dlLightNormal',
  '_DL_LIGHT_NORMAL',
  '_dl_light_normal',
  '_tfrag_light_normal',
  '_TFRAG_LIGHT_NORMAL'
];

const postScaleAttributeNames = [
  'modelLightPostScale',
  'dlLightPostScale',
  '_DL_LIGHT_POST_SCALE',
  '_dl_light_post_scale',
  '_tfrag_light_post_scale',
  '_TFRAG_LIGHT_POST_SCALE'
];

const sourceCacheColorUserDataKey = 'mapOMaticSourceTfragCacheColor';
const tfragTextureSourceKeyUserDataKey = 'mapOMaticTfragTextureSourceKey';
const ps2VertexColorMax = 255 / 128;

interface GltfTextureJson {
  source?: unknown;
}

interface GltfImageJson {
  uri?: unknown;
}

interface GltfParserJson {
  textures?: GltfTextureJson[];
  images?: GltfImageJson[];
}

export function tagTfragTextureSourceKeys(gltf: GLTF, gltfUrl: string): void {
  const json = gltf.parser.json as GltfParserJson | undefined;
  const textures = json?.textures;
  const images = json?.images;
  if (!Array.isArray(textures) || !Array.isArray(images)) {
    return;
  }

  for (const [object, reference] of gltf.parser.associations) {
    if (!isTexture(object)) {
      continue;
    }

    const textureIndex = numberValue(reference.textures);
    if (textureIndex === null || !Number.isInteger(textureIndex)) {
      continue;
    }

    const imageIndex = numberValue(textures[textureIndex]?.source);
    const uri = imageIndex === null ? null : stringValue(images[imageIndex]?.uri);
    if (!uri || uri.startsWith('data:')) {
      continue;
    }

    const sourceKey = resolveTfragTextureSourceKey(uri, gltfUrl);
    if (sourceKey) {
      object.userData[tfragTextureSourceKeyUserDataKey] = sourceKey;
    }
  }
}

export class TfragMaterialController {
  private prepared: PreparedTfrag[] = [];
  private materialRebakes = 0;
  private startupCameraStart: SceneCameraStart | null = null;
  private atlasTexture: THREE.Texture | null = null;

  prepare(
    root: THREE.Object3D,
    directionalLights: DirectionalLightRecord[],
    displayOptions: ModelDisplayNodeOptions,
    rc1PointLights: Rc1PointLightRecord[] = []
  ): TfragStats {
    pruneToLod0(root);
    this.dispose();
    this.prepared = [];

    root.updateWorldMatrix(true, true);
    const atlas = createTfragAtlas(root);
    this.atlasTexture = atlas?.texture ?? null;
    const bakeContext = createTfragBakeContext(directionalLights, rc1PointLights);
    const batches = new Map<string, TfragGeometryBatch>();
    const materialCache = new Map<string, THREE.Material>();
    const sourceMeshes: THREE.Mesh[] = [];

    root.traverse((object) => {
      if (!isMesh(object)) {
        return;
      }

      const mesh = object as THREE.Mesh;
      sourceMeshes.push(mesh);
      mesh.updateWorldMatrix(true, false);
      this.captureStartupCameraStart(mesh);

      const sourceMaterial = mesh.material ?? null;
      const atlasRegion = resolveTfragAtlasRegion(mesh.geometry, sourceMaterial, atlas);
      const materialKey = materialBatchKey(sourceMaterial, atlasRegion !== null);
      let material = materialCache.get(materialKey);
      if (!material) {
        material = createTfragDisplayMaterial(
          sourceMaterial,
          displayOptions,
          atlasRegion ? atlas!.texture : null
        );
        materialCache.set(materialKey, material);
      }

      const clonedGeometry = mesh.geometry.clone();
      bakeTfragGeometryColors(clonedGeometry, bakeContext, mesh.matrixWorld);
      const batchTarget = getTfragBatchTarget(root, mesh);
      const targetWorldInverse = new THREE.Matrix4().copy(batchTarget.matrixWorld).invert();
      const localToTarget = new THREE.Matrix4().multiplyMatrices(targetWorldInverse, mesh.matrixWorld);
      if (!isIdentityMatrix(localToTarget)) {
        clonedGeometry.applyMatrix4(localToTarget);
      }

      const geometry = clonedGeometry.index ? clonedGeometry.toNonIndexed() : clonedGeometry;
      if (geometry !== clonedGeometry) {
        clonedGeometry.dispose();
      }
      if (atlasRegion) {
        applyTfragAtlasUvs(geometry, atlasRegion);
      }

      const batchKey = `${batchTarget.uuid}:${materialKey}`;
      let batch = batches.get(batchKey);
      if (!batch) {
        batch = {
          target: batchTarget,
          material,
          geometries: [],
          sourcePrimitives: 0
        };
        batches.set(batchKey, batch);
      }

      batch.geometries.push(geometry);
      batch.sourcePrimitives += 1;
    });

    for (const mesh of sourceMeshes) {
      mesh.parent?.remove(mesh);
      mesh.geometry.dispose();
      disposeMaterial(mesh.material);
    }

    let mergedIndex = 0;
    for (const batch of batches.values()) {
      const mergedGeometry = batch.geometries.length === 1
        ? batch.geometries[0]
        : mergeTfragGeometries(batch.geometries);

      if (!mergedGeometry) {
        for (const geometry of batch.geometries) {
          const mesh = createMergedTfragMesh(geometry, batch.material, mergedIndex);
          batch.target.add(...mesh.objects);
          this.prepared.push({
            geometry,
            mesh: mesh.above,
            belowWaterMesh: mesh.below,
            sourcePrimitives: 1
          });
          mergedIndex += 1;
        }
        continue;
      }

      for (const geometry of batch.geometries) {
        if (geometry !== mergedGeometry) {
          geometry.dispose();
        }
      }

      const mesh = createMergedTfragMesh(mergedGeometry, batch.material, mergedIndex);
      batch.target.add(...mesh.objects);
      this.prepared.push({
        geometry: mergedGeometry,
        mesh: mesh.above,
        belowWaterMesh: mesh.below,
        sourcePrimitives: batch.sourcePrimitives
      });
      mergedIndex += 1;
    }

    this.materialRebakes += this.prepared.length > 0 ? 1 : 0;
    return this.getStats(directionalLights.length);
  }

  dispose(): void {
    const disposedMaterials = new Set<THREE.Material>();
    for (const prepared of this.prepared) {
      prepared.geometry.dispose();
      disposeMaterial(prepared.mesh.material, disposedMaterials);
      if (prepared.belowWaterMesh) {
        disposeMaterial(prepared.belowWaterMesh.material, disposedMaterials);
      }
    }

    this.prepared = [];
    this.startupCameraStart = null;
    this.atlasTexture?.dispose();
    this.atlasTexture = null;
  }

  getStats(directionalLightRecords: number): TfragStats {
    let triangles = 0;
    let sourcePrimitives = 0;

    for (const prepared of this.prepared) {
      triangles += estimateTriangleCount(prepared.geometry);
      sourcePrimitives += prepared.sourcePrimitives;
    }

    return {
      meshes: this.prepared.length,
      sourcePrimitives,
      triangles,
      lod0Triangles: triangles || null,
      directionalLightRecords,
      materialRebakes: this.materialRebakes
    };
  }

  getStartupCameraStart(): SceneCameraStart | null {
    const start = this.startupCameraStart;
    if (!start) {
      return null;
    }

    return {
      anchor: start.anchor.clone(),
      lookAt: start.lookAt?.clone() ?? null
    };
  }

  private captureStartupCameraStart(mesh: THREE.Mesh): void {
    if (this.startupCameraStart?.lookAt) {
      return;
    }

    const anchor = this.startupCameraStart?.anchor ?? readGeometryPosition(mesh.geometry, 0, mesh.matrixWorld);
    if (!anchor) {
      return;
    }

    const lookAt = findDistinctGeometryPosition(mesh.geometry, mesh.matrixWorld, anchor);
    this.startupCameraStart = {
      anchor,
      lookAt: lookAt ?? this.startupCameraStart?.lookAt ?? null
    };
  }
}

function createMergedTfragMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  index: number
): { above: THREE.Mesh; below: THREE.Mesh | null; objects: THREE.Mesh[] } {
  if (!geometry.boundingSphere) {
    geometry.computeBoundingSphere();
  }
  const name = `tfrag_lod0_merged_${index.toString().padStart(3, '0')}`;
  const passes = createWaterSurfaceMaterialPasses(material);
  const above = new THREE.Mesh(geometry, passes?.above ?? material);
  above.name = name;
  if (!passes) {
    return { above, below: null, objects: [above] };
  }

  above.renderOrder = aboveWaterRenderOrder;
  const below = new THREE.Mesh(geometry, passes.below);
  below.name = `${name}_below_water`;
  below.renderOrder = belowWaterRenderOrder;
  return { above, below, objects: [below, above] };
}

function getTfragBatchTarget(root: THREE.Object3D, object: THREE.Object3D): THREE.Object3D {
  let current = object;
  let parent = current.parent;
  while (parent && parent !== root) {
    current = parent;
    parent = current.parent;
  }

  return parent === root && current !== object ? current : root;
}

function pruneToLod0(root: THREE.Object3D): void {
  const removeQueue: THREE.Object3D[] = [];

  root.traverse((object) => {
    if (object === root) {
      return;
    }

    const lodIndex = getObjectLodIndex(object);
    if (lodIndex !== null && lodIndex !== 0) {
      removeQueue.push(object);
    }
  });

  const removalSet = new Set(removeQueue);
  for (const object of removeQueue) {
    if (!object.parent || removalSet.has(object.parent)) {
      continue;
    }

    object.parent?.remove(object);
  }
}

function bakeTfragGeometryColors(
  geometry: THREE.BufferGeometry,
  context: BakeContext,
  matrixWorld: THREE.Matrix4
): void {
  const geometryAttributes = geometry as GeometryWithAttributes;
  const positions = geometry.getAttribute('position');
  const cacheColor = getSourceTfragCacheColor(geometry);
  const selector = findAttribute(geometryAttributes, selectorAttributeNames);
  const baseColor = findAttribute(geometryAttributes, baseColorAttributeNames);
  const lightNormal = findAttribute(geometryAttributes, lightNormalAttributeNames) ?? geometry.getAttribute('normal');
  const postScale = findAttribute(geometryAttributes, postScaleAttributeNames);
  const vertexCount = positions?.count ?? cacheColor?.count ?? baseColor?.count ?? 0;
  const colorAttribute = getWritableColorAttribute(geometry, vertexCount);
  const colors = colorAttribute.array as Float32Array;
  const pointPosition = new THREE.Vector3();
  const pointNormal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld);

  for (let index = 0; index < vertexCount; index += 1) {
    const fallbackColor = readColor(cacheColor, index, [1, 1, 1]);
    const base = readColor(baseColor, index, fallbackColor);
    const normal = normalizeVec3(readVec3(lightNormal, index, [0, 1, 0]));
    pointPosition.set(
      Number(positions?.getX(index) ?? 0),
      Number(positions?.getY(index) ?? 0),
      Number(positions?.getZ(index) ?? 0)
    ).applyMatrix4(matrixWorld);
    pointNormal.set(...normal).applyNormalMatrix(normalMatrix).normalize();
    const selectorValue = Math.floor(Math.max(readScalar(selector, index, 15), 0) + 0.5);
    const postScaleValue = readScalar(postScale, index, 1);
    const color = computeTfragColor({
      base,
      fallbackColor,
      normal,
      worldPosition: [pointPosition.x, pointPosition.y, pointPosition.z],
      worldNormal: [pointNormal.x, pointNormal.y, pointNormal.z],
      selectorValue,
      postScaleValue,
      context
    });

    colors[index * 3] = color[0];
    colors[index * 3 + 1] = color[1];
    colors[index * 3 + 2] = color[2];
  }

  if (geometry.getAttribute('color') !== colorAttribute) {
    geometry.setAttribute('color', colorAttribute);
  }
  colorAttribute.needsUpdate = true;
}

function getSourceTfragCacheColor(geometry: THREE.BufferGeometry): THREE.BufferAttribute | null {
  const existing = geometry.userData[sourceCacheColorUserDataKey];
  if (isBufferAttribute(existing)) {
    return existing;
  }

  const color = geometry.getAttribute('color');
  if (!color) {
    return null;
  }

  const sourceColor = cloneAttributeToFloat(color);
  geometry.userData[sourceCacheColorUserDataKey] = sourceColor;
  return sourceColor;
}

function computeTfragColor(input: {
  base: [number, number, number];
  fallbackColor: [number, number, number];
  normal: [number, number, number];
  worldPosition: [number, number, number];
  worldNormal: [number, number, number];
  selectorValue: number;
  postScaleValue: number;
  context: BakeContext;
}): [number, number, number] {
  const { base, fallbackColor, normal, worldPosition, worldNormal, selectorValue, postScaleValue, context } = input;

  const lightContribution = evaluateSelectedLights(selectorValue, normal, context.directionalLights);
  const pointContribution = evaluateRc1PointLighting(worldPosition, worldNormal, context.rc1PointLights);
  if (!lightContribution.valid) {
    return applyOutputScale([
      clampPs2VertexColor(fallbackColor[0] + pointContribution[0]),
      clampPs2VertexColor(fallbackColor[1] + pointContribution[1]),
      clampPs2VertexColor(fallbackColor[2] + pointContribution[2])
    ], postScaleValue);
  }

  const decodedBase = decodeTfragRgb5Color(base);
  const lit: [number, number, number] = [
    clampPs2VertexColor(decodedBase[0] + lightContribution.color[0] + pointContribution[0]),
    clampPs2VertexColor(decodedBase[1] + lightContribution.color[1] + pointContribution[1]),
    clampPs2VertexColor(decodedBase[2] + lightContribution.color[2] + pointContribution[2])
  ];
  return applyOutputScale(lit, postScaleValue);
}

function evaluateSelectedLights(
  selectorValue: number,
  normal: [number, number, number],
  directionalLights: PreparedDirectionalLightRecord[]
): { valid: false; color: [number, number, number] } | { valid: true; color: [number, number, number] } {
  const primarySlot = selectorValue & 0x0f;
  const primary = directionalLights[primarySlot];

  if (!primary) {
    return { valid: false, color: [0, 0, 0] };
  }

  const blendByte = (selectorValue >> 8) & 0xff;
  if (blendByte <= 0) {
    return { valid: true, color: evaluateLightRecord(primary, normal) };
  }

  const blendSlot = (selectorValue >> 4) & 0x0f;
  const blend = directionalLights[blendSlot];
  if (!blend) {
    return { valid: true, color: evaluateLightRecord(primary, normal) };
  }

  const t = blendByte / 256;
  return { valid: true, color: evaluateBlendedLightRecord(primary, blend, t, normal) };
}

function evaluateLightRecord(record: PreparedDirectionalLightRecord, normal: [number, number, number]): [number, number, number] {
  return evaluatePs2DirectionalLight(record.topColor, record.topDirection, record.inverseColor, record.inverseDirection, normal);
}

function evaluateBlendedLightRecord(
  primary: PreparedDirectionalLightRecord,
  secondary: PreparedDirectionalLightRecord,
  amount: number,
  normal: [number, number, number]
): [number, number, number] {
  const t = clamp01(amount);
  const topColor = mixVec4(primary.topColor, secondary.topColor, t);
  const inverseColor = mixVec4(primary.inverseColor, secondary.inverseColor, t);
  const topDirection = mixVec3(primary.topDirection, secondary.topDirection, t);
  const inverseDirection = mixVec3(primary.inverseDirection, secondary.inverseDirection, t);

  return evaluatePs2DirectionalLight(topColor, topDirection, inverseColor, inverseDirection, normal);
}

function createTfragDisplayMaterial(
  sourceMaterial: THREE.Material | THREE.Material[] | null,
  displayOptions: ModelDisplayNodeOptions,
  atlasTexture: THREE.Texture | null = null
): THREE.Material {
  const firstMaterial = Array.isArray(sourceMaterial) ? sourceMaterial[0] : sourceMaterial;
  const source = firstMaterial as Partial<THREE.MeshBasicMaterial> | null;
  const material = new THREE.MeshBasicNodeMaterial({
    name: `${firstMaterial?.name ?? 'tfrag'}_vertex_lit`,
    map: atlasTexture ?? source?.map ?? null,
    transparent: firstMaterial?.transparent ?? false,
    opacity: firstMaterial?.opacity ?? 1,
    alphaTest: firstMaterial?.alphaTest ?? 0,
    depthTest: firstMaterial?.depthTest ?? true,
    depthWrite: firstMaterial?.depthWrite ?? true,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  material.forceSinglePass = true;
  const lightTerm = vertexStage(attribute<'vec3'>('color', 'vec3')).setInterpolation('linear');

  const map = material.map;
  if (map) {
    configureModelDisplayTexture(map);
    const mapSample = texture(map, uv());
    material.colorNode = applyTfragFogNode(
      applyModelDisplayTextureModulateNode(mapSample.rgb, lightTerm),
      displayOptions
    );

    const alphaState = resolveTfragAlphaState(
      material.transparent,
      material.opacity,
      material.alphaTest,
      material.depthWrite
    );
    if (alphaState) {
      material.opacityNode = mapSample.a
        .mul(float(alphaState.opacityScale))
        .clamp(0, 1);
      material.depthWrite = alphaState.depthWrite;
      material.alphaTest = alphaState.alphaTest;
    }
  } else {
    material.colorNode = applyTfragFogNode(
      applyModelDisplayTextureModulateNode(vec3(1, 1, 1), lightTerm),
      displayOptions
    );
  }

  return material;
}

function resolveTfragAtlasRegion(
  geometry: THREE.BufferGeometry,
  sourceMaterial: THREE.Material | THREE.Material[] | null,
  atlas: TfragAtlas | null
): TfragAtlasRegion | null {
  const uv = geometry.getAttribute('uv');
  if (!atlas || !uv || !canRemapTfragAtlasUvs(uv)) {
    return null;
  }

  const firstMaterial = Array.isArray(sourceMaterial) ? sourceMaterial[0] : sourceMaterial;
  if (!firstMaterial || firstMaterial.transparent || firstMaterial.opacity !== 1 || firstMaterial.alphaTest !== 0) {
    return null;
  }
  const map = (firstMaterial as Partial<THREE.MeshBasicMaterial> | null)?.map ?? null;
  return map ? atlas.regionsByTexture.get(map.uuid) ?? null : null;
}

function applyTfragAtlasUvs(
  geometry: THREE.BufferGeometry,
  region: TfragAtlasRegion
): void {
  const sourceUv = geometry.getAttribute('uv');
  if (!sourceUv) {
    return;
  }

  const atlasUv = new Float32Array(sourceUv.count * 2);
  for (let index = 0; index < sourceUv.count; index += 1) {
    atlasUv[index * 2] = remapTfragAtlasUv(sourceUv.getX(index), region.offsetX, region.scaleX);
    atlasUv[index * 2 + 1] = remapTfragAtlasUv(sourceUv.getY(index), region.offsetY, region.scaleY);
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(atlasUv, 2));
}

function materialBatchKey(
  sourceMaterial: THREE.Material | THREE.Material[] | null,
  usesAtlas = false
): string {
  const firstMaterial = Array.isArray(sourceMaterial) ? sourceMaterial[0] : sourceMaterial;
  if (!firstMaterial) {
    return 'null-material';
  }

  const source = firstMaterial as Partial<THREE.MeshBasicMaterial>;
  return [
    'material',
    usesAtlas ? 'tfrag-atlas' : textureBatchKey(source.map ?? null),
    firstMaterial.transparent ? 'transparent' : 'opaque',
    firstMaterial.opacity.toString(),
    firstMaterial.alphaTest.toString(),
    firstMaterial.depthTest ? 'depth-test' : 'no-depth-test',
    firstMaterial.depthWrite ? 'depth-write' : 'no-depth-write'
  ].join('|');
}

function textureBatchKey(source: THREE.Texture | null): string {
  if (!source) {
    return 'no-map';
  }

  const sourceKey = source.userData?.[tfragTextureSourceKeyUserDataKey];
  if (typeof sourceKey !== 'string' || !sourceKey) {
    return `texture:${source.uuid}`;
  }

  return [
    `source:${sourceKey}`,
    source.wrapS.toString(),
    source.wrapT.toString(),
    source.magFilter.toString(),
    source.minFilter.toString()
  ].join('|');
}

function isTexture(value: unknown): value is THREE.Texture {
  return (value as THREE.Texture | null)?.isTexture === true;
}

function resolveTfragTextureSourceKey(uri: string, gltfUrl: string): string | null {
  try {
    if (uri.startsWith('/') || hasUrlScheme(uri)) {
      return new URL(uri, window.location.href).toString();
    }

    const gltfAbsoluteUrl = new URL(gltfUrl, window.location.href);
    if (gltfAbsoluteUrl.protocol === 'blob:') {
      return null;
    }

    return new URL(uri, new URL('.', gltfAbsoluteUrl)).toString();
  } catch {
    return null;
  }
}

function hasUrlScheme(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(value);
}

function isIdentityMatrix(matrix: THREE.Matrix4): boolean {
  const elements = matrix.elements;
  return (
    elements[0] === 1 &&
    elements[1] === 0 &&
    elements[2] === 0 &&
    elements[3] === 0 &&
    elements[4] === 0 &&
    elements[5] === 1 &&
    elements[6] === 0 &&
    elements[7] === 0 &&
    elements[8] === 0 &&
    elements[9] === 0 &&
    elements[10] === 1 &&
    elements[11] === 0 &&
    elements[12] === 0 &&
    elements[13] === 0 &&
    elements[14] === 0 &&
    elements[15] === 1
  );
}

function findDistinctGeometryPosition(
  geometry: THREE.BufferGeometry,
  matrixWorld: THREE.Matrix4,
  anchor: THREE.Vector3
): THREE.Vector3 | null {
  const position = getPositionAttribute(geometry);
  if (!position) {
    return null;
  }

  const candidateCount = Math.min(3, geometry.getIndex()?.count ?? position.count);
  for (let vertexIndex = 0; vertexIndex < candidateCount; vertexIndex += 1) {
    const point = readGeometryPosition(geometry, vertexIndex, matrixWorld);
    if (point && point.distanceToSquared(anchor) > 1) {
      return point;
    }
  }

  return null;
}

function readGeometryPosition(
  geometry: THREE.BufferGeometry,
  vertexIndex: number,
  matrixWorld: THREE.Matrix4
): THREE.Vector3 | null {
  const position = getPositionAttribute(geometry);
  if (!position) {
    return null;
  }

  const index = geometry.getIndex();
  if (index && vertexIndex >= index.count) {
    return null;
  }

  const positionIndex = index ? Math.trunc(index.getX(vertexIndex)) : vertexIndex;
  if (positionIndex < 0 || positionIndex >= position.count) {
    return null;
  }

  const point = new THREE.Vector3(
    position.getX(positionIndex),
    position.getY(positionIndex),
    position.getZ(positionIndex)
  ).applyMatrix4(matrixWorld);

  return isFiniteVector(point) ? point : null;
}

function getPositionAttribute(geometry: THREE.BufferGeometry): PositionAttribute | null {
  const position = geometry.getAttribute('position') as PositionAttribute | undefined;
  return position && position.count > 0 ? position : null;
}

function isFiniteVector(value: THREE.Vector3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function mergeTfragGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geometries.length === 0) {
    return null;
  }

  const firstGeometry = geometries[0];
  const firstAttributes = getBufferAttributes(firstGeometry);
  if (firstGeometry.index || firstAttributes.length === 0) {
    return null;
  }

  const attributeNames = firstAttributes.map(([name]) => name).sort();
  const specs = new Map<string, { itemSize: number; normalized: boolean; arrayCtor: TypedArray['constructor'] }>();

  for (const name of attributeNames) {
    const attribute = firstGeometry.getAttribute(name);
    if (!isBufferAttribute(attribute)) {
      return null;
    }

    specs.set(name, {
      itemSize: attribute.itemSize,
      normalized: attribute.normalized,
      arrayCtor: attribute.array.constructor
    });
  }

  const totalCounts = new Map<string, number>();
  for (const geometry of geometries) {
    if (geometry.index || !sameAttributeNames(attributeNames, geometry)) {
      return null;
    }

    for (const name of attributeNames) {
      const spec = specs.get(name);
      const attribute = geometry.getAttribute(name);
      if (!spec || !isBufferAttribute(attribute) || !sameAttributeSpec(spec, attribute)) {
        return null;
      }

      totalCounts.set(name, (totalCounts.get(name) ?? 0) + attribute.count);
    }
  }

  const mergedGeometry = new THREE.BufferGeometry();
  for (const name of attributeNames) {
    const spec = specs.get(name);
    const totalCount = totalCounts.get(name);
    if (!spec || !totalCount) {
      return null;
    }

    const mergedArray = createTypedArray(spec.arrayCtor, totalCount * spec.itemSize);
    let offset = 0;
    for (const geometry of geometries) {
      const attribute = geometry.getAttribute(name);
      if (!isBufferAttribute(attribute)) {
        return null;
      }

      mergedArray.set(attribute.array as TypedArray, offset);
      offset += attribute.array.length;
    }

    mergedGeometry.setAttribute(name, new THREE.BufferAttribute(mergedArray, spec.itemSize, spec.normalized));
  }

  mergedGeometry.computeBoundingSphere();
  return mergedGeometry;
}

function getBufferAttributes(geometry: THREE.BufferGeometry): Array<[string, THREE.BufferAttribute]> {
  return Object.entries((geometry as GeometryWithAttributes).attributes).filter(
    (entry): entry is [string, THREE.BufferAttribute] => isBufferAttribute(entry[1])
  );
}

function sameAttributeNames(names: string[], geometry: THREE.BufferGeometry): boolean {
  const geometryNames = getBufferAttributes(geometry).map(([name]) => name).sort();
  return names.length === geometryNames.length && names.every((name, index) => name === geometryNames[index]);
}

function sameAttributeSpec(
  spec: { itemSize: number; normalized: boolean; arrayCtor: TypedArray['constructor'] },
  attribute: THREE.BufferAttribute
): boolean {
  return (
    spec.itemSize === attribute.itemSize &&
    spec.normalized === attribute.normalized &&
    spec.arrayCtor === attribute.array.constructor
  );
}

function createTypedArray(arrayCtor: TypedArray['constructor'], length: number): TypedArray {
  return new (arrayCtor as new (length: number) => TypedArray)(length);
}

function isBufferAttribute(attribute: unknown): attribute is THREE.BufferAttribute {
  return (attribute as THREE.BufferAttribute | undefined)?.isBufferAttribute === true;
}

function getObjectLodIndex(object: THREE.Object3D): number | null {
  const extras = object.userData ?? {};
  const nestedExtras = (extras.extras as Record<string, unknown> | undefined) ?? {};
  const value = extras.LodIndex ?? extras.lodIndex ?? extras.lod ?? nestedExtras.LodIndex ?? null;

  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }

  const nameMatch = object.name.match(/(?:^|_)lod_(\d+)(?:_|$)/i);
  return nameMatch ? Number.parseInt(nameMatch[1], 10) : null;
}

function findAttribute(geometry: GeometryWithAttributes, names: string[]): AnyAttribute | null {
  for (const name of names) {
    const attribute = geometry.attributes[name];
    if (attribute) {
      return attribute;
    }
  }

  return null;
}

function readColor(attribute: AnyAttribute | undefined | null, index: number, fallback: [number, number, number]): [number, number, number] {
  if (!attribute) {
    return fallback;
  }

  return [
    readComponent(attribute, index, 0, fallback[0]),
    readComponent(attribute, index, 1, fallback[1]),
    readComponent(attribute, index, 2, fallback[2])
  ];
}

function readVec3(attribute: AnyAttribute | undefined | null, index: number, fallback: [number, number, number]): [number, number, number] {
  if (!attribute) {
    return fallback;
  }

  return [
    readComponent(attribute, index, 0, fallback[0]),
    readComponent(attribute, index, 1, fallback[1]),
    readComponent(attribute, index, 2, fallback[2])
  ];
}

function readScalar(attribute: AnyAttribute | undefined | null, index: number, fallback: number): number {
  if (!attribute) {
    return fallback;
  }

  return readComponent(attribute, index, 0, fallback);
}

function readComponent(attribute: AnyAttribute, index: number, component: number, fallback: number): number {
  if (component >= attribute.itemSize) {
    return fallback;
  }

  return attribute.getComponent(index, component);
}

function cloneAttributeToFloat(attribute: AnyAttribute): THREE.BufferAttribute {
  const array = new Float32Array(attribute.count * attribute.itemSize);
  for (let index = 0; index < attribute.count; index += 1) {
    for (let component = 0; component < attribute.itemSize; component += 1) {
      array[index * attribute.itemSize + component] = readComponent(attribute, index, component, 1);
    }
  }

  return new THREE.BufferAttribute(array, attribute.itemSize, false);
}

function getWritableColorAttribute(geometry: THREE.BufferGeometry, vertexCount: number): THREE.BufferAttribute {
  const existing = geometry.getAttribute('color');
  if (
    isBufferAttribute(existing) &&
    existing.itemSize === 3 &&
    existing.count === vertexCount &&
    existing.array instanceof Float32Array &&
    !existing.normalized
  ) {
    return existing;
  }

  return new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
}

function createTfragBakeContext(
  directionalLights: DirectionalLightRecord[],
  rc1PointLights: Rc1PointLightRecord[]
): BakeContext {
  return {
    directionalLights: directionalLights.map(prepareDirectionalLightRecord),
    rc1PointLights: prepareRc1PointLights(rc1PointLights)
  };
}

function prepareDirectionalLightRecord(record: DirectionalLightRecord): PreparedDirectionalLightRecord {
  return {
    topColor: record.topColor,
    topDirection: gameDirectionToGltf(record.topDirection),
    inverseColor: record.inverseColor,
    inverseDirection: gameDirectionToGltf(record.inverseDirection)
  };
}

function applyOutputScale(color: [number, number, number], postScale: number): [number, number, number] {
  return scaleTfragVertexColor(color, postScale);
}

function gameDirectionToGltf(direction: Vec4): [number, number, number] {
  return [direction[0], direction[2], -direction[1]];
}

function mixVec3(a: [number, number, number], b: [number, number, number], amount: number): [number, number, number] {
  return [
    a[0] * (1 - amount) + b[0] * amount,
    a[1] * (1 - amount) + b[1] * amount,
    a[2] * (1 - amount) + b[2] * amount
  ];
}

function mixVec4(a: Vec4, b: Vec4, amount: number): Vec4 {
  return [
    a[0] * (1 - amount) + b[0] * amount,
    a[1] * (1 - amount) + b[1] * amount,
    a[2] * (1 - amount) + b[2] * amount,
    a[3] * (1 - amount) + b[3] * amount
  ];
}

function normalizeVec3(value: [number, number, number]): [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= 0.000001) {
    return [0, 1, 0];
  }

  return [value[0] / length, value[1] / length, value[2] / length];
}

function clampPs2VertexColor(value: number): number {
  return Math.min(ps2VertexColorMax, Math.max(0, value));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function estimateTriangleCount(geometry: THREE.BufferGeometry): number {
  if (geometry.index) {
    return Math.floor(geometry.index.count / 3);
  }

  const position = geometry.getAttribute('position');
  return position ? Math.floor(position.count / 3) : 0;
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

function disposeMaterial(material: THREE.Material | THREE.Material[], disposedMaterials?: Set<THREE.Material>): void {
  if (Array.isArray(material)) {
    for (const item of material) {
      disposeMaterial(item, disposedMaterials);
    }
    return;
  }

  if (disposedMaterials?.has(material)) {
    return;
  }

  disposedMaterials?.add(material);
  material.dispose();
}
