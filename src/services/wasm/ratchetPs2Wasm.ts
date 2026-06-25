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
const ratchetPs2WasmAssetVersion = 'render-pipeline-bloom-v1';

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
  const viteBaseUrl = new URL(import.meta.env.BASE_URL, window.location.href);
  return new URL('ratchetps2/', viteBaseUrl).toString();
}
