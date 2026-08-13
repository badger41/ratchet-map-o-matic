import { unzipSync } from 'fflate';

const maxDlCustomMapWadBytes = 512 * 1024 * 1024;
const dlSectorSize = 0x800;
const dlLevelWadHeaderSize = 0xc68;
const dlLevelDataFileBlockOffset = 0x18;

export function extractDlCustomMapWad(zipBytes: Uint8Array): Uint8Array {
  const files = unzipSync(zipBytes, {
    filter: (entry) => {
      if (!entry.name.toLowerCase().endsWith('.wad')) {
        return false;
      }
      if (entry.originalSize > maxDlCustomMapWadBytes) {
        throw new Error(`DL custom map WAD is too large: ${entry.originalSize} bytes`);
      }
      return true;
    }
  });
  const wadEntries = Object.entries(files);
  if (wadEntries.length !== 1) {
    throw new Error(`DL custom map ZIP must contain exactly one .wad file; found ${wadEntries.length}.`);
  }

  return wadEntries[0][1];
}

export function wrapDlCoreLevelWad(coreLevelBytes: Uint8Array, level: number): Uint8Array {
  const dataOffset = Math.ceil(dlLevelWadHeaderSize / dlSectorSize) * dlSectorSize;
  const dataSectors = Math.ceil(coreLevelBytes.byteLength / dlSectorSize);
  const levelWad = new Uint8Array(dataOffset + dataSectors * dlSectorSize);
  const header = new DataView(levelWad.buffer);
  header.setInt32(0, dlLevelWadHeaderSize, true);
  header.setInt32(8, Number.isInteger(level) ? level : 0, true);
  header.setInt32(dlLevelDataFileBlockOffset, dataOffset / dlSectorSize, true);
  header.setInt32(dlLevelDataFileBlockOffset + 4, dataSectors, true);
  levelWad.set(coreLevelBytes, dataOffset);
  return levelWad;
}
