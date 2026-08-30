const tfragFullOpacityAlpha = 0x7f / 0xff;
const tfragAlphaCutoff = 0.06;
const ps2VertexColorScale = 128;
const ps2VertexColorMax = 255 / ps2VertexColorScale;

type Vec3 = [number, number, number];
type Vec4 = [number, number, number, number];

export function decodeTfragRgb5Color(value: [number, number, number]): [number, number, number] {
  const expand = (component: number) => {
    const rgb5 = Math.min(31, Math.max(0, Math.round(component * 31)));
    return rgb5 / 16;
  };
  return [expand(value[0]), expand(value[1]), expand(value[2])];
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

export function evaluatePs2DirectionalLight(
  topColor: Vec4,
  topDirection: Vec3,
  inverseColor: Vec4,
  inverseDirection: Vec3,
  normal: Vec3
): Vec3 {
  const topDotRaw = dot(normal, normalize(topDirection));
  const inverseDotRaw = dot(normal, normalize(inverseDirection));
  const topDot = Math.max(topDotRaw, topDotRaw * topColor[3]);
  const inverseDot = Math.max(inverseDotRaw, inverseDotRaw * inverseColor[3]);

  return [
    Math.max(0, topColor[0] * topDot + inverseColor[0] * inverseDot),
    Math.max(0, topColor[1] * topDot + inverseColor[1] * inverseDot),
    Math.max(0, topColor[2] * topDot + inverseColor[2] * inverseDot)
  ];
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

function normalize(value: Vec3): Vec3 {
  const length = Math.hypot(...value);
  return length > 0.000001
    ? [value[0] / length, value[1] / length, value[2] / length]
    : [0, 1, 0];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
