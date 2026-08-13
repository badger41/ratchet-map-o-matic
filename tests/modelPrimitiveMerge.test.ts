import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { mergeAdjacentModelPrimitives } from '../src/features/map-viewer/renderer/ModelPrimitiveMerge.ts';

test('adjacent model primitives with separate vertex streams merge without losing triangles', () => {
  const material = new THREE.MeshBasicMaterial();
  const otherMaterial = new THREE.MeshBasicMaterial();
  const primitive = (x: number, primitiveMaterial: THREE.Material) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      x, 0, 0, x + 1, 0, 0, x, 1, 0
    ]), 3));
    geometry.setIndex([0, 1, 2]);
    return {
      geometry,
      material: primitiveMaterial,
      matrixWorld: new THREE.Matrix4(),
      renderOrder: 0
    };
  };

  const primitives = mergeAdjacentModelPrimitives([
    primitive(0, material),
    primitive(2, material),
    primitive(4, otherMaterial)
  ]);

  assert.equal(primitives.length, 2);
  assert.equal(primitives[0].geometry.getAttribute('position').count, 6);
  assert.deepEqual(Array.from(primitives[0].geometry.index!.array), [0, 1, 2, 3, 4, 5]);
});
