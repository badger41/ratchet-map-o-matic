export function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export class LoadYieldController {
  private lastYieldTime = performance.now();

  constructor(private readonly budgetMs: number) {}

  async maybeYield(): Promise<void> {
    const now = performance.now();
    if (now - this.lastYieldTime < this.budgetMs) {
      return;
    }

    await waitForNextFrame();
    this.lastYieldTime = performance.now();
  }
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
