import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGcTieGlowColorPvar } from '../src/features/map-viewer/renderer/mobys/simulation/gc/3305/TieGlowColorPvar.ts';

test('GC tie glow accepts the 0x70-byte controller PVAR', () => {
  const pvar = new Uint8Array(0x70);
  const view = new DataView(pvar.buffer);
  view.setInt32(0x00, 7, true);
  view.setFloat32(0x04, 180, true);
  view.setFloat32(0x08, 40, true);
  view.setInt32(0x1c, 1, true);
  pvar.set([200, 180, 160, 80, 60, 40], 0x20);

  const config = parseGcTieGlowColorPvar(pvar);
  assert.ok(config);
  assert.equal(config.tieGroupIndex, 7);
  assert.equal(config.phaseRadiansPerStep, Math.PI / 60);
  assert.ok(Math.abs(config.thresholdRadians - 40 * Math.PI / 180) < 1e-7);
  assert.equal(config.colorA, 0xa0b4c8);
  assert.equal(config.colorB, 0x283c50);

  view.setInt32(0x1c, 0, true);
  assert.ok(parseGcTieGlowColorPvar(pvar));
});
