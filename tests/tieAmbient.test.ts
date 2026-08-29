import assert from 'node:assert/strict';
import test from 'node:test';
import { tieAmbientPackedColor } from '../src/services/mapPackages/tiePackageParsers.ts';

test('decodes 0xffff tie colors instead of replacing them with neutral light', () => {
  assert.deepEqual(tieAmbientPackedColor([0x2c3c, 0xff1f, 0xffff], 2), {
    r: 60,
    g: 44,
    b: 31,
    valid: true
  });
});
