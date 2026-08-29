import * as THREE from 'three/webgpu';
import {
  attribute,
  float,
  floor,
  sRGBTransferOETF,
  texture,
  uv,
  vec3
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import type { ShrubRenderOptions } from '../../../../services/mapPackages/mapPackageTypes';
import {
  configureModelMaterialTransparency,
  createModelOpacityNode,
  resolveModelMaterialInfo
} from '../model-materials/ModelMaterialNodes';
import {
  applyModelDisplayTextureModulateNode,
  applyShrubFogNode,
  applyShrubDisplayLiftNode,
  applyModelColorStrengthNode,
  configureModelDisplayTexture,
  decodeModelDisplayTextureNode,
  type ModelDisplayNodeOptions
} from '../ModelFog';
import {
  createShrubDirectionalLightNode,
  createShrubInstanceLightingNormalNode,
  createShrubLightingUniforms
} from './ShrubLighting';
import {
  shrubAmbientAttributeName,
  shrubAmbientTintScale,
  shrubLightingUniformsUserDataKey,
  type ShrubDirectionalLightBinding,
  type ShrubLightingUniforms
} from './ShrubTypes';

export function cloneShrubMaterial(
  material: THREE.Material | THREE.Material[],
  directionalLightBinding: ShrubDirectionalLightBinding | null,
  options: ShrubRenderOptions,
  displayOptions: ModelDisplayNodeOptions
): THREE.Material | THREE.Material[] {
  return Array.isArray(material)
    ? material.map((item) => createShrubDisplayMaterial(item, directionalLightBinding, options, displayOptions))
    : createShrubDisplayMaterial(material, directionalLightBinding, options, displayOptions);
}

function createShrubDisplayMaterial(
  source: THREE.Material,
  directionalLightBinding: ShrubDirectionalLightBinding | null,
  options: ShrubRenderOptions,
  displayOptions: ModelDisplayNodeOptions
): THREE.Material {
  const sourceMaterial = source as Partial<THREE.MeshBasicMaterial>;
  const modelMaterialInfo = resolveModelMaterialInfo(source, 'shrub');
  const uniforms = createShrubLightingUniforms(options);
  const material = new THREE.MeshBasicNodeMaterial({
    name: `${source.name || 'shrub'}_map_omatic_lit`,
    color: sourceMaterial.color?.clone?.() ?? new THREE.Color(1, 1, 1),
    map: sourceMaterial.map ?? null,
    alphaMap: sourceMaterial.alphaMap ?? null,
    vertexColors: sourceMaterial.vertexColors ?? false,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    depthTest: source.depthTest,
    depthWrite: source.depthWrite,
    side: THREE.DoubleSide,
    toneMapped: false
  });

  material.forceSinglePass = true;
  material.userData = {
    ...source.userData,
    mapOmaticShrubMaterial: true,
    mapOmaticShrubDirectionalLightMaterial: directionalLightBinding !== null,
    mapOmaticModelMaterialInfo: modelMaterialInfo,
    [shrubLightingUniformsUserDataKey]: uniforms
  };

  if (material.map) {
    configureModelDisplayTexture(material.map);
  }

  if (material.alphaMap) {
    configureModelDisplayTexture(material.alphaMap);
  }

  configureModelMaterialTransparency(material, modelMaterialInfo);
  material.opacityNode = createModelOpacityNode(material, modelMaterialInfo);
  material.colorNode = createShrubColorNode(material, directionalLightBinding, uniforms, options, displayOptions);
  return material;
}

function createShrubColorNode(
  material: THREE.MeshBasicNodeMaterial,
  directionalLightBinding: ShrubDirectionalLightBinding | null,
  uniforms: ShrubLightingUniforms,
  options: ShrubRenderOptions,
  displayOptions: ModelDisplayNodeOptions
): Node<'vec3'> {
  const displayMaterialColorNode = sRGBTransferOETF(
    vec3(material.color.r, material.color.g, material.color.b)
  ) as Node<'vec3'>;
  const baseDisplayColorNode = material.map
    ? texture(material.map, uv()).rgb.mul(displayMaterialColorNode)
    : displayMaterialColorNode;
  const baseColorNode = decodeModelDisplayTextureNode(baseDisplayColorNode);
  const rawAmbientNode = attribute<'vec3'>(shrubAmbientAttributeName, 'vec3');
  const ambientTermNode = rawAmbientNode
    .mul(float(shrubAmbientTintScale))
    .mul(uniforms.ambientScale);
  const directionalLightNode = directionalLightBinding
    ? createShrubDirectionalLightNode(
      directionalLightBinding,
      uniforms,
      displayOptions.dynamic ? undefined : options,
      createShrubInstanceLightingNormalNode())
    : null;
  const directionalTermNode = directionalLightNode
    ? applyModelColorStrengthNode(
      directionalLightNode.rgb,
      displayOptions.dynamic ? uniforms.directionalColorStrength : options.directionalColorStrength)
      .mul(uniforms.directionalScale)
    : vec3(0, 0, 0);
  const ambientLitNode = baseColorNode.mul(ambientTermNode);
  const directionalLitNode = baseColorNode.mul(directionalTermNode);
  const additiveLitNode = directionalLitNode.add(ambientLitNode);
  const combinedLightTermNode = quantizeShrubLightTermNode(ambientTermNode.add(directionalTermNode));
  const modulateLitNode = applyModelDisplayTextureModulateNode(baseDisplayColorNode, combinedLightTermNode);

  const litColorNode = additiveLitNode.mul(uniforms.blendAdditiveScale)
    .add(modulateLitNode.mul(uniforms.blendModulateScale))
    .saturate();
  const exposureNode = displayOptions.dynamic ? uniforms.exposureScale : float(Math.max(0, options.exposure));
  return applyShrubFogNode(
    applyShrubDisplayLiftNode(litColorNode.mul(exposureNode).saturate(), displayOptions),
    displayOptions
  );
}

function quantizeShrubLightTermNode(lightTermNode: Node<'vec3'>): Node<'vec3'> {
  return floor(
    lightTermNode.clamp(0, shrubAmbientTintScale)
      .mul(float(128))
      .add(float(0.5))
  ).div(float(128));
}
