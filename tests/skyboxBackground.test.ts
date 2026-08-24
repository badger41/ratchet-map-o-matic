import assert from 'node:assert/strict';
import test from 'node:test';
import { skyboxEncodedBackgroundColor } from '../src/features/map-viewer/renderer/skybox/SkyboxBackground.ts';

test('keeps the level background bytes in the encoded sky pass', () => {
  const color = skyboxEncodedBackgroundColor({
    backgroundColor: { red: 64, green: 128, blue: 192 },
    fogColor: { red: 0, green: 0, blue: 0 },
    fogNearDistance: 0,
    fogFarDistance: 0,
    fogNearIntensity: 255,
    fogFarIntensity: 255
  });

  assert.ok(Math.abs(color.r - 64 / 255) < 0.00001);
  assert.ok(Math.abs(color.g - 128 / 255) < 0.00001);
  assert.ok(Math.abs(color.b - 192 / 255) < 0.00001);
});
