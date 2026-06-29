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
}

export interface DlMobyInstances {
  staticCount: number;
  spawnableMobyCount: number;
  pad8: number;
  padC: number;
  instances: DlMobyInstance[];
  trailingByteLength: number;
}

export interface DlGameplayBlock {
  levelSettings: DlLevelSettings | null;
  mobyInstances: DlMobyInstances | null;
}

export interface DlGameplayBlocks {
  blocks: DlGameplayBlock[];
}

export interface RatchetPs2WasmModule {
  initializeRatchetPs2Wasm(options?: { assetBaseUrl?: string }): Promise<void>;
  getApiVersion(): Promise<string>;
  unpackDlLevelWad(levelWadBytes: Uint8Array | ArrayBuffer): Promise<PackedFilePackageResult>;
  parseDlGameplayCore(gameplayBytes: Uint8Array | ArrayBuffer): Promise<DlGameplayBlocks>;
  buildDlLevelWadRenderPackage(levelWadBytes: Uint8Array | ArrayBuffer): Promise<PackedFilePackageResult>;
}

let wasmModulePromise: Promise<RatchetPs2WasmModule> | null = null;
const ratchetPs2WasmAssetVersion = import.meta.env.DEV ? `dev-${Date.now()}` : 'moby-render-v1';

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
