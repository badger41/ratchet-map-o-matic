const tfragFullOpacityAlpha = 0x80 / 0xff;
const tfragAlphaCutoff = 0.06;
const ps2VertexColorScale = 128;
const ps2VertexColorMax = 255 / ps2VertexColorScale;

export function decodeTfragRgb5Color(value: [number, number, number]): [number, number, number] {
  return [
    Math.round(value[0] * 31) / 16,
    Math.round(value[1] * 31) / 16,
    Math.round(value[2] * 31) / 16
  ];
}

export function scaleTfragVertexColor(
  value: [number, number, number],
  postScale: number
): [number, number, number] {
  const colorScale = Math.max(0, postScale);
  const scaleComponent = (component: number) => {
    const sourceByte = Math.min(255, Math.max(0, Math.round(component * ps2VertexColorScale)));
    return Math.min(
      ps2VertexColorMax,
      Math.max(0, Math.floor(sourceByte * colorScale) / ps2VertexColorScale)
    );
  };
  return [scaleComponent(value[0]), scaleComponent(value[1]), scaleComponent(value[2])];
}

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
