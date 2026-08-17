import {
  defineWadMaps,
  type WadMapEntry
} from './mapTypes';

export const gcMaps = defineWadMaps('GC', [
  { category: 'SP', level: 0, name: 'Aranos 1' },
  { category: 'SP', level: 1, name: 'Oozla' },
  { category: 'SP', level: 2, name: 'Maktar Resort' },
  { category: 'SP', level: 3, name: 'Endako' },
  { category: 'SP', level: 4, name: 'Barlow' },
  { category: 'SP', level: 5, name: 'Feltzin System' },
  { category: 'SP', level: 6, name: 'Notak' },
  { category: 'SP', level: 7, name: 'Siberius' },
  { category: 'SP', level: 8, name: 'Tabora' },
  { category: 'SP', level: 9, name: 'Dobbo' },
  { category: 'SP', level: 10, name: 'Hrugis Cloud' },
  { category: 'SP', level: 11, name: 'Joba' },
  { category: 'SP', level: 12, name: 'Todano' },
  { category: 'SP', level: 13, name: 'Boldan' },
  { category: 'SP', level: 14, name: 'Aranos 2' },
  { category: 'SP', level: 15, name: 'Gorn' },
  { category: 'SP', level: 16, name: 'Snivelak' },
  { category: 'SP', level: 17, name: 'Smolg' },
  { category: 'SP', level: 18, name: 'Damosel' },
  { category: 'SP', level: 19, name: 'Grelbin' },
  { category: 'SP', level: 20, name: 'Yeedil' },
  { category: 'SP', level: 30, wadIndex: 21, name: 'Insomniac Museum' },
  { category: 'SP', level: 22, name: 'Dobbo Orbit' },
  { category: 'SP', level: 23, name: 'Damosel Orbit' },
  { category: 'SP', level: 24, name: 'Slim\'s Ship Shack' },
  { category: 'SP', level: 25, name: 'Wupash Nebula' },
  { category: 'SP', level: 26, name: 'Jamming Array' }
] satisfies WadMapEntry[]);
