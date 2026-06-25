export function extractDlGameplayCore(wadBytes: Uint8Array): Uint8Array | null {
  const sectorSize = 0x800;
  const levelWadHeaderSize = 0x0c68;
  const coreSegmentTableLength = 14 * 8;
  if (wadBytes.byteLength < levelWadHeaderSize) {
    return null;
  }

  const view = dataViewFor(wadBytes);
  const headerSize = view.getInt32(0, true);
  if (headerSize < levelWadHeaderSize || headerSize > wadBytes.byteLength) {
    return null;
  }

  const coreLevel = readSectorFileBlock(wadBytes, 0x18, sectorSize);
  if (!coreLevel || coreLevel.byteLength < coreSegmentTableLength) {
    return null;
  }

  const rawGameplayCore = readCoreSegment(coreLevel, 0x60);
  return rawGameplayCore && isWadCompressed(rawGameplayCore)
    ? decompressWad(rawGameplayCore)
    : rawGameplayCore;
}

export function extractDlLevelSettingsGameplayCore(wadBytes: Uint8Array): Uint8Array | null {
  const gameplayCore = extractDlGameplayCore(wadBytes);
  if (!gameplayCore) {
    return null;
  }

  const levelSettings = trimDlLevelSettingsPayload(extractGameplayBlockPayload(gameplayCore, 0x00));
  if (!levelSettings) {
    return null;
  }

  const headerSize = 0x80;
  const minimalGameplayCore = new Uint8Array(headerSize + levelSettings.byteLength);
  dataViewFor(minimalGameplayCore).setInt32(0, headerSize, true);
  minimalGameplayCore.set(levelSettings, headerSize);
  return minimalGameplayCore;
}

function extractGameplayBlockPayload(gameplayCore: Uint8Array, headerOffset: number): Uint8Array | null {
  const headerSize = 0x80;
  if (gameplayCore.byteLength < headerSize) {
    return null;
  }

  const view = dataViewFor(gameplayCore);
  const pointer = view.getInt32(headerOffset, true);
  if (pointer <= 0 || pointer > gameplayCore.byteLength) {
    return null;
  }

  let nextPointer = gameplayCore.byteLength;
  for (let offset = 0; offset < headerSize; offset += 4) {
    const candidate = view.getInt32(offset, true);
    if (candidate > pointer && candidate <= gameplayCore.byteLength && candidate < nextPointer) {
      nextPointer = candidate;
    }
  }

  return gameplayCore.slice(pointer, nextPointer);
}

function trimDlLevelSettingsPayload(payload: Uint8Array | null): Uint8Array | null {
  if (!payload || payload.byteLength < 0x80) {
    return payload;
  }

  const firstPartSize = 0x5c;
  const chunkPlaneSize = 0x20;
  const chunkPlaneCount = dataViewFor(payload).getInt32(firstPartSize + 0x0c, true);
  const chunkPlaneBytes = chunkPlaneCount > 0
    ? chunkPlaneCount * chunkPlaneSize
    : chunkPlaneSize;
  const requiredLength = firstPartSize + chunkPlaneBytes + 4;
  return requiredLength > 0 && requiredLength <= payload.byteLength
    ? payload.slice(0, requiredLength)
    : payload;
}

function readSectorFileBlock(container: Uint8Array, headerOffset: number, sectorSize: number): Uint8Array | null {
  const view = dataViewFor(container);
  const sectorOffset = view.getInt32(headerOffset, true);
  const sectorLength = view.getInt32(headerOffset + 4, true);
  if (sectorOffset <= 0 || sectorLength <= 0) {
    return null;
  }

  const offset = sectorOffset * sectorSize;
  const length = sectorLength * sectorSize;
  if (offset < 0 || length < 0 || offset + length > container.byteLength) {
    return null;
  }

  return container.slice(offset, offset + length);
}

function readCoreSegment(coreLevel: Uint8Array, headerOffset: number): Uint8Array | null {
  const view = dataViewFor(coreLevel);
  const offset = view.getInt32(headerOffset, true);
  const length = view.getInt32(headerOffset + 4, true);
  if (offset <= 0 || length <= 0 || offset + length > coreLevel.byteLength) {
    return null;
  }

  return coreLevel.slice(offset, offset + length);
}

function isWadCompressed(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 3 && bytes[0] === 0x57 && bytes[1] === 0x41 && bytes[2] === 0x44;
}

