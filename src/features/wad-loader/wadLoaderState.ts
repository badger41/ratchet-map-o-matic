import { formatByteSize } from '../../lib/format';
import type { WadUnpackPhase } from '../../lib/wadUnpack';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface LoadProgressState {
  value: number;
  label: string;
}

export const idleProgress: LoadProgressState = {
  value: 0,
  label: 'Idle'
};

export function progressForPhase(phase: WadUnpackPhase, loaded: number | null, total: number | null): LoadProgressState {
  if (phase === 'fetch') {
    const value = total && total > 0 && loaded !== null
      ? clamp((loaded / total) * 72, 3, 72)
      : 12;
    const label = total && total > 0 && loaded !== null
      ? `Fetching ${formatByteSize(loaded)} / ${formatByteSize(total)}`
      : 'Fetching WAD';
    return { value, label };
  }

  if (phase === 'wasm') {
    return { value: 82, label: 'Starting WASM' };
  }

  return { value: 92, label: 'Unpacking WAD' };
}

export function statusColor(status: LoadStatus): string {
  switch (status) {
    case 'loading':
      return 'blue';
    case 'ready':
      return 'teal';
    case 'error':
      return 'red';
    default:
      return 'gray';
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
