import type { MapAssetPackage } from '../mapAssets/mapAssetPackage';

export type Vec4 = [number, number, number, number];

export type DiagnosticMode = 'runtime' | 'base' | 'cache' | 'selector';
export type SkyboxBlendMode = 'metadata' | 'auto-additive-overlays' | 'additive-blend-layers';
export type MapSceneLoadStageId = 'manifest' | 'tfrag' | 'skybox' | 'compile';
export type MapSceneLoadStageStatus = 'pending' | 'active' | 'done' | 'error';

export interface MapSceneLoadStageUpdate {
  id: MapSceneLoadStageId;
  status: MapSceneLoadStageStatus;
  detail?: string;
  loaded?: number;
  total?: number;
}

export interface RootManifest {
  Game?: string;
  Level?: number;
  ExtractedAtUtc?: string;
  [key: string]: unknown;
}

export interface GltfExportEntry {
  Family?: string | null;
  ModelId?: number | string | null;
  SourcePath?: string | null;
  GltfPath?: string | null;
  BufferPath?: string | null;
  DiagnosticsPath?: string | null;
  Status?: string | null;
  Error?: string | null;
}

export interface AssetManifest {
  GltfExports?: GltfExportEntry[];
  [key: string]: unknown;
}

export interface WorldSlot {
  SemanticName?: string | null;
  Path?: string | null;
  Status?: string | null;
  [key: string]: unknown;
}

export interface WorldManifest {
  Slots?: WorldSlot[];
  TieClassCount?: number | null;
  TieInstanceCount?: number | null;
  ShrubClassCount?: number | null;
  ShrubInstanceCount?: number | null;
  [key: string]: unknown;
}

export interface DirectionalLightRecord {
  index: number;
  topColor: Vec4;
  topDirection: Vec4;
  inverseColor: Vec4;
  inverseDirection: Vec4;
}

export interface TfragDiagnostics {
  Geometry?: {
    TriangleCount?: number;
    LodTriangleCounts?: Record<string, number>;
    [key: string]: unknown;
  };
  LodStats?: Array<{
    LodIndex?: number;
    TriangleCount?: number;
    MeshCount?: number;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface LoadedMapPackage {
  assetPackage: MapAssetPackage;
  manifestUrl: string;
  manifestBaseUrl: string;
  manifestPath: string;
  assetManifestPath: string;
  worldManifestPath: string;
  rootManifest: RootManifest;
  assetManifest: AssetManifest;
  worldManifest: WorldManifest | null;
  skyboxEntry: GltfExportEntry | null;
  skyboxGltfPath: string | null;
  skyboxGltfUrl: string | null;
  tfragEntry: GltfExportEntry;
  tfragGltfPath: string;
  tfragGltfUrl: string;
  tfragDiagnostics: TfragDiagnostics | null;
  directionalLightPath: string;
  directionalLightUrl: string;
  directionalLights: DirectionalLightRecord[];
}

export interface TfragStats {
  meshes: number;
  sourcePrimitives: number;
  triangles: number;
  lod0Triangles: number | null;
  directionalLightRecords: number;
  materialRebakes: number;
}

export interface SkyboxStats {
  loaded: boolean;
  shells: number;
  animatedShells: number;
  meshes: number;
  primitives: number;
  materials: number;
  additiveMaterials: number;
  triangles: number;
}

export interface TfragMaterialOptions {
  diagnosticMode: DiagnosticMode;
  lightIntensity: number;
  exposure: number;
  cacheMix: number;
  ditherStrength: number;
  postScaleEnabled: boolean;
}

export interface SkyboxRenderOptions {
  visible: boolean;
  animationEnabled: boolean;
  animationSpeed: number;
  blendMode: SkyboxBlendMode;
  alphaFalloff: number;
}

export const defaultTfragMaterialOptions: TfragMaterialOptions = {
  diagnosticMode: 'runtime',
  exposure: 1,
  lightIntensity: 1,
  cacheMix: 0,
  ditherStrength: 0,
  postScaleEnabled: true
};

export const defaultSkyboxRenderOptions: SkyboxRenderOptions = {
  visible: true,
  animationEnabled: true,
  animationSpeed: 1,
  blendMode: 'auto-additive-overlays',
  alphaFalloff: 1
};
