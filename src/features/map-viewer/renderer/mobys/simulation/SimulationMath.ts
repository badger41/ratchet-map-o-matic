const tau = Math.PI * 2;

export function wrapRadians(value: number): number {
  const wrapped = (value + Math.PI) % tau;
  return (wrapped < 0 ? wrapped + tau : wrapped) - Math.PI;
}

export function lerpWrappedRadians(from: number, to: number, amount: number): number {
  return wrapRadians(from + wrapRadians(to - from) * amount);
}
