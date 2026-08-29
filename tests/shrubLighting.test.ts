import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createShrubLightBasisInstanceAttributes } from '../src/features/map-viewer/renderer/shrubs/ShrubLightBasis.ts';

test('shrub lighting basis keeps rotation but removes non-uniform instance scale', () => {
  const instanceMatrix = new THREE.Matrix4()
    .makeRotationZ(Math.PI / 2)
    .scale(new THREE.Vector3(2, 3, 4));
  const basis = createShrubLightBasisInstanceAttributes(
    [{ instanceMatrix }],
    new THREE.Matrix4()
  );

  const approximately = (actual: ArrayLike<number>, expected: number[]) => {
    assert.equal(actual.length, expected.length);
    expected.forEach((value, index) => assert.ok(Math.abs(actual[index] - value) < 1e-6));
  };
  approximately(basis.x.array, [0, 1, 0]);
  approximately(basis.y.array, [-1, 0, 0]);
  approximately(basis.z.array, [0, 0, 1]);
});
