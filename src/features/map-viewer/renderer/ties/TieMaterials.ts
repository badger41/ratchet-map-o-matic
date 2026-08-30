import * as THREE from 'three/webgpu';
import {
  attribute,
  float,
  mix,
  positionView,
  sRGBTransferOETF,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vertexStage
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
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
  applyModelDisplayTextureModulateNode,
  configureModelDisplayTexture,
  decodeModelDisplayTextureNode,
  type ModelDisplayNodeOptions
} from '../ModelFog';
import { createTieAmbientRawColorNode } from './TieAmbient';
import {
  createTieDirectionalLightNode
} from './TieLighting';
import {
  tieEnvironmentPassMask,
  tieAmbientRawIntensityScale,
  tieGlowColorRowAttributeName,
  type TieAmbientTextureBinding,
  type TieDirectionalLightBinding,
  type TieGlowColorBinding
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
      displayOptions))
    : createTieDisplayMaterial(
      material,
      geometry,
      ambientBinding,
      glowColorBinding,
      directionalLightBinding,
      skyboxReflectionTexture,
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

export function tieMaterialUsesReflection(material: THREE.Material | THREE.Material[]): boolean {
  return Array.isArray(material)
    ? material.some((item) => resolveModelMaterialInfo(item, 'tie').usesReflectiveMask)
    : resolveModelMaterialInfo(material, 'tie').usesReflectiveMask;
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
    configureModelDisplayTexture(material.map);
  }
  if (material.alphaMap) {
    configureModelDisplayTexture(material.alphaMap);
  }

  material.userData = {
    ...source.userData,
    mapOmaticModelMaterialInfo: modelMaterialInfo
  };

  configureModelMaterialTransparency(material, modelMaterialInfo);
  material.side = source.side;
  if (modelMaterialInfo.usesGlowEmission) {
    material.colorNode = createTieGlowNode(material, modelMaterialInfo, null);
  } else {
    material.colorNode = decodeModelDisplayTextureNode(createTieBaseDisplayColorNode(material));
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
    configureModelDisplayTexture(material.map);
  }

  if (material.alphaMap) {
    configureModelDisplayTexture(material.alphaMap);
  }

  configureModelMaterialTransparency(material, modelMaterialInfo);
  material.side = source.side;
  material.opacityNode = createModelOpacityNode(material, modelMaterialInfo);
  if (modelMaterialInfo.usesGlowEmission) {
    const glowNode = applyTieFogNode(
      createTieGlowNode(material, modelMaterialInfo, glowColorBinding),
      displayOptions);
    const bloomFadeNode = createTieBloomDistanceFadeNode();
    material.colorNode = glowNode.mul(float(1).sub(bloomFadeNode));
    (material as MeshBasicWithEmissiveNode).emissiveNode = glowNode.mul(bloomFadeNode);
    return material;
  }

  const needsFeatureColorNode = modelMaterialInfo.usesReflectiveMask;
  if (ambientBinding || directionalLightBinding || needsFeatureColorNode) {
    material.colorNode = createTieColorNode(
      material,
      ambientBinding,
      directionalLightBinding,
      reflectionTexture,
      hasSecondUvReflection,
      modelMaterialInfo,
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
  hasSecondUvReflection: boolean,
  modelMaterialInfo: ModelMaterialInfo,
  displayOptions: ModelDisplayNodeOptions
): Node<'vec3'> {
  const baseDisplayColorNode = createTieBaseDisplayColorNode(material);
  const baseColorNode = decodeModelDisplayTextureNode(baseDisplayColorNode);
  const directionalLightNode = directionalLightBinding && !ambientBinding?.hasBakedDirectionalLight
    ? createTieDirectionalLightNode(directionalLightBinding)
    : null;
  let lightTermNode = directionalLightNode;
  if (ambientBinding) {
    const ambientTermNode = createTieAmbientRawColorNode(ambientBinding).mul(float(tieAmbientRawIntensityScale));
    lightTermNode = directionalLightNode ? ambientTermNode.add(directionalLightNode) : ambientTermNode;
  }
  const litColorNode = lightTermNode
    ? applyModelDisplayTextureModulateNode(baseDisplayColorNode, lightTermNode)
    : baseColorNode;

  const featureColorNode = applyModelMaterialFeatureColorNode(
    material,
    modelMaterialInfo,
    baseColorNode,
    litColorNode,
    createTieMaterialFeatureOptions(
      skyboxReflectionTexture,
      hasSecondUvReflection));
  return applyTieFogNode(featureColorNode.clamp(0, 1), displayOptions);
}

function createTieBaseDisplayColorNode(material: THREE.MeshBasicNodeMaterial): Node<'vec3'> {
  const materialColorNode = uniform(new THREE.Vector3(material.color.r, material.color.g, material.color.b));
  const displayMaterialColorNode = sRGBTransferOETF(materialColorNode) as Node<'vec3'>;
  if (!material.map) {
    return displayMaterialColorNode;
  }

  return texture(material.map, uv()).rgb.mul(displayMaterialColorNode);
}

function createTieGlowNode(
  material: THREE.MeshBasicNodeMaterial,
  modelMaterialInfo: ModelMaterialInfo,
  glowColorBinding: TieGlowColorBinding | null
): Node<'vec3'> {
  const baseDisplayColor = createTieBaseDisplayColorNode(material);
  const exportedTint = uniform(new THREE.Vector3(
    modelMaterialInfo.glowTint.r,
    modelMaterialInfo.glowTint.g,
    modelMaterialInfo.glowTint.b
  ));
  const glowStrength = uniform(modelMaterialInfo.glowEmissionStrength);
  if (!glowColorBinding) {
    return applyModelDisplayTextureModulateNode(baseDisplayColor, exportedTint).mul(glowStrength);
  }

  const row = attribute<'float'>(tieGlowColorRowAttributeName, 'float');
  const runtimeTint = vertexStage(texture(
    glowColorBinding.texture,
    vec2(float(0.5), row.add(float(0.5)).div(uniform(Math.max(1, glowColorBinding.instanceCount))).clamp(0, 1))
  ));
  return applyModelDisplayTextureModulateNode(
    baseDisplayColor,
    mix(exportedTint, runtimeTint.rgb.mul(float(255 / 128)), runtimeTint.a)
  ).mul(mix(glowStrength, float(1), runtimeTint.a));
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

function createTieMaterialFeatureOptions(
  skyboxReflectionTexture: THREE.Texture | null,
  hasSecondUvReflection: boolean
): ModelMaterialFeatureOptions {
  return {
    shine: {
      skyboxTexture: skyboxReflectionTexture,
      useSecondUvReflection: hasSecondUvReflection
    }
  };
}
