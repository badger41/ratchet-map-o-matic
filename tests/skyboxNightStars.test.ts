import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateSkyboxNightStars,
  nightStarRgb
} from '../src/features/map-viewer/renderer/skybox/SkyboxNightStars.ts';

test('recreates DL generated night-star ranges and 60 Hz color twinkling', () => {
  let state = 0x12345678;
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const stars = generateSkyboxNightStars(1024, [0, 1], random);

  assert.equal(stars.length, 1024);
  assert.ok(stars.every((star) => star.size >= 56 / 256 && star.size <= 143 / 256));
  assert.ok(stars.every((star) => Math.abs(Math.hypot(...star.position) - 50) < 0.000001));
  assert.ok(stars.every((star) => star.size <= 0.4 || star.textureId === 1));
  const twinkler = stars.find((star) => star.twinkles);
  const steady = stars.find((star) => !star.twinkles);
  assert.ok(twinkler && steady);
  assert.notDeepEqual(nightStarRgb(twinkler, 0), nightStarRgb(twinkler, 1));
  assert.deepEqual(nightStarRgb(steady, 0), nightStarRgb(steady, 1));
});
