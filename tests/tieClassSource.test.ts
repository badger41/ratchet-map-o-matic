import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { buildTieOptions } from '../src/features/map-viewer/components/tieWindowData.ts';
import {
  applyModelMaterialFeatureColorNode,
  resolveModelMaterialInfo
} from '../src/features/map-viewer/renderer/model-materials/ModelMaterialNodes.ts';
import {
  mergeAdjacentTiePrimitives,
  splitIndexedTieGeometryComponents
} from '../src/features/map-viewer/renderer/ties/TiePrimitiveMerge.ts';
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
      ambientSourceIndices: null,
      packedLightModeBits: null,
      packedLightNormals: [],
      packedLightScales: []
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

test('tie viewer lists only loadable classes', () => {
  const options = buildTieOptions([
    { ModelId: 10, GltfPath: 'tie/00010/tie.gltf' },
    { ModelId: '20', GltfPath: 'tie/00020/tie.gltf' },
    { ModelId: null, GltfPath: 'tie/unknown/tie.gltf' },
    { ModelId: ' ', GltfPath: 'tie/blank/tie.gltf' },
    { ModelId: 30, GltfPath: null }
  ]);

  assert.deepEqual(options.map(({ modelId, label }) => ({ modelId, label })), [
    { modelId: 10, label: 'Class 10 (0x000a)' },
    { modelId: 20, label: 'Class 20 (0x0014)' }
  ]);
});

test('splits disconnected transparent tie panels into sortable geometry', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    10, 0, 0, 11, 0, 0, 10, 1, 0
  ], 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);

  const components = splitIndexedTieGeometryComponents(geometry);
  assert.equal(components.length, 2);
  assert.deepEqual(components.map((component) => Array.from(component.index!.array)), [
    [0, 1, 2],
    [3, 4, 5]
  ]);

  const complexGeometry = new THREE.BufferGeometry();
  complexGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Array(27 * 3).fill(0), 3));
  complexGeometry.setIndex(Array.from({ length: 27 }, (_, index) => index));
  assert.equal(splitIndexedTieGeometryComponents(complexGeometry)[0], complexGeometry);
});

test('tie base render-state flag does not add a reflection pass', () => {
  const material = new THREE.MeshBasicNodeMaterial();
  material.userData = {
    TieTextureAlphaUsage: 'Opaque',
    TiePassFlags: 0x08,
    TieSecondPassMode: 'None',
    TieEnvironmentPassBits: 0
  };
  const litColor = vec3(0.25, 0.5, 0.75);
  const color = applyModelMaterialFeatureColorNode(
    material,
    resolveModelMaterialInfo(material, 'tie'),
    vec3(1, 1, 1),
    litColor
  );

  assert.equal(color, litColor);
});

test('tie glow tint preserves relative packed RGB channels', () => {
  const material = new THREE.MeshBasicNodeMaterial();
  material.userData = {
    TieGlowRgba: '#4E5C6780',
    TieUsesGlowEmission: true
  };

  assert.deepEqual(resolveModelMaterialInfo(material, 'tie').glowTint.toArray(), [78 / 103, 92 / 103, 1]);
});

test('tie environment flags add the generated reflection pass', () => {
  const material = new THREE.MeshBasicNodeMaterial({ map: new THREE.Texture() });
  material.userData = {
    TieTextureAlphaUsage: 'ReflectiveMask',
    TiePassFlags: 0x0a,
    TieEnvironmentPassBits: 0x02,
    TieReflectiveEnvironmentSource: 'TieTexture',
    TieReflectiveBleedColorFactor: [1, 0.875, 0.75]
  };
  const info = resolveModelMaterialInfo(material, 'tie');
  const litColor = vec3(0.25, 0.5, 0.75);
  const color = applyModelMaterialFeatureColorNode(
    material,
    info,
    vec3(1, 1, 1),
    litColor,
    { shine: { skyboxTexture: new THREE.Texture() } }
  );

  assert.equal(info.secondPassMode, 'GeneratedEnvPass');
  assert.deepEqual(info.reflectiveBleedColor.toArray(), [1, 0.875, 0.75]);
  assert.notEqual(color, litColor);
});
