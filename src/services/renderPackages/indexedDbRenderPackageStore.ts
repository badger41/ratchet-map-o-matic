import type {
  DlMobyInstances,
  DlLevelSettings,
  PackedFileEntry
} from '../wasm/ratchetPs2Wasm';

const databaseName = 'ratchet-map-o-matic';
const databaseVersion = 1;
const metadataStoreName = 'renderPackageMetadata';
const payloadStoreName = 'renderPackagePayloads';
const sourcePrefix = 'idb:';
const textDecoder = new TextDecoder();
const renderPackageFormatVersion = import.meta.env.DEV ? `dev-${Date.now()}` : 'moby-render-v1';

export interface IndexedDbRenderPackageMetadata {
  id: string;
  cacheVersion?: string;
  label: string;
  sourceUrl: string;
  createdAt: number;
  updatedAt: number;
  game: string | null;
  level: number | null;
  packedByteLength: number;
  entryCount: number;
  entries: PackedFileEntry[];
  levelSettings?: DlLevelSettings | null;
  mobyInstances?: DlMobyInstances | null;
}

export interface IndexedDbRenderPackageRecord extends IndexedDbRenderPackageMetadata {
  packedBytes: Uint8Array;
}

export interface SaveIndexedDbRenderPackageOptions {
  label: string;
  sourceUrl: string;
  wadBytes: Uint8Array;
  packedBytes: Uint8Array;
  entries: PackedFileEntry[];
  levelSettings?: DlLevelSettings | null;
  mobyInstances?: DlMobyInstances | null;
}

interface IndexedDbRenderPackagePayload {
  id: string;
  packedBytes: Uint8Array | ArrayBuffer;
}

export function toIndexedDbPackageSource(id: string): string {
  return `${sourcePrefix}${id}`;
}

export function isIndexedDbPackageSource(value: string): boolean {
  return value.trim().startsWith(sourcePrefix);
}

export function parseIndexedDbPackageSource(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.startsWith(sourcePrefix) ? trimmed.slice(sourcePrefix.length) : null;
}

export async function saveIndexedDbRenderPackage(
  options: SaveIndexedDbRenderPackageOptions
): Promise<IndexedDbRenderPackageMetadata> {
  const entries = normalizeEntries(options.entries);
  const sourceUrl = normalizeSourceUrl(options.sourceUrl);
  const rootManifest = readPackedJson<{ Game?: unknown; Level?: unknown }>(
    options.packedBytes,
    entries,
    'manifest.json'
  );
  const id = `render-package:${await sha256Hex(options.wadBytes)}`;
  const existing = await getMetadata(id);
  const now = Date.now();
  const metadata: IndexedDbRenderPackageMetadata = {
    id,
    cacheVersion: renderPackageFormatVersion,
    label: options.label,
    sourceUrl,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    game: stringValue(rootManifest?.Game),
    level: numberValue(rootManifest?.Level),
    packedByteLength: options.packedBytes.byteLength,
    entryCount: entries.length,
    entries,
    levelSettings: options.levelSettings ?? null,
    mobyInstances: options.mobyInstances ?? null
  };

  const db = await openDatabase();
  try {
    const transaction = db.transaction([metadataStoreName, payloadStoreName], 'readwrite');
    transaction.objectStore(metadataStoreName).put(metadata);
    transaction.objectStore(payloadStoreName).put({
      id,
      packedBytes: options.packedBytes
    } satisfies IndexedDbRenderPackagePayload);
    await transactionComplete(transaction);
  } finally {
    db.close();
  }

  return metadata;
}

export async function findIndexedDbRenderPackageBySourceUrl(
  sourceUrl: string
): Promise<IndexedDbRenderPackageMetadata | null> {
  const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
  const records = await listIndexedDbRenderPackages();
  return (
    records.find((record) => {
      return (
        record.cacheVersion === renderPackageFormatVersion &&
        normalizeSourceUrl(record.sourceUrl) === normalizedSourceUrl &&
        hasViewerRenderPackageEntries(record.entries)
      );
    }) ?? null
  );
}

