import type { PackedFileEntry } from '../wasm/ratchetPs2Wasm.ts';

export interface DlMissionGameplayEntry {
  missionIndex: number;
  path: string;
}

export function findDlMissionGameplayEntries(
  entries: Array<Pick<PackedFileEntry, 'path'>>
): DlMissionGameplayEntry[] {
  return entries.flatMap(({ path }) => {
    const match = /^missions\/mission_(\d+)\/gameplay\.bin$/i.exec(path.replace(/\\/g, '/'));
    return match ? [{ missionIndex: Number(match[1]), path }] : [];
  }).sort((left, right) => left.missionIndex - right.missionIndex);
}

export function mobyMissionVisible(instanceMission: number, selectedMission: number | null): boolean {
  return instanceMission < 0 || instanceMission === selectedMission;
}
