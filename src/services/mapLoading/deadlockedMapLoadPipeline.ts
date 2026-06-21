import type { DeadlockedMapDefinition } from '../../data/deadlockedMaps';
import {
  hasViewerRenderPackageEntries,
  saveIndexedDbRenderPackage,
  type IndexedDbRenderPackageMetadata
} from '../renderPackages/indexedDbRenderPackageStore';
import { loadRatchetPs2Wasm } from '../wasm/ratchetPs2Wasm';
import { fetchWadBytes } from '../wads/fetchWadBytes';

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
  cachedPackage: IndexedDbRenderPackageMetadata;
  durationMs: number;
}

export const mapLoadStageDefinitions: MapLoadStageDefinition[] = [
  { id: 'download', label: 'Download WAD' },
  { id: 'convert', label: 'Build render package' },
  { id: 'store', label: 'Cache package' }
];

export async function loadDeadlockedMapRenderPackage(
  map: DeadlockedMapDefinition,
  onStageUpdate?: (update: MapLoadStageUpdate) => void
): Promise<DeadlockedMapLoadResult> {
  const startedAt = performance.now();
  const sourceUrl = map.wadUrl;

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
    detail: 'Preparing converter',
    loaded: null,
    total: null
  });
  await yieldToBrowser();
  const wasm = await loadRatchetPs2Wasm();
  const apiVersion = await wasm.getApiVersion();
  onStageUpdate?.({
    id: 'convert',
    status: 'active',
    detail: `Exporting render assets with API ${apiVersion}`,
    loaded: null,
    total: null
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
    entries: renderPackage.entries
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
    durationMs: performance.now() - startedAt
  };
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
