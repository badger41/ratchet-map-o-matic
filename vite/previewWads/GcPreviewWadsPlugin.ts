import { PreviewWadsPlugin } from './PreviewWadsPlugin.ts';

const wadSizes = new Map([
  [0, 15413968],
  [1, 18282272],
  [2, 19783360],
  [3, 18030064],
  [4, 25027480],
  [5, 15596158],
  [6, 19756128],
  [7, 22814288],
  [8, 21145040],
  [9, 19894448],
  [10, 14039304],
  [11, 23979684],
  [12, 18049824],
  [13, 18827936],
  [14, 16845488],
  [15, 12832192],
  [16, 18058240],
  [17, 17438784],
  [18, 18972688],
  [19, 25144176],
  [20, 21928336],
  [21, 7691392],
  [22, 13464928],
  [23, 11827664],
  [24, 8297873],
  [25, 8292911],
  [26, 10764880]
]);

export class GcPreviewWadsPlugin extends PreviewWadsPlugin {
  readonly name = 'gc-preview-wads';
  protected readonly mountPath = '/preview-wads';
  protected readonly isoPath = '/run/media/system/data/Games/PS2/Ratchet & Clank 2 (Preview).iso';
  protected readonly wadDirectory = 'G';
  protected readonly sizes = wadSizes;

  normalize(bytes: Uint8Array): Buffer {
    if (bytes.byteLength < 0x68 || new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) !== 0x68) {
      throw new Error('GC preview WAD does not have the expected 0x68-byte header.');
    }

    const normalized = PreviewWadsPlugin.sectorAlignedBuffer(bytes);
    normalized.copy(normalized, 0x10, 0x0c, 0x5c);
    normalized.writeUInt32LE(0x60, 0);
    normalized.writeUInt32LE(0, 0x0c);
    return normalized;
  }
}
