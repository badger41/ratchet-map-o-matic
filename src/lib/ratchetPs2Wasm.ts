export const ratchetPs2WasmAssetBaseUrl = '/ratchetps2/';

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

export interface RatchetPs2WasmModule {
  initializeRatchetPs2Wasm(options?: { assetBaseUrl?: string }): Promise<void>;
  getApiVersion(): Promise<string>;
  unpackDlLevelWad(levelWadBytes: Uint8Array | ArrayBuffer): Promise<PackedFilePackageResult>;
  buildDlLevelWadRenderPackage(levelWadBytes: Uint8Array | ArrayBuffer): Promise<PackedFilePackageResult>;
}

let wasmModulePromise: Promise<RatchetPs2WasmModule> | null = null;

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
  const moduleUrl = new URL(
    'ratchetps2-wasm.js',
    new URL(ratchetPs2WasmAssetBaseUrl, window.location.origin)
  );
  const wasm = await import(/* @vite-ignore */ moduleUrl.toString()) as RatchetPs2WasmModule;
  await wasm.initializeRatchetPs2Wasm({ assetBaseUrl: ratchetPs2WasmAssetBaseUrl });
  return wasm;
}
