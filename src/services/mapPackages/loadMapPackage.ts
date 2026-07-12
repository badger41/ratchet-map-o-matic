import {
  dirnamePackagePath,
  HttpMapAssetPackage,
  joinPackagePath,
  normalizePackagePath,
  type MapAssetPackage
} from '../mapAssets/mapAssetPackage';
import {
  binaryByteLength,
  createDataView,
  type BinaryBuffer
} from './binaryBuffer';
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
  const tfragGltfPath = tfragEntry?.GltfPath
    ? resolveAssetPath(manifestRootPath, tfragEntry.GltfPath)
    : null;
  const tfragGltfUrl = tfragGltfPath ? await assetPackage.resolveUrl(tfragGltfPath) : null;
  const tfragChunkEntries = findTfragChunkGltfEntries(assetManifest, assetPackage, manifestRootPath);
  const tfragChunkGltfPaths = tfragChunkEntries.map((entry) => {
    return resolveAssetPath(manifestRootPath, requiredString(entry.GltfPath, 'tfrag chunk glTF path'));
  });
  const tfragChunkGltfUrls = await Promise.all(tfragChunkGltfPaths.map((path) => assetPackage.resolveUrl(path)));
  const skyboxEntry = findSkyboxGltfEntry(assetManifest);
  const skyboxGltfPath = skyboxEntry?.GltfPath
    ? resolveAssetPath(manifestRootPath, skyboxEntry.GltfPath)
    : null;
  const skyboxGltfUrl = skyboxGltfPath ? await assetPackage.resolveUrl(skyboxGltfPath) : null;
  const tieEntries = findTieGltfEntries(assetManifest);
  const mobyEntries = findMobyGltfEntries(assetManifest);
  const shrubEntries = findShrubGltfEntries(assetManifest);

  const worldManifestPath = joinPackagePath(manifestRootPath, 'world/manifest.json');
  const worldManifest = await assetPackage.readOptionalJson<WorldManifest>(worldManifestPath);
  const directionalLightPackagePath = findDirectionalLightPath(manifestRootPath, rootManifest, worldManifest);
  const directionalLightUrl = await assetPackage.resolveUrl(directionalLightPackagePath);
  const directionalLightBytes = await assetPackage.readBytes(directionalLightPackagePath);
  const directionalLights = parseDirectionalLightRecords(directionalLightBytes);
  const tieClassIdsPackagePath = findStaticInstancePath(manifestRootPath, rootManifest, worldManifest, 'tie_class_ids');
  const tieInstancesPackagePath = findStaticInstancePath(manifestRootPath, rootManifest, worldManifest, 'tie_instances');
  const tieColorsPackagePath = findStaticInstancePath(manifestRootPath, rootManifest, worldManifest, 'tie_instance_colors');
  const tieGroupsPackagePath = findStaticInstancePath(manifestRootPath, rootManifest, worldManifest, 'tie_groups');
  const shrubClassIdsPackagePath = findStaticInstancePath(manifestRootPath, rootManifest, worldManifest, 'shrub_class_ids');
  const shrubInstancesPackagePath = findStaticInstancePath(manifestRootPath, rootManifest, worldManifest, 'shrub_instances');
  const shrubGroupsPackagePath = findStaticInstancePath(manifestRootPath, rootManifest, worldManifest, 'shrub_groups');

  const tfragDiagnosticsPath = tfragEntry?.DiagnosticsPath
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
    tfragChunkEntries,
    tfragChunkGltfPaths,
    tfragChunkGltfUrls,
    tfragDiagnostics,
    tieEntries,
    tieClassIdsPath: tieClassIdsPackagePath,
    tieInstancesPath: tieInstancesPackagePath,
    tieColorsPath: tieColorsPackagePath,
    tieGroupsPath: tieGroupsPackagePath,
    tieClassCountExpected: numberValue(worldManifest?.TieClassCount),
    tieInstanceCountExpected: numberValue(worldManifest?.TieInstanceCount),
    mobyEntries,
    shrubEntries,
    shrubClassIdsPath: shrubClassIdsPackagePath,
    shrubInstancesPath: shrubInstancesPackagePath,
    shrubGroupsPath: shrubGroupsPackagePath,
    shrubClassCountExpected: numberValue(worldManifest?.ShrubClassCount),
    shrubInstanceCountExpected: numberValue(worldManifest?.ShrubInstanceCount),
    directionalLightPath: directionalLightPackagePath,
    directionalLightUrl,
    directionalLights
  };
}

