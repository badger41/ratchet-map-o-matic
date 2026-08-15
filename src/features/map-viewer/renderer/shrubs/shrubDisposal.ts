import * as THREE from 'three/webgpu';
import { isMesh } from './ShrubClassSource';

export function disposeObject3D(root: THREE.Object3D): void {
  const disposedMaterials = new Set<THREE.Material>();
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    if (!isMesh(object)) {
      return;
    }

    if (object.geometry && !disposedGeometries.has(object.geometry)) {
      disposedGeometries.add(object.geometry);
      object.geometry.dispose();
    }
    disposeMaterial(object.material, disposedMaterials);
  });
}

function disposeMaterial(material: THREE.Material | THREE.Material[], disposedMaterials: Set<THREE.Material>): void {
  if (Array.isArray(material)) {
    for (const item of material) {
      disposeMaterial(item, disposedMaterials);
    }
    return;
  }

  if (disposedMaterials.has(material)) {
    return;
  }

  disposedMaterials.add(material);
  material.dispose();
}
