import * as THREE from 'three/webgpu';
import { isMesh } from './ShrubClassSource';

export function disposeObject3D(root: THREE.Object3D): void {
  const disposedMaterials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!isMesh(object)) {
      return;
    }

    object.geometry?.dispose();
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
