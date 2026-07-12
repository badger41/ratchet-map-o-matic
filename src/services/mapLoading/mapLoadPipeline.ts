import type { MapDefinition } from '../../data/mapCatalog';
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
  type DlMobyInstance,
  type DlLevelSettings,
  type DlPvarTables,
  type PackedFileEntry,
  type PackedFilePackageResult,
  type WasmByteArray,
  type RatchetPs2WasmModule
} from '../wasm/ratchetPs2Wasm';
import { fetchMapSourceBytes } from './fetchMapSourceBytes';

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

export interface MapLoadResult {
  map: MapDefinition;
  sourceUrl: string;
  apiVersion: string;
  sourceByteLength: number;
  packedByteLength: number;
  entryCount: number;
  cachedPackage: IndexedDbRenderPackageMetadata | null;
  packageSource: string;
  levelSettings: DlLevelSettings | null;
  mobyInstances: DlMobyInstances | null;
  durationMs: number;
}

interface GameplayData {
  levelSettings: DlLevelSettings | null;
  mobyInstances: DlMobyInstances | null;
}

interface UyaGameplayCoreFiles {
  levelSettings: Uint8Array | null;
  mobyInstances: Uint8Array | null;
  pvarMobyLinks: Uint8Array | null;
  pvarTable: Uint8Array | null;
  pvarData: Uint8Array | null;
  pvarRelativePointers: Uint8Array | null;
}

export const mapLoadStageDefinitions: MapLoadStageDefinition[] = [
  { id: 'download', label: 'Download map' },
  { id: 'convert', label: 'Build render package' },
  { id: 'store', label: 'Cache package' }
];

