import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeRc1TieAmbientColor,
  evaluateRc1PointLighting,
  prepareRc1PointLights
} from '../src/features/map-viewer/renderer/rc1/Rc1Lighting.ts';
import { parseRc1PointLightRecords } from '../src/services/mapPackages/rc1/Rc1PointLights.ts';

test('parses and evaluates RC1 ambient and point lights', () => {
  const bytes = new Uint8Array(0x30);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 1, true);
  view.setFloat32(0x10, 10, true);
  view.setFloat32(0x14, 0, true);
  view.setFloat32(0x18, 0, true);
  view.setFloat32(0x1c, 20, true);
  bytes.set([128, 64, 0], 0x20);

  const lights = prepareRc1PointLights(parseRc1PointLightRecords(bytes));
  assert.deepEqual(decodeRc1TieAmbientColor([0x001f], 0), {
    r: 255,
    g: 0,
    b: 0,
    valid: true
  });
  assert.deepEqual(evaluateRc1PointLighting([0, 0, 0], [1, 0, 0], lights), [0.5, 0.25, 0]);
  assert.throws(() => parseRc1PointLightRecords(new Uint8Array(0x11)), /Invalid RC1 point light payload length/);
});
