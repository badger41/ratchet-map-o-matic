const thresholdBlendAmount = 0.1;
const tau = Math.PI * 2;

export function tieGlowRgbForPhase(
  current: number,
  colorA: number,
  colorB: number,
  phase: number,
  thresholdRadians: number,
  spatial: boolean
): number {
  if (thresholdRadians === 0) {
    return lerpRgb(colorA, colorB, Math.sin(phase) * 0.5 + 0.5);
  }

  if (spatial) {
    const amount = Math.max(0, Math.min(1,
      phase > Math.PI - 1 ? Math.PI - phase : phase - thresholdRadians + 1
    ));
    return lerpRgb(colorB, colorA, amount);
  }

  return lerpRgb(
    current,
    phase > thresholdRadians ? colorB : colorA,
    thresholdBlendAmount
  );
}

export function tieGlowDisplayByte(rgb: number, shift: number): number {
  return rgb >> shift & 0xfc;
}

export function wrapTieGlowAngle(value: number): number {
  return ((value + Math.PI) % tau + tau) % tau - Math.PI;
}

function lerpRgb(from: number, to: number, amount: number): number {
  return lerpByte(from, to, amount)
    | lerpByte(from >> 8, to >> 8, amount) << 8
    | lerpByte(from >> 16, to >> 16, amount) << 16;
}

function lerpByte(from: number, to: number, amount: number): number {
  const fromByte = from & 0xff;
  return Math.trunc(fromByte + ((to & 0xff) - fromByte) * amount);
}
