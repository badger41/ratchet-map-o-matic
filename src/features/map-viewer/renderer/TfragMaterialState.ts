const tfragFullOpacityAlpha = 0x80 / 0xff;
const tfragAlphaCutoff = 0.06;

export function resolveTfragAlphaState(
  transparent: boolean,
  opacity: number,
  alphaTest: number,
  depthWrite: boolean
) {
  if (!transparent && alphaTest <= 0) {
    return null;
  }

  return {
    opacityScale: opacity / tfragFullOpacityAlpha,
    depthWrite: transparent ? false : depthWrite,
    alphaTest: transparent ? Math.max(alphaTest, tfragAlphaCutoff) : alphaTest
  };
}
