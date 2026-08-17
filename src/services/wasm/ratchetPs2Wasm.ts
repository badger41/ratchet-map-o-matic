export interface PackedFileEntry {
  path: string;
  offset: number;
  length: number;
  contentType: string;
}

export interface PackedFilePackageResult {
  packedBytes: Uint8Array;
  entries: PackedFileEntry[];
}

export type WasmByteArray = Uint8Array | number[] | string;

export interface DlRgb96 {
  red: number;
  green: number;
  blue: number;
}

export interface DlVector3 {
  x: number;
  y: number;
  z: number;
}

export interface DlLevelSettings {
  backgroundColor: DlRgb96;
  fogColor: DlRgb96;
  fogNearDistance: number;
  fogFarDistance: number;
  fogNearIntensity: number;
  fogFarIntensity: number;
}

export interface DlMobyInstance {
  size: number;
  mission: number;
  uid: number;
  bolts: number;
  classId: number;
  scale: number;
  drawDistance: number;
  updateDistance: number;
  unused20: number;
  unused24: number;
  position: DlVector3;
  rotation: DlVector3;
  group: number;
  isRooted: number;
  rootedDistance: number;
  unused4C: number;
  pvarIndex: number;
  occlusion: number;
  modeBits: number;
  color: DlRgb96;
  light: number;
  unused6C: number;
  pvar?: DlMobyInstancePvar | null;
}

export interface DlMobyInstancePvar {
  index: number;
  offset: number;
  length: number;
  data: Uint8Array;
}

export interface DlMobyInstances {
  staticCount: number;
  spawnableMobyCount: number;
  pad8: number;
  padC: number;
  instances: DlMobyInstance[];
  trailingByteLength: number;
}

export interface DlPvarTableEntry {
  index: number;
  offset: number;
  length: number;
  data: WasmByteArray;
}

export interface DlPvarRelativePointer {
  pvarIndex: number;
  offset: number;
}

export interface DlPvarTables {
  mobyLinksBytes: WasmByteArray;
  tableBytes: WasmByteArray;
  dataBytes: WasmByteArray;
  relativePointerBytes: WasmByteArray;
  entries: DlPvarTableEntry[];
  relativePointers: DlPvarRelativePointer[];
}

export interface DlGameplayBlock {
  index: number;
  headerOffset: number;
  pointer: number;
  semanticName: string;
  payloadLength: number;
  levelSettings: DlLevelSettings | null;
  mobyInstances: DlMobyInstances | null;
}

export interface DlGameplayBlocks {
  kind: string;
  headerSize: number;
  pvarTables: DlPvarTables | null;
  blocks: DlGameplayBlock[];
}

export type UyaRgb96 = DlRgb96;
export type UyaVector3 = DlVector3;

export interface UyaLevelSettings extends DlLevelSettings {
  deathHeight: number;
  isSphericalWorld: boolean;
  sphereCenter: UyaVector3;
  shipPosition: UyaVector3;
  shipRotationZ: number;
  shipPath: number;
  shipCameraCuboidStart: number;
  shipCameraCuboidEnd: number;
  padding58: number;
  chunkPlanes: unknown[];
  coreSoundsCount: number;
  rac3ThirdPart: number;
  trailingByteLength: number;
}

export interface UyaMobyInstance {
  size: number;
  mission: number;
  uid: number;
  bolts: number;
  unknown20: number;
  unknown24: number;
  classId: number;
  scale: number;
  drawDistance: number;
  updateDistance: number;
  position: UyaVector3;
  rotation: UyaVector3;
  group: number;
  isRooted: number;
  rootedDistance: number;
  unknown64: number;
  pvarIndex: number;
  occlusion: number;
  modeBits: number;
  color: UyaRgb96;
  light: number;
  unknown84: number;
}

export interface UyaMobyInstances {
  staticCount: number;
  spawnableMobyCount: number;
  pad8: number;
  padC: number;
  instances: UyaMobyInstance[];
  trailingByteLength: number;
}

export interface UyaGameplayBlock {
  index: number;
  headerOffset: number;
  pointer: number;
  semanticName: string;
  payloadLength: number;
  payloadBytes: Uint8Array;
  levelSettings: UyaLevelSettings | null;
  mobyInstances: UyaMobyInstances | null;
}

