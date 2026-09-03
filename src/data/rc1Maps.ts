import { defineWadMaps, type WadMapEntry } from './mapTypes.ts';

export const rc1Maps = defineWadMaps('RC1', [
  { category: 'SP', level: 0, name: 'Veldin 1' },
  { category: 'SP', level: 1, name: 'Novalis' },
  { category: 'SP', level: 2, name: 'Aridia' },
  { category: 'SP', level: 3, name: 'Kerwan' },
  { category: 'SP', level: 4, name: 'Eudora' },
  { category: 'SP', level: 5, name: 'Rilgar' },
  { category: 'SP', level: 6, name: 'Nebula G34' },
  { category: 'SP', level: 7, name: 'Umbris' },
  { category: 'SP', level: 8, name: 'Batalia' },
  { category: 'SP', level: 9, name: 'Gaspar' },
  { category: 'SP', level: 10, name: 'Orxon' },
  { category: 'SP', level: 11, name: 'Pokitaru' },
  { category: 'SP', level: 12, name: 'Hoven' },
  { category: 'SP', level: 13, name: 'Oltanis Orbit' },
  { category: 'SP', level: 14, name: 'Oltanis' },
  { category: 'SP', level: 15, name: 'Quartu' },
  { category: 'SP', level: 16, name: 'Kalebo III' },
  { category: 'SP', level: 17, name: 'Veldin Orbit' },
  { category: 'SP', level: 18, name: 'Veldin 2' }
] satisfies WadMapEntry[]);
