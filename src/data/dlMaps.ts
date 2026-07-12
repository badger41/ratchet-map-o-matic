import {
  defineWadMaps,
  vanillaWadUrl,
  type MapDefinition,
  type WadMapEntry
} from './mapTypes';

export const dlWadMaps = defineWadMaps('DL', [
  { category: 'MP', level: 0, name: 'Lobby' },
  { category: 'SP', level: 1, name: 'DreadZone Station' },
  { category: 'SP', level: 2, name: 'Catacrom Four' },
  { category: 'SP', level: 4, name: 'Sarathos' },
  { category: 'SP', level: 5, name: 'Kronos' },
  { category: 'SP', level: 6, name: 'Shaar' },
  { category: 'SP', level: 7, name: 'The Valix Belt' },
  { category: 'SP', level: 8, name: 'Orxon' },
  { category: 'SP', level: 10, name: 'Planet Torval' },
  { category: 'SP', level: 11, name: 'Stygia' },
  { category: 'SP', level: 13, name: 'Maraxus' },
  { category: 'SP', level: 14, name: 'Ghost Station' },
  { category: 'SP', level: 15, name: 'DreadZone Station Interior' },
  { category: 'MP', level: 41, name: 'Battledome Tower' },
  { category: 'MP', level: 42, name: 'Catacrom Graveyard' },
  { category: 'MP', level: 44, name: 'Sarathos Swamp' },
  { category: 'MP', level: 45, name: 'Dark Cathedral' },
  { category: 'MP', level: 46, name: 'Temple of Shaar' },
  { category: 'MP', level: 47, name: 'Valix Lighthouse' },
  { category: 'MP', level: 48, name: 'Mining Facility' },
  { category: 'MP', level: 50, name: 'Torval Ruins' },
  { category: 'MP', level: 51, name: 'Tempus Station' },
  { category: 'MP', level: 53, name: 'Maraxus Prison' },
  { category: 'MP', level: 54, name: 'Ghost Station' }
] satisfies WadMapEntry[]);

const devLooseMaps: MapDefinition[] = [{
  id: 'dev-dl-level44-loose',
  gameId: 'DL',
  category: 'MP',
  level: 44,
  name: 'Sarathos Swamp Loose Export',
  label: 'Dev - 44: Sarathos Swamp loose export',
  wadUrl: vanillaWadUrl('DL', 44),
  viewerPackageSource: '/@fs/run/media/system/data/Projects/ratchet-ps2-cli/test-assets/extractions/level44_iso_world01/manifest.json'
}];

export const dlMaps: MapDefinition[] = [
  ...dlWadMaps,
  ...(import.meta.env.DEV ? devLooseMaps : [])
];
