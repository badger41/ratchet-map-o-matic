export type RatchetGameId = 'DL';
export type MapCategory = 'SP' | 'MP' | 'Mission';

export interface DeadlockedMapDefinition {
  id: string;
  gameId: RatchetGameId;
  category: MapCategory;
  level: number;
  name: string;
  label: string;
  wadUrl: string;
}

export const deadlockedMaps: DeadlockedMapDefinition[] = [
  {
    id: 'dl-mp-lobby',
    gameId: 'DL',
    category: 'MP',
    level: 0,
    name: 'MP Lobby',
    label: '00 - MP: Lobby',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level00.wad'
  },
  {
    id: 'dl-sp-dreadzone-station',
    gameId: 'DL',
    category: 'SP',
    level: 1,
    name: 'SP Dreadzone Station',
    label: '01 - SP: DreadZone Station',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level01.wad'
  },
  {
    id: 'dl-sp-catacrom-four',
    gameId: 'DL',
    category: 'SP',
    level: 2,
    name: 'SP: Catacrom Four',
    label: '02 - SP: Catacrom Four',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level02.wad'
  },
  {
    id: 'dl-sp-sarathos',
    gameId: 'DL',
    category: 'SP',
    level: 4,
    name: 'SP: Sarathos',
    label: '04 - SP: Sarathos',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level04.wad'
  },
  {
    id: 'dl-sp-kronos',
    gameId: 'DL',
    category: 'SP',
    level: 5,
    name: 'SP: Kronos',
    label: '05 - SP: Kronos',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level05.wad'
  },
  {
    id: 'dl-sp-shaar',
    gameId: 'DL',
    category: 'SP',
    level: 6,
    name: 'SP: Shaar',
    label: '06 - SP: Shaar',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level06.wad'
  },
  {
    id: 'dl-sp-valix',
    gameId: 'DL',
    category: 'SP',
    level: 7,
    name: 'The Valix Belt',
    label: '07 - SP: The Valix Belt',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level07.wad'
  },
  {
    id: 'dl-sp-orxon',
    gameId: 'DL',
    category: 'SP',
    level: 8,
    name: 'Orxon',
    label: '08 - SP: Orxon',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level08.wad'
  },
  {
    id: 'dl-sp-torval',
    gameId: 'DL',
    category: 'SP',
    level: 10,
    name: 'Planet Torval',
    label: '10 - SP: Planet Torval',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level10.wad'
  },
  {
    id: 'dl-sp-stygia',
    gameId: 'DL',
    category: 'SP',
    level: 11,
    name: 'Stygia',
    label: '11 - SP: Stygia',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level11.wad'
  },
  {
    id: 'dl-sp-maraxus',
    gameId: 'DL',
    category: 'SP',
    level: 13,
    name: 'Maraxus',
    label: '13 - SP: Maraxus',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level13.wad'
  },
  {
    id: 'dl-sp-ghost-station',
    gameId: 'DL',
    category: 'SP',
    level: 14,
    name: 'Ghost Station',
    label: '14 - SP: Ghost Station',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level14.wad'
  },
  {
    id: 'dl-sp-dreadzone-station-interior',
    gameId: 'DL',
    category: 'SP',
    level: 15,
    name: 'DreadZone Station Interior',
    label: '15 - SP: DreadZone Station Interior',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level15.wad'
  },
  {
    id: 'dl-mp-battledome-tower',
    gameId: 'DL',
    category: 'MP',
    level: 41,
    name: 'Battledome Tower',
    label: '41 - MP: Battledome Tower',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level41.wad'
  },
  {
    id: 'dl-mp-catacrom-graveyard',
    gameId: 'DL',
    category: 'MP',
    level: 42,
    name: 'Catacrom Graveyard',
    label: '42 - MP: Catacrom Graveyard',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level42.wad'
  },
  {
    id: 'dl-mp-sarathos-swamp',
    gameId: 'DL',
    category: 'MP',
    level: 44,
    name: 'Sarathos Swamp',
    label: '44 - MP: Sarathos Swamp',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level44.wad'
  },
  {
    id: 'dl-mp-dark-cathedral',
    gameId: 'DL',
    category: 'MP',
    level: 45,
    name: 'Dark Cathedral',
    label: '45 - MP: Dark Cathedral',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level45.wad'
  },
  {
    id: 'dl-mp-temple-of-shaar',
    gameId: 'DL',
    category: 'MP',
    level: 46,
    name: 'Temple of Shaar',
    label: '46 - MP: Temple of Shaar',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level46.wad'
  },
  {
    id: 'dl-mp-valix-lighthouse',
    gameId: 'DL',
    category: 'MP',
    level: 47,
    name: 'Valix Lighthouse',
    label: '48 - MP: Valix Lighthouse',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level47.wad'
  },
  {
    id: 'dl-mp-mining-facility',
    gameId: 'DL',
    category: 'MP',
    level: 48,
    name: 'Mining Facility',
    label: '48 - MP: Mining Facility',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level48.wad'
  },
  {
    id: 'dl-mp-torval-ruins',
    gameId: 'DL',
    category: 'MP',
    level: 50,
    name: 'Torval Ruins',
    label: '50 - MP: Torval Ruins',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level50.wad'
  },
  {
    id: 'dl-mp-tempus-station',
    gameId: 'DL',
    category: 'MP',
    level: 51,
    name: 'Tempus Station',
    label: '51 - MP: Tempus Station',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level51.wad'
  },
  {
    id: 'dl-mp-maraxus-prison',
    gameId: 'DL',
    category: 'MP',
    level: 53,
    name: 'Maraxus Prison',
    label: '53 - MP: Maraxus Prison',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level53.wad'
  },
  {
    id: 'dl-mp-ghost-station',
    gameId: 'DL',
    category: 'MP',
    level: 54,
    name: 'Ghost Station',
    label: '54 - MP: Ghost Station',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level54.wad'
  },
];

export const defaultDeadlockedMap = deadlockedMaps[0];
