import * as THREE from 'three/webgpu';
import { attribute, diffuseColor, float, pow, sRGBTransferOETF, texture, uv, vec3, vec4 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import type { SkyboxRenderOptions } from '../../../../services/mapPackages/mapPackageTypes';
import {
  hasGeometryColorAttribute,
  numberExtra,
  numberValue,
  skyboxPrimitiveData
} from './skyboxMetadata.ts';

interface SkyboxReflectionCandidate {
  texture: THREE.Texture;
  shellIndex: number;
  drawOrder: number;
  traversalIndex: number;
}

const skyboxFullOpacityAlphaByte = 127;
const skyboxFullOpacityAlpha = skyboxFullOpacityAlphaByte / 255;
const additiveOverlayMinAlphaFalloff = 2;
const additiveOverlayMaxAlphaByte = 0x60;
const skyboxTextureByMaterial = new WeakMap<THREE.Material, THREE.Texture>();

export function cloneSkyboxMaterial(
  material: THREE.Material | THREE.Material[],
  object: THREE.Mesh
): THREE.Material | THREE.Material[] {
  return Array.isArray(material)
    ? material.map((item) => createSkyboxMaterial(item, object))
    : createSkyboxMaterial(material, object);
}

export function configureSkyboxMaterial(
  material: THREE.Material,
  object: THREE.Mesh,
  options: SkyboxRenderOptions
): void {
  material.side = THREE.DoubleSide;
  (material as Partial<THREE.MeshBasicMaterial>).wireframe = false;
  material.depthWrite = false;
  material.depthTest = false;
  material.toneMapped = false;
  material.transparent = true;
  material.alphaHash = false;
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  const bloomLayer = isSkyboxBloomLayer(material, object);
  material.blendSrc = bloomLayer ? THREE.OneFactor : THREE.SrcAlphaFactor;
  material.blendDst = bloomLayer
    ? THREE.ZeroFactor
    : shouldUseAdditiveSkyboxBlend(material, object, options)
      ? THREE.OneFactor
      : THREE.OneMinusSrcAlphaFactor;
  material.blendEquationAlpha = THREE.AddEquation;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = bloomLayer ? THREE.ZeroFactor : THREE.OneMinusSrcAlphaFactor;
  const opacityNode = `${skyboxGameForObject(object)}`.toUpperCase() === 'UYA'
    ? createSkyboxGsAlphaNode(material, object, skyboxTextureByMaterial.get(material) ?? null)
    : createSkyboxOpacityNode(material, object, options);
  (material as THREE.MeshBasicNodeMaterial).opacityNode = opacityNode;
  material.forceSinglePass = true;
  material.userData.mapOmaticSkyboxBlendMode = options.blendMode;
  material.userData.mapOmaticSkyboxAdditiveBlend = material.blendDst === THREE.OneFactor;
  material.userData.mapOmaticSkyboxAlphaFalloff = resolveSkyboxAlphaFalloff(options);
  material.needsUpdate = true;
}

export function selectSkyboxReflectionTexture(root: THREE.Object3D): THREE.Texture | null {
  let best: SkyboxReflectionCandidate | null = null;
  let traversalIndex = 0;

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    const data = skyboxPrimitiveData(mesh);
    const shellIndex = numberValue(data.SkyboxShellIndex);
    const drawOrder = numberValue(data.SkyboxDrawOrder ?? data.SkyboxSourceDrawOrder);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const texture = skyboxTextureByMaterial.get(material);
      if (!texture) {
        continue;
      }

      const candidate: SkyboxReflectionCandidate = {
        texture,
        shellIndex: shellIndex ?? Number.NEGATIVE_INFINITY,
        drawOrder: drawOrder ?? Number.NEGATIVE_INFINITY,
        traversalIndex
      };
      if (!best || compareSkyboxReflectionCandidate(candidate, best) > 0) {
        best = candidate;
      }
    }

    traversalIndex += 1;
  });

  const selected = best as SkyboxReflectionCandidate | null;
  return selected ? createSkyboxReflectionTexture(selected.texture) : null;
}

export function getSkyboxDrawOrder(object: THREE.Mesh): number {
  const data = skyboxPrimitiveData(object);
  return numberExtra(data.SkyboxDrawOrder ?? data.SkyboxSourceDrawOrder, 0);
}

export function isSkyboxAdditiveMaterial(material: THREE.Material): boolean {
  return material.userData?.mapOmaticSkyboxAdditiveBlend === true;
}

export function isSkyboxReflectionTextureClone(textureSource: THREE.Texture): boolean {
  return textureSource.userData?.mapOmaticReflectionTextureClone === true;
}

export function isSkyboxBloomLayer(material: THREE.Material, object: THREE.Mesh): boolean {
  return getSkyboxDrawBlendMode(object, material) === 'Bloom';
}