export async function listIndexedDbRenderPackages(): Promise<IndexedDbRenderPackageMetadata[]> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(metadataStoreName, 'readonly');
    const records = await requestToPromise<IndexedDbRenderPackageMetadata[]>(
      transaction.objectStore(metadataStoreName).getAll()
    );
    await transactionComplete(transaction);
    return records.sort((left, right) => right.updatedAt - left.updatedAt);
  } finally {
    db.close();
  }
}

export async function loadIndexedDbRenderPackage(id: string): Promise<IndexedDbRenderPackageRecord> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction([metadataStoreName, payloadStoreName], 'readonly');
    const metadata = await requestToPromise<IndexedDbRenderPackageMetadata | undefined>(
      transaction.objectStore(metadataStoreName).get(id)
    );
    const payload = await requestToPromise<IndexedDbRenderPackagePayload | undefined>(
      transaction.objectStore(payloadStoreName).get(id)
    );
    await transactionComplete(transaction);

    if (!metadata || !payload) {
      throw new Error(`Cached render package '${id}' was not found.`);
    }

    return {
      ...metadata,
      packedBytes: normalizeBytes(payload.packedBytes)
    };
  } finally {
    db.close();
  }
}

export async function deleteIndexedDbRenderPackage(id: string): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction([metadataStoreName, payloadStoreName], 'readwrite');
    transaction.objectStore(metadataStoreName).delete(id);
    transaction.objectStore(payloadStoreName).delete(id);
    await transactionComplete(transaction);
  } finally {
    db.close();
  }
}

export function hasViewerRenderPackageEntries(entries: PackedFileEntry[]): boolean {
  const paths = new Set(entries.map((entry) => normalizePackagePath(entry.path)));
  return paths.has('manifest.json') && paths.has('assets/manifest.json') && paths.has('world/manifest.json');
}

async function getMetadata(id: string): Promise<IndexedDbRenderPackageMetadata | null> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(metadataStoreName, 'readonly');
    const metadata = await requestToPromise<IndexedDbRenderPackageMetadata | undefined>(
      transaction.objectStore(metadataStoreName).get(id)
    );
    await transactionComplete(transaction);
    return metadata ?? null;
  } finally {
    db.close();
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(metadataStoreName)) {
        const metadataStore = db.createObjectStore(metadataStoreName, { keyPath: 'id' });
        metadataStore.createIndex('updatedAt', 'updatedAt');
      }

      if (!db.objectStoreNames.contains(payloadStoreName)) {
        db.createObjectStore(payloadStoreName, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', standaloneArrayBuffer(bytes));
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  }

  return fallbackHashHex(bytes);
}

function fallbackHashHex(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function standaloneArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer;
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function normalizeBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function normalizeEntries(entries: PackedFileEntry[]): PackedFileEntry[] {
  return entries.map((entry) => ({
    path: normalizePackagePath(entry.path),
    offset: entry.offset,
    length: entry.length,
    contentType: entry.contentType || 'application/octet-stream'
  }));
}

function normalizePackagePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function normalizeSourceUrl(sourceUrl: string): string {
  const trimmed = sourceUrl.trim();
  try {
    return new URL(trimmed, window.location.href).toString();
  } catch {
    return trimmed;
  }
}

function readPackedJson<T>(packedBytes: Uint8Array, entries: PackedFileEntry[], path: string): T | null {
  const normalizedPath = normalizePackagePath(path);
  const entry = entries.find((candidate) => normalizePackagePath(candidate.path) === normalizedPath);
  if (!entry) {
    return null;
  }

  const start = entry.offset;
  const end = start + entry.length;
  if (start < 0 || end < start || end > packedBytes.byteLength) {
    return null;
  }

  return JSON.parse(textDecoder.decode(packedBytes.slice(start, end))) as T;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
