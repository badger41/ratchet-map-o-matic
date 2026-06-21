import {
  dirnamePackagePath,
  HttpMapAssetPackage,
  joinPackagePath,
  normalizePackagePath,
  toStandaloneArrayBuffer,
  type MapAssetPackage
} from '../mapAssets/mapAssetPackage';
import type {
  AssetManifest,
  DirectionalLightRecord,
  GltfExportEntry,
  LoadedMapPackage,
  RootManifest,
  TfragDiagnostics,
  Vec4,
  WorldManifest
} from './mapPackageTypes';

export function normalizeManifestUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Manifest URL is empty.');
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export async function loadMapPackage(manifestUrlInput: string): Promise<LoadedMapPackage> {
  const manifestUrl = normalizeManifestUrl(manifestUrlInput);
  const manifestUrlObject = new URL(manifestUrl, window.location.href);
  const manifestBaseUrl = new URL('.', manifestUrlObject).toString();
  const assetPackage = new HttpMapAssetPackage(manifestBaseUrl, manifestUrl);

  return loadMapPackageFromAssetPackage(assetPackage, {
    manifestPath: 'manifest.json',
    manifestUrl,
    manifestBaseUrl
  });
}

export interface LoadMapPackageOptions {
  manifestPath?: string;
  manifestUrl?: string;
  manifestBaseUrl?: string;
}

export async function loadMapPackageFromAssetPackage(
  assetPackage: MapAssetPackage,
  options: LoadMapPackageOptions = {}
): Promise<LoadedMapPackage> {
  const manifestPath = normalizePackagePath(options.manifestPath ?? 'manifest.json');
  const manifestRootPath = dirnamePackagePath(manifestPath);
  const manifestUrl = options.manifestUrl ?? await assetPackage.resolveUrl(manifestPath);
  const manifestBaseUrl = options.manifestBaseUrl ?? assetPackage.baseUrl;

  const rootManifest = await assetPackage.readJson<RootManifest>(manifestPath);
  const assetManifestPath = joinPackagePath(manifestRootPath, 'assets/manifest.json');
  const assetManifest = await assetPackage.readJson<AssetManifest>(assetManifestPath);
  const tfragEntry = findTfragGltfEntry(assetManifest);
  const tfragGltfPath = resolveAssetPath(manifestRootPath, requiredString(tfragEntry.GltfPath, 'tfrag GltfPath'));
  const tfragGltfUrl = await assetPackage.resolveUrl(tfragGltfPath);
  const skyboxEntry = findSkyboxGltfEntry(assetManifest);
  const skyboxGltfPath = skyboxEntry?.GltfPath
    ? resolveAssetPath(manifestRootPath, skyboxEntry.GltfPath)
    : null;
  const skyboxGltfUrl = skyboxGltfPath ? await assetPackage.resolveUrl(skyboxGltfPath) : null;

  const worldManifestPath = joinPackagePath(manifestRootPath, 'world/manifest.json');
  const worldManifest = await assetPackage.readOptionalJson<WorldManifest>(worldManifestPath);
  const directionalLightPath = findDirectionalLightPath(worldManifest);
  const directionalLightPackagePath = resolveWorldPath(manifestRootPath, directionalLightPath);
  const directionalLightUrl = await assetPackage.resolveUrl(directionalLightPackagePath);
  const directionalLightBuffer = toStandaloneArrayBuffer(await assetPackage.readBytes(directionalLightPackagePath));
  const directionalLights = parseDirectionalLightRecords(directionalLightBuffer);

  const tfragDiagnosticsPath = tfragEntry.DiagnosticsPath
    ? resolveAssetPath(manifestRootPath, tfragEntry.DiagnosticsPath)
    : null;
  const tfragDiagnostics = tfragDiagnosticsPath
    ? await assetPackage.readOptionalJson<TfragDiagnostics>(tfragDiagnosticsPath)
    : null;

  return {
    assetPackage,
    manifestUrl,
    manifestBaseUrl,
    manifestPath,
    assetManifestPath,
    worldManifestPath,
    rootManifest,
    assetManifest,
    worldManifest,
    skyboxEntry,
    skyboxGltfPath,
    skyboxGltfUrl,
    tfragEntry,
    tfragGltfPath,
    tfragGltfUrl,
    tfragDiagnostics,
    directionalLightPath: directionalLightPackagePath,
    directionalLightUrl,
    directionalLights
  };
}

export function parseDirectionalLightRecords(buffer: ArrayBuffer): DirectionalLightRecord[] {
  const headerSize = 0x10;
  const recordSize = 0x40;

  if (buffer.byteLength < headerSize) {
    throw new Error(`Directional light payload is too small: ${buffer.byteLength} bytes`);
  }

  const recordBytes = buffer.byteLength - headerSize;
  if (recordBytes % recordSize !== 0) {
    throw new Error(`Directional light payload has ${recordBytes} record bytes, not a multiple of 0x40`);
  }

  const view = new DataView(buffer);
  const headerCount = Math.max(0, view.getInt32(0, true));
  const availableCount = recordBytes / recordSize;
  const records: DirectionalLightRecord[] = [];
  const recordCount = Math.min(headerCount, availableCount);

  for (let index = 0; index < recordCount; index += 1) {
    const offset = headerSize + index * recordSize;
    records.push({
      index,
      topColor: readVec4(view, offset),
      topDirection: readVec4(view, offset + 0x10),
      inverseColor: readVec4(view, offset + 0x20),
      inverseDirection: readVec4(view, offset + 0x30)
    });
  }

  return records;
}

function findTfragGltfEntry(assetManifest: AssetManifest): GltfExportEntry {
  const entry = assetManifest.GltfExports?.find((candidate) => {
    return (
      candidate.Family?.toLowerCase() === 'tfrag' &&
      candidate.Status?.toLowerCase() === 'written' &&
      typeof candidate.GltfPath === 'string' &&
      candidate.GltfPath.length > 0
    );
  });

  if (!entry) {
    throw new Error('No written tfrag glTF export found in assets/manifest.json');
  }

  return entry;
}

function findSkyboxGltfEntry(assetManifest: AssetManifest): GltfExportEntry | null {
  return assetManifest.GltfExports?.find((candidate) => {
    return (
      candidate.Family?.toLowerCase() === 'skybox' &&
      candidate.Status?.toLowerCase() === 'written' &&
      typeof candidate.GltfPath === 'string' &&
      candidate.GltfPath.length > 0
    );
  }) ?? null;
}

function findDirectionalLightPath(worldManifest: WorldManifest | null): string {
  return findWorldSlotPath(worldManifest, 'directional_lights') ?? 'lighting/directional_lights.bin';
}

function findWorldSlotPath(worldManifest: WorldManifest | null, semanticName: string): string | null {
  return (
    worldManifest?.Slots?.find((slot) => {
      return slot.SemanticName?.toLowerCase() === semanticName && typeof slot.Path === 'string' && slot.Path.length > 0;
    })?.Path ?? null
  );
}

function resolveAssetPath(manifestRootPath: string, assetPath: string): string {
  return joinPackagePath(manifestRootPath, `assets/${assetPath.replace(/^\/+/, '')}`);
}

function resolveWorldPath(manifestRootPath: string, slotPath: string): string {
  return joinPackagePath(manifestRootPath, `world/${slotPath.replace(/^\/+/, '')}`);
}

function requiredString(value: string | null | undefined, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing ${label}.`);
  }

  return value;
}

function readVec4(view: DataView, offset: number): Vec4 {
  return [
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
    view.getFloat32(offset + 12, true)
  ];
}