export function parseDirectionalLightRecords(buffer: BinaryBuffer): DirectionalLightRecord[] {
  const headerSize = 0x10;
  const recordSize = 0x40;
  const byteLength = binaryByteLength(buffer);

  if (byteLength < headerSize) {
    throw new Error(`Directional light payload is too small: ${byteLength} bytes`);
  }

  const recordBytes = byteLength - headerSize;
  if (recordBytes % recordSize !== 0) {
    throw new Error(`Directional light payload has ${recordBytes} record bytes, not a multiple of 0x40`);
  }

  const view = createDataView(buffer);
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

function findTfragGltfEntry(assetManifest: AssetManifest): GltfExportEntry | null {
  const entries = findWrittenTfragGltfEntries(assetManifest);
  return entries.find((entry) => !isTfragChunkGltfEntry(entry)) ?? null;
}

function findTfragChunkGltfEntries(
  assetManifest: AssetManifest,
  assetPackage: MapAssetPackage,
  manifestRootPath: string
): GltfExportEntry[] {
  const manifestEntries = findWrittenTfragGltfEntries(assetManifest)
    .filter(isTfragChunkGltfEntry)
    .sort(compareGltfExportEntries);

  if (manifestEntries.length > 0) {
    return manifestEntries;
  }

  return findPackedTfragChunkGltfEntries(assetPackage, manifestRootPath);
}

function findWrittenTfragGltfEntries(assetManifest: AssetManifest): GltfExportEntry[] {
  return (assetManifest.GltfExports ?? []).filter((candidate) => {
    return (
      candidate.Family?.toLowerCase() === 'tfrag' &&
      candidate.Status?.toLowerCase() === 'written' &&
      typeof candidate.GltfPath === 'string' &&
      candidate.GltfPath.length > 0
    );
  });
}

function isTfragChunkGltfEntry(entry: GltfExportEntry): boolean {
  return numberValue(entry.ModelId) !== null ||
    isChunkPath(entry.GltfPath) ||
    isChunkPath(entry.SourcePath);
}

function isChunkPath(path: string | null | undefined): boolean {
  if (typeof path !== 'string' || path.length === 0) {
    return false;
  }

  const normalized = normalizePackagePath(path).toLowerCase();
  return normalized.startsWith('chunks/') || normalized.includes('/chunks/');
}

function compareGltfExportEntries(a: GltfExportEntry, b: GltfExportEntry): number {
  const leftModelId = numberValue(a.ModelId);
  const rightModelId = numberValue(b.ModelId);
  if (leftModelId !== null || rightModelId !== null) {
    return (leftModelId ?? Number.MAX_SAFE_INTEGER) - (rightModelId ?? Number.MAX_SAFE_INTEGER);
  }

  return (a.GltfPath ?? '').localeCompare(b.GltfPath ?? '');
}

function findPackedTfragChunkGltfEntries(
  assetPackage: MapAssetPackage,
  manifestRootPath: string
): GltfExportEntry[] {
  return assetPackage.listEntries()
    .map((entry) => createTfragChunkEntryFromPackagePath(entry.path, manifestRootPath))
    .filter((entry): entry is GltfExportEntry => entry !== null)
    .sort(compareGltfExportEntries);
}

function createTfragChunkEntryFromPackagePath(
  packagePath: string,
  manifestRootPath: string
): GltfExportEntry | null {
  const assetPath = toManifestAssetPath(packagePath, manifestRootPath);
  const match = assetPath.match(/^tfrag\/chunks\/chunk(\d+)\/tfrag\.gltf$/i);
  if (!match) {
    return null;
  }

  const modelId = Number(match[1]);
  const chunkDirectory = dirnamePackagePath(assetPath);
  return {
    Family: 'tfrag',
    ModelId: Number.isFinite(modelId) ? modelId : null,
    SourcePath: `${chunkDirectory}/tfrag.bin`,
    GltfPath: assetPath,
    BufferPath: `${chunkDirectory}/tfrag.buffer.bin`,
    Status: 'written'
  };
}

function toManifestAssetPath(packagePath: string, manifestRootPath: string): string {
  const normalizedPath = normalizePackagePath(packagePath);
  const assetRootPath = joinPackagePath(manifestRootPath, 'assets');
  if (!assetRootPath) {
    return normalizedPath.startsWith('assets/')
      ? normalizedPath.slice('assets/'.length)
      : normalizedPath;
  }

  const prefix = `${assetRootPath}/`;
  return normalizedPath.startsWith(prefix)
    ? normalizedPath.slice(prefix.length)
    : normalizedPath;
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

function findTieGltfEntries(assetManifest: AssetManifest): GltfExportEntry[] {
  return findFamilyGltfEntries(assetManifest, 'tie');
}

function findMobyGltfEntries(assetManifest: AssetManifest): GltfExportEntry[] {
  return findFamilyGltfEntries(assetManifest, 'moby');
}

function findShrubGltfEntries(assetManifest: AssetManifest): GltfExportEntry[] {
  return findFamilyGltfEntries(assetManifest, 'shrub');
}

function findFamilyGltfEntries(assetManifest: AssetManifest, family: string): GltfExportEntry[] {
  return (assetManifest.GltfExports ?? [])
    .filter((candidate) => {
      return (
        candidate.Family?.toLowerCase() === family &&
        candidate.Status?.toLowerCase() === 'written' &&
        typeof candidate.GltfPath === 'string' &&
        candidate.GltfPath.length > 0 &&
        numberValue(candidate.ModelId) !== null
      );
    })
    .sort((a, b) => (numberValue(a.ModelId) ?? 0) - (numberValue(b.ModelId) ?? 0));
}

function findDirectionalLightPath(
  manifestRootPath: string,
  rootManifest: RootManifest,
  worldManifest: WorldManifest | null
): string {
  return findStaticInstancePath(manifestRootPath, rootManifest, worldManifest, 'directional_lights')
    ?? resolveWorldPath(manifestRootPath, 'lighting/directional_lights.bin');
}

function findStaticInstancePath(
  manifestRootPath: string,
  rootManifest: RootManifest,
  worldManifest: WorldManifest | null,
  semanticName: string
): string | null {
  const worldPath = findWorldSlotPath(worldManifest, semanticName);
  if (worldPath) {
    return resolveWorldPath(manifestRootPath, worldPath);
  }

  const gameplayCorePath = findUyaGameplayCorePath(rootManifest, semanticName);
  return gameplayCorePath ? joinPackagePath(manifestRootPath, gameplayCorePath) : null;
}

function findUyaGameplayCorePath(rootManifest: RootManifest, semanticName: string): string | null {
  if (typeof rootManifest.Game !== 'string' || rootManifest.Game.toUpperCase() !== 'UYA') {
    return null;
  }

  switch (semanticName) {
    case 'directional_lights':
      return 'gameplay/core/directional_lights.bin';
    case 'tie_class_ids':
      return 'gameplay/core/tie_classes.bin';
    case 'tie_instances':
      return 'gameplay/core/tie_instances.bin';
    case 'tie_instance_colors':
      return 'gameplay/core/tie_ambient_rgbas.bin';
    case 'tie_groups':
      return 'gameplay/core/tie_groups.bin';
    case 'shrub_class_ids':
      return 'gameplay/core/shrub_classes.bin';
    case 'shrub_instances':
      return 'gameplay/core/shrub_instances.bin';
    case 'shrub_groups':
      return 'gameplay/core/shrub_groups.bin';
    default:
      return null;
  }
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

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
