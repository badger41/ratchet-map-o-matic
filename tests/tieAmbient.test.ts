import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  tieAmbientPackedColor
} from '../src/services/mapPackages/tiePackageParsers.ts';
import type { DirectionalLightRecord } from '../src/services/mapPackages/mapPackageTypes.ts';
import { applyTieSourceLighting } from '../src/features/map-viewer/renderer/ties/TieLighting.ts';
import type {
  PreparedTieRecord,
  TiePrimitive
} from '../src/features/map-viewer/renderer/ties/TieTypes.ts';

test('decodes 0xffff tie colors instead of replacing them with neutral light', () => {
  assert.deepEqual(tieAmbientPackedColor([0x2c3c, 0xff1f, 0xffff], 2), {
    r: 60,
    g: 44,
    b: 31,
    valid: true
  });
});

test('replicates compact low bits before shifting', () => {
  assert.deepEqual(tieAmbientPackedColor([0, 0, 4], 2), {
    r: 33,
    g: 0,
    b: 0,
    valid: true
  });
});

test('bakes packed TIE lighting before its per-source scale', () => {
  const geometry = new THREE.BufferGeometry();
  const primitive: TiePrimitive = {
    name: 'packed_light_test',
    geometry,
    material: new THREE.MeshBasicMaterial(),
    matrixWorld: new THREE.Matrix4(),
    renderOrder: 0,
    isGlowOverlay: false,
    hasAmbientAttribute: false,
    ambientSlotCount: 3,
    ambientWordCount: 3,
    ambientColorRecipes: [],
    ambientSourceIndices: null,
    packedLightModeBits: 1,
    packedLightNormals: [0x0080],
    packedLightScales: [64]
  };
  const record: PreparedTieRecord = {
    source: {
      index: 0,
      classId: 0x2232,
      headerWords: [0, 0, 0],
      matrixRows: [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0]
      ],
      position: [0, 0, 0, 1],
      tailWords: [0, 0, 0, 0],
      lightSelector: 0
    },
    colorEntry: {
      entryIndex: 0,
      id: 0,
      wordCount: 3,
      byteLength: 6,
      offset: 0,
      nonZeroCount: 3,
      firstWords: [0x140a, 0x001e, 0],
      words: [0x140a, 0x001e, 0],
      averageRgb: [10, 20, 30]
    },
    instanceMatrix: new THREE.Matrix4(),
    mirroredKey: 'normal',
    isMirrored: false
  };
  const light: DirectionalLightRecord = {
    index: 0,
    topColor: [1, 0, 0, 0],
    topDirection: [1, 0, 0, 0],
    inverseColor: [0, 0, 0, 0],
    inverseDirection: [-1, 0, 0, 0]
  };

  assert.deepEqual(
    applyTieSourceLighting({ r: 10, g: 20, b: 30, valid: true }, 2, record, primitive, [light]),
    { r: 68, g: 10, b: 15, valid: true }
  );
  primitive.material.dispose();
  geometry.dispose();
});
