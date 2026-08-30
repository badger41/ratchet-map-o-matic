export { numberValue } from '../InstanceData';

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

    await yieldToMainThread();
    this.lastYieldTime = performance.now();
  }
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
