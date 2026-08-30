import type { GltfExportEntry } from '../../../services/mapPackages/mapPackageTypes';

export function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function buildModelEntryMap(entries: GltfExportEntry[]): Map<number, GltfExportEntry> {
  const map = new Map<number, GltfExportEntry>();
  for (const entry of entries) {
    const modelId = numberValue(entry.ModelId);
    if (modelId !== null) {
      map.set(modelId, entry);
    }
  }

  return map;
}

export function groupRecordsByClassId<T extends { classId: number }>(records: T[]): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const record of records) {
    const group = groups.get(record.classId);
    if (group) {
      group.push(record);
    } else {
      groups.set(record.classId, [record]);
    }
  }

  return groups;
}
