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
    id: 'dl-sp-valix-lighthouse',
    gameId: 'DL',
    category: 'SP',
    level: 7,
    name: 'Valix Lighthouse',
    label: 'SP: Valix Lighthouse',
    wadUrl: 'https://box.rac-horizon.com/downloads/vanilla_wads/dl/level07.wad'
  }
];

export const defaultDeadlockedMap = deadlockedMaps[0];