function createSkyboxMaterial(source: THREE.Material, object: THREE.Mesh): THREE.Material {
  const sourceMaterial = source as Partial<THREE.MeshBasicMaterial>;
  const sourceMap = sourceMaterial.map ?? null;
  const bloomLayer = isSkyboxBloomLayer(source, object);
  const hasVertexColors = hasGeometryColorAttribute(object)
    || sourceMaterial.vertexColors === true
    || Boolean(source.userData?.SkyboxUsesVertexColor0);
  const material = new THREE.MeshBasicNodeMaterial({
    name: `${source.name || 'skybox'}_map_omatic`,
    color: bloomLayer
      ? new THREE.Color(1, 1, 1)
      : sourceMaterial.color?.clone?.() ?? new THREE.Color(1, 1, 1),
    map: null,
    alphaMap: null,
    vertexColors: false,
    transparent: true,
    opacity: 1,
    alphaTest: getSkyboxTextureAlphaMode(source) === 'Mask' ? 0.06 : 0,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });

  material.userData = {
    ...source.userData,
    mapOmaticSkyboxMaterial: true,
    mapOmaticSourceMaterialType: source.type
  };

  if (sourceMap) {
    configureSkyboxTexture(sourceMap);
    skyboxTextureByMaterial.set(material, sourceMap);
  }

  const colorNode = createSkyboxColorNode(material, sourceMap, hasVertexColors);
  material.colorNode = colorNode;
  const uyaSkybox = `${skyboxGameForObject(object)}`.toUpperCase() === 'UYA';
  const auxiliaryNode = !uyaSkybox && bloomLayer
      ? colorNode.mul(sourceMap ? texture(sourceMap, uv()).a : float(1))
      : vec3(0);
  Object.assign(material, { emissiveNode: auxiliaryNode });
  if (bloomLayer) {
    material.outputNode = vec4(colorNode, diffuseColor.a);
  }

  return material;
}

function createSkyboxGsAlphaNode(
  material: THREE.Material,
  object: THREE.Mesh,
  map: THREE.Texture | null
): Node<'float'> {
  let alphaNode: Node<'float'> | null = map && skyboxUsesTextureOpacity(material)
    ? texture(map, uv()).a.div(float(skyboxFullOpacityAlpha))
    : null;

  if (skyboxUsesVertexOpacity(material, object)) {
    const vertexAlpha = attribute<'vec4'>('color', 'vec4').a;
    alphaNode = alphaNode ? alphaNode.mul(vertexAlpha) : vertexAlpha;
  }

  const baseColorAlpha = skyboxBaseColorOpacity(material);
  if (baseColorAlpha < 1) {
    alphaNode = alphaNode ? alphaNode.mul(baseColorAlpha) : float(baseColorAlpha);
  }

  return alphaNode ?? float(1);
}

function skyboxGameForObject(object: THREE.Object3D): unknown {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (current.userData?.Game) {
      return current.userData.Game;
    }
  }

  return null;
}

function configureSkyboxTexture(textureSource: THREE.Texture): void {
  // The GS blends encoded framebuffer values; decode the finished sky pass instead.
  textureSource.colorSpace = THREE.NoColorSpace;
  textureSource.magFilter = THREE.LinearFilter;
  textureSource.minFilter = THREE.LinearFilter;
  textureSource.generateMipmaps = false;
  textureSource.anisotropy = 1;
  textureSource.needsUpdate = true;
}

function createSkyboxReflectionTexture(source: THREE.Texture): THREE.Texture {
  const textureClone = source.clone();
  textureClone.colorSpace = THREE.SRGBColorSpace;
  textureClone.wrapS = THREE.ClampToEdgeWrapping;
  textureClone.wrapT = THREE.ClampToEdgeWrapping;
  textureClone.needsUpdate = true;
  textureClone.userData = {
    ...source.userData,
    mapOmaticSkyboxReflectionTexture: true,
    mapOmaticReflectionTextureClone: true
  };
  return textureClone;
}

function compareSkyboxReflectionCandidate(left: SkyboxReflectionCandidate, right: SkyboxReflectionCandidate): number {
  return (left.shellIndex - right.shellIndex)
    || (left.drawOrder - right.drawOrder)
    || (left.traversalIndex - right.traversalIndex);
}

function getSkyboxTextureAlphaMode(material: THREE.Material): string {
  return `${material.userData?.SkyboxMaterialAlphaMode || material.userData?.SkyboxTextureAlphaMode || ''}`;
}

function getSkyboxDrawBlendMode(object: THREE.Mesh, material: THREE.Material): string {
  const data = skyboxPrimitiveData(object);
  const blendMode = `${data.SkyboxDrawBlendMode || material.userData?.SkyboxDrawBlendMode || ''}`;
  if (blendMode) {
    return blendMode;
  }

  const flags = numberExtra(data.SkyboxShellFlags ?? material.userData?.SkyboxShellFlags, 0);
  return (flags & 0x2) !== 0 ? 'Bloom' : 'SourceOver';
}

function shouldUseAdditiveSkyboxBlend(
  material: THREE.Material,
  object: THREE.Mesh,
  options: SkyboxRenderOptions
): boolean {
  const drawBlendMode = getSkyboxDrawBlendMode(object, material);
  if (drawBlendMode === 'Bloom') {
    return false;
  }

  if (drawBlendMode !== 'SourceOver') {
    return false;
  }

  if (options.blendMode === 'metadata') {
    return false;
  }

  if (options.blendMode === 'auto-additive-overlays') {
    return skyboxUsesAdditiveOverlayBlend(material, object);
  }

  if (options.blendMode === 'additive-blend-layers') {
    return getSkyboxTextureAlphaMode(material) === 'Blend';
  }

  return false;
}

