import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { defaultSkyboxRenderOptions } from '../src/services/mapPackages/mapPackageTypes.ts';
import {
  cloneSkyboxMaterial,
  configureSkyboxMaterial,
  isSkyboxBloomLayer
} from '../src/features/map-viewer/renderer/skybox/SkyboxMaterials.ts';
import { ps2SkyBloomProfileForGame } from '../src/features/map-viewer/renderer/TightBloomNode.ts';

test('renders UYA bloom shells and keeps their GS alpha in the auxiliary output', () => {
  const source = new THREE.MeshBasicMaterial({ color: 0x000000 });
  source.map = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
    THREE.RGBAFormat
  );
  source.userData.SkyboxDrawBlendMode = 'Bloom';
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), source);
  const root = new THREE.Group();
  root.userData.Game = 'UYA';
  root.add(mesh);
  const material = cloneSkyboxMaterial(source, mesh) as THREE.MeshBasicNodeMaterial;

  assert.equal(isSkyboxBloomLayer(material, mesh), true);
  assert.equal(material.color.getHex(), 0xffffff);
  configureSkyboxMaterial(material, mesh, defaultSkyboxRenderOptions);
  assert.ok(material.emissiveNode);
  assert.ok(material.outputNode);
  assert.equal(material.blendSrc, THREE.OneFactor);
  assert.equal(material.blendDst, THREE.ZeroFactor);
  assert.equal(material.blendDstAlpha, THREE.ZeroFactor);

  source.userData.SkyboxDrawBlendMode = 'SourceOver';
  const laterShell = cloneSkyboxMaterial(source, mesh) as THREE.MeshBasicNodeMaterial;
  configureSkyboxMaterial(laterShell, mesh, defaultSkyboxRenderOptions);
  assert.ok(laterShell.opacityNode);
  assert.equal(laterShell.blendDstAlpha, THREE.OneMinusSrcAlphaFactor);

  root.userData.Game = 'DL';
  const dlShell = cloneSkyboxMaterial(source, mesh) as THREE.MeshBasicNodeMaterial;
  configureSkyboxMaterial(dlShell, mesh, defaultSkyboxRenderOptions);
  assert.equal(dlShell.blendDstAlpha, THREE.OneMinusSrcAlphaFactor);
});

test('uses UYA legacy bloom without changing the DL path', () => {
  assert.equal(ps2SkyBloomProfileForGame('UYA'), 'uya');
  assert.equal(ps2SkyBloomProfileForGame('DL'), 'dl');
  assert.equal(ps2SkyBloomProfileForGame('GC'), 'dl');
});
