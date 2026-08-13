import type { MapDefinition, RatchetGameId } from '../../data/mapCatalog';

const horizonBaseUrl = 'https://box.rac-horizon.com';

export function horizonCustomMapIndexUrl(gameId: RatchetGameId): string {
  return `${horizonBaseUrl}/downloads/maps/index_${gameId.toLowerCase()}_ntsc.txt`;
}

export async function fetchHorizonCustomMaps(
  gameId: RatchetGameId,
  signal?: AbortSignal
): Promise<MapDefinition[]> {
  const response = await fetch(horizonCustomMapIndexUrl(gameId), { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch Horizon ${gameId} maps: ${response.status} ${response.statusText}`);
  }

  return parseHorizonCustomMapIndex(gameId, await response.text());
}

export function parseHorizonCustomMapIndex(gameId: RatchetGameId, text: string): MapDefinition[] {
  const gameSlug = gameId.toLowerCase();
  const archiveSuffix = gameId === 'UYA' ? '.ntsc.zip' : '.zip';
  const mapBaseUrl = new URL(`/downloads/maps/${gameSlug}/`, horizonBaseUrl);

  return text
    .split(/\r?\n/)
    .map((line): MapDefinition | null => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return null;
      }

      const [fileBaseRaw, displayNameRaw, levelRaw] = trimmed.split('|');
      const fileBase = fileBaseRaw?.trim();
      const name = displayNameRaw?.trim() || fileBase;
      if (!fileBase || !name) {
        return null;
      }

      const level = Number.parseInt(levelRaw?.trim() ?? '', 10);
      return {
        id: `${gameSlug}-custom-${fileBase}`,
        gameId,
        category: 'Custom',
        level: Number.isFinite(level) ? level : 0,
        name,
        label: `Custom: ${name}`,
        wadUrl: new URL(`${encodeURIComponent(fileBase)}${archiveSuffix}`, mapBaseUrl).toString(),
        sourceKind: 'customZip',
        customMapRouteId: fileBase
      };
    })
    .filter((map): map is MapDefinition => map !== null);
}
