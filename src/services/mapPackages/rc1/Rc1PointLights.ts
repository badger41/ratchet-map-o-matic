import {
  binaryByteLength,
  createDataView,
  type BinaryBuffer
} from '../binaryBuffer.ts';

export interface Rc1PointLightRecord {
  index: number;
  position: [number, number, number];
  radius: number;
  color: [number, number, number];
}

export function parseRc1PointLightRecords(buffer: BinaryBuffer): Rc1PointLightRecord[] {
  const headerSize = 0x10;
  const recordSize = 0x20;
  const byteLength = binaryByteLength(buffer);
  if (byteLength < headerSize || (byteLength - headerSize) % recordSize !== 0) {
    throw new Error(`Invalid RC1 point light payload length: ${byteLength} bytes`);
  }

  const view = createDataView(buffer);
  const count = Math.min(Math.max(0, view.getInt32(0, true)), (byteLength - headerSize) / recordSize);
  return Array.from({ length: count }, (_, index) => {
    const offset = headerSize + index * recordSize;
    return {
      index,
      position: [
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true)
      ],
      radius: view.getFloat32(offset + 0x0c, true),
      color: [view.getUint8(offset + 0x10), view.getUint8(offset + 0x11), view.getUint8(offset + 0x12)]
    };
  });
}
