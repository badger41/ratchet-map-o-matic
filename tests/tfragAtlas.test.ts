import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { packTfragAtlasRects, remapTfragAtlasUv } from '../src/features/map-viewer/renderer/TfragAtlas.ts';

test('packs padded tfrag textures into an atlas with a power-of-two width and no overlap', () => {
  const packed = packTfragAtlasRects([
    { key: 'a', width: 128, height: 128 },
    { key: 'b', width: 64, height: 64 },
    { key: 'c', width: 32, height: 32 }
  ]);

  assert.equal((packed.width & (packed.width - 1)), 0);
  for (const rect of packed.rects) {
    assert.ok(rect.x + rect.width + 2 <= packed.width);
    assert.ok(rect.y + rect.height + 2 <= packed.height);
  }
  for (let left = 0; left < packed.rects.length; left += 1) {
    for (let right = left + 1; right < packed.rects.length; right += 1) {
      const a = packed.rects[left];
      const b = packed.rects[right];
      assert.ok(a.x + a.width + 2 <= b.x || b.x + b.width + 2 <= a.x
        || a.y + a.height + 2 <= b.y || b.y + b.height + 2 <= a.y);
    }
  }
});

test('remaps repeating and clamped tfrag UVs into an atlas region', () => {
  assert.equal(remapTfragAtlasUv(-0.25, 0.5, 0.25, THREE.RepeatWrapping), 0.6875);
  assert.equal(remapTfragAtlasUv(1.25, 0.5, 0.25, THREE.RepeatWrapping), 0.5625);
  assert.equal(remapTfragAtlasUv(-1, 0.5, 0.25, THREE.ClampToEdgeWrapping), 0.5);
  assert.equal(remapTfragAtlasUv(2, 0.5, 0.25, THREE.ClampToEdgeWrapping), 0.75);
});
