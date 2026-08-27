export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function indexValue(value: unknown): number | null {
  const number = numberValue(value);
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
