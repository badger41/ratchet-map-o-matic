import * as THREE from 'three/webgpu';

export function pruneMobyLods(root: THREE.Object3D): void {
  const groups: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.name === 'low_lod' || object.name === 'far_lod') {
      groups.push(object);
    }
  });

  for (const group of groups) {
    group.parent?.remove(group);
  }
}
