import assert from 'node:assert/strict';
import test from 'node:test';
import { readHudBankSlots } from '../src/features/map-viewer/components/hudBankData.ts';

test('groups exported HUD frames by bank slot and preserves empty slots', () => {
  const banks = readHudBankSlots({
    Banks: [
      { BankIndex: 0, Length: 64, DeclaredDecompressedSize: 64 },
      { BankIndex: 1, Length: 128, DeclaredDecompressedSize: 128 },
      { BankIndex: 2, Length: 0, DeclaredDecompressedSize: 0 }
    ],
    NormalizedFrameTextures: [
      {
        FrameIndex: 8,
        TextureIndex: 3,
        PaletteIndex: 4,
        TextureBank: 1,
        Status: 'written',
        PngPath: 'bank_1/tex.0008.png',
        Texture: { Width: 32, Height: 16 }
      },
      {
        FrameIndex: 7,
        TextureBank: 1,
        Status: 'skipped',
        PngPath: 'bank_1/tex.0007.png'
      }
    ]
  });

  assert.deepEqual(banks.map((bank) => bank.index), [0, 1, 2]);
  assert.equal(banks[0].textures.length, 0);
  assert.deepEqual(banks[1].textures[0], {
    frameIndex: 8,
    textureIndex: 3,
    paletteIndex: 4,
    path: 'bank_1/tex.0008.png',
    url: null,
    width: 32,
    height: 16
  });
  assert.equal(banks[2].textures.length, 0);
});
