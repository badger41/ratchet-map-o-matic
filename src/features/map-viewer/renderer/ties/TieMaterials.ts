import * as THREE from 'three/webgpu';
import {
  float,
  max,
  positionView,
  smoothstep,
  texture,
  uniform,
  uv,
  vec3
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import type {
  TieRenderOptions
} from '../../../../services/mapPackages/mapPackageTypes';
import {
  applyModelMaterialFeatureColorNode,
  configureModelMaterialTransparency,
  createModelOpacityNode,
  resolveModelMaterialInfo,
  type ModelMaterialFeatureOptions,
  type ModelMaterialInfo
} from '../model-materials/ModelMaterialNodes';
import {
  applyTieFogNode,
  applyTieDisplayLiftNode,
  applyModelDisplayModulateNode,
  applyModelColorStrengthNode
} from '../ModelFog';
import { createTieAmbientRawColorNode } from './TieAmbient';
import {
  createTieDirectionalColorNode,
  createTieDirectionalLightNode,
  createTieLightingUniforms,
  updateTieMaterialLightingUniforms
} from './TieLighting';
import {
  tieEnvironmentPassMask,
  tieAmbientRawIntensityScale,
  type TieAmbientTextureBinding,
  type TieDirectionalLightBinding,
  type TieInstancedMeshBinding,
  type TieLightingUniforms
} from './TieTypes';

type MeshBasicWithEmissiveNode = THREE.MeshBasicNodeMaterial & {
  emissiveNode: Node<'vec3'> | null;
};

const tieBloomFadeStart = uniform(0);
const tieBloomFadeEnd = uniform(1);

export function setTieBloomDistanceFadeRange(start: number, end: number): void {
  tieBloomFadeStart.value = Math.max(0, start);
  tieBloomFadeEnd.value = Math.max(tieBloomFadeStart.value + 0.001, end);
}

export function cloneTieMaterial(
  material: THREE.Material | THREE.Material[],
  geometry: THREE.BufferGeometry,
  ambientBinding: TieAmbientTextureBinding | null,
  directionalLightBinding: TieDirectionalLightBinding | null,
  skyboxReflectionTexture: THREE.Texture | null,
  options: TieRenderOptions
): THREE.Material | THREE.Material[] {
  return Array.isArray(material)
    ? material.map((item) => createTieDisplayMaterial(
      item,
      geometry,
      ambientBinding,
      directionalLightBinding,
      skyboxReflectionTexture,
      options))
    : createTieDisplayMaterial(
      material,
      geometry,
      ambientBinding,
      directionalLightBinding,
      skyboxReflectionTexture,
      options);
}

export function cloneTieTextureMaterial(material: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
  return Array.isArray(material)
    ? material.map(createTieTextureMaterial)
    : createTieTextureMaterial(material);
}

export function tieMaterialUsesGlowEmission(material: THREE.Material | THREE.Material[]): boolean {
  return Array.isArray(material)
    ? material.some((item) => resolveModelMaterialInfo(item, 'tie').usesGlowEmission)
    : resolveModelMaterialInfo(material, 'tie').usesGlowEmission;
}

export function updateTieRenderOptionUniforms(binding: TieInstancedMeshBinding, options: TieRenderOptions): void {
  updateTieMaterialLightingUniforms(binding.flatMaterial, options, false);
  if (binding.coloredMaterial) {
    updateTieMaterialLightingUniforms(binding.coloredMaterial, options, true);
  }
}

export function applyTieRenderOptions(binding: TieInstancedMeshBinding, options: TieRenderOptions): void {
  updateTieRenderOptionUniforms(binding, options);
  binding.mesh.material = options.colorsEnabled && binding.coloredMaterial
    ? binding.coloredMaterial
    : binding.flatMaterial;
}

function createTieTextureMaterial(source: THREE.Material): THREE.Material {
  const sourceMaterial = source as Partial<THREE.MeshBasicMaterial>;
  const modelMaterialInfo = resolveModelMaterialInfo(source, 'tie');
  const material = new THREE.MeshBasicNodeMaterial({
    name: `${source.name || 'tie'}_texture_debug`,
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
  if (material.map) {
    material.map.colorSpace = THREE.SRGBColorSpace;
  }
  if (material.alphaMap) {
    material.alphaMap.colorSpace = THREE.SRGBColorSpace;
  }

  configureModelMaterialTransparency(material, modelMaterialInfo);
  if (modelMaterialInfo.usesGlowEmission) {
    material.colorNode = createTieBaseColorNode(material)
      .mul(vec3(modelMaterialInfo.glowTint.r, modelMaterialInfo.glowTint.g, modelMaterialInfo.glowTint.b));
  }
  return material;
}

function createTieBloomDistanceFadeNode() {
  return float(1).sub(smoothstep(tieBloomFadeStart, tieBloomFadeEnd, positionView.z.negate()));
}

function createTieDisplayMaterial(
  source: THREE.Material,
  geometry: THREE.BufferGeometry,
  ambientBinding: TieAmbientTextureBinding | null,
  directionalLightBinding: TieDirectionalLightBinding | null,
  skyboxReflectionTexture: THREE.Texture | null,
  options: TieRenderOptions
): THREE.Material {
  const sourceMaterial = source as Partial<THREE.MeshBasicMaterial>;
  const modelMaterialInfo = resolveModelMaterialInfo(source, 'tie');
  const hasSecondUvReflection = hasTieSecondUvReflection(geometry, modelMaterialInfo);
  const reflectionTexture = resolveTieReflectionTexture(source, modelMaterialInfo, skyboxReflectionTexture);
  const material = new THREE.MeshBasicNodeMaterial({
    name: `${source.name || 'tie'}_map_omatic_unlit`,
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
    mapOmaticTieMaterial: true,
    mapOmaticTieAmbientMaterial: ambientBinding !== null,
    mapOmaticTieAmbientTexture: ambientBinding?.texture ?? null,
    mapOmaticTieDirectionalLightMaterial: directionalLightBinding !== null,
    mapOmaticTiePreserveMultipassMaterial: modelMaterialInfo.preserveTieMultipass,
    mapOmaticTieSecondUvReflectionMaterial: hasSecondUvReflection,
    mapOmaticTieReflectionTexture: reflectionTexture,
    mapOmaticModelMaterialInfo: modelMaterialInfo,
    mapOmaticSourceMaterialType: source.type
  };

  if (material.map) {
    material.map.colorSpace = THREE.SRGBColorSpace;
  }

  if (material.alphaMap) {
    material.alphaMap.colorSpace = THREE.SRGBColorSpace;
  }

  configureModelMaterialTransparency(material, modelMaterialInfo);
  material.opacityNode = createModelOpacityNode(material, modelMaterialInfo);
  if (modelMaterialInfo.usesGlowEmission) {
    const glowColorNode = createTieBaseColorNode(material)
      .mul(vec3(modelMaterialInfo.glowTint.r, modelMaterialInfo.glowTint.g, modelMaterialInfo.glowTint.b));
    const bloomFadeNode = createTieBloomDistanceFadeNode();
    material.colorNode = glowColorNode.mul(float(1).sub(bloomFadeNode));
    (material as MeshBasicWithEmissiveNode).emissiveNode = glowColorNode.mul(bloomFadeNode);
    return material;
  }

  const needsFeatureColorNode = modelMaterialInfo.usesReflectiveMask
    || modelMaterialInfo.passFlags !== 0;
  if (ambientBinding || directionalLightBinding || needsFeatureColorNode) {
    const lightingUniforms = createTieLightingUniforms(
      options,
      ambientBinding !== null,
      directionalLightBinding !== null
    );
    material.userData.mapOmaticTieLightingUniforms = lightingUniforms;
    material.colorNode = createTieColorNode(
      material,
      ambientBinding,
      directionalLightBinding,
      reflectionTexture,
      lightingUniforms,
      hasSecondUvReflection,
      modelMaterialInfo);
  }

  return material;
}

function resolveTieReflectionTexture(
  source: THREE.Material,
  modelMaterialInfo: ModelMaterialInfo,
  fallbackTexture: THREE.Texture | null
): THREE.Texture | null {
  if (!modelMaterialInfo.usesReflectiveMask || modelMaterialInfo.reflectiveEnvironmentSource !== 'TieTexture') {
    return fallbackTexture;
  }

  const sourceMaterial = source as Partial<THREE.MeshStandardMaterial>;
  const texture = sourceMaterial.emissiveMap ?? null;
  if (!texture) {
    return fallbackTexture;
  }

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createTieColorNode(
  material: THREE.MeshBasicNodeMaterial,
  ambientBinding: TieAmbientTextureBinding | null,
  directionalLightBinding: TieDirectionalLightBinding | null,
  skyboxReflectionTexture: THREE.Texture | null,
  lightingUniforms: TieLightingUniforms,
  hasSecondUvReflection: boolean,
  modelMaterialInfo: ModelMaterialInfo
): Node<'vec3'> {
  const baseColorNode = createTieBaseColorNode(material);
  const directionalLightNode = directionalLightBinding
    ? createTieDirectionalLightNode(directionalLightBinding, lightingUniforms)
    : null;
  const directionalColorNode = directionalLightBinding
    ? createTieDirectionalColorNode(directionalLightBinding, lightingUniforms)
    : null;
  const directionalTermNode = directionalLightNode
    ? applyModelColorStrengthNode(directionalLightNode, lightingUniforms.directionalColorStrength)
      .mul(lightingUniforms.directionalScale)
      .mul(float(0.5))
    : vec3(0, 0, 0);
  const directionalLitNode = directionalLightNode
    ? baseColorNode.mul(directionalTermNode)
    : vec3(0, 0, 0);
  let litColorNode: Node<'vec3'> = directionalLightNode
    ? directionalLitNode.add(directionalLightNode.mul(lightingUniforms.rawDirectionalScale))
    : baseColorNode;

  if (directionalColorNode) {
    litColorNode = litColorNode.add(
      directionalColorNode.mul(lightingUniforms.rawDirectionalColorScale)
    );
  }

  if (ambientBinding) {
    const rawAmbientColorNode = createTieAmbientRawColorNode(ambientBinding);
    const ambientColorNode = rawAmbientColorNode.mul(float(tieAmbientRawIntensityScale));
    const ambientTermNode = applyTieColorStrength(
      ambientColorNode,
      lightingUniforms.colorStrength
    ).mul(lightingUniforms.ambientScale);
    const ambientLitNode = baseColorNode.mul(ambientTermNode);
    const combinedLightTermNode = ambientTermNode.add(directionalTermNode).clamp(0, 1);
    const additiveLitNode = directionalLitNode.add(ambientLitNode);
    const tintedWorldLitNode = baseColorNode.mul(ambientTermNode).mul(vec3(1, 1, 1).add(directionalTermNode));
    const modulateLitNode = applyModelDisplayModulateNode(baseColorNode, combinedLightTermNode);
    const maxLightLitNode = baseColorNode.mul(max(ambientTermNode, directionalTermNode));
    const blendedLitNode = additiveLitNode.mul(lightingUniforms.blendAdditiveScale)
      .add(tintedWorldLitNode.mul(lightingUniforms.blendTintedWorldScale))
      .add(modulateLitNode.mul(lightingUniforms.blendModulateScale))
      .add(maxLightLitNode.mul(lightingUniforms.blendMaxLightScale));

    litColorNode = litColorNode
      .sub(directionalLitNode)
      .add(blendedLitNode)
      .add(ambientColorNode.mul(lightingUniforms.rawColorScale))
      .add(rawAmbientColorNode.mul(lightingUniforms.rawByteScale));
  }

  const featureColorNode = applyModelMaterialFeatureColorNode(
    material,
    modelMaterialInfo,
    baseColorNode,
    litColorNode,
    createTieMaterialFeatureOptions(
      directionalColorNode && directionalLightNode
        ? max(directionalLightNode, directionalColorNode.mul(float(0.45)))
        : directionalColorNode,
      skyboxReflectionTexture,
      lightingUniforms,
      hasSecondUvReflection));
  return applyTieFogNode(applyTieDisplayLiftNode(featureColorNode.mul(lightingUniforms.exposureScale).clamp(0, 1)));
}

function createTieBaseColorNode(material: THREE.MeshBasicNodeMaterial): Node<'vec3'> {
  const materialColorNode = vec3(material.color.r, material.color.g, material.color.b);
  if (!material.map) {
    return materialColorNode;
  }

  return texture(material.map, uv()).rgb.mul(materialColorNode);
}

function hasTieSecondUvReflection(
  geometry: THREE.BufferGeometry,
  modelMaterialInfo: ModelMaterialInfo
): boolean {
  if (!modelMaterialInfo.usesReflectiveMask) {
    return false;
  }
  if (usesTieGeneratedEnvPassReflection(modelMaterialInfo)) {
    return false;
  }

  const position = geometry.getAttribute('position');
  const uv1 = geometry.getAttribute('uv1');
  return Boolean(position && uv1 && uv1.itemSize >= 2 && uv1.count === position.count);
}

function usesTieGeneratedEnvPassReflection(modelMaterialInfo: ModelMaterialInfo): boolean {
  return modelMaterialInfo.family === 'tie'
    && (modelMaterialInfo.passEnvironmentModeBits !== 0
      || (modelMaterialInfo.passFlags & tieEnvironmentPassMask) !== 0
      || modelMaterialInfo.secondPassMode === 'GeneratedEnvPass'
      || modelMaterialInfo.secondPassMode === 'GeneratedEnvPassAlt'
      || modelMaterialInfo.secondPassMode === 'GeneratedEnvPassMixed');
}

function applyTieColorStrength(colorNode: Node<'vec3'>, colorStrength: Node<'float'>): Node<'vec3'> {
  const neutral = vec3(1, 1, 1);
  return max(neutral.add(colorNode.sub(neutral).mul(colorStrength)), vec3(0, 0, 0));
}

function createTieMaterialFeatureOptions(
  tintNode: Node<'vec3'> | null,
  skyboxReflectionTexture: THREE.Texture | null,
  lightingUniforms: TieLightingUniforms,
  hasSecondUvReflection: boolean
): ModelMaterialFeatureOptions {
  return {
    shine: {
      tintNode,
      skyboxTexture: skyboxReflectionTexture,
      shineScaleNode: lightingUniforms.shineScale,
      skyboxReflectionScaleNode: lightingUniforms.reflectionScale,
      materialDebugModeNode: lightingUniforms.materialDebugMode,
      useSecondUvReflection: hasSecondUvReflection
    }
  };
}
