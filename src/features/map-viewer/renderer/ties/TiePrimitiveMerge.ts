import * as THREE from 'three/webgpu';
import type { TiePrimitive } from './TieTypes';
import { resolveModelMaterialInfo } from '../model-materials/ModelMaterialNodes.ts';

// ponytail: avoid unbounded draw-call fan-out; use OIT if complex meshes need exact sorting.
const maxSortableAlphaComponents = 8;

export function mergeTiePrimitives(primitives: TiePrimitive[]): TiePrimitive[] {
  const merged: TiePrimitive[] = [];
  for (const primitive of primitives) {
    const previous = tieMaterialUsesAlphaBlend(primitive.material)
      ? merged.at(-1)
      : merged.find((candidate) => canMerge(candidate, primitive));
    if (previous && canMerge(previous, primitive)) {
      previous.geometry = mergeGeometry(previous.geometry, primitive.geometry);
    } else {
      merged.push(primitive);
    }
  }

  return merged;
}

export function splitIndexedTieGeometryComponents(geometry: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const index = geometry.index;
  if (!index || geometry.groups.length > 0) {
    return [geometry];
  }

  const start = Math.max(0, geometry.drawRange.start);
  const available = Math.max(0, index.count - start);
  const requested = Number.isFinite(geometry.drawRange.count) ? geometry.drawRange.count : available;
  const end = start + Math.floor(Math.min(available, requested) / 3) * 3;
  const parents = new Map<number, number>();
  const find = (value: number): number => {
    const parent = parents.get(value);
    if (parent === undefined) {
      parents.set(value, value);
      return value;
    }
    if (parent === value) {
      return value;
    }

    const root = find(parent);
    parents.set(value, root);
    return root;
  };
  const join = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parents.set(rightRoot, leftRoot);
    }
  };

  for (let offset = start; offset < end; offset += 3) {
    const a = index.getX(offset);
    join(a, index.getX(offset + 1));
    join(a, index.getX(offset + 2));
  }

  const componentIndices = new Map<number, number[]>();
  for (let offset = start; offset < end; offset += 3) {
    const a = index.getX(offset);
    const root = find(a);
    const indices = componentIndices.get(root) ?? [];
    indices.push(a, index.getX(offset + 1), index.getX(offset + 2));
    componentIndices.set(root, indices);
  }
  if (componentIndices.size <= 1 || componentIndices.size > maxSortableAlphaComponents) {
    return [geometry];
  }

  return Array.from(componentIndices.values(), (indices) => {
    const component = new THREE.BufferGeometry();
    component.name = geometry.name;
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      component.setAttribute(name, attribute);
    }
    component.morphAttributes = { ...geometry.morphAttributes };
    component.morphTargetsRelative = geometry.morphTargetsRelative;
    component.userData = { ...geometry.userData };
    component.setIndex(indices);
    component.computeBoundingBox();
    component.computeBoundingSphere();
    return component;
  });
}

function canMerge(left: TiePrimitive, right: TiePrimitive): boolean {
  return sameMaterial(left.material, right.material)
    && left.renderOrder === right.renderOrder
    && left.isGlowOverlay === right.isGlowOverlay
    && left.hasAmbientAttribute === right.hasAmbientAttribute
    && left.ambientSlotCount === right.ambientSlotCount
    && left.ambientWordCount === right.ambientWordCount
    && left.packedLightModeBits === right.packedLightModeBits
    && sameNumbers(left.packedLightNormals, right.packedLightNormals)
    && sameNumbers(left.packedLightScales, right.packedLightScales)
    && sameRecipes(left, right)
    && left.matrixWorld.equals(right.matrixWorld)
    && sameGeometryStreams(left.geometry, right.geometry);
}

function sameNumbers(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameMaterial(
  left: THREE.Material | THREE.Material[],
  right: THREE.Material | THREE.Material[]
): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return !Array.isArray(left) && !Array.isArray(right)
      && tieMaterialRenderKey(left) === tieMaterialRenderKey(right);
  }

  return left.length === right.length
    && left.every((material, index) => tieMaterialRenderKey(material) === tieMaterialRenderKey(right[index]));
}

