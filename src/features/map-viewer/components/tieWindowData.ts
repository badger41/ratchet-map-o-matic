import type { GltfExportEntry } from '../../../services/mapPackages/mapPackageTypes';

export interface TieOption {
  key: string;
  label: string;
  modelId: number;
  entry: GltfExportEntry;
}

export function buildTieOptions(entries: GltfExportEntry[]): TieOption[] {
  return entries.flatMap((entry, index) => {
    if (entry.ModelId === null
      || entry.ModelId === undefined
      || (typeof entry.ModelId === 'string' && entry.ModelId.trim() === '')) {
      return [];
    }
    const modelId = Number(entry.ModelId);
    return Number.isFinite(modelId) && entry.GltfPath
      ? [{
          key: `${modelId}:${entry.GltfPath}:${index}`,
          label: `Class ${modelId} (0x${modelId.toString(16).padStart(4, '0')})`,
          modelId,
          entry
        }]
      : [];
  });
}
