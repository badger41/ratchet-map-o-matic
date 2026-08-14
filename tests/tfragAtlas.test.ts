import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  canRemapTfragAtlasUvs,
  packTfragAtlasRects,
  remapTfragAtlasUv
} from '../src/features/map-viewer/renderer/TfragAtlas.ts';

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

test('only remaps tfrag UVs that do not rely on texture wrapping', () => {
  const contained = new THREE.Float32BufferAttribute([0, 0, 0.25, 0.75, 1, 1], 2);
  const seamUnwrapped = new THREE.Float32BufferAttribute([0.95, 0, 1.05, 0.5, 1, 1], 2);

  assert.equal(canRemapTfragAtlasUvs(contained), true);
  assert.equal(canRemapTfragAtlasUvs(seamUnwrapped), false);
  assert.equal(remapTfragAtlasUv(0.25, 0.5, 0.25), 0.5625);
});
