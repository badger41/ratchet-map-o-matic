import assert from 'node:assert/strict';
import test from 'node:test';
import { hasTieBloomSourceNear } from '../src/features/map-viewer/renderer/ties/TieBloomRange.ts';

test('runs bloom only when a glow sphere reaches the camera range', () => {
  const centers = [20, 0, 0, 2, 200, 0, 0, 5];
  const camera = { x: 0, y: 0, z: 0 };

  assert.equal(hasTieBloomSourceNear(centers, camera, 17.9), false);
  assert.equal(hasTieBloomSourceNear(centers, camera, 18), true);
});
