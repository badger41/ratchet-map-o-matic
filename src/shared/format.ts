export function formatByteSize(byteLength: number | null | undefined): string {
  if (byteLength === null || byteLength === undefined || !Number.isFinite(byteLength)) {
    return 'Unknown';
  }

  if (byteLength < 1024) {
    return `${byteLength} B`;
  }

  const units = ['KB', 'MB', 'GB'];
  let value = byteLength / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unitIndex]}`;
}

export function formatDurationMs(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs)) {
    return 'Unknown';
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }

  return `${(durationMs / 1000).toFixed(2)} s`;
}
