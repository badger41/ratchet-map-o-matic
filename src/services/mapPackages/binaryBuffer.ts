export type BinaryBuffer = ArrayBuffer | Uint8Array;

export function binaryByteLength(buffer: BinaryBuffer): number {
  return buffer.byteLength;
}

export function createDataView(buffer: BinaryBuffer): DataView {
  if (buffer instanceof Uint8Array) {
    return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  return new DataView(buffer);
}
