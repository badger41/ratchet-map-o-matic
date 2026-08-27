import { PreviewWadsPlugin } from './PreviewWadsPlugin.ts';

const wadSizes = new Map([
  [1, 17621712],
  [2, 22530384],
  [3, 15182288],
  [4, 19946416],
  [7, 13157680],
  [8, 18085984],
  [9, 22655728],
  [27, 13468832],
  [28, 13505456],
  [31, 12394224],
  [33, 12063929]
]);

export class UyaPreviewWadsPlugin extends PreviewWadsPlugin {
  readonly name = 'uya-preview-wads';
  protected readonly mountPath = '/uya-preview-wads';
  protected readonly isoPath = '/run/media/system/data/Games/PS2/UYA-May26Proto.ISO';
  protected readonly wadDirectory = 'LEVELS';
  protected readonly sizes = wadSizes;

  normalize(bytes: Uint8Array): Buffer {
    if (bytes.byteLength < 0x60 || new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) !== 0x60) {
      throw new Error('UYA preview WAD does not have the expected 0x60-byte header.');
    }

    return PreviewWadsPlugin.sectorAlignedBuffer(bytes);
  }
}