export interface UyaGameplayBlocks {
  kind: string;
  headerSize: number;
  headerBytes: Uint8Array;
  pvarTables: DlPvarTables | null;
  blocks: UyaGameplayBlock[];
}

export interface RatchetPs2WasmModule {
  initializeRatchetPs2Wasm(options?: { assetBaseUrl?: string }): Promise<void>;
  getApiVersion(): Promise<string>;
  unpackDlLevelWad(levelWadBytes: Uint8Array | ArrayBuffer): Promise<PackedFilePackageResult>;
  unpackUyaLevelWad(levelWadBytes: Uint8Array | ArrayBuffer): Promise<PackedFilePackageResult>;
  parseDlGameplayCore(gameplayBytes: Uint8Array | ArrayBuffer): Promise<DlGameplayBlocks>;
  parseDlGameplayMission(gameplayBytes: Uint8Array | ArrayBuffer): Promise<DlGameplayBlocks>;
  parseUyaGameplayCore(gameplayBytes: Uint8Array | ArrayBuffer): Promise<UyaGameplayBlocks>;
  buildDlLevelWadRenderPackage(levelWadBytes: Uint8Array | ArrayBuffer): Promise<PackedFilePackageResult>;
  buildDlLevelWadRenderPackageEnvelope?(levelWadBytes: Uint8Array | ArrayBuffer): Promise<WasmByteArray>;
  buildGcLevelWadRenderPackage(levelWadBytes: Uint8Array | ArrayBuffer): Promise<PackedFilePackageResult>;
  buildGcLevelWadRenderPackageEnvelope?(levelWadBytes: Uint8Array | ArrayBuffer): Promise<WasmByteArray>;
  buildUyaLevelWadRenderPackage(levelWadBytes: Uint8Array | ArrayBuffer): Promise<PackedFilePackageResult>;
  buildUyaLevelWadRenderPackageEnvelope?(levelWadBytes: Uint8Array | ArrayBuffer): Promise<WasmByteArray>;
  buildUyaCustomMapZipRenderPackage?(zipBytes: Uint8Array | ArrayBuffer): Promise<PackedFilePackageResult>;
  buildUyaCustomMapZipRenderPackageEnvelope?(zipBytes: Uint8Array | ArrayBuffer): Promise<WasmByteArray>;
  buildUyaCustomMapRenderPackage?(zipBytes: Uint8Array | ArrayBuffer): Promise<PackedFilePackageResult>;
  buildUyaCustomMapRenderPackageEnvelope?(zipBytes: Uint8Array | ArrayBuffer): Promise<WasmByteArray>;
}

let wasmModulePromise: Promise<RatchetPs2WasmModule> | null = null;
const ratchetPs2WasmAssetVersion = import.meta.env.DEV ? `dev-${Date.now()}` : 'gc-ties-v3';

export function loadRatchetPs2Wasm(): Promise<RatchetPs2WasmModule> {
  if (!wasmModulePromise) {
    wasmModulePromise = initializeRatchetPs2WasmModule().catch((error: unknown) => {
      wasmModulePromise = null;
      throw error;
    });
  }

  return wasmModulePromise;
}

async function initializeRatchetPs2WasmModule(): Promise<RatchetPs2WasmModule> {
  const assetBaseUrl = resolveRatchetPs2WasmAssetBaseUrl();
  const moduleUrl = new URL('ratchetps2-wasm.js', assetBaseUrl);
  moduleUrl.searchParams.set('v', ratchetPs2WasmAssetVersion);
  const wasm = await import(/* @vite-ignore */ moduleUrl.toString()) as RatchetPs2WasmModule;
  await wasm.initializeRatchetPs2Wasm({ assetBaseUrl });
  return wasm;
}

function resolveRatchetPs2WasmAssetBaseUrl(): string {
  const baseHref = globalThis.location?.href ?? import.meta.url;
  const viteBaseUrl = new URL(import.meta.env.BASE_URL, baseHref);
  return new URL('ratchetps2/', viteBaseUrl).toString();
}