function decompressWad(source: Uint8Array): Uint8Array {
  const headerSize = 0x10;
  const view = dataViewFor(source);
  const compressedSize = view.getInt32(3, true);
  if (!isWadCompressed(source) || compressedSize <= 0 || compressedSize > source.byteLength) {
    throw new Error('Invalid compressed WAD header.');
  }

  const destination: number[] = [];
  let cursor = headerSize;
  while (cursor < compressedSize) {
    cursor = decompressWadPacket(destination, source, cursor, headerSize, compressedSize);
  }

  return Uint8Array.from(destination);
}

function decompressWadPacket(
  destination: number[],
  source: Uint8Array,
  cursor: number,
  payloadStart: number,
  end: number
): number {
  const packetFlag = readWadByte(source, cursor, payloadStart, end);
  cursor += 1;

  if (packetFlag < 0x10) {
    const literalLength = packetFlag !== 0
      ? packetFlag + 3
      : readWadByte(source, cursor++, payloadStart, end) + 18;
    return copyWadLiteral(destination, source, cursor, payloadStart, end, literalLength);
  }

  let matchLength = 0;
  let lookbackOffset = -1;
  if (packetFlag < 0x20) {
    matchLength = packetFlag & 0b111;
    if (matchLength === 0) {
      matchLength = readWadByte(source, cursor++, payloadStart, end) + 7;
    }

    const lowOffsetByte = readWadByte(source, cursor++, payloadStart, end);
    const highOffsetByte = readWadByte(source, cursor++, payloadStart, end);
    lookbackOffset = destination.length
      - ((packetFlag & 0b1000) * 0x800)
      - (highOffsetByte * 0x40)
      - (lowOffsetByte >> 2);

    if (lookbackOffset === destination.length && matchLength !== 1) {
      return alignWadCursor(cursor, payloadStart, end);
    }

    if (lookbackOffset !== destination.length) {
      matchLength += 2;
      lookbackOffset -= 0x4000;
    }
  } else if (packetFlag < 0x40) {
    matchLength = packetFlag & 0x1f;
    if (matchLength === 0) {
      matchLength = readWadByte(source, cursor++, payloadStart, end) + 0x1f;
    }

    matchLength += 2;
    const lowOffsetBits = readWadByte(source, cursor++, payloadStart, end);
    const highOffsetBits = readWadByte(source, cursor++, payloadStart, end);
    lookbackOffset = destination.length - (highOffsetBits * 0x40) - (lowOffsetBits >> 2) - 1;
  } else {
    const majorLookbackByte = readWadByte(source, cursor++, payloadStart, end);
    lookbackOffset = destination.length - majorLookbackByte * 8 - ((packetFlag >> 2) & 0b111) - 1;
    matchLength = (packetFlag >> 5) + 1;
  }

  copyWadMatch(destination, lookbackOffset, matchLength);
  return copyWadLiteral(destination, source, cursor, payloadStart, end, source[cursor - 2] & 0b11);
}

function readWadByte(source: Uint8Array, cursor: number, payloadStart: number, end: number): number {
  if (cursor >= end || cursor < payloadStart) {
    throw new Error('Unexpected end of compressed WAD buffer.');
  }

  return source[cursor];
}

function copyWadLiteral(
  destination: number[],
  source: Uint8Array,
  cursor: number,
  payloadStart: number,
  end: number,
  size: number
): number {
  if (cursor + size > end || cursor < payloadStart) {
    throw new Error('Unexpected end of compressed WAD literal.');
  }

  for (let index = 0; index < size; index += 1) {
    destination.push(source[cursor + index]);
  }

  return cursor + size;
}

function copyWadMatch(destination: number[], lookbackOffset: number, matchLength: number): void {
  if (matchLength === 1) {
    return;
  }

  if (lookbackOffset < 0 || lookbackOffset >= destination.length) {
    throw new Error('Compressed WAD match points outside the decompressed buffer.');
  }

  for (let index = 0; index < matchLength; index += 1) {
    destination.push(destination[lookbackOffset + index]);
  }
}

function alignWadCursor(cursor: number, payloadStart: number, end: number): number {
  while (((cursor - payloadStart) % 0x1000) !== 0) {
    cursor += 1;
    if (cursor > end) {
      throw new Error('Compressed WAD padding stepped outside the buffer.');
    }
  }

  return cursor;
}

function dataViewFor(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
