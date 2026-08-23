import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  inspectMobyViewOptions,
  isMobyMetalObject,
  mobyPreviewAlphaScale,
  pruneMobyLods,
  setMobyBangles,
  setMobyBindPose,
  setMobyLod,
  setMobyMetalsVisible
} from '../src/features/map-viewer/renderer/mobys/MobyGltfSupport.ts';
import {
  configureModelMaterialTransparency,
  resolveModelMaterialInfo,
  syncModelAlphaOpaquePass
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

  const blendMaterial = new THREE.MeshBasicMaterial();
  blendMaterial.userData = {
    HasAlpha: true,
    AlphaMode: 'Blend',
    MinAlpha: 20,
    MaxAlpha: 128,
    UsesBinaryAlpha: false,
    TextureFullOpacityAlpha: 255
  };
  const blendInfo = resolveModelMaterialInfo(blendMaterial, 'moby');
  assert.equal(blendInfo.fullOpacityAlpha, 128 / 255);
  assert.equal(blendInfo.hasOpaqueTexels, true);
  assert.equal(blendInfo.usesAlphaCutout, false);
  configureModelMaterialTransparency(blendMaterial, blendInfo);
  const compileHook = () => {};
  blendMaterial.onBeforeCompile = compileHook;
  blendMaterial.customProgramCacheKey = () => 'moby-preview-alpha';
  assert.equal(blendMaterial.transparent, true);
  assert.equal(blendMaterial.depthWrite, false);
  assert.equal(blendMaterial.alphaTest, 0);
  assert.equal(blendMaterial.forceSinglePass, true);
  const blendMesh = new THREE.Mesh(new THREE.BufferGeometry(), blendMaterial);
  syncModelAlphaOpaquePass(blendMesh);
  const opaquePass = blendMesh.children[0] as THREE.Mesh;
  assert.equal((opaquePass.material as THREE.Material).colorWrite, true);
  assert.equal((opaquePass.material as THREE.Material).depthWrite, true);
  assert.equal((opaquePass.material as THREE.Material).alphaTest, 254 / 255);
  assert.equal((opaquePass.material as THREE.Material).onBeforeCompile, compileHook);
  assert.equal((opaquePass.material as THREE.Material).customProgramCacheKey(), 'moby-preview-alpha');
  assert.notEqual(blendMaterial.onBeforeCompile, compileHook);
  assert.match(blendMaterial.onBeforeCompile.toString(), /diffuseColor\.a >=/);
  assert.equal(blendMaterial.customProgramCacheKey(), 'moby-preview-alpha-alpha-translucent-only');

  const solidMaterial = new THREE.MeshBasicMaterial();
  configureModelMaterialTransparency(solidMaterial, resolveModelMaterialInfo(solidMaterial, 'moby'));
  const groupedMesh = new THREE.Mesh(new THREE.BufferGeometry(), [blendMaterial, solidMaterial]);
  syncModelAlphaOpaquePass(groupedMesh);
  const groupedOpaqueMaterials = (groupedMesh.children[0] as THREE.Mesh).material as THREE.Material[];
  assert.equal(groupedOpaqueMaterials[0].visible, true);
  assert.equal(groupedOpaqueMaterials[1].visible, false);

  const glassMaterial = new THREE.MeshBasicMaterial();
  glassMaterial.userData = { HasAlpha: true, AlphaMode: 'Blend', MinAlpha: 20, MaxAlpha: 64 };
  const glassInfo = resolveModelMaterialInfo(glassMaterial, 'moby');
  configureModelMaterialTransparency(glassMaterial, glassInfo);
  const glassMesh = new THREE.Mesh(new THREE.BufferGeometry(), glassMaterial);
  syncModelAlphaOpaquePass(glassMesh);
  assert.equal(glassInfo.hasOpaqueTexels, false);
  assert.equal(glassMesh.children.length, 0);

  const cutoutMaterial = new THREE.MeshBasicMaterial();
  cutoutMaterial.userData = {
    HasAlpha: true,
    AlphaMode: 'Blend',
    MinAlpha: 0,
    MaxAlpha: 128,
    UsesBinaryAlpha: true
  };
  const cutoutInfo = resolveModelMaterialInfo(cutoutMaterial, 'moby');
  configureModelMaterialTransparency(cutoutMaterial, cutoutInfo);
  const cutoutMesh = new THREE.Mesh(new THREE.BufferGeometry(), cutoutMaterial);
  syncModelAlphaOpaquePass(cutoutMesh);
  assert.equal(cutoutInfo.usesAlphaCutout, true);
  assert.equal(cutoutMaterial.transparent, false);
  assert.equal(cutoutMaterial.depthWrite, true);
  assert.equal(cutoutMesh.children.length, 0);

  pruneMobyLods(root);

  assert.equal(root.getObjectByName('low_lod'), undefined);
  assert.equal(root.getObjectByName('far_lod'), undefined);
  assert.equal(root.getObjectsByProperty('name', 'high_lod').length, 2);
});

test('restores skinned mobys from inverse bind matrices', () => {
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  bone.position.x = -5;
  const skeleton = new THREE.Skeleton([bone], [new THREE.Matrix4().makeTranslation(-2, 0, 0)]);
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.bind(skeleton, new THREE.Matrix4());
  root.add(bone, mesh);

  setMobyBindPose(root);

  assert.equal(bone.position.x, 2);
  assert.equal(bone.matrixWorld.elements[12], 2);
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
