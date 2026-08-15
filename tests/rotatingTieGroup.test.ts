import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  ps2ToGltfBasisMatrix,
  setViewerTieGroupRotation
} from '../src/features/map-viewer/renderer/ties/TieTypes.ts';

test('shared-pivot tie rotation follows the controller local axis', () => {
  const controllerYaw = -0.5890486240386963;
  const controllerRotation = new THREE.Matrix4()
    .makeRotationFromEuler(new THREE.Euler(0, controllerYaw, 0, 'ZYX'));
  const rotation = new THREE.Matrix4();
  setViewerTieGroupRotation(
    rotation,
    new THREE.Matrix4().makeRotationZ(-Math.PI / 2),
    controllerRotation,
    controllerRotation.clone().invert()
  );
  const localAxis = new THREE.Vector3(0, 0, 1)
    .transformDirection(controllerRotation)
    .transformDirection(ps2ToGltfBasisMatrix);
  const rotatedAxis = localAxis.clone().transformDirection(rotation);
  assert.ok(rotatedAxis.distanceTo(localAxis) < 1e-6);
});
