import type {
  TieColorEntry,
  TieColorTable,
  TieInstanceRecord,
  Vec4
} from './mapPackageTypes';

export function parseTieClassIds(buffer: ArrayBuffer): number[] {
  if (buffer.byteLength < 4) {
    return [];
  }

  const view = new DataView(buffer);
  const headerCount = Math.max(0, view.getInt32(0, true));
  const availableCount = Math.max(0, Math.floor((buffer.byteLength - 4) / 4));
  const count = Math.min(headerCount, availableCount);
  const classIds: number[] = [];

  for (let index = 0; index < count; index += 1) {
    classIds.push(view.getInt32(4 + index * 4, true));
  }

  return classIds;
}

export function parseTieInstanceRecords(buffer: ArrayBuffer, expectedCount: number | null = null): TieInstanceRecord[] {
  const headerSize = 0x10;
  const recordSize = 0x60;

  if (buffer.byteLength < headerSize) {
    throw new Error(`Tie instance payload is too small: ${buffer.byteLength} bytes`);
  }

  const view = new DataView(buffer);
  const headerCount = Math.max(0, view.getInt32(0, true));
  const manifestCount = expectedCount == null ? headerCount : Math.max(0, expectedCount);
  const availableCount = Math.floor(Math.max(buffer.byteLength - headerSize, 0) / recordSize);
  const count = Math.min(headerCount, manifestCount, availableCount);
  const records: TieInstanceRecord[] = [];

  for (let index = 0; index < count; index += 1) {
    const offset = headerSize + index * recordSize;
    records.push(readTieInstanceRecord(view, index, offset));
  }

  return records;
}

export function parseTieColorTable(buffer: ArrayBuffer): TieColorTable {
  const view = new DataView(buffer);
  const entries: TieColorEntry[] = [];
  const byInstanceId = new Map<number, TieColorEntry>();
  let mappedCount = 0;
  let sentinelCount = 0;
  let duplicateIdCount = 0;
  let offset = 0;

  while (offset + 4 <= buffer.byteLength) {
    const entryIndex = entries.length;
    const entryOffset = offset;
    const id = view.getInt16(offset, true);
    const wordCount = view.getInt16(offset + 0x02, true);
    offset += 4;

    if (wordCount < 0 || offset + wordCount * 2 > buffer.byteLength) {
      break;
    }

    const entry = readTieColorEntry(view, id, wordCount, offset, entryIndex, entryOffset);
    entries.push(entry);

    if (id < 0) {
      sentinelCount += 1;
    } else if (byInstanceId.has(id)) {
      duplicateIdCount += 1;
    } else {
      byInstanceId.set(id, entry);
      mappedCount += 1;
    }

    offset += wordCount * 2;
    if ((offset & 1) !== 0) {
      offset += 1;
    }
  }

  return {
    entries,
    byInstanceId,
    entryCount: entries.length,
    mappedCount,
    sentinelCount,
    duplicateIdCount
  };
}

export function tieAmbientPackedColor(
  words: number[],
  wordIndex: number
): { r: number; g: number; b: number; valid: boolean } {
  if (wordIndex < 2 || wordIndex >= words.length || words.length <= 2) {
    return tieAmbientNeutralPackedColor(false);
  }

  const packed = words[wordIndex];
  if (!Number.isFinite(packed) || packed === 0xffff) {
    return tieAmbientNeutralPackedColor(false);
  }

  const header0 = Number(words[0] ?? 0);
  const header1 = Number(words[1] ?? 0);
  const baseR = header0 & 0xff;
  const baseG = (header0 >> 8) & 0xff;
  const baseB = header1 & 0xff;
  const shift = (header1 >> 8) & 0xff;
  return {
    r: clampByte(baseR + (((packed & 0x1f) << 3) >> shift)),
    g: clampByte(baseG + ((((packed >> 5) & 0x1f) << 3) >> shift)),
    b: clampByte(baseB + ((((packed >> 10) & 0x1f) << 3) >> shift)),
    valid: true
  };
}

function readTieInstanceRecord(view: DataView, index: number, offset: number): TieInstanceRecord {
  return {
    index,
    classId: view.getInt32(offset, true),
    headerWords: [
      view.getInt32(offset + 0x04, true),
      view.getInt32(offset + 0x08, true),
      view.getInt32(offset + 0x0c, true)
    ],
    matrixRows: [
      readVec4(view, offset + 0x10),
      readVec4(view, offset + 0x20),
      readVec4(view, offset + 0x30)
    ],
    position: readVec4(view, offset + 0x40),
    tailWords: [
      view.getInt32(offset + 0x50, true),
      view.getInt32(offset + 0x54, true),
      view.getInt32(offset + 0x58, true),
      view.getInt32(offset + 0x5c, true)
    ],
    lightSelector: view.getInt32(offset + 0x50, true) & 0xffff
  };
}

function readTieColorEntry(
  view: DataView,
  id: number,
  wordCount: number,
  offset: number,
  entryIndex: number,
  entryOffset: number
): TieColorEntry {
  let nonZeroCount = 0;
  const firstWords: number[] = [];
  const words: number[] = [];

  for (let index = 0; index < wordCount; index += 1) {
    const value = view.getUint16(offset + index * 2, true);
    words.push(value);

    if (index < 8) {
      firstWords.push(value);
    }

    if (value !== 0 && value !== 0xffff) {
      nonZeroCount += 1;
    }
  }

  return {
    entryIndex,
    id,
    wordCount,
    byteLength: wordCount * 2,
    offset: entryOffset,
    nonZeroCount,
    firstWords,
    words,
    averageRgb: averageTieAmbientPackedColors(words)
  };
}

function averageTieAmbientPackedColors(words: number[]): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let sampleCount = 0;

  for (let index = 2; index < words.length; index += 1) {
    const color = tieAmbientPackedColor(words, index);
    if (!color.valid) {
      continue;
    }

    r += color.r;
    g += color.g;
    b += color.b;
    sampleCount += 1;
  }

  const divisor = Math.max(sampleCount, 1);
  return [r / divisor, g / divisor, b / divisor];
}

function readVec4(view: DataView, offset: number): Vec4 {
  return [
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
    view.getFloat32(offset + 12, true)
  ];
}

function tieAmbientNeutralPackedColor(valid: boolean): { r: number; g: number; b: number; valid: boolean } {
  return {
    r: 128,
    g: 128,
    b: 128,
    valid
  };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(Math.floor(value), 255));
}
