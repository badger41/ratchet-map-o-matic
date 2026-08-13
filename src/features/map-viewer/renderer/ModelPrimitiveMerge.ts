import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

interface ModelPrimitive {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrixWorld: THREE.Matrix4;
  renderOrder: number;
}

export function mergeAdjacentModelPrimitives<T extends ModelPrimitive>(
  primitives: T[],
  sameState: (left: T, right: T) => boolean = () => true
): T[] {
  const merged: T[] = [];
  for (const primitive of primitives) {
    const previous = merged.at(-1);
    if (!previous || !canMerge(previous, primitive) || !sameState(previous, primitive)) {
      merged.push(primitive);
      continue;
    }

    const geometry = mergeGeometries([previous.geometry, primitive.geometry]);
    if (!geometry) {
      merged.push(primitive);
      continue;
    }

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    previous.geometry = geometry;
  }

  return merged;
}

function canMerge(left: ModelPrimitive, right: ModelPrimitive): boolean {
  return sameMaterial(left.material, right.material)
    && left.renderOrder === right.renderOrder
    && left.matrixWorld.equals(right.matrixWorld)
    && sameGeometryFormat(left.geometry, right.geometry);
}

function sameMaterial(
  left: THREE.Material | THREE.Material[],
  right: THREE.Material | THREE.Material[]
): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return left === right;
  }

  return left.length === right.length && left.every((material, index) => material === right[index]);
}

function sameGeometryFormat(left: THREE.BufferGeometry, right: THREE.BufferGeometry): boolean {
  if ((left.index === null) !== (right.index === null)
    || left.groups.length > 0 || right.groups.length > 0
    || !usesFullDrawRange(left) || !usesFullDrawRange(right)) {
    return false;
  }

  const leftNames = Object.keys(left.attributes).sort();
  const rightNames = Object.keys(right.attributes).sort();
  return leftNames.length === rightNames.length
    && leftNames.every((name, index) => name === rightNames[index]
      && sameAttributeFormat(left.getAttribute(name), right.getAttribute(name)));
}

function usesFullDrawRange(geometry: THREE.BufferGeometry): boolean {
  const count = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
  return geometry.drawRange.start === 0 && geometry.drawRange.count >= count;
}

function sameAttributeFormat(
  left: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  right: THREE.BufferAttribute | THREE.InterleavedBufferAttribute
): boolean {
  return left.itemSize === right.itemSize
    && left.normalized === right.normalized
    && left.array.constructor === right.array.constructor;
}
