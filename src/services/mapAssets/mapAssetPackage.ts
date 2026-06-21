export interface MapAssetEntry {
  path: string;
  length: number;
  contentType: string;
}

export interface MapAssetPackage {
  readonly id: string;
  readonly baseUrl: string;
  listEntries(): MapAssetEntry[];
  has(path: string): boolean;
  readBytes(path: string): Promise<Uint8Array>;
  readOptionalBytes(path: string): Promise<Uint8Array | null>;
  readText(path: string): Promise<string>;
  readJson<T>(path: string): Promise<T>;
  readOptionalJson<T>(path: string): Promise<T | null>;
  resolveUrl(path: string): Promise<string>;
  dispose(): void;
}

export interface PackedMapAssetEntry {
  path: string;
  offset: number;
  length: number;
  contentType?: string | null;
}

const textDecoder = new TextDecoder();

export class HttpMapAssetPackage implements MapAssetPackage {
  readonly id: string;
  readonly baseUrl: string;

  constructor(baseUrl: string, id = baseUrl) {
    this.baseUrl = new URL(baseUrl, window.location.href).toString();
    this.id = id;
  }

  listEntries(): MapAssetEntry[] {
    return [];
  }

  has(_path: string): boolean {
    return false;
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const response = await fetch(await this.resolveUrl(path));
    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: ${response.status} ${response.statusText}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  async readOptionalBytes(path: string): Promise<Uint8Array | null> {
    const response = await fetch(await this.resolveUrl(path));
    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: ${response.status} ${response.statusText}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  async readText(path: string): Promise<string> {
    return textDecoder.decode(await this.readBytes(path));
  }

  async readJson<T>(path: string): Promise<T> {
    return JSON.parse(await this.readText(path)) as T;
  }

  async readOptionalJson<T>(path: string): Promise<T | null> {
    const bytes = await this.readOptionalBytes(path);
    return bytes ? JSON.parse(textDecoder.decode(bytes)) as T : null;
  }

  async resolveUrl(path: string): Promise<string> {
    return new URL(normalizePackagePath(path), this.baseUrl).toString();
  }

  dispose(): void {
  }
}

export class PackedMapAssetPackage implements MapAssetPackage {
  readonly id: string;
  readonly baseUrl: string;
  private readonly packedBytes: Uint8Array;
  private readonly entries: MapAssetEntry[];
  private readonly entriesByPath = new Map<string, PackedMapAssetEntry>();
  private readonly objectUrlPromises = new Map<string, Promise<string>>();
  private readonly objectUrls = new Set<string>();

  constructor(packedBytes: Uint8Array, entries: PackedMapAssetEntry[], id = 'packed-map-package') {
    this.id = id;
    this.baseUrl = `map-asset://${encodeURIComponent(id)}/`;
    this.packedBytes = packedBytes;
    this.entries = entries.map((entry) => {
      const path = normalizePackagePath(entry.path);
      const normalized = {
        ...entry,
        path,
        contentType: entry.contentType || contentTypeForPath(path)
      };
      this.entriesByPath.set(path, normalized);
      return {
        path,
        length: normalized.length,
        contentType: normalized.contentType
      };
    });
  }

  listEntries(): MapAssetEntry[] {
    return [...this.entries];
  }

  has(path: string): boolean {
    return this.entriesByPath.has(normalizePackagePath(path));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const entry = this.entriesByPath.get(normalizePackagePath(path));
    if (!entry) {
      throw new Error(`Packed map package does not contain '${path}'.`);
    }

    const start = entry.offset;
    const end = entry.offset + entry.length;
    if (start < 0 || end < start || end > this.packedBytes.byteLength) {
      throw new Error(`Packed map package entry '${entry.path}' is out of bounds.`);
    }

    return this.packedBytes.slice(start, end);
  }

  async readOptionalBytes(path: string): Promise<Uint8Array | null> {
    return this.has(path) ? this.readBytes(path) : null;
  }

  async readText(path: string): Promise<string> {
    return textDecoder.decode(await this.readBytes(path));
  }

  async readJson<T>(path: string): Promise<T> {
    return JSON.parse(await this.readText(path)) as T;
  }

  async readOptionalJson<T>(path: string): Promise<T | null> {
    return this.has(path) ? this.readJson<T>(path) : null;
  }

  async resolveUrl(path: string): Promise<string> {
    const normalized = normalizePackagePath(path);
    const cacheKey = /\.gltf$/i.test(normalized) ? `gltf:${normalized}` : `raw:${normalized}`;
    const existing = this.objectUrlPromises.get(cacheKey);
    if (existing) {
      return existing;
    }

    const promise = /\.gltf$/i.test(normalized)
      ? this.createPatchedGltfObjectUrl(normalized)
      : this.createRawObjectUrl(normalized);
    this.objectUrlPromises.set(cacheKey, promise);
    return promise;
  }

  dispose(): void {
    for (const url of this.objectUrls) {
      URL.revokeObjectURL(url);
    }

    this.objectUrls.clear();
    this.objectUrlPromises.clear();
  }

  private async createRawObjectUrl(path: string): Promise<string> {
    const bytes = await this.readBytes(path);
    const entry = this.entriesByPath.get(path);
    const blob = new Blob([toStandaloneArrayBuffer(bytes)], { type: entry?.contentType || contentTypeForPath(path) });
    const url = URL.createObjectURL(blob);
    this.objectUrls.add(url);
    return url;
  }

  private async createPatchedGltfObjectUrl(path: string): Promise<string> {
    const gltf = await this.readJson<Record<string, unknown>>(path);
    await this.rewriteGltfResourceUris(gltf, dirnamePackagePath(path));
    const blob = new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' });
    const url = URL.createObjectURL(blob);
    this.objectUrls.add(url);
    return url;
  }

  private async rewriteGltfResourceUris(gltf: Record<string, unknown>, basePath: string): Promise<void> {
    await this.rewriteUriList(gltf.buffers, basePath);
    await this.rewriteUriList(gltf.images, basePath);
  }

  private async rewriteUriList(value: unknown, basePath: string): Promise<void> {
    if (!Array.isArray(value)) {
      return;
    }

    await Promise.all(value.map(async (item) => {
      if (!isRecord(item) || typeof item.uri !== 'string' || !isRelativeResourceUri(item.uri)) {
        return;
      }

      const resourcePath = joinPackagePath(basePath, safeDecodeUriComponent(item.uri));
      if (this.has(resourcePath)) {
        item.uri = await this.resolveUrl(resourcePath);
      }
    }));
  }
}

export function normalizePackagePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part.length > 0 && part !== '.')
    .join('/');
}

export function joinPackagePath(basePath: string, relativePath: string): string {
  const parts: string[] = [];
  for (const part of `${basePath}/${relativePath}`.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') {
      continue;
    }

    if (part === '..') {
      parts.pop();
      continue;
    }

    parts.push(part);
  }

  return parts.join('/');
}

export function dirnamePackagePath(path: string): string {
  const normalized = normalizePackagePath(path);
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.substring(0, index) : '';
}

export function toStandaloneArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function isRelativeResourceUri(uri: string): boolean {
  return !/^(?:[a-z]+:|\/\/)/i.test(uri);
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function contentTypeForPath(path: string): string {
  switch (path.split('.').pop()?.toLowerCase()) {
    case 'gltf':
      return 'model/gltf+json';
    case 'json':
      return 'application/json';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'bin':
    case 'dat':
    case 'wad':
    case 'bnk':
    case 'pif':
    default:
      return 'application/octet-stream';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
