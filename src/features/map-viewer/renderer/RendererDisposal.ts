import * as THREE from 'three/webgpu';

export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    mesh.geometry?.dispose();
    disposeMaterial(mesh.material);
  });
}

export function runRendererCleanup(label: string, cleanup: () => void): void {
  try {
    cleanup();
  } catch (error) {
    console.warn(`Ignored renderer cleanup error while disposing ${label}.`, error);
  }
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