export async function preloadMapConverter(map: MapDefinition): Promise<void> {
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

export async function loadMapRenderPackage(
  map: MapDefinition,
  onStageUpdate?: (update: MapLoadStageUpdate) => void
): Promise<MapLoadResult> {
  const startedAt = performance.now();
  if (map.viewerPackageSource) {
    return loadLooseViewerPackage(map, startedAt, onStageUpdate);
  }

  const sourceUrl = map.wadUrl;
  const sourceLabel = map.sourceKind === 'customZip' ? 'custom map ZIP' : 'WAD';

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
      sourceByteLength: 0,
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
  const sourceBytes = await fetchMapSourceBytes(sourceUrl, ({ loaded, total }) => {
    onStageUpdate?.({
      id: 'download',
      status: 'active',
      detail: total ? `${loaded} / ${total} bytes` : `${loaded} bytes`,
      loaded,
      total
    });
  }, sourceLabel);
  onStageUpdate?.({
    id: 'download',
    status: 'done',
    detail: `${sourceBytes.byteLength} bytes`,
    loaded: sourceBytes.byteLength,
    total: sourceBytes.byteLength
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

  const usesOptimizedRenderBridge = hasRenderPackageEnvelope(wasm, map);
  onStageUpdate?.({
    id: 'convert',
    status: 'active',
    detail: usesOptimizedRenderBridge ? 'Exporting render assets with optimized bridge' : 'Exporting render assets',
    loaded: 1,
    total: 3
  });
  await yieldToBrowser();
  const renderPackage = await buildRenderPackage(wasm, map, sourceBytes);
  if (!hasViewerRenderPackageEntries(renderPackage.entries)) {
    throw new Error('WASM render package did not contain the viewer manifest set.');
  }

  onStageUpdate?.({
    id: 'convert',
    status: 'active',
    detail: 'Parsing gameplay data',
    loaded: 2,
    total: 3
  });
  const gameplayData = await parsePackedGameplayData(wasm, renderPackage, map.gameId);
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
    wadBytes: sourceBytes,
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
    sourceByteLength: sourceBytes.byteLength,
    packedByteLength: renderPackage.packedBytes.byteLength,
    entryCount: renderPackage.entries.length,
    cachedPackage,
    packageSource: toIndexedDbPackageSource(cachedPackage.id),
    levelSettings: gameplayData.levelSettings,
    mobyInstances: gameplayData.mobyInstances,
    durationMs: performance.now() - startedAt
  };
}

async function buildRenderPackage(
  wasm: RatchetPs2WasmModule,
  map: MapDefinition,
  sourceBytes: Uint8Array
): Promise<PackedFilePackageResult> {
  return map.sourceKind === 'customZip'
    ? buildUyaCustomMapZipRenderPackage(wasm, sourceBytes)
    : buildWadRenderPackage(wasm, map.gameId, sourceBytes);
}

async function buildWadRenderPackage(
  wasm: RatchetPs2WasmModule,
  gameId: MapDefinition['gameId'],
  wadBytes: Uint8Array
): Promise<PackedFilePackageResult> {
  if (gameId === 'UYA') {
    if (!wasm.buildUyaLevelWadRenderPackageEnvelope) {
      throw new Error('Optimized UYA WASM render package export is not loaded. Hard-refresh the page and retry.');
    }

    return decodeRenderPackageEnvelope(await wasm.buildUyaLevelWadRenderPackageEnvelope(wadBytes));
  }

  return wasm.buildDlLevelWadRenderPackageEnvelope
    ? decodeRenderPackageEnvelope(await wasm.buildDlLevelWadRenderPackageEnvelope(wadBytes))
    : wasm.buildDlLevelWadRenderPackage(wadBytes);
}

async function buildUyaCustomMapZipRenderPackage(
  wasm: RatchetPs2WasmModule,
  zipBytes: Uint8Array
): Promise<PackedFilePackageResult> {
  const envelopeBuilder = wasm.buildUyaCustomMapZipRenderPackageEnvelope
    ?? wasm.buildUyaCustomMapRenderPackageEnvelope;
  if (envelopeBuilder) {
    return decodeRenderPackageEnvelope(await envelopeBuilder(zipBytes));
  }

  const packageBuilder = wasm.buildUyaCustomMapZipRenderPackage
    ?? wasm.buildUyaCustomMapRenderPackage;
  if (packageBuilder) {
    return packageBuilder(zipBytes);
  }

  throw new Error('UYA custom map ZIP WASM render package export is not loaded. Refresh the page after updating the Ratchet PS2 WASM bridge.');
}

function hasRenderPackageEnvelope(
  wasm: RatchetPs2WasmModule,
  map: MapDefinition
): boolean {
  if (map.sourceKind === 'customZip') {
    return Boolean(wasm.buildUyaCustomMapZipRenderPackageEnvelope ?? wasm.buildUyaCustomMapRenderPackageEnvelope);
  }

  return map.gameId === 'UYA'
    ? Boolean(wasm.buildUyaLevelWadRenderPackageEnvelope)
    : Boolean(wasm.buildDlLevelWadRenderPackageEnvelope);
}

function decodeRenderPackageEnvelope(envelope: WasmByteArray): PackedFilePackageResult {
  const bytes = normalizeBytes(envelope);
  if (bytes.byteLength < 4) {
    throw new Error('WASM render package envelope is too small.');
  }

  const entriesJsonLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(0, true);
  const entriesJsonOffset = 4;
  const packedBytesOffset = entriesJsonOffset + entriesJsonLength;
  if (entriesJsonLength < 0 || packedBytesOffset > bytes.byteLength) {
    throw new Error('WASM render package envelope has invalid entry metadata length.');
  }

  const entriesJson = new TextDecoder().decode(bytes.subarray(entriesJsonOffset, packedBytesOffset));
  return {
    packedBytes: bytes.subarray(packedBytesOffset),
    entries: normalizePackedFileEntries(JSON.parse(entriesJson) as unknown[])
  };
}

async function parsePackedGameplayData(
  wasm: RatchetPs2WasmModule,
  renderPackage: PackedFilePackageResult,
  gameId: MapDefinition['gameId']
): Promise<GameplayData> {
  if (gameId === 'UYA') {
    return parsePackedUyaGameplayData(renderPackage);
  }

  const gameplayCore = readPackedFileBytes(renderPackage, 'gameplay/gameplay_core.bin');
  if (!gameplayCore) {
    throw new Error('WASM render package did not include gameplay/gameplay_core.bin.');
  }

  try {
    return await parseGameplayCore(wasm, gameplayCore);
  } catch (error) {
    console.warn('Failed to parse packed DL gameplay data.', error);
    return emptyGameplayData();
  }
}

async function parseLooseGameplayData(
  manifestUrl: string,
  gameId: MapDefinition['gameId']
): Promise<GameplayData> {
  if (gameId === 'UYA') {
    try {
      return await parseLooseUyaGameplayData(manifestUrl);
    } catch (error) {
      console.warn('Failed to parse loose UYA gameplay data.', error);
      return emptyGameplayData();
    }
  }

  if (gameId !== 'DL') {
    return emptyGameplayData();
  }

  try {
    const gameplayCore = await fetchLooseGameplayCore(manifestUrl);
    if (!gameplayCore) {
      return emptyGameplayData();
    }

    const wasm = await loadRatchetPs2Wasm();
    return await parseGameplayCore(wasm, gameplayCore);
  } catch (error) {
    console.warn('Failed to parse loose DL gameplay data.', error);
    return emptyGameplayData();
  }
}

async function fetchLooseGameplayCore(manifestUrl: string): Promise<Uint8Array | null> {
  const gameplayCoreUrl = new URL('gameplay/gameplay_core.bin', new URL(manifestUrl, window.location.href));
  const response = await fetch(gameplayCoreUrl);
  return response.ok && !isHtmlResponse(response)
    ? new Uint8Array(await response.arrayBuffer())
    : null;
}

async function parseGameplayCore(wasm: RatchetPs2WasmModule, gameplayCore: Uint8Array): Promise<GameplayData> {
  const gameplay = await wasm.parseDlGameplayCore(gameplayCore);
  const pvarTables = normalizeDlPvarTables(gameplay.pvarTables);
  const mobyInstances = gameplay.blocks.find((block) => block.mobyInstances)?.mobyInstances ?? null;
  return {
    levelSettings: gameplay.blocks.find((block) => block.levelSettings)?.levelSettings ?? null,
    mobyInstances: attachMobyPvars(mobyInstances, pvarTables)
  };
}

async function parseLooseUyaGameplayData(manifestUrl: string): Promise<GameplayData> {
  return parseUyaGameplayCoreFiles(await fetchLooseUyaGameplayCoreFiles(manifestUrl));
}

async function fetchLooseUyaGameplayCoreFiles(manifestUrl: string): Promise<UyaGameplayCoreFiles> {
  const [
    levelSettings,
    mobyInstances,
    pvarMobyLinks,
    pvarTable,
    pvarData,
    pvarRelativePointers
  ] = await Promise.all([
    fetchLooseUyaCoreFile(manifestUrl, 'level_settings.bin'),
    fetchLooseUyaCoreFile(manifestUrl, 'moby_instances.bin'),
    fetchLooseUyaCoreFile(manifestUrl, 'pvar_moby_links.bin'),
    fetchLooseUyaCoreFile(manifestUrl, 'pvar_table.bin'),
    fetchLooseUyaCoreFile(manifestUrl, 'pvar_data.bin'),
    fetchLooseUyaCoreFile(manifestUrl, 'pvar_relative_pointers.bin')
  ]);

  return {
    levelSettings,
    mobyInstances,
    pvarMobyLinks,
    pvarTable,
    pvarData,
    pvarRelativePointers
  };
}

function parsePackedUyaGameplayData(renderPackage: PackedFilePackageResult): GameplayData {
  const files: UyaGameplayCoreFiles = {
    levelSettings: readPackedFileBytes(renderPackage, 'gameplay/core/level_settings.bin'),
    mobyInstances: readRequiredPackedFileBytes(renderPackage, 'gameplay/core/moby_instances.bin'),
    pvarMobyLinks: readPackedFileBytes(renderPackage, 'gameplay/core/pvar_moby_links.bin'),
    pvarTable: readPackedFileBytes(renderPackage, 'gameplay/core/pvar_table.bin'),
    pvarData: readPackedFileBytes(renderPackage, 'gameplay/core/pvar_data.bin'),
    pvarRelativePointers: readPackedFileBytes(renderPackage, 'gameplay/core/pvar_relative_pointers.bin')
  };
  try {
    return parseUyaGameplayCoreFiles(files);
  } catch (error) {
    console.warn('Failed to parse packed UYA gameplay data.', error);
    return emptyGameplayData();
  }
}

async function fetchLooseUyaCoreFile(manifestUrl: string, fileName: string): Promise<Uint8Array | null> {
  const fileUrl = new URL(`gameplay/core/${fileName}`, new URL(manifestUrl, window.location.href));
  const response = await fetch(fileUrl);
  return response.ok && !isHtmlResponse(response)
    ? new Uint8Array(await response.arrayBuffer())
    : null;
}

function parseUyaGameplayCoreFiles(files: UyaGameplayCoreFiles): GameplayData {
  const pvarTables = parsePvarTables(
    files.pvarMobyLinks,
    files.pvarTable,
    files.pvarData,
    files.pvarRelativePointers);

  return {
    levelSettings: files.levelSettings ? parseUyaLevelSettings(files.levelSettings) : null,
    mobyInstances: attachMobyPvars(
      files.mobyInstances ? parseUyaMobyInstances(files.mobyInstances) : null,
      pvarTables)
  };
}

function readRequiredPackedFileBytes(renderPackage: PackedFilePackageResult, path: string): Uint8Array {
  const bytes = readPackedFileBytes(renderPackage, path);
  if (!bytes) {
    throw new Error(`WASM render package did not include ${path}.`);
  }

  return bytes;
}

function readPackedFileBytes(renderPackage: PackedFilePackageResult, path: string): Uint8Array | null {
  const normalizedPath = normalizePackagePath(path);
  const entry = renderPackage.entries.find((candidate) => normalizePackagePath(candidate.path) === normalizedPath);
  if (!entry) {
    return null;
  }

  if (entry.offset < 0 || entry.length < 0 || entry.offset + entry.length > renderPackage.packedBytes.byteLength) {
    throw new Error(`Packed file '${path}' points outside the render package.`);
  }

  return renderPackage.packedBytes.slice(entry.offset, entry.offset + entry.length);
}

function normalizePackagePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function parseUyaLevelSettings(bytes: Uint8Array): DlLevelSettings {
  const requiredLength = 0x28;
  if (bytes.byteLength < requiredLength) {
    throw new Error(`UYA level settings payload is too small: ${bytes.byteLength} bytes`);
  }

  const view = dataViewFor(bytes);
  return {
    backgroundColor: readRgb96(view, 0x00),
    fogColor: readRgb96(view, 0x0c),
    fogNearDistance: readFloat32(view, 0x18),
    fogFarDistance: readFloat32(view, 0x1c),
    fogNearIntensity: readFloat32(view, 0x20),
    fogFarIntensity: readFloat32(view, 0x24)
  };
}

function parseUyaMobyInstances(bytes: Uint8Array): DlMobyInstances {
  const headerSize = 0x10;
  const recordSize = 0x88;
  if (bytes.byteLength < headerSize) {
    throw new Error(`UYA moby instances payload is too small: ${bytes.byteLength} bytes`);
  }

  const view = dataViewFor(bytes);
  const staticCount = view.getInt32(0x00, true);
  if (staticCount < 0) {
    throw new Error('UYA moby instance count cannot be negative.');
  }

  const recordsLength = staticCount * recordSize;
  if (headerSize + recordsLength > bytes.byteLength) {
    throw new Error(`UYA moby instances payload has ${bytes.byteLength} bytes, expected at least ${headerSize + recordsLength}.`);
  }

  const instances: DlMobyInstance[] = [];
  for (let index = 0; index < staticCount; index += 1) {
    instances.push(parseUyaMobyInstance(view, headerSize + index * recordSize));
  }

  return {
    staticCount,
    spawnableMobyCount: view.getInt32(0x04, true),
    pad8: view.getInt32(0x08, true),
    padC: view.getInt32(0x0c, true),
    instances,
    trailingByteLength: bytes.byteLength - headerSize - recordsLength
  };
}

function parseUyaMobyInstance(view: DataView, offset: number): DlMobyInstance {
  return {
    size: view.getInt32(offset + 0x00, true),
    mission: view.getInt32(offset + 0x04, true),
    uid: view.getInt32(offset + 0x10, true),
    bolts: view.getInt32(offset + 0x14, true),
    classId: view.getInt32(offset + 0x28, true),
    scale: readFloat32(view, offset + 0x2c),
    drawDistance: view.getInt32(offset + 0x30, true),
    updateDistance: view.getInt32(offset + 0x34, true),
    unused20: view.getInt32(offset + 0x20, true),
    unused24: view.getInt32(offset + 0x24, true),
    position: readVector3(view, offset + 0x40),
    rotation: readVector3(view, offset + 0x4c),
    group: view.getInt32(offset + 0x58, true),
    isRooted: view.getInt32(offset + 0x5c, true),
    rootedDistance: readFloat32(view, offset + 0x60),
    unused4C: view.getInt32(offset + 0x64, true),
    pvarIndex: view.getInt32(offset + 0x68, true),
    occlusion: view.getInt32(offset + 0x6c, true),
    modeBits: view.getInt32(offset + 0x70, true),
    color: readRgb96(view, offset + 0x74),
    light: view.getInt32(offset + 0x80, true),
    unused6C: view.getInt32(offset + 0x84, true)
  };
}

function parsePvarTables(
  mobyLinksBytes: Uint8Array | null,
  tableBytes: Uint8Array | null,
  dataBytes: Uint8Array | null,
  relativePointerBytes: Uint8Array | null
): DlPvarTables | null {
  if (!mobyLinksBytes && !tableBytes && !dataBytes && !relativePointerBytes) {
    return null;
  }

  const table = tableBytes ?? new Uint8Array();
  const data = dataBytes ?? new Uint8Array();
  return {
    mobyLinksBytes: mobyLinksBytes ?? new Uint8Array(),
    tableBytes: table,
    dataBytes: data,
    relativePointerBytes: relativePointerBytes ?? new Uint8Array(),
    entries: parsePvarTableEntries(table, data),
    relativePointers: parsePvarRelativePointers(relativePointerBytes ?? new Uint8Array())
  };
}

function parsePvarTableEntries(tableBytes: Uint8Array, dataBytes: Uint8Array): DlPvarTables['entries'] {
  const entrySize = 8;
  if (tableBytes.byteLength % entrySize !== 0) {
    throw new Error(`UYA pvar table length must be divisible by ${entrySize}.`);
  }

  const tableView = dataViewFor(tableBytes);
  const entries: DlPvarTables['entries'] = [];
  for (let index = 0; index < tableBytes.byteLength / entrySize; index += 1) {
    const offset = tableView.getInt32(index * entrySize, true);
    const length = tableView.getInt32(index * entrySize + 4, true);
    if (offset < 0 || length < 0 || offset + length > dataBytes.byteLength) {
      throw new Error(`UYA pvar table entry ${index} points outside pvar data.`);
    }

    entries.push({
      index,
      offset,
      length,
      data: dataBytes.subarray(offset, offset + length)
    });
  }

  return entries;
}

function parsePvarRelativePointers(bytes: Uint8Array): DlPvarTables['relativePointers'] {
  const entrySize = 8;
  if (bytes.byteLength % entrySize !== 0) {
    throw new Error(`UYA pvar relative pointer table length must be divisible by ${entrySize}.`);
  }

  const view = dataViewFor(bytes);
  const pointers: DlPvarTables['relativePointers'] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += entrySize) {
    pointers.push({
      pvarIndex: view.getInt32(offset, true),
      offset: view.getInt32(offset + 4, true)
    });
  }

  return pointers;
}

function readRgb96(view: DataView, offset: number): { red: number; green: number; blue: number } {
  return {
    red: view.getInt32(offset, true),
    green: view.getInt32(offset + 4, true),
    blue: view.getInt32(offset + 8, true)
  };
}

function readVector3(view: DataView, offset: number): { x: number; y: number; z: number } {
  return {
    x: readFloat32(view, offset),
    y: readFloat32(view, offset + 4),
    z: readFloat32(view, offset + 8)
  };
}

function readFloat32(view: DataView, offset: number): number {
  return view.getFloat32(offset, true);
}

function dataViewFor(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function isHtmlResponse(response: Response): boolean {
  return response.headers.get('content-type')?.toLowerCase().includes('text/html') ?? false;
}

function attachMobyPvars(mobyInstances: DlMobyInstances | null, pvarTables: DlPvarTables | null): DlMobyInstances | null {
  if (!mobyInstances || !pvarTables) {
    return mobyInstances;
  }

  return {
    ...mobyInstances,
    instances: mobyInstances.instances.map((instance) => {
      const entry = instance.pvarIndex >= 0 ? pvarTables.entries[instance.pvarIndex] : null;
      return {
        ...instance,
        pvar: entry
          ? {
              index: entry.index,
              offset: entry.offset,
              length: entry.length,
              data: normalizeBytes(entry.data)
            }
          : null
      };
    })
  };
}

function normalizeDlPvarTables(pvarTables: DlPvarTables | null | undefined): DlPvarTables | null {
  if (!pvarTables) {
    return null;
  }

  return {
    ...pvarTables,
    mobyLinksBytes: normalizeBytes(pvarTables.mobyLinksBytes),
    tableBytes: normalizeBytes(pvarTables.tableBytes),
    dataBytes: normalizeBytes(pvarTables.dataBytes),
    relativePointerBytes: normalizeBytes(pvarTables.relativePointerBytes),
    entries: pvarTables.entries.map((entry) => ({
      ...entry,
      data: normalizeBytes(entry.data)
    }))
  };
}

function normalizePackedFileEntries(entries: unknown[]): PackedFileEntry[] {
  return entries.map((entry) => {
    const value = entry as Partial<PackedFileEntry> & {
      Path?: unknown;
      Offset?: unknown;
      Length?: unknown;
      ContentType?: unknown;
    };
    return {
      path: stringEntryField(value.path ?? value.Path),
      offset: numberEntryField(value.offset ?? value.Offset),
      length: numberEntryField(value.length ?? value.Length),
      contentType: stringEntryField(value.contentType ?? value.ContentType) || 'application/octet-stream'
    };
  });
}

function stringEntryField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberEntryField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeBytes(value: WasmByteArray | ArrayBuffer | ArrayBufferView | null | undefined): Uint8Array {
  if (!value) {
    return new Uint8Array();
  }

  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  if (typeof value === 'string') {
    return decodeBase64Bytes(value);
  }

  return Uint8Array.from(value);
}

function decodeBase64Bytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function emptyGameplayData(): GameplayData {
  return {
    levelSettings: null,
    mobyInstances: null
  };
}

async function loadLooseViewerPackage(
  map: MapDefinition,
  startedAt: number,
  onStageUpdate?: (update: MapLoadStageUpdate) => void
): Promise<MapLoadResult> {
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
  const gameplayData = await parseLooseGameplayData(sourceUrl, map.gameId);
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
    sourceByteLength: 0,
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
