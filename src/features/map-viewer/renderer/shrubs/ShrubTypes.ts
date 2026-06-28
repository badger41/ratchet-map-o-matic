import * as THREE from 'three/webgpu';
import type UniformNode from 'three/src/nodes/core/UniformNode.js';
import type {
  ShrubInstanceRecord,
  ShrubStats
} from '../../../../services/mapPackages/mapPackageTypes';

export interface ShrubPrimitive {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrixWorld: THREE.Matrix4;
  renderOrder: number;
  isBillboard: boolean;
}

export interface PreparedShrubRecord {
  source: ShrubInstanceRecord;
  instanceMatrix: THREE.Matrix4;
  mirroredKey: 'normal' | 'mirrored';
  isMirrored: boolean;
  ambientColor: [number, number, number];
}

export interface ShrubInstancedMeshBinding {
  mesh: THREE.InstancedMesh;
  material: THREE.Material | THREE.Material[];
  isBillboard: boolean;
}

export interface ShrubLightingUniforms {
  ambientScale: UniformNode<'float', number>;
  directionalScale: UniformNode<'float', number>;
  exposureScale: UniformNode<'float', number>;
  directionalColorStrength: UniformNode<'float', number>;
  directionalFrontScale: UniformNode<'float', number>;
  directionalBackScale: UniformNode<'float', number>;
  blendAdditiveScale: UniformNode<'float', number>;
  blendModulateScale: UniformNode<'float', number>;
}

export interface ShrubDirectionalLightBinding {
  topColors: THREE.DataTexture;
  topDirections: THREE.DataTexture;
  inverseColors: THREE.DataTexture;
  inverseDirections: THREE.DataTexture;
  slotCount: number;
}

export type ShrubLoadProgressCallback = (loadedClasses: number, totalClasses: number) => void;

export const emptyShrubStats: ShrubStats = {
  classIds: 0,
  exportedClasses: 0,
  loadedClasses: 0,
  instances: 0,
  renderedInstances: 0,
  missingClasses: 0,
  batches: 0,
  primitives: 0,
  billboardBatches: 0,
  triangles: 0
};

export const instanceMirrorMatrix = new THREE.Matrix4().makeScale(-1, 1, 1);
export const ps2ToGltfBasisMatrix = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, -1, 0, 0,
  0, 0, 0, 1
);
export const gltfToPs2BasisMatrix = ps2ToGltfBasisMatrix.clone().invert();

export const shrubAmbientAttributeName = 'shrubAmbientColor';
export const lightSelectorAttributeName = 'modelLightSelector';
export const shrubDirectionalLightSlotCount = 16;
export const shrubAmbientTintScale = 255 / 128;
export const shrubClassLoadConcurrency = 2;
export const shrubLoadFrameBudgetMs = 6;
export const shrubInstanceChunkCellSize = 2400;
export const shrubInstanceChunkMaxRecords = 768;
export const shrubLightingUniformsUserDataKey = 'mapOmaticShrubLightingUniforms';
