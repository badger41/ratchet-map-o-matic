import * as THREE from 'three/webgpu';
import type UniformNode from 'three/src/nodes/core/UniformNode.js';
import type {
  TieColorEntry,
  TieInstanceRecord,
  TieStats
} from '../../../../services/mapPackages/mapPackageTypes';

export interface TiePrimitive {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrixWorld: THREE.Matrix4;
  renderOrder: number;
  isGlowOverlay: boolean;
  hasAmbientAttribute: boolean;
  ambientSlotCount: number | null;
  ambientWordCount: number | null;
  ambientColorRecipes: TieAmbientColorRecipe[];
  ambientSourceIndices: number[] | null;
}

export interface PreparedTieRecord {
  source: TieInstanceRecord;
  colorEntry: TieColorEntry | null;
  instanceMatrix: THREE.Matrix4;
  mirroredKey: 'normal' | 'mirrored';
  isMirrored: boolean;
}

export interface TieInstancedMeshBinding {
  mesh: THREE.InstancedMesh;
  records: PreparedTieRecord[];
  flatMaterial: THREE.Material | THREE.Material[];
  coloredMaterial: THREE.Material | THREE.Material[] | null;
  ambientBinding: TieAmbientTextureBinding | null;
}

export interface TieLightingUniforms {
  ambientScale: UniformNode<'float', number>;
  directionalScale: UniformNode<'float', number>;
  rawColorScale: UniformNode<'float', number>;
  rawByteScale: UniformNode<'float', number>;
  rawDirectionalScale: UniformNode<'float', number>;
  rawDirectionalColorScale: UniformNode<'float', number>;
  colorStrength: UniformNode<'float', number>;
  blendAdditiveScale: UniformNode<'float', number>;
  blendTintedWorldScale: UniformNode<'float', number>;
  blendModulateScale: UniformNode<'float', number>;
  blendMaxLightScale: UniformNode<'float', number>;
  shineScale: UniformNode<'float', number>;
  reflectionScale: UniformNode<'float', number>;
  materialDebugMode: UniformNode<'float', number>;
  directionalOverrideEnabled: UniformNode<'float', number>;
  directionalOverrideSlot: UniformNode<'float', number>;
}

export interface TieAmbientColorRecipe {
  targetIndex: number;
  sourceIndices: number[];
  divisor: number;
}

export interface TieAmbientTextureBinding {
  texture: THREE.DataTexture;
  wordCount: number;
  instanceCount: number;
  recipeCount: number;
  recipeSamples: number;
  validSamples: number;
  rowByRecord: WeakMap<PreparedTieRecord, number>;
  statsCounted: boolean;
}

export interface TieMaterialSet {
  flatMaterial: THREE.Material | THREE.Material[];
  coloredMaterial: THREE.Material | THREE.Material[] | null;
  ambientBinding: TieAmbientTextureBinding | null;
}

export interface TieDirectionalLightBinding {
  topColors: THREE.DataTexture;
  topDirections: THREE.DataTexture;
  inverseColors: THREE.DataTexture;
  inverseDirections: THREE.DataTexture;
  slotCount: number;
}

export type TieLoadProgressCallback = (loadedClasses: number, totalClasses: number) => void;

export const emptyTieStats: TieStats = {
  classIds: 0,
  exportedClasses: 0,
  loadedClasses: 0,
  instances: 0,
  renderedInstances: 0,
  colorEntries: 0,
  coloredInstances: 0,
  ambientBatches: 0,
  ambientRecipes: 0,
  ambientRecipeSamples: 0,
  ambientValidSamples: 0,
  missingClasses: 0,
  batches: 0,
  primitives: 0,
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

export const tieAmbientAttributeName = 'tieAmbientIndex';
export const tieAmbientAttributeAliases = [
  tieAmbientAttributeName,
  '_tie_ambient_index',
  '_TIE_AMBIENT_INDEX',
  '_dl_tie_ambient_index',
  '_DL_TIE_AMBIENT_INDEX'
];
export const tieAmbientInstanceRowAttributeName = 'tieAmbientRow';
export const tieAmbientPs2NeutralByte = 128;
export const tieAmbientRawIntensityScale = 255 / tieAmbientPs2NeutralByte;
export const dlTieEnvironmentPassMask = 0x06;
export const dlLightSelectorAttributeName = 'dlLightSelector';
export const tieDirectionalLightSlotCount = 16;
export const tieDirectionalLightFloor = 0.28;
export const tieClassLoadConcurrency = 2;
export const tieLoadFrameBudgetMs = 6;
export const tieInstanceChunkCellSize = 2400;
export const tieInstanceChunkMaxRecords = 768;
