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
import type { ShrubPrimitive } from './ShrubTypes';

export async function loadShrubClassSource(
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
    gltf.scene.name = `shrub_class_${String(entry.ModelId ?? 'unknown').padStart(5, '0')}`;
    return gltf.scene;
  } catch (error) {
    console.warn(`Failed to load shrub class ${entry.ModelId ?? 'unknown'} from ${url}`, error);
    return null;
  }
}

export function collectShrubPrimitives(source: THREE.Object3D): ShrubPrimitive[] {
  source.updateMatrixWorld(true);
  const primitives: ShrubPrimitive[] = [];

  source.traverse((object) => {
    if (!isMesh(object) || !object.geometry || !object.material) {
      return;
    }

    primitives.push({
      name: object.name || 'shrub_primitive',
      geometry: object.geometry,
      material: object.material,
      matrixWorld: object.matrixWorld.clone(),
      renderOrder: object.renderOrder,
      isBillboard: isShrubBillboardObject(object)
    });
  });

  return primitives;
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

function isShrubBillboardObject(object: THREE.Object3D): boolean {
  if (object.userData?.ShrubBillboard || object.userData?.shrubBillboard) {
    return true;
  }

  const mesh = object as THREE.Mesh;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.some((material) => Boolean(material?.userData?.ShrubBillboardMaterial));
}
