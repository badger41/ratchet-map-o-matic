import type { MapDefinition } from '../../data/mapCatalog';

export const horizonUyaCustomMapIndexUrl = 'https://box.rac-horizon.com/downloads/maps/index_uya_ntsc.txt';

const horizonBaseUrl = 'https://box.rac-horizon.com';
const horizonUyaMapPath = '/downloads/maps/uya/';

export async function fetchHorizonUyaCustomMaps(signal?: AbortSignal): Promise<MapDefinition[]> {
  const response = await fetch(horizonUyaCustomMapIndexUrl, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch Horizon UYA maps: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  return text
    .split(/\r?\n/)
    .map(parseHorizonUyaMapLine)
    .filter((map): map is MapDefinition => Boolean(map));
}

function parseHorizonUyaMapLine(line: string): MapDefinition | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const [fileBaseRaw, displayNameRaw] = trimmed.split('|');
  const fileBase = fileBaseRaw?.trim();
  const name = displayNameRaw?.trim() || fileBase;
  if (!fileBase || !name) {
    return null;
  }

  return {
    id: `uya-custom-${fileBase}`,
    gameId: 'UYA',
    category: 'Custom',
    level: 0,
    name,
    label: `Custom: ${name}`,
    wadUrl: new URL(`${encodeURIComponent(fileBase)}.ntsc.zip`, new URL(horizonUyaMapPath, horizonBaseUrl)).toString(),
    sourceKind: 'customZip',
    customMapRouteId: fileBase
  };
}