function skyboxUsesAdditiveOverlayBlend(material: THREE.Material, object: THREE.Mesh): boolean {
  const data = skyboxPrimitiveData(object);
  if (getSkyboxTextureAlphaMode(material) !== 'Blend') {
    return false;
  }

  const textureMaxAlpha = numberValue(material.userData?.SkyboxTextureMaxAlpha) ?? 255;
  const vertexAlphaMax = numberValue(material.userData?.SkyboxVertexAlphaMax) ?? 1;
  if (textureMaxAlpha > additiveOverlayMaxAlphaByte || vertexAlphaMax < 0.9) {
    return false;
  }

  return Boolean(data.SkyboxShellRotationPatchApplied)
    || Boolean(data.SkyboxShellHasRuntimeRotation);
}

function createSkyboxColorNode(
  material: THREE.MeshBasicNodeMaterial,
  map: THREE.Texture | null,
  hasVertexColors: boolean
): Node<'vec3'> {
  let colorNode = sRGBTransferOETF(
    vec3(material.color.r, material.color.g, material.color.b)
  ) as Node<'vec3'>;
  if (map) {
    colorNode = texture(map, uv()).rgb.mul(colorNode);
  }

  if (hasVertexColors) {
    colorNode = colorNode.mul(
      sRGBTransferOETF(attribute<'vec4'>('color', 'vec4').rgb) as Node<'vec3'>
    );
  }

  return colorNode;
}

function createSkyboxOpacityNode(
  material: THREE.Material,
  object: THREE.Mesh,
  options: SkyboxRenderOptions
): Node<'float'> | null {
  const map = skyboxTextureByMaterial.get(material) ?? null;
  const falloff = resolveSkyboxAlphaFalloff(options);
  const usesAdditiveBlend = shouldUseAdditiveSkyboxBlend(material, object, options);
  const effectiveFalloff = usesAdditiveBlend && falloff > 0
    ? Math.max(falloff, additiveOverlayMinAlphaFalloff)
    : falloff;
  let opacityNode: Node<'float'> | null = null;

  if (map && skyboxUsesTextureOpacity(material)) {
    opacityNode = texture(map, uv()).a
      .div(float(skyboxFullOpacityAlpha))
      .clamp(0, 1);
  }

  if (skyboxUsesVertexOpacity(material, object)) {
    const vertexAlpha = attribute<'vec4'>('color', 'vec4').a.clamp(0, 1);
    opacityNode = opacityNode ? opacityNode.mul(vertexAlpha) : vertexAlpha;
  }

  const baseColorAlpha = skyboxBaseColorOpacity(material);
  if (baseColorAlpha < 1) {
    const baseAlphaNode = float(baseColorAlpha);
    opacityNode = opacityNode ? opacityNode.mul(baseAlphaNode) : baseAlphaNode;
  }

  if (!opacityNode) {
    return null;
  }

  if (effectiveFalloff <= 0 || effectiveFalloff === 1) {
    return opacityNode;
  }

  const shapedOpacity = pow(opacityNode, float(effectiveFalloff));
  if (!usesAdditiveBlend) {
    return shapedOpacity;
  }

  const textureMaxAlpha = numberValue(material.userData?.SkyboxTextureMaxAlpha) ?? skyboxFullOpacityAlphaByte;
  const maxOpacity = Math.min(Math.max(textureMaxAlpha / skyboxFullOpacityAlphaByte, 1 / skyboxFullOpacityAlphaByte), 1);
  return shapedOpacity
    .div(float(Math.pow(maxOpacity, effectiveFalloff - 1)))
    .clamp(0, 1);
}

function skyboxUsesTextureOpacity(material: THREE.Material): boolean {
  const alphaMode = getSkyboxTextureAlphaMode(material);
  return alphaMode === 'Blend' || alphaMode === 'Mask';
}

function skyboxUsesVertexOpacity(material: THREE.Material, object: THREE.Mesh): boolean {
  return hasGeometryColorAttribute(object)
    && (Boolean(material.userData?.SkyboxUsesVertexColor0)
      || numberValue(material.userData?.SkyboxVertexAlphaMin) !== null
      || numberValue(material.userData?.SkyboxVertexAlphaMax) !== null);
}

function skyboxBaseColorOpacity(material: THREE.Material): number {
  const alphaByte = numberValue(material.userData?.SkyboxBaseColorAlpha);
  if (alphaByte === null || alphaByte >= 255) {
    return 1;
  }

  return Math.min(Math.max(alphaByte / skyboxFullOpacityAlphaByte, 0), 1);
}

function resolveSkyboxAlphaFalloff(options: SkyboxRenderOptions): number {
  return Math.max(0, Math.min(Number(options.alphaFalloff) || 0, 8));
}
