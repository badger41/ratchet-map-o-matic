import type { DeadlockedMapDefinition } from '../../data/deadlockedMaps';
import {
  findIndexedDbRenderPackageBySourceUrl,
  hasViewerRenderPackageEntries,
  saveIndexedDbRenderPackage,
  toIndexedDbPackageSource,
  type IndexedDbRenderPackageMetadata
} from '../renderPackages/indexedDbRenderPackageStore';
import {
  loadRatchetPs2Wasm,
  type DlMobyInstances,
  type DlLevelSettings,
  type RatchetPs2WasmModule
} from '../wasm/ratchetPs2Wasm';
import { fetchWadBytes } from '../wads/fetchWadBytes';
import { extractDlGameplayCore } from './extractDlGameplayCore';

export type MapLoadStageId = 'download' | 'convert' | 'store';
export type MapLoadStageStatus = 'pending' | 'active' | 'done' | 'error';

export interface MapLoadStageDefinition {
  id: MapLoadStageId;
  label: string;
}

export interface MapLoadStageUpdate {
  id: MapLoadStageId;
  status: MapLoadStageStatus;
  detail: string;
  loaded: number | null;
  total: number | null;
}

export interface DeadlockedMapLoadResult {
  map: DeadlockedMapDefinition;
  sourceUrl: string;
  apiVersion: string;
  wadByteLength: number;
  packedByteLength: number;
  entryCount: number;
  cachedPackage: IndexedDbRenderPackageMetadata | null;
  packageSource: string;
  levelSettings: DlLevelSettings | null;
  mobyInstances: DlMobyInstances | null;
  durationMs: number;
}

interface DeadlockedGameplayData {
  levelSettings: DlLevelSettings | null;
  mobyInstances: DlMobyInstances | null;
}

export const mapLoadStageDefinitions: MapLoadStageDefinition[] = [
  { id: 'download', label: 'Download WAD' },
  { id: 'convert', label: 'Build render package' },
  { id: 'store', label: 'Cache package' }
];

export async function preloadDeadlockedMapConverter(map: DeadlockedMapDefinition): Promise<void> {
  if (map.viewerPackageSource) {
    return;
  }

  const existingPackage = await findCachedPackage(map.wadUrl);
  if (existingPackage) {
    return;
  }

  try {
    await loadRatchetPs2Wasm();
  } catch (error) {
    console.warn('Failed to preload Ratchet PS2 WASM converter.', error);
  }
}

export async function loadDeadlockedMapRenderPackage(
  map: DeadlockedMapDefinition,
  onStageUpdate?: (update: MapLoadStageUpdate) => void
): Promise<DeadlockedMapLoadResult> {
  const startedAt = performance.now();
  if (map.viewerPackageSource) {
    return loadLooseViewerPackage(map, startedAt, onStageUpdate);
  }

  const sourceUrl = map.wadUrl;

  onStageUpdate?.({
    id: 'download',
    status: 'active',
    detail: 'Checking cache',
    loaded: null,
    total: null
  });

  const existingPackage = await findCachedPackage(sourceUrl);
  if (existingPackage) {
    onStageUpdate?.({
      id: 'download',
      status: 'done',
      detail: 'Using cached render package',
      loaded: null,
      total: null
    });
    onStageUpdate?.({
      id: 'convert',
      status: 'done',
      detail: `${existingPackage.entryCount} cached entries`,
      loaded: existingPackage.packedByteLength,
      total: existingPackage.packedByteLength
    });
    onStageUpdate?.({
      id: 'store',
      status: 'done',
      detail: existingPackage.id,
      loaded: existingPackage.packedByteLength,
      total: existingPackage.packedByteLength
    });

    return {
      map,
      sourceUrl,
      apiVersion: 'cached',
      wadByteLength: 0,
      packedByteLength: existingPackage.packedByteLength,
      entryCount: existingPackage.entryCount,
      cachedPackage: existingPackage,
      packageSource: toIndexedDbPackageSource(existingPackage.id),
      levelSettings: existingPackage.levelSettings ?? null,
      mobyInstances: existingPackage.mobyInstances ?? null,
      durationMs: performance.now() - startedAt
    };
  }

  onStageUpdate?.({
    id: 'download',
    status: 'active',
    detail: 'Starting',
    loaded: 0,
    total: null
  });
  const wadBytes = await fetchWadBytes(sourceUrl, ({ loaded, total }) => {
    onStageUpdate?.({
      id: 'download',
      status: 'active',
      detail: total ? `${loaded} / ${total} bytes` : `${loaded} bytes`,
      loaded,
      total
    });
  });
  onStageUpdate?.({
    id: 'download',
    status: 'done',
    detail: `${wadBytes.byteLength} bytes`,
    loaded: wadBytes.byteLength,
    total: wadBytes.byteLength
  });

  onStageUpdate?.({
    id: 'convert',
    status: 'active',
    detail: 'Loading WASM runtime',
    loaded: null,
    total: null
  });
  await yieldToBrowser();
  const wasm = await loadRatchetPs2Wasm();
  const apiVersion = await wasm.getApiVersion();

  onStageUpdate?.({
    id: 'convert',
    status: 'active',
    detail: 'Parsing gameplay data',
    loaded: 1,
    total: 3
  });
  const gameplayData = await parseWadGameplayData(wasm, wadBytes);

  onStageUpdate?.({
    id: 'convert',
    status: 'active',
    detail: 'Exporting render assets',
    loaded: 2,
    total: 3
  });
  await yieldToBrowser();
  const renderPackage = await wasm.buildDlLevelWadRenderPackage(wadBytes);
  if (!hasViewerRenderPackageEntries(renderPackage.entries)) {
    throw new Error('WASM render package did not contain the viewer manifest set.');
  }
  onStageUpdate?.({
    id: 'convert',
    status: 'done',
    detail: `${renderPackage.entries.length} entries`,
    loaded: renderPackage.packedBytes.byteLength,
    total: renderPackage.packedBytes.byteLength
  });

  onStageUpdate?.({
    id: 'store',
    status: 'active',
    detail: 'Writing IndexedDB',
    loaded: null,
    total: null
  });
  await yieldToBrowser();
  const cachedPackage = await saveIndexedDbRenderPackage({
    label: map.label,
    sourceUrl,
    wadBytes,
    packedBytes: renderPackage.packedBytes,
    entries: renderPackage.entries,
    levelSettings: gameplayData.levelSettings,
    mobyInstances: gameplayData.mobyInstances
  });
  onStageUpdate?.({
    id: 'store',
    status: 'done',
    detail: cachedPackage.id,
    loaded: renderPackage.packedBytes.byteLength,
    total: renderPackage.packedBytes.byteLength
  });

  return {
    map,
    sourceUrl,
    apiVersion,
    wadByteLength: wadBytes.byteLength,
    packedByteLength: renderPackage.packedBytes.byteLength,
    entryCount: renderPackage.entries.length,
    cachedPackage,
    packageSource: toIndexedDbPackageSource(cachedPackage.id),
    levelSettings: gameplayData.levelSettings,
    mobyInstances: gameplayData.mobyInstances,
    durationMs: performance.now() - startedAt
  };
}

