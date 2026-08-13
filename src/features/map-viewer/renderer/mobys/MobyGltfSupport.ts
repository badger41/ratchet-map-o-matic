import * as THREE from 'three/webgpu';

export const mobyLodNames = ['high_lod', 'low_lod', 'far_lod'] as const;
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

export function mobyPreviewAlphaScale(fullOpacityAlpha: number): number {
  return 1 / THREE.MathUtils.clamp(fullOpacityAlpha, 1 / 255, 1);
}

function isMobyLodName(name: string): name is MobyLodName {
  return mobyLodNames.includes(name as MobyLodName);
}
