import * as THREE from 'three/webgpu';
import { texture, uv, vertexColor } from 'three/tsl';
import type { DirectionalLightRecord, TfragMaterialOptions, TfragStats, Vec4 } from '../../../services/mapPackages/mapPackageTypes';

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

interface PreparedTfrag {
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  sourcePrimitives: number;
}

interface TfragGeometryBatch {
  material: THREE.Material;
  geometries: THREE.BufferGeometry[];
  sourcePrimitives: number;
}

interface BakeContext {
  directionalLights: DirectionalLightRecord[];
  options: TfragMaterialOptions;
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

export class TfragMaterialController {
  private prepared: PreparedTfrag[] = [];
  private materialRebakes = 0;

  prepare(root: THREE.Object3D, directionalLights: DirectionalLightRecord[], options: TfragMaterialOptions): TfragStats {
    pruneToLod0(root);
    this.dispose();
    this.prepared = [];

    root.updateWorldMatrix(true, true);
    const rootWorldInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
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

      const sourceMaterial = mesh.material ?? null;
      const materialKey = materialBatchKey(sourceMaterial);
      let material = materialCache.get(materialKey);
      if (!material) {
        material = createTfragDisplayMaterial(sourceMaterial);
        materialCache.set(materialKey, material);
      }

      const clonedGeometry = mesh.geometry.clone();
      const localToRoot = new THREE.Matrix4().multiplyMatrices(rootWorldInverse, mesh.matrixWorld);
      if (!isIdentityMatrix(localToRoot)) {
        clonedGeometry.applyMatrix4(localToRoot);
      }

      const geometry = clonedGeometry.index ? clonedGeometry.toNonIndexed() : clonedGeometry;
      if (geometry !== clonedGeometry) {
        clonedGeometry.dispose();
      }

      bakeTfragGeometryColors(geometry, { directionalLights, options });

      let batch = batches.get(materialKey);
      if (!batch) {
        batch = {
          material,
          geometries: [],
          sourcePrimitives: 0
        };
        batches.set(materialKey, batch);
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
          root.add(mesh);
          this.prepared.push({
            geometry,
            mesh,
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
      root.add(mesh);
      this.prepared.push({
        geometry: mergedGeometry,
        mesh,
        sourcePrimitives: batch.sourcePrimitives
      });
      mergedIndex += 1;
    }

    this.materialRebakes += this.prepared.length > 0 ? 1 : 0;
    return this.getStats(directionalLights.length);
  }

  update(directionalLights: DirectionalLightRecord[], options: TfragMaterialOptions): TfragStats {
    for (const prepared of this.prepared) {
      bakeTfragGeometryColors(prepared.geometry, { directionalLights, options });
    }

    this.materialRebakes += this.prepared.length > 0 ? 1 : 0;
    return this.getStats(directionalLights.length);
  }

  dispose(): void {
    for (const prepared of this.prepared) {
      prepared.geometry.dispose();
      disposeMaterial(prepared.mesh.material);
    }

    this.prepared = [];
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
}

function createMergedTfragMesh(geometry: THREE.BufferGeometry, material: THREE.Material, index: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `tfrag_lod0_merged_${index.toString().padStart(3, '0')}`;
  mesh.frustumCulled = false;
  return mesh;
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

function bakeTfragGeometryColors(geometry: THREE.BufferGeometry, context: BakeContext): void {
  const geometryAttributes = geometry as GeometryWithAttributes;
  const positions = geometry.getAttribute('position');
  const cacheColor = getSourceTfragCacheColor(geometry);
  const selector = findAttribute(geometryAttributes, selectorAttributeNames);
  const baseColor = findAttribute(geometryAttributes, baseColorAttributeNames);
  const lightNormal = findAttribute(geometryAttributes, lightNormalAttributeNames) ?? geometry.getAttribute('normal');
  const postScale = findAttribute(geometryAttributes, postScaleAttributeNames);
  const vertexCount = positions?.count ?? cacheColor?.count ?? baseColor?.count ?? 0;
  const colors = new Float32Array(vertexCount * 3);

  for (let index = 0; index < vertexCount; index += 1) {
    const fallbackColor = readColor(cacheColor, index, [1, 1, 1]);
    const base = readColor(baseColor, index, fallbackColor);
    const normal = normalizeVec3(readVec3(lightNormal, index, [0, 1, 0]));
    const selectorValue = Math.floor(Math.max(readScalar(selector, index, 15), 0) + 0.5);
    const postScaleValue = readScalar(postScale, index, 1);
    const color = computeDiagnosticColor({
      base,
      fallbackColor,
      normal,
      selectorValue,
      postScaleValue,
      context
    });

    colors[index * 3] = color[0];
    colors[index * 3 + 1] = color[1];
    colors[index * 3 + 2] = color[2];
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.getAttribute('color').needsUpdate = true;
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

function computeDiagnosticColor(input: {
  base: [number, number, number];
  fallbackColor: [number, number, number];
  normal: [number, number, number];
  selectorValue: number;
  postScaleValue: number;
  context: BakeContext;
}): [number, number, number] {
  const { base, fallbackColor, normal, selectorValue, postScaleValue, context } = input;
  const { diagnosticMode, lightIntensity, exposure, cacheMix, postScaleEnabled } = context.options;

  if (diagnosticMode === 'base') {
    return applyOutputScale(base, exposure, postScaleEnabled ? postScaleValue : 1);
  }

  if (diagnosticMode === 'cache') {
    return applyOutputScale(fallbackColor, exposure, postScaleEnabled ? postScaleValue : 1);
  }

  if (diagnosticMode === 'selector') {
    return selectorDebugColor(selectorValue);
  }

  const lightContribution = evaluateSelectedLights(selectorValue, normal, context.directionalLights);
  if (!lightContribution.valid) {
    return applyOutputScale(fallbackColor, exposure, postScaleEnabled ? postScaleValue : 1);
  }

  const directionalScale = lightIntensity / 2;
  const lit: [number, number, number] = [
    clamp01(base[0] + lightContribution.color[0] * directionalScale),
    clamp01(base[1] + lightContribution.color[1] * directionalScale),
    clamp01(base[2] + lightContribution.color[2] * directionalScale)
  ];
  const cacheAmount = clamp01(Number.isFinite(cacheMix) ? cacheMix : 0);
  const output = cacheAmount > 0 ? mixVec3(lit, fallbackColor, cacheAmount) : lit;

  return applyOutputScale(output, exposure, postScaleEnabled ? postScaleValue : 1);
}

function evaluateSelectedLights(
  selectorValue: number,
  normal: [number, number, number],
  directionalLights: DirectionalLightRecord[]
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

function evaluateLightRecord(record: DirectionalLightRecord, normal: [number, number, number]): [number, number, number] {
  const topDirection = normalizeVec3(gameDirectionToGltf(record.topDirection));
  const inverseDirection = normalizeVec3(gameDirectionToGltf(record.inverseDirection));
  return evaluatePreparedLightRecord(record.topColor, topDirection, record.inverseColor, inverseDirection, normal);
}

function evaluateBlendedLightRecord(
  primary: DirectionalLightRecord,
  secondary: DirectionalLightRecord,
  amount: number,
  normal: [number, number, number]
): [number, number, number] {
  const t = clamp01(amount);
  const topColor = mixVec4(primary.topColor, secondary.topColor, t);
  const inverseColor = mixVec4(primary.inverseColor, secondary.inverseColor, t);
  const topDirection = normalizeVec3(
    mixVec3(normalizeVec3(gameDirectionToGltf(primary.topDirection)), normalizeVec3(gameDirectionToGltf(secondary.topDirection)), t)
  );
  const inverseDirection = normalizeVec3(
    mixVec3(normalizeVec3(gameDirectionToGltf(primary.inverseDirection)), normalizeVec3(gameDirectionToGltf(secondary.inverseDirection)), t)
  );

  return evaluatePreparedLightRecord(topColor, topDirection, inverseColor, inverseDirection, normal);
}

function evaluatePreparedLightRecord(
  topColor: Vec4,
  topDirection: [number, number, number],
  inverseColor: Vec4,
  inverseDirection: [number, number, number],
  normal: [number, number, number]
): [number, number, number] {
  const topDotRaw = dotVec3(normal, topDirection);
  const inverseDotRaw = dotVec3(normal, inverseDirection);
  const topDot = Math.max(topDotRaw, topDotRaw * topColor[3]);
  const inverseDot = Math.max(inverseDotRaw, inverseDotRaw * inverseColor[3]);

  return [
    Math.max(0, topColor[0] * topDot + inverseColor[0] * inverseDot),
    Math.max(0, topColor[1] * topDot + inverseColor[1] * inverseDot),
    Math.max(0, topColor[2] * topDot + inverseColor[2] * inverseDot)
  ];
}

function createTfragDisplayMaterial(sourceMaterial: THREE.Material | THREE.Material[] | null): THREE.Material {
  const firstMaterial = Array.isArray(sourceMaterial) ? sourceMaterial[0] : sourceMaterial;
  const source = firstMaterial as Partial<THREE.MeshBasicMaterial> | null;
  const material = new THREE.MeshBasicNodeMaterial({
    name: `${firstMaterial?.name ?? 'tfrag'}_vertex_lit`,
    map: source?.map ?? null,
    vertexColors: true,
    transparent: firstMaterial?.transparent ?? false,
    opacity: firstMaterial?.opacity ?? 1,
    alphaTest: firstMaterial?.alphaTest ?? 0,
    depthTest: firstMaterial?.depthTest ?? true,
    depthWrite: firstMaterial?.depthWrite ?? true,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  material.forceSinglePass = true;

  if (material.map) {
    material.map.colorSpace = THREE.SRGBColorSpace;
    material.colorNode = texture(material.map, uv()).mul(vertexColor());
  } else {
    material.colorNode = vertexColor();
  }

  return material;
}

function materialBatchKey(sourceMaterial: THREE.Material | THREE.Material[] | null): string {
  const firstMaterial = Array.isArray(sourceMaterial) ? sourceMaterial[0] : sourceMaterial;
  if (!firstMaterial) {
    return 'null-material';
  }

  return firstMaterial.uuid;
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

function applyOutputScale(color: [number, number, number], exposure: number, postScale: number): [number, number, number] {
  const scale = Math.max(0, exposure) * Math.max(0, postScale);
  return [clamp01(color[0] * scale), clamp01(color[1] * scale), clamp01(color[2] * scale)];
}

function selectorDebugColor(selectorValue: number): [number, number, number] {
  const slot = selectorValue & 0x0f;
  const palette: Array<[number, number, number]> = [
    [0.93, 0.22, 0.18],
    [0.22, 0.62, 0.96],
    [0.24, 0.76, 0.38],
    [0.95, 0.76, 0.18],
    [0.76, 0.39, 0.95],
    [0.95, 0.49, 0.18],
    [0.12, 0.78, 0.78],
    [0.9, 0.9, 0.9],
    [0.55, 0.2, 0.2],
    [0.2, 0.36, 0.55],
    [0.2, 0.5, 0.27],
    [0.56, 0.47, 0.17],
    [0.43, 0.25, 0.55],
    [0.52, 0.3, 0.18],
    [0.18, 0.5, 0.5],
    [0.08, 0.08, 0.08]
  ];

  return palette[slot] ?? palette[15];
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

function dotVec3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
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

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const item of material) {
      item.dispose();
    }
    return;
  }

  material.dispose();
}
