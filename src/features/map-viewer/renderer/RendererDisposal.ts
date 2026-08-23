import * as THREE from 'three/webgpu';

export function disposeObject3D(root: THREE.Object3D): void {
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  const disposedMaterials = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    if (mesh.geometry && !disposedGeometries.has(mesh.geometry)) {
      disposedGeometries.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    disposeMaterial(mesh.material, disposedMaterials);
  });
}

export function runRendererCleanup(label: string, cleanup: () => void): void {
  try {
    cleanup();
  } catch (error) {
    console.warn(`Ignored renderer cleanup error while disposing ${label}.`, error);
  }
}

function disposeMaterial(material: THREE.Material | THREE.Material[], disposed: Set<THREE.Material>): void {
  if (Array.isArray(material)) {
    for (const item of material) {
      disposeMaterial(item, disposed);
    }
    return;
  }

  if (disposed.has(material)) {
    return;
  }
  disposed.add(material);
  material.dispose();
}
