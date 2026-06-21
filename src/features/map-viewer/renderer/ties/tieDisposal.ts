import * as THREE from 'three/webgpu';
import { isMesh } from './TieClassSource';

export function disposeObject3D(
  root: THREE.Object3D,
  disposedMaterials = new Set<THREE.Material>(),
  disposedTextures = new Set<THREE.Texture>()
): void {
  root.traverse((object) => {
    if (!isMesh(object)) {
      return;
    }

    object.geometry?.dispose();
    disposeMaterial(object.material, disposedMaterials, disposedTextures);
  });
}

export function disposeInactiveMaterial(
  activeMaterial: THREE.Material | THREE.Material[],
  candidate: THREE.Material | THREE.Material[],
  disposedMaterials: Set<THREE.Material>,
  disposedTextures: Set<THREE.Texture>
): void {
  if (!isSameMaterial(activeMaterial, candidate)) {
    disposeMaterial(candidate, disposedMaterials, disposedTextures);
  }
}

function isSameMaterial(
  left: THREE.Material | THREE.Material[],
  right: THREE.Material | THREE.Material[]
): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((item, index) => item === right[index]);
  }

  return left === right;
}

function disposeMaterial(
  material: THREE.Material | THREE.Material[],
  disposedMaterials: Set<THREE.Material>,
  disposedTextures: Set<THREE.Texture>
): void {
  if (Array.isArray(material)) {
    for (const item of material) {
      disposeMaterial(item, disposedMaterials, disposedTextures);
    }
    return;
  }

  if (disposedMaterials.has(material)) {
    return;
  }

  disposedMaterials.add(material);
  material.dispose();
  disposeMaterialOwnedTextures(material, disposedTextures);
}

function disposeMaterialOwnedTextures(material: THREE.Material, disposedTextures: Set<THREE.Texture>): void {
  const texture = material.userData.mapOmaticTieAmbientTexture;
  if (texture instanceof THREE.Texture) {
    if (!disposedTextures.has(texture)) {
      disposedTextures.add(texture);
      texture.dispose();
    }

    material.userData.mapOmaticTieAmbientTexture = null;
  }
}
