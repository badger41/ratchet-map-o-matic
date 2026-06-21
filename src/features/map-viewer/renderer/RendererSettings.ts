export const defaultWorldDisplayLift = 2.5;

export function resolveFrameRateLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 120;
  }

  if (value <= 30) {
    return 30;
  }

  if (value <= 60) {
    return 60;
  }

  if (value <= 120) {
    return 120;
  }

  return 240;
}

export function resolveWorldDisplayLift(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 1;
}

export function shouldUseWorldComposite(value: number): boolean {
  return Math.abs(value - 1) > 0.001;
}

export function frameIntervalForLimit(limit: number): number {
  return 1000 / limit;
}
