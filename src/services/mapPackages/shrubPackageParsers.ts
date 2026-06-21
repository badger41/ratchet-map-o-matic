import type {
  ShrubInstanceRecord,
  Vec4
} from './mapPackageTypes';
import { parseTieClassIds } from './tiePackageParsers';

export function parseShrubClassIds(buffer: ArrayBuffer): number[] {
  return parseTieClassIds(buffer);
}

export function parseShrubInstanceRecords(buffer: ArrayBuffer, expectedCount: number | null = null): ShrubInstanceRecord[] {
  const headerSize = 0x10;
  const recordSize = 0x70;

  if (buffer.byteLength < headerSize) {
    throw new Error(`Shrub instance payload is too small: ${buffer.byteLength} bytes`);
  }

  const view = new DataView(buffer);
  const headerCount = Math.max(0, view.getInt32(0, true));
  const manifestCount = expectedCount == null ? headerCount : Math.max(0, expectedCount);
  const availableCount = Math.floor(Math.max(buffer.byteLength - headerSize, 0) / recordSize);
  const count = Math.min(headerCount, manifestCount, availableCount);
  const records: ShrubInstanceRecord[] = [];

  for (let index = 0; index < count; index += 1) {
    const offset = headerSize + index * recordSize;
    records.push(readShrubInstanceRecord(view, index, offset));
  }

  return records;
}

function readShrubInstanceRecord(view: DataView, index: number, offset: number): ShrubInstanceRecord {
  const payloadWords: number[] = [];
  const payloadBytes: number[] = [];
  for (let word = 0; word < 8; word += 1) {
    payloadWords.push(view.getInt32(offset + 0x50 + word * 4, true));
  }

  for (let byte = 0; byte < 0x20; byte += 1) {
    payloadBytes.push(view.getUint8(offset + 0x50 + byte));
  }

  return {
    index,
    classId: view.getInt32(offset, true),
    drawDistance: view.getFloat32(offset + 0x04, true),
    matrixRows: [
      readVec4(view, offset + 0x10),
      readVec4(view, offset + 0x20),
      readVec4(view, offset + 0x30)
    ],
    position: readVec4(view, offset + 0x40),
    lightRgb: [payloadWords[0] ?? 128, payloadWords[1] ?? 128, payloadWords[2] ?? 128],
    lightBucket: payloadWords[4] ?? 0,
    lightSelector: view.getUint16(offset + 0x60, true),
    payloadWords,
    payloadBytes
  };
}

function readVec4(view: DataView, offset: number): Vec4 {
  return [
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
    view.getFloat32(offset + 12, true)
  ];
}
