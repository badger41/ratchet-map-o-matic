import * as THREE from 'three/webgpu';

export const mobyLodNames = ['high_lod', 'low_lod', 'far_lod'] as const;
export const mobyMetalReflectionScaleAttributeName = '_moby_metal_reflection_scale';
export const mobyReflectionOriginAttributeName = 'mobyReflectionOrigin';
export const mobyMetalFadeStart = 8;
export const mobyMetalFadeEnd = 24;
// MobyProc adds 1000 to clip Z; UpdateViewContext converts it through this W scale into 24-bit depth.
export const mobyMetalDepthBiasScale = 1000 / (1024 * 0.0016240659169852734 * 0xffffff);
export type MobyLodName = typeof mobyLodNames[number];

export interface MobyViewOptions {
  lods: MobyLodName[];
  bangles: string[];
  hasMetals: boolean;
}

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

export function inspectMobyViewOptions(root: THREE.Object3D): MobyViewOptions {
  const availableLods = new Set<MobyLodName>();
  root.traverse((object) => {
    if (isMobyLodName(object.name)) {
      availableLods.add(object.name);
    }
  });

  return {
    lods: mobyLodNames.filter((name) => availableLods.has(name)),
    bangles: (root.getObjectByName('bangles')?.children ?? []).map((group) => group.name),
    hasMetals: Boolean(root.getObjectByName('metals'))
  };
}

export function setMobyLod(root: THREE.Object3D, lod: MobyLodName): void {
  root.traverse((object) => {
    if (isMobyLodName(object.name)) {
      object.visible = object.name === lod;
    }
  });
}

export function setMobyBangles(root: THREE.Object3D, visibleBangles: ReadonlySet<string>): void {
  for (const group of root.getObjectByName('bangles')?.children ?? []) {
    group.visible = visibleBangles.has(group.name);
  }
}

export function setMobyMetalsVisible(root: THREE.Object3D, visible: boolean): void {
  const metals = root.getObjectByName('metals');
  if (metals) {
    metals.visible = visible;
  }
}

export function setMobyBindPose(root: THREE.Object3D): void {
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && !skeletons.has(mesh.skeleton)) {
      skeletons.add(mesh.skeleton);
      mesh.skeleton.pose();
    }
  });
  root.updateMatrixWorld(true);
}

export function isMobyMetalObject(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (current.name === 'metals') {
      return true;
    }
  }

  return false;
}

export function mobyPreviewAlphaScale(fullOpacityAlpha: number): number {
  return 1 / THREE.MathUtils.clamp(fullOpacityAlpha, 1 / 255, 1);
}

function isMobyLodName(name: string): name is MobyLodName {
  return mobyLodNames.includes(name as MobyLodName);
}
