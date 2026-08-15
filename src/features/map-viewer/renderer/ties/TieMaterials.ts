import * as THREE from 'three/webgpu';
import {
  attribute,
  float,
  max,
  mix,
  positionView,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vertexStage
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
  applyModelColorStrengthNode,
  type ModelDisplayNodeOptions
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
  tieGlowColorRowAttributeName,
  type TieAmbientTextureBinding,
  type TieDirectionalLightBinding,
  type TieGlowColorBinding,
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
  glowColorBinding: TieGlowColorBinding | null,
  directionalLightBinding: TieDirectionalLightBinding | null,
  skyboxReflectionTexture: THREE.Texture | null,
  options: TieRenderOptions,
  displayOptions: ModelDisplayNodeOptions
): THREE.Material | THREE.Material[] {
  return Array.isArray(material)
    ? material.map((item) => createTieDisplayMaterial(
      item,
      geometry,
      ambientBinding,
      glowColorBinding,
      directionalLightBinding,
      skyboxReflectionTexture,
      options,
      displayOptions))
    : createTieDisplayMaterial(
      material,
      geometry,
      ambientBinding,
      glowColorBinding,
      directionalLightBinding,
      skyboxReflectionTexture,
      options,
      displayOptions);
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
  if (binding.flatMaterial) {
    updateTieMaterialLightingUniforms(binding.flatMaterial, options, false);
  }
  if (binding.coloredMaterial) {
    updateTieMaterialLightingUniforms(binding.coloredMaterial, options, true);
  }
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
    toneMapped: false
  });
  if (material.map) {
    material.map.colorSpace = THREE.SRGBColorSpace;
  }
  if (material.alphaMap) {
    material.alphaMap.colorSpace = THREE.SRGBColorSpace;
  }

  material.userData = {
    ...source.userData,
    mapOmaticModelMaterialInfo: modelMaterialInfo
  };

  configureModelMaterialTransparency(material, modelMaterialInfo);
  material.side = source.side;
  if (modelMaterialInfo.usesGlowEmission) {
    material.colorNode = createTieGlowNode(material, modelMaterialInfo, null);
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
  glowColorBinding: TieGlowColorBinding | null,
  directionalLightBinding: TieDirectionalLightBinding | null,
  skyboxReflectionTexture: THREE.Texture | null,
  options: TieRenderOptions,
  displayOptions: ModelDisplayNodeOptions
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
    toneMapped: false
  });

  material.forceSinglePass = true;
  material.userData = {
    ...source.userData,
    mapOmaticTieMaterial: true,
    mapOmaticTieAmbientMaterial: ambientBinding !== null,
    mapOmaticTieAmbientTexture: ambientBinding?.texture ?? null,
    mapOmaticTieGlowColorTexture: glowColorBinding?.texture ?? null,
    mapOmaticTieDirectionalLightMaterial: directionalLightBinding !== null,
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
  material.side = source.side;
  material.opacityNode = createModelOpacityNode(material, modelMaterialInfo);
  if (modelMaterialInfo.usesGlowEmission) {
    const glowNode = createTieGlowNode(material, modelMaterialInfo, glowColorBinding);
    const bloomFadeNode = createTieBloomDistanceFadeNode();
    material.colorNode = glowNode;
    (material as MeshBasicWithEmissiveNode).emissiveNode = glowNode.mul(bloomFadeNode);
    return material;
  }

  const needsFeatureColorNode = modelMaterialInfo.usesReflectiveMask;
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
      modelMaterialInfo,
      options,
      displayOptions);
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

  const cachedTexture = source.userData.mapOmaticTieReflectionTexture;
  if (cachedTexture instanceof THREE.Texture) {
    return cachedTexture;
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
  modelMaterialInfo: ModelMaterialInfo,
  options: TieRenderOptions,
  displayOptions: ModelDisplayNodeOptions
): Node<'vec3'> {
  const baseColorNode = createTieBaseColorNode(material);
  const directionalLightNode = directionalLightBinding
    ? createTieDirectionalLightNode(
      directionalLightBinding,
      lightingUniforms,
      displayOptions.dynamic ? undefined : options)
    : null;
  const directionalColorNode = directionalLightBinding
    ? createTieDirectionalColorNode(directionalLightBinding, lightingUniforms)
    : null;
  const staticCombined = !displayOptions.dynamic && options.lightingMode === 'combined';
  const directionalScale = staticCombined
    ? float(Math.max(0, options.directionalIntensity))
    : lightingUniforms.directionalScale;
  const directionalTermNode = directionalLightNode
    ? applyModelColorStrengthNode(
      directionalLightNode,
      displayOptions.dynamic ? lightingUniforms.directionalColorStrength : options.directionalColorStrength)
      .mul(directionalScale)
      .mul(float(0.5))
    : vec3(0, 0, 0);
  const directionalLitNode = directionalLightNode
    ? baseColorNode.mul(directionalTermNode)
    : vec3(0, 0, 0);
  let litColorNode: Node<'vec3'> = directionalLightNode
    ? staticCombined
      ? directionalLitNode
      : directionalLitNode.add(directionalLightNode.mul(lightingUniforms.rawDirectionalScale))
    : baseColorNode;

  if (directionalColorNode && !staticCombined) {
    litColorNode = litColorNode.add(
      directionalColorNode.mul(lightingUniforms.rawDirectionalColorScale)
    );
  }

  if (ambientBinding) {
    const rawAmbientColorNode = createTieAmbientRawColorNode(ambientBinding);
    const ambientColorNode = rawAmbientColorNode.mul(float(tieAmbientRawIntensityScale));
    const ambientTermNode = applyTieColorStrength(
      ambientColorNode,
      staticCombined ? float(Math.max(0, options.colorStrength)) : lightingUniforms.colorStrength
    ).mul(staticCombined ? float(Math.max(0, options.ambientIntensity)) : lightingUniforms.ambientScale);
    const ambientLitNode = baseColorNode.mul(ambientTermNode);
    const combinedLightTermNode = ambientTermNode.add(directionalTermNode).clamp(0, 1);
    const additiveLitNode = directionalLitNode.add(ambientLitNode);
    const tintedWorldLitNode = baseColorNode.mul(ambientTermNode).mul(vec3(1, 1, 1).add(directionalTermNode));
    const modulateLitNode = applyModelDisplayModulateNode(baseColorNode, combinedLightTermNode);
    const maxLightLitNode = baseColorNode.mul(max(ambientTermNode, directionalTermNode));
    const blendedLitNode = staticCombined
      ? directionalLightNode
        ? selectStaticTieBlendNode(options.blendMode, additiveLitNode, tintedWorldLitNode, modulateLitNode, maxLightLitNode)
        : additiveLitNode
      : additiveLitNode.mul(lightingUniforms.blendAdditiveScale)
        .add(tintedWorldLitNode.mul(lightingUniforms.blendTintedWorldScale))
        .add(modulateLitNode.mul(lightingUniforms.blendModulateScale))
        .add(maxLightLitNode.mul(lightingUniforms.blendMaxLightScale));

    litColorNode = litColorNode
      .sub(directionalLitNode)
      .add(blendedLitNode);
    if (!staticCombined) {
      litColorNode = litColorNode
        .add(ambientColorNode.mul(lightingUniforms.rawColorScale))
        .add(rawAmbientColorNode.mul(lightingUniforms.rawByteScale));
    }
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
  const exposureNode = displayOptions.dynamic ? lightingUniforms.exposureScale : float(Math.max(0, options.exposure));
  return applyTieFogNode(
    applyTieDisplayLiftNode(featureColorNode.mul(exposureNode).clamp(0, 1), displayOptions),
    displayOptions
  );
}

function selectStaticTieBlendNode(
  blendMode: TieRenderOptions['blendMode'],
  additive: Node<'vec3'>,
  tintedWorld: Node<'vec3'>,
  modulate: Node<'vec3'>,
  maxLight: Node<'vec3'>
): Node<'vec3'> {
  switch (blendMode) {
    case 'additive':
      return additive;
    case 'modulate':
      return modulate;
    case 'max-light':
      return maxLight;
    case 'tinted-world':
    default:
      return tintedWorld;
  }
}

function createTieBaseColorNode(material: THREE.MeshBasicNodeMaterial): Node<'vec3'> {
  const materialColorNode = uniform(new THREE.Vector3(material.color.r, material.color.g, material.color.b));
  if (!material.map) {
    return materialColorNode;
  }

  return texture(material.map, uv()).rgb.mul(materialColorNode);
}

function createTieGlowNode(
  material: THREE.MeshBasicNodeMaterial,
  modelMaterialInfo: ModelMaterialInfo,
  glowColorBinding: TieGlowColorBinding | null
): Node<'vec3'> {
  const baseColor = createTieBaseColorNode(material);
  const exportedTint = uniform(new THREE.Vector3(
    modelMaterialInfo.glowTint.r,
    modelMaterialInfo.glowTint.g,
    modelMaterialInfo.glowTint.b
  ));
  const glowStrength = uniform(modelMaterialInfo.glowEmissionStrength);
  if (!glowColorBinding) {
    return baseColor.mul(exportedTint).mul(glowStrength);
  }

  const row = attribute<'float'>(tieGlowColorRowAttributeName, 'float');
  const runtimeTint = vertexStage(texture(
    glowColorBinding.texture,
    vec2(float(0.5), row.add(float(0.5)).div(uniform(Math.max(1, glowColorBinding.instanceCount))).clamp(0, 1))
  ));
  return baseColor.mul(mix(exportedTint, runtimeTint.rgb.mul(float(255 / 128)), runtimeTint.a)).mul(glowStrength);
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
