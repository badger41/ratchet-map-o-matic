import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  inspectMobyViewOptions,
  isMobyMetalObject,
  mobyPreviewAlphaScale,
  pruneMobyLods,
  setMobyBangles,
  setMobyLod,
  setMobyMetalsVisible
} from '../src/features/map-viewer/renderer/mobys/MobyGltfSupport.ts';
import {
  configureModelMaterialTransparency,
  resolveModelMaterialInfo
} from '../src/features/map-viewer/renderer/model-materials/ModelMaterialNodes.ts';
import { mergeMissionMobyEntries } from '../src/services/mapPackages/mobyPackageEntries.ts';

test('keeps high-detail moby faces and drops lower LOD groups', () => {
  const root = new THREE.Group();
  for (const name of ['high_lod', 'low_lod', 'far_lod']) {
    const group = new THREE.Group();
    group.name = name;
    root.add(group);
  }

  const bangles = new THREE.Group();
  bangles.name = 'bangles';
  const bangle = new THREE.Group();
  bangle.name = 'bangle_00';
  const bangleHigh = new THREE.Group();
  const bangleLow = new THREE.Group();
  bangleHigh.name = 'high_lod';
  bangleLow.name = 'low_lod';
  bangle.add(bangleHigh, bangleLow);
  bangles.add(bangle);
  const metals = new THREE.Group();
  metals.name = 'metals';
  const metalMesh = new THREE.Mesh();
  metals.add(metalMesh);
  root.add(bangles, metals);
  assert.equal(isMobyMetalObject(metalMesh), true);
  assert.equal(isMobyMetalObject(bangle), false);

  assert.deepEqual(inspectMobyViewOptions(root), {
    lods: ['high_lod', 'low_lod', 'far_lod'],
    bangles: ['bangle_00'],
    hasMetals: true
  });
  setMobyLod(root, 'low_lod');
  assert.equal(root.getObjectsByProperty('name', 'high_lod').every((group) => !group.visible), true);
  assert.equal(root.getObjectsByProperty('name', 'low_lod').every((group) => group.visible), true);
  setMobyBangles(root, new Set());
  setMobyMetalsVisible(root, false);
  assert.equal(bangle.visible, false);
  assert.equal(metals.visible, false);
  assert.equal(mobyPreviewAlphaScale(128 / 255), 255 / 128);

  const blendMaterial = new THREE.MeshBasicNodeMaterial();
  blendMaterial.userData = { HasAlpha: true, AlphaMode: 'Blend', MinAlpha: 0, MaxAlpha: 128 };
  configureModelMaterialTransparency(
    blendMaterial,
    resolveModelMaterialInfo(blendMaterial, 'moby'),
    { alphaBlendDepthWrite: true }
  );
  assert.equal(blendMaterial.transparent, true);
  assert.equal(blendMaterial.depthWrite, true);
  assert.equal(blendMaterial.alphaTest, 0.06);

  pruneMobyLods(root);

  assert.equal(root.getObjectByName('low_lod'), undefined);
  assert.equal(root.getObjectByName('far_lod'), undefined);
  assert.equal(root.getObjectsByProperty('name', 'high_lod').length, 2);
});

test('merges unique mission mobys while preferring main-level models', () => {
  const entries = mergeMissionMobyEntries([
    { Family: 'moby', ModelId: 10, GltfPath: 'moby/00010/moby.gltf', Status: 'written' }
  ], {
    Mobys: [
      { Group: 'mission_0', ClassId: 10, Gltf: 'missions/mission_0/moby/000a/moby.gltf', Status: 'written' },
      { Group: 'mission_0', ClassId: 20, Gltf: 'missions/mission_0/moby/0014/moby.gltf', Status: 'written' },
      { Group: 'mission_1', ClassId: 20, Gltf: 'missions/mission_1/moby/0014/moby.gltf', Status: 'written' }
    ]
  });

  assert.deepEqual(entries.map((entry) => [entry.ModelId, entry.GltfPath]), [
    [10, 'moby/00010/moby.gltf'],
    [20, '../missions/mission_0/moby/0014/moby.gltf']
  ]);
});
