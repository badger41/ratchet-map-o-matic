import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTieGroupRecords } from '../src/services/mapPackages/tiePackageParsers.ts';

test('a missing TIE group does not truncate the preceding group', () => {
  const bytes = new Uint8Array(0x28);
  const view = new DataView(bytes.buffer);
  view.setInt32(0x00, 3, true);
  view.setInt32(0x04, 8, true);
  view.setInt32(0x10, 0, true);
  view.setInt32(0x14, -1, true);
  view.setInt32(0x18, 4, true);
  view.setUint16(0x20, 1, true);
  view.setUint16(0x22, 0x8002, true);
  view.setUint16(0x24, 3, true);
  view.setUint16(0x26, 0x8004, true);

  assert.deepEqual(parseTieGroupRecords(bytes, 10), [[1, 2], [], [3, 4]]);
});
