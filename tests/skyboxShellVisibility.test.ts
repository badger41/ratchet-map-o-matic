import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  setSkyboxShellVisible,
  skyboxShellIndices
} from '../src/features/map-viewer/renderer/skybox/skyboxMetadata.ts';

test('lists and toggles meshes by exported skybox shell index', () => {
  const root = new THREE.Group();
  const shell0 = new THREE.Mesh(new THREE.BufferGeometry());
  const shell2 = new THREE.Mesh(new THREE.BufferGeometry());
  shell0.userData.SkyboxShellIndex = 0;
  shell2.geometry.userData.SkyboxShellIndex = '2';
  root.add(shell2, shell0);

  assert.deepEqual(skyboxShellIndices(root), [0, 2]);
  setSkyboxShellVisible(root, 2, false);
  assert.equal(shell0.visible, true);
  assert.equal(shell2.visible, false);
});
