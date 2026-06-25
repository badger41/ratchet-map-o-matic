import * as THREE from 'three/webgpu';
import {
  attribute,
  float,
  mix,
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
  createShrubDirectionalLightNode,
  createShrubLightingUniforms
} from './ShrubLighting';
import {
  shrubAmbientAttributeName,
  shrubAmbientTintScale,
  shrubDirectionalLightFloor,
  shrubDirectionalLightReferenceIntensity,
  shrubLightingUniformsUserDataKey,
  type ShrubDirectionalLightBinding,
  type ShrubLightingUniforms
} from './ShrubTypes';

export function cloneShrubMaterial(
  material: THREE.Material | THREE.Material[],
  directionalLightBinding: ShrubDirectionalLightBinding | null,
  options: ShrubRenderOptions
): THREE.Material | THREE.Material[] {
  return Array.isArray(material)
    ? material.map((item) => createShrubDisplayMaterial(item, directionalLightBinding, options))
    : createShrubDisplayMaterial(material, directionalLightBinding, options);
}

function createShrubDisplayMaterial(
  source: THREE.Material,
  directionalLightBinding: ShrubDirectionalLightBinding | null,
  options: ShrubRenderOptions
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
    material.map.colorSpace = THREE.SRGBColorSpace;
  }

  if (material.alphaMap) {
    material.alphaMap.colorSpace = THREE.SRGBColorSpace;
  }

  configureModelMaterialTransparency(material, modelMaterialInfo);
  material.opacityNode = createModelOpacityNode(material, modelMaterialInfo);
  material.colorNode = createShrubColorNode(material, directionalLightBinding, uniforms);
  return material;
}

function createShrubColorNode(
  material: THREE.MeshBasicNodeMaterial,
  directionalLightBinding: ShrubDirectionalLightBinding | null,
  uniforms: ShrubLightingUniforms
): Node<'vec3'> {
  const materialColorNode = vec3(material.color.r, material.color.g, material.color.b);
  const baseColorNode = material.map
    ? texture(material.map, uv()).rgb.mul(materialColorNode)
    : materialColorNode;
  const rawAmbientNode = attribute<'vec3'>(shrubAmbientAttributeName, 'vec3');
  const ambientNode = rawAmbientNode.mul(uniforms.ambientScale);
  const directionalLightNode = directionalLightBinding
    ? createShrubDirectionalLightNode(directionalLightBinding)
    : null;
  const directionalValidNode = directionalLightNode ? directionalLightNode.a : float(0);
  const directionalTermNode = directionalLightNode
    ? mix(
      vec3(1, 1, 1),
      directionalLightNode.rgb
        .mul(uniforms.directionalScale)
        .div(float(shrubDirectionalLightReferenceIntensity))
        .add(vec3(shrubDirectionalLightFloor, shrubDirectionalLightFloor, shrubDirectionalLightFloor))
        .clamp(0, 1),
      directionalLightNode.a
    )
    : vec3(1, 1, 1);
  const instanceTintNode = mix(
    vec3(1, 1, 1),
    rawAmbientNode.mul(float(shrubAmbientTintScale)),
    directionalValidNode
  );
  const ambientLitNode = baseColorNode.mul(ambientNode);
  const additiveLitNode = baseColorNode.mul(directionalTermNode).add(ambientLitNode);
  const modulateLitNode = baseColorNode.mul(directionalTermNode).mul(instanceTintNode).add(ambientLitNode);

  return additiveLitNode.mul(uniforms.blendAdditiveScale)
    .add(modulateLitNode.mul(uniforms.blendModulateScale))
    .saturate();
}
