export type RatchetGameId = 'DL' | 'GC' | 'UYA';
export type MapCategory = 'SP' | 'MP' | 'Mission' | 'Custom';
export type MapSourceKind = 'vanillaWad' | 'customZip';

export interface MapDefinition {
  id: string;
  gameId: RatchetGameId;
  category: MapCategory;
  level: number;
  wadIndex?: number;
  name: string;
  label: string;
  wadUrl: string;
  viewerPackageSource?: string;
  sourceKind?: MapSourceKind;
  customMapRouteId?: string;
}

export type WadMapEntry = Pick<MapDefinition, 'category' | 'level' | 'name' | 'wadIndex'>;

const vanillaWadBaseUrl = 'https://box.rac-horizon.com/downloads/vanilla_wads';

export function formatLevelNumber(level: number): string {
  return level.toString().padStart(2, '0');
}

export function vanillaWadUrl(gameId: RatchetGameId, level: number): string {
  return `${vanillaWadBaseUrl}/${gameId.toLowerCase()}/level${formatLevelNumber(level)}.wad`;
}

export function defineWadMaps(gameId: RatchetGameId, maps: WadMapEntry[]): MapDefinition[] {
  const gameSlug = gameId.toLowerCase();

  return maps.map((map) => {
    const levelNumber = formatLevelNumber(map.level);
    const wadIndex = map.wadIndex ?? map.level;

    return {
      id: `${gameSlug}-${map.category.toLowerCase()}-level${levelNumber}`,
      gameId,
      category: map.category,
      level: map.level,
      wadIndex,
      name: map.name,
      label: `${levelNumber} - ${map.category}: ${map.name}`,
      wadUrl: vanillaWadUrl(gameId, wadIndex),
      sourceKind: 'vanillaWad'
    };
  });
}