async function parseWadGameplayData(wasm: RatchetPs2WasmModule, wadBytes: Uint8Array): Promise<DeadlockedGameplayData> {
  try {
    const gameplayCore = extractDlGameplayCore(wadBytes);
    if (!gameplayCore) {
      return emptyGameplayData();
    }

    return parseGameplayCore(wasm, gameplayCore);
  } catch (error) {
    console.warn('Failed to parse DL gameplay data.', error);
    return emptyGameplayData();
  }
}

async function parseLooseGameplayData(manifestUrl: string): Promise<DeadlockedGameplayData> {
  try {
    const gameplayCoreUrl = new URL('gameplay/gameplay_core.bin', new URL(manifestUrl, window.location.href));
    const response = await fetch(gameplayCoreUrl);
    if (!response.ok) {
      return emptyGameplayData();
    }

    const wasm = await loadRatchetPs2Wasm();
    return parseGameplayCore(wasm, new Uint8Array(await response.arrayBuffer()));
  } catch (error) {
    console.warn('Failed to parse loose DL gameplay data.', error);
    return emptyGameplayData();
  }
}

async function parseGameplayCore(wasm: RatchetPs2WasmModule, gameplayCore: Uint8Array): Promise<DeadlockedGameplayData> {
  const blocks = (await wasm.parseDlGameplayCore(gameplayCore)).blocks;
  return {
    levelSettings: blocks.find((block) => block.levelSettings)?.levelSettings ?? null,
    mobyInstances: blocks.find((block) => block.mobyInstances)?.mobyInstances ?? null
  };
}

function emptyGameplayData(): DeadlockedGameplayData {
  return {
    levelSettings: null,
    mobyInstances: null
  };
}

async function loadLooseViewerPackage(
  map: DeadlockedMapDefinition,
  startedAt: number,
  onStageUpdate?: (update: MapLoadStageUpdate) => void
): Promise<DeadlockedMapLoadResult> {
  const sourceUrl = map.viewerPackageSource ?? '';

  onStageUpdate?.({
    id: 'download',
    status: 'done',
    detail: 'Using loose export',
    loaded: null,
    total: null
  });
  onStageUpdate?.({
    id: 'convert',
    status: 'active',
    detail: 'Parsing gameplay data',
    loaded: null,
    total: null
  });
  const gameplayData = await parseLooseGameplayData(sourceUrl);
  onStageUpdate?.({
    id: 'convert',
    status: 'done',
    detail: gameplayData.mobyInstances || gameplayData.levelSettings ? 'Parsed gameplay data' : 'Skipped',
    loaded: null,
    total: null
  });
  onStageUpdate?.({
    id: 'store',
    status: 'done',
    detail: 'Skipped',
    loaded: null,
    total: null
  });

  return {
    map,
    sourceUrl,
    apiVersion: 'loose',
    wadByteLength: 0,
    packedByteLength: 0,
    entryCount: 0,
    cachedPackage: null,
    packageSource: sourceUrl,
    levelSettings: gameplayData.levelSettings,
    mobyInstances: gameplayData.mobyInstances,
    durationMs: performance.now() - startedAt
  };
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function findCachedPackage(sourceUrl: string): Promise<IndexedDbRenderPackageMetadata | null> {
  try {
    return await findIndexedDbRenderPackageBySourceUrl(sourceUrl);
  } catch (error) {
    console.warn('Failed to check IndexedDB render package cache.', error);
    return null;
  }
}
