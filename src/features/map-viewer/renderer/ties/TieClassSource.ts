import * as THREE from 'three/webgpu';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  dirnamePackagePath,
  joinPackagePath
} from '../../../../services/mapAssets/mapAssetPackage';
import type {
  GltfExportEntry,
  LoadedMapPackage
} from '../../../../services/mapPackages/mapPackageTypes';
import {
  tieAmbientAttributeAliases,
  type TieAmbientColorRecipe,
  type TiePrimitive
} from './TieTypes';
import {
  isRecord,
  numberValue
} from './tieUtils';

interface TieGltfMeshJson {
  extras?: Record<string, unknown>;
}

interface TieGltfJson {
  meshes?: TieGltfMeshJson[];
}

interface TieGltfAssociation {
  mesh?: number;
  meshes?: number;
}

interface TieGltfParserMetadata {
  json?: TieGltfJson;
  associations?: WeakMap<object, TieGltfAssociation>;
}

interface TieGltfLoadResult {
  scene: THREE.Group;
  parser?: TieGltfParserMetadata;
}

export async function loadTieClassSource(
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
    attachTieGltfMeshExtras(gltf as TieGltfLoadResult);
    gltf.scene.name = `tie_class_${String(entry.ModelId ?? 'unknown').padStart(5, '0')}`;
    return gltf.scene;
  } catch (error) {
    console.warn(`Failed to load tie class ${entry.ModelId ?? 'unknown'} from ${url}`, error);
    return null;
  }
}

export function collectTiePrimitives(source: THREE.Object3D): TiePrimitive[] {
  source.updateMatrixWorld(true);
  const primitives: TiePrimitive[] = [];

  source.traverse((object) => {
    if (!isMesh(object) || !object.geometry || !object.material) {
      return;
    }

    primitives.push({
      name: object.name || 'tie_primitive',
      geometry: object.geometry,
      material: object.material,
      matrixWorld: object.matrixWorld.clone(),
      renderOrder: object.renderOrder,
      isGlowOverlay: Boolean(object.userData?.isGlowOverlay),
      hasAmbientAttribute: hasTieAmbientAttribute(object.geometry) || Boolean(object.userData?.hasTieAmbientAttribute),
      ambientSlotCount: resolveTieObjectNumber(object, 'AmbientSlotCount'),
      ambientWordCount: resolveTieObjectNumber(object, 'AmbientWordCount'),
      ambientColorRecipes: resolveTieAmbientColorRecipes(object),
      ambientSourceIndices: null
    });
  });

  return primitives;
}

export function pruneToLod0(root: THREE.Object3D): void {
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

    object.parent.remove(object);
  }
}

export function createInstancedGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.name = source.name;
  geometry.index = source.index;
  for (const [name, attribute] of Object.entries(source.attributes)) {
    geometry.setAttribute(name, attribute);
  }

  geometry.morphAttributes = { ...source.morphAttributes };
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  geometry.groups = source.groups.map((group) => ({ ...group }));
  geometry.drawRange = { ...source.drawRange };
  geometry.userData = { ...source.userData };
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  return geometry;
}

export function estimateTriangleCount(geometry: THREE.BufferGeometry): number {
  if (geometry.index) {
    return Math.floor(geometry.index.count / 3);
  }

  const position = geometry.getAttribute('position');
  return position ? Math.floor(position.count / 3) : 0;
}

export function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

function attachTieGltfMeshExtras(gltf: TieGltfLoadResult): void {
  const meshes = gltf.parser?.json?.meshes;
  const associations = gltf.parser?.associations;
  if (!meshes || !associations) {
    return;
  }

  gltf.scene.traverse((object) => {
    const association = associations.get(object);
    const meshIndex = association?.meshes ?? association?.mesh;
    if (meshIndex === undefined) {
      return;
    }

    const extras = meshes[meshIndex]?.extras;
    if (!extras) {
      return;
    }

    object.userData = {
      ...extras,
      ...object.userData,
      extras: {
        ...extras,
        ...(isRecord(object.userData.extras) ? object.userData.extras : {})
      }
    };
  });
}

function hasTieAmbientAttribute(geometry: THREE.BufferGeometry): boolean {
  return getTieAmbientAttribute(geometry) !== null;
}

export function getTieAmbientAttribute(
  geometry: THREE.BufferGeometry
): THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null {
  for (const name of tieAmbientAttributeAliases) {
    const attributeValue = geometry.getAttribute(name);
    if (attributeValue) {
      return attributeValue;
    }
  }

  return null;
}

function resolveTieObjectNumber(object: THREE.Object3D, key: string): number | null {
  for (const value of resolveTieObjectUserDataValues(object, key)) {
    const parsed = numberValue(value);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function resolveTieAmbientColorRecipes(object: THREE.Object3D): TieAmbientColorRecipe[] {
  for (const value of resolveTieObjectUserDataValues(object, 'AmbientColorRecipes')) {
    const recipes = normalizeTieAmbientColorRecipes(value);
    if (recipes.length > 0) {
      return recipes;
    }
  }

  return [];
}

function resolveTieObjectUserDataValues(object: THREE.Object3D, key: string): unknown[] {
  const values: unknown[] = [];
  appendUserDataValue(values, object.userData, key);

  if (isMesh(object)) {
    appendUserDataValue(values, object.geometry?.userData, key);
  }

  let current = object.parent;
  while (current) {
    appendUserDataValue(values, current.userData, key);
    current = current.parent;
  }

  return values;
}

function appendUserDataValue(values: unknown[], userData: unknown, key: string): void {
  if (!isRecord(userData)) {
    return;
  }

  if (key in userData) {
    values.push(userData[key]);
  }

  const extras = userData.extras;
  if (isRecord(extras) && key in extras) {
    values.push(extras[key]);
  }
}

function normalizeTieAmbientColorRecipes(value: unknown): TieAmbientColorRecipe[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const recipes: TieAmbientColorRecipe[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const targetIndex = numberValue(item.TargetIndex ?? item.targetIndex);
    if (targetIndex === null) {
      continue;
    }

    const sourceValue = item.SourceIndices ?? item.sourceIndices ?? item.SourceIndex ?? item.sourceIndex;
    const sourceIndices = normalizeNumberArray(sourceValue);
    if (sourceIndices.length === 0) {
      continue;
    }

    recipes.push({
      targetIndex,
      sourceIndices,
      divisor: Math.max(1, Math.floor(numberValue(item.Divisor ?? item.divisor) ?? sourceIndices.length))
    });
  }

  return recipes;
}

function normalizeNumberArray(value: unknown): number[] {
  const sourceValues = Array.isArray(value) ? value : [value];
  const numbers: number[] = [];
  for (const item of sourceValues) {
    const parsed = numberValue(item);
    if (parsed !== null) {
      numbers.push(Math.floor(parsed));
    }
  }

  return numbers;
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

  const nameMatch = object.name.match(/(?:^|_)lod_?(\d+)(?:_|$)/i);
  return nameMatch ? Number.parseInt(nameMatch[1], 10) : null;
}
