import { arrayValue, indexValue, isRecord, numberValue } from '../../../shared/valueParsing.ts';

export interface HudBankTexture {
  frameIndex: number;
  textureIndex: number | null;
  paletteIndex: number | null;
  path: string;
  url: string | null;
  width: number | null;
  height: number | null;
}

export interface HudBankSlot {
  index: number;
  length: number | null;
  textures: HudBankTexture[];
}

export function readHudBankSlots(value: unknown): HudBankSlot[] {
  if (!isRecord(value)) {
    return [];
  }

  const slots = new Map<number, HudBankSlot>();
  for (const entry of arrayValue(value.Banks)) {
    if (!isRecord(entry)) {
      continue;
    }

    const index = indexValue(entry.BankIndex);
    if (index !== null) {
      slots.set(index, {
        index,
        length: numberValue(entry.Length),
        textures: []
      });
    }
  }

  for (const entry of arrayValue(value.NormalizedFrameTextures)) {
    if (!isRecord(entry) || entry.Status !== 'written' || typeof entry.PngPath !== 'string') {
      continue;
    }

    const bankIndex = indexValue(entry.TextureBank);
    const frameIndex = indexValue(entry.FrameIndex);
    if (bankIndex === null || frameIndex === null) {
      continue;
    }

    const texture = isRecord(entry.Texture) ? entry.Texture : null;
    const bank = slots.get(bankIndex) ?? {
      index: bankIndex,
      length: null,
      textures: []
    };
    bank.textures.push({
      frameIndex,
      textureIndex: indexValue(entry.TextureIndex),
      paletteIndex: indexValue(entry.PaletteIndex),
      path: entry.PngPath,
      url: null,
      width: numberValue(texture?.Width),
      height: numberValue(texture?.Height)
    });
    slots.set(bankIndex, bank);
  }

  return [...slots.values()]
    .sort((a, b) => a.index - b.index)
    .map((bank) => ({
      ...bank,
      textures: bank.textures.sort((a, b) => a.frameIndex - b.frameIndex)
    }));
}
