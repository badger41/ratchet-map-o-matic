import * as THREE from 'three/webgpu';
import type { SkyboxStats } from '../../../../services/mapPackages/mapPackageTypes';
import type { SkyboxShellAnimation } from './SkyboxAnimation';
import { isSkyboxAdditiveMaterial } from './SkyboxMaterials';
import {
  countGeometryTriangles,
  numberValue,
  skyboxPrimitiveData
} from './skyboxMetadata';

export const emptySkyboxStats: SkyboxStats = {
  loaded: false,
  shells: 0,
  animatedShells: 0,
  meshes: 0,
  primitives: 0,
  materials: 0,
  additiveMaterials: 0,
  triangles: 0
};

export function buildSkyboxStats(root: THREE.Object3D, animations: SkyboxShellAnimation[]): SkyboxStats {
  const shells = new Set<number>();
  const materials = new Set<THREE.Material>();
  const additiveMaterials = new Set<THREE.Material>();
  let meshes = 0;
  let primitives = 0;
  let triangles = 0;

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    meshes += 1;
    const data = skyboxPrimitiveData(mesh);
    const shellIndex = numberValue(data.SkyboxShellIndex);
    if (shellIndex !== null) {
      shells.add(shellIndex);
    }

    primitives += Math.max(mesh.geometry.groups.length, 1);
    triangles += countGeometryTriangles(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of meshMaterials) {
      materials.add(material);
      if (isSkyboxAdditiveMaterial(material)) {
        additiveMaterials.add(material);
      }
    }
  });

  return {
    loaded: meshes > 0,
    shells: shells.size,
    animatedShells: animations.length,
    meshes,
    primitives,
    materials: materials.size,
    additiveMaterials: additiveMaterials.size,
    triangles
  };
}
