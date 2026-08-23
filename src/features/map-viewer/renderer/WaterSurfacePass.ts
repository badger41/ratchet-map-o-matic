import * as THREE from 'three/webgpu';
import { and, or, positionWorld, uniform } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

export const belowWaterRenderOrder = -2;
export const waterRenderOrder = 0;
export const aboveWaterRenderOrder = 2;

export interface WaterSurfaceMaterialPasses {
  above: THREE.Material | THREE.Material[];
  below: THREE.Material | THREE.Material[];
}

type MaskedMaterial = THREE.Material & { maskNode: Node<'bool'> | null };

const waterSurfaceEnabled = uniform(0);
const waterSurfaceY = uniform(0);
const belowWaterMask = and(waterSurfaceEnabled.greaterThan(0.5), positionWorld.y.lessThan(waterSurfaceY));
const aboveWaterMask = or(waterSurfaceEnabled.lessThanEqual(0.5), positionWorld.y.greaterThanEqual(waterSurfaceY));
const materialPassCache = new WeakMap<object, WaterSurfaceMaterialPasses | null>();
const belowWaterMaterials = new Set<THREE.Material>();
let waterSurfaceActive = false;

export function setWaterSurface(height: number | null, enabled: boolean): void {
  waterSurfaceActive = enabled && height !== null;
  waterSurfaceY.value = height ?? 0;
  waterSurfaceEnabled.value = waterSurfaceActive ? 1 : 0;
  for (const material of belowWaterMaterials) {
    material.visible = waterSurfaceActive;
  }
}

export function resolveWaterSurfaceHeight(heights: number[]): number | null {
  const first = heights[0];
  return Number.isFinite(first) && heights.every((height) => height === first) ? first : null;
}

export function createWaterSurfaceMaterialPasses(
  material: THREE.Material | THREE.Material[]
): WaterSurfaceMaterialPasses | null {
  const cached = materialPassCache.get(material);
  if (cached !== undefined) {
    return cached;
  }

  const passes = Array.isArray(material)
    ? createArrayPasses(material)
    : createSinglePasses(material);
  materialPassCache.set(material, passes);
  return passes;
}

function createSinglePasses(material: THREE.Material): WaterSurfaceMaterialPasses | null {
  if (!isSplittable(material)) {
    return null;
  }

  const below = material.clone() as MaskedMaterial;
  below.userData = { ...material.userData };
  configureMasks(material, below);
  return { above: material, below };
}

function createArrayPasses(materials: THREE.Material[]): WaterSurfaceMaterialPasses | null {
  if (!materials.some(isSplittable)) {
    return null;
  }

  const below = materials.map((material) => {
    const clone = material.clone();
    clone.userData = { ...material.userData };
    if (isSplittable(material) && isMasked(clone)) {
      configureMasks(material, clone);
    } else {
      clone.visible = false;
    }
    return clone;
  });
  return { above: materials, below };
}

function configureMasks(above: MaskedMaterial, below: MaskedMaterial): void {
  const sourceMask = above.maskNode;
  above.depthWrite = false;
  below.depthWrite = false;
  above.maskNode = sourceMask ? and(sourceMask, aboveWaterMask) : aboveWaterMask;
  below.maskNode = sourceMask ? and(sourceMask, belowWaterMask) : belowWaterMask;
  below.visible = waterSurfaceActive;
  belowWaterMaterials.add(below);
  below.addEventListener('dispose', () => belowWaterMaterials.delete(below));
}

function isSplittable(material: THREE.Material): material is MaskedMaterial {
  return material.transparent && isMasked(material);
}

function isMasked(material: THREE.Material): material is MaskedMaterial {
  return 'maskNode' in material;
}