function tieMaterialUsesAlphaBlend(material: THREE.Material | THREE.Material[]): boolean {
  const materials = Array.isArray(material) ? material : [material];
  return materials.some((item) => resolveModelMaterialInfo(item, 'tie').usesAlphaBlend);
}

const tieMaterialRenderKeys = new WeakMap<THREE.Material, string>();

function tieMaterialRenderKey(material: THREE.Material): string {
  const cached = tieMaterialRenderKeys.get(material);
  if (cached) {
    return cached;
  }

  const source = material as Partial<THREE.MeshStandardMaterial>;
  const info = resolveModelMaterialInfo(material, 'tie');
  const key = [
    source.map?.uuid,
    source.alphaMap?.uuid,
    source.emissiveMap?.uuid,
    source.color?.getHexString(),
    source.vertexColors,
    material.side,
    material.transparent,
    material.opacity,
    material.alphaTest,
    material.depthTest,
    material.depthWrite,
    info.alphaUsage,
    info.alphaMode,
    info.usesOpacityAlpha,
    info.usesReflectiveMask,
    info.usesAlphaCutout,
    info.usesAlphaBlend,
    info.usesAlphaMask,
    info.hasOpaqueTexels,
    info.fullOpacityAlpha,
    info.usesReflectiveMask ? info.passFlags : 0,
    info.usesReflectiveMask ? info.passEnvironmentModeBits : 0,
    info.usesReflectiveMask ? info.secondPassMode : null,
    info.usesGlowEmission,
    info.glowEmissionStrength,
    info.glowTint.getHexString(),
    info.usesReflectiveMask ? info.reflectiveEnvironmentSource : null,
    info.usesReflectiveMask ? info.reflectiveBleedColor.getHexString() : null
  ].join('|');
  tieMaterialRenderKeys.set(material, key);
  return key;
}

function sameRecipes(left: TiePrimitive, right: TiePrimitive): boolean {
  return left.ambientColorRecipes.length === right.ambientColorRecipes.length
    && left.ambientColorRecipes.every((recipe, index) => {
      const other = right.ambientColorRecipes[index];
      return recipe.targetIndex === other.targetIndex
        && recipe.divisor === other.divisor
        && recipe.sourceIndices.length === other.sourceIndices.length
        && recipe.sourceIndices.every((sourceIndex, sourceIndexIndex) => sourceIndex === other.sourceIndices[sourceIndexIndex]);
    });
}

function sameGeometryStreams(left: THREE.BufferGeometry, right: THREE.BufferGeometry): boolean {
  if (!left.index || !right.index
    || left.groups.length > 0 || right.groups.length > 0
    || left.drawRange.start !== 0 || right.drawRange.start !== 0
    || left.drawRange.count < left.index.count || right.drawRange.count < right.index.count) {
    return false;
  }

  const leftNames = Object.keys(left.attributes);
  const rightNames = Object.keys(right.attributes);
  return leftNames.length === rightNames.length
    && leftNames.every((name) => left.getAttribute(name) === right.getAttribute(name));
}

function mergeGeometry(left: THREE.BufferGeometry, right: THREE.BufferGeometry): THREE.BufferGeometry {
  const leftIndex = left.index!;
  const rightIndex = right.index!;
  let maxIndex = 0;
  for (let index = 0; index < leftIndex.count; index += 1) {
    maxIndex = Math.max(maxIndex, leftIndex.getX(index));
  }
  for (let index = 0; index < rightIndex.count; index += 1) {
    maxIndex = Math.max(maxIndex, rightIndex.getX(index));
  }

  const indices = maxIndex <= 0xffff
    ? new Uint16Array(leftIndex.count + rightIndex.count)
    : new Uint32Array(leftIndex.count + rightIndex.count);
  for (let index = 0; index < leftIndex.count; index += 1) {
    indices[index] = leftIndex.getX(index);
  }
  for (let index = 0; index < rightIndex.count; index += 1) {
    indices[leftIndex.count + index] = rightIndex.getX(index);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.name = left.name;
  for (const [name, attribute] of Object.entries(left.attributes)) {
    geometry.setAttribute(name, attribute);
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingBox = left.boundingBox?.clone() ?? null;
  geometry.boundingSphere = left.boundingSphere?.clone() ?? null;
  return geometry;
}
