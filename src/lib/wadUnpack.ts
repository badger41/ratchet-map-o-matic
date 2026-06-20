import type { DeadlockedMapDefinition } from '../data/deadlockedMaps';
import {
  loadRatchetPs2Wasm,
  type PackedFileEntry
} from './ratchetPs2Wasm';

export type WadUnpackPhase = 'fetch' | 'wasm' | 'unpack';

export interface WadUnpackProgress {
  phase: WadUnpackPhase;
  loaded: number | null;
  total: number | null;
}

export interface WadUnpackResult {
  map: DeadlockedMapDefinition;
  sourceUrl: string;
  apiVersion: string;
  wadByteLength: number;
  packedByteLength: number;
  entries: PackedFileEntry[];
  durationMs: number;
}

export async function unpackDeadlockedWad(
  map: DeadlockedMapDefinition,
  wadUrl: string,
  onProgress?: (progress: WadUnpackProgress) => void
): Promise<WadUnpackResult> {
  const startedAt = performance.now();
  const sourceUrl = normalizeWadUrl(wadUrl);

  onProgress?.({ phase: 'fetch', loaded: 0, total: null });
  const wadBytes = await fetchBytes(sourceUrl, (loaded, total) => {
    onProgress?.({ phase: 'fetch', loaded, total });
  });

  onProgress?.({ phase: 'wasm', loaded: null, total: null });
  await yieldToBrowser();
  const wasm = await loadRatchetPs2Wasm();
  const apiVersion = await wasm.getApiVersion();

  onProgress?.({ phase: 'unpack', loaded: null, total: null });
  await yieldToBrowser();
  const unpacked = await wasm.unpackDlLevelWad(wadBytes);

  return {
    map,
    sourceUrl,
    apiVersion,
    wadByteLength: wadBytes.byteLength,
    packedByteLength: unpacked.packedBytes.byteLength,
    entries: [...unpacked.entries].sort((left, right) => right.length - left.length),
    durationMs: performance.now() - startedAt
  };
}

function normalizeWadUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('WAD URL is empty.');
  }

  return trimmed;
}

async function fetchBytes(url: string, onProgress: (loaded: number, total: number | null) => void): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch WAD: ${response.status} ${response.statusText}`);
  }

  const total = parseContentLength(response.headers.get('content-length'));
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress(bytes.byteLength, bytes.byteLength);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function parseContentLength(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
