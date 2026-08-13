import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { pruneMobyLods } from '../src/features/map-viewer/renderer/mobys/MobyGltfSupport.ts';

test('keeps high-detail moby faces and drops lower LOD groups', () => {
  const root = new THREE.Group();
  for (const name of ['high_lod', 'low_lod', 'far_lod']) {
    const group = new THREE.Group();
    group.name = name;
    root.add(group);
  }

  const bangle = new THREE.Group();
  const bangleHigh = new THREE.Group();
  const bangleLow = new THREE.Group();
  bangleHigh.name = 'high_lod';
  bangleLow.name = 'low_lod';
  bangle.add(bangleHigh, bangleLow);
  root.add(bangle);

  pruneMobyLods(root);

  assert.equal(root.getObjectByName('low_lod'), undefined);
  assert.equal(root.getObjectByName('far_lod'), undefined);
  assert.equal(root.getObjectsByProperty('name', 'high_lod').length, 2);
});
