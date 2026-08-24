import assert from 'node:assert/strict';
import test from 'node:test';
import {
  tieGlowDisplayByte,
  tieGlowRgbForPhase,
  wrapTieGlowAngle
} from '../src/features/map-viewer/renderer/mobys/simulation/dl/3305/TieGlowColorMath.ts';

test('matches the game tie-glow byte math', () => {
  const rgb = (r: number, g: number, b: number) => r | g << 8 | b << 16;
  const faded = tieGlowRgbForPhase(0, rgb(200, 100, 20), rgb(80, 40, 8), 0, 1, false);

  assert.deepEqual([0, 8, 16].map((shift) => tieGlowDisplayByte(faded, shift)), [20, 8, 0]);
  assert.equal(
    tieGlowRgbForPhase(0, rgb(200, 100, 20), rgb(80, 40, 8), 0.5, 1, true),
    rgb(140, 70, 14)
  );
  assert.equal(
    tieGlowRgbForPhase(0, rgb(200, 100, 20), rgb(80, 40, 8), -Math.PI / 2, 0, true),
    rgb(200, 100, 20)
  );
  assert.equal(
    tieGlowRgbForPhase(0, rgb(200, 100, 20), rgb(80, 40, 8), Math.PI / 2, 0, true),
    rgb(80, 40, 8)
  );
  assert.equal(wrapTieGlowAngle(Math.PI), -Math.PI);
});
