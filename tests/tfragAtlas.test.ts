import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  canRemapTfragAtlasUvs,
  packTfragAtlasRects,
  remapTfragAtlasUv
} from '../src/features/map-viewer/renderer/TfragAtlas.ts';
import { resolveTfragAlphaState } from '../src/features/map-viewer/renderer/TfragMaterialState.ts';
import {
  createWaterSurfaceMaterialPasses,
  resolveWaterSurfaceHeight
} from '../src/features/map-viewer/renderer/WaterSurfacePass.ts';

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

test('normalizes PS2 tfrag alpha without letting blends punch the depth buffer', () => {
  assert.deepEqual(resolveTfragAlphaState(true, 1, 0, false), {
    opacityScale: 255 / 128,
    depthWrite: false,
    alphaTest: 0.06
  });
  assert.equal(resolveTfragAlphaState(false, 1, 0, true), null);
});

test('only shares a water split plane when every water instance has the same surface', () => {
  assert.equal(resolveWaterSurfaceHeight([12.5, 12.5]), 12.5);
  assert.equal(resolveWaterSurfaceHeight([12.5, 13]), null);
  assert.equal(resolveWaterSurfaceHeight([]), null);
});

test('splits true blends into non-depth-writing water passes', () => {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: true });
  const passes = createWaterSurfaceMaterialPasses(material);
  assert.ok(passes && !Array.isArray(passes.below));
  assert.equal(passes.above, material);
  assert.equal(material.depthWrite, false);
  assert.equal(passes.below.depthWrite, false);
  assert.ok(material.maskNode);
  assert.ok('maskNode' in passes.below && passes.below.maskNode);
  material.dispose();
  passes.below.dispose();
});
