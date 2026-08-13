import type {
  GltfExportEntry,
  RootManifest
} from './mapPackageTypes.ts';

export function mergeMissionMobyEntries(
  mainEntries: GltfExportEntry[],
  rootManifest: RootManifest
): GltfExportEntry[] {
  const entries = [...mainEntries];
  const classIds = new Set(entries.map((entry) => numberValue(entry.ModelId)));

  for (const missionEntry of rootManifest.Mobys ?? []) {
    const classId = numberValue(missionEntry.ClassId);
    if (
      classId === null ||
      classIds.has(classId) ||
      missionEntry.Status?.toLowerCase() !== 'written' ||
      typeof missionEntry.Gltf !== 'string' ||
      missionEntry.Gltf.length === 0
    ) {
      continue;
    }

    classIds.add(classId);
    entries.push({
      Family: 'moby',
      ModelId: classId,
      GltfPath: `../${missionEntry.Gltf.replace(/\\/g, '/').replace(/^\/+/, '')}`,
      Status: 'written'
    });
  }

  return entries;
}

function numberValue(value: unknown): number | null {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) ? number : null;
}
