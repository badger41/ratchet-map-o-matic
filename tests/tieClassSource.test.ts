import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { mergeAdjacentTiePrimitives } from '../src/features/map-viewer/renderer/ties/TiePrimitiveMerge.ts';
import type { TiePrimitive } from '../src/features/map-viewer/renderer/ties/TieTypes.ts';

test('adjacent compatible tie primitives share one exact index stream', () => {
  const material = new THREE.MeshBasicMaterial();
  const otherMaterial = new THREE.MeshBasicMaterial();
  const position = new THREE.BufferAttribute(new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    2, 0, 0, 3, 0, 0, 2, 1, 0,
    4, 0, 0, 5, 0, 0, 4, 1, 0
  ]), 3);
  const primitive = (indices: number[], primitiveMaterial: THREE.Material): TiePrimitive => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', position);
    geometry.setIndex(indices);
    return {
      name: 'primitive',
      geometry,
      material: primitiveMaterial,
      matrixWorld: new THREE.Matrix4(),
      renderOrder: 0,
      isGlowOverlay: false,
      hasAmbientAttribute: false,
      ambientSlotCount: null,
      ambientWordCount: null,
      ambientColorRecipes: [],
      ambientSourceIndices: null
    };
  };

  const primitives = mergeAdjacentTiePrimitives([
    primitive([0, 1, 2], material),
    primitive([3, 4, 5], material),
    primitive([6, 7, 8], otherMaterial)
  ]);
  assert.equal(primitives.length, 2);
  assert.deepEqual(Array.from(primitives[0].geometry.index!.array), [0, 1, 2, 3, 4, 5]);
  assert.equal(primitives.reduce((sum, item) => sum + item.geometry.index!.count / 3, 0), 3);
});
