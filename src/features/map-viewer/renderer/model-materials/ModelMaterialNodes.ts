import * as THREE from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  cameraViewMatrix,
  cameraWorldMatrix,
  clamp,
  dot,
  float,
  max,
  modelWorldMatrix,
  normalView,
  mix,
  normalWorld,
  normalize,
  positionWorld,
  reflect,
  sRGBTransferEOTF,
  sRGBTransferOETF,
  screenUV,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

export type ModelMaterialFamily =
  | 'tie'
  | 'shrub'
  | 'moby';

export interface ModelMaterialInfo {
  family: ModelMaterialFamily;
  alphaUsage: string | null;
  alphaMode: string | null;
  usesOpacityAlpha: boolean;
  usesReflectiveMask: boolean;
  usesAlphaBlend: boolean;
  usesAlphaMask: boolean;
  fullOpacityAlpha: number;
  passFlags: number;
  passEnvironmentModeBits: number;
  secondPassMode: string | null;
  usesGlowEmission: boolean;
  glowEmissionStrength: number;
  glowTint: THREE.Color;
  reflectiveEnvironmentSource: string | null;
  reflectiveBleedColor: THREE.Color;
}

export interface ModelMaterialFeatureOptions {
  shine?: ModelShineOptions;
}

export interface ModelShineOptions {
  skyboxTexture?: THREE.Texture | null;
  shineScaleNode?: Node<'float'> | null;
  skyboxReflectionScaleNode?: Node<'float'> | null;
  materialDebugModeNode?: Node<'float'> | null;
  useSecondUvReflection?: boolean;
}

const modelFullOpacityAlphaByte = 128;
const modelDefaultAlphaCutoff = 0.06;
const modelReflectiveBleedColor = new THREE.Color(1, 1, 1);
const tieTextureMatrixPassMask = 0x01;
const tieEnvironmentPassMask = 0x06;
export const tieReflectionOriginAttributeName = 'tieReflectionOrigin';

export function resolveModelMaterialInfo(source: THREE.Material, family: ModelMaterialFamily): ModelMaterialInfo {
  const cached = source.userData.mapOmaticModelMaterialInfo as ModelMaterialInfo | undefined;
  if (cached?.family === family) {
    return cached;
  }

  const alphaUsage = resolveAlphaUsage(source, family);
  const alphaMode = alphaUsage === 'Opaque'
    ? null
    : resolveAlphaMode(source, family);
  const usesReflectiveMask = alphaUsage === 'ReflectiveMask';
  const usesOpacityAlpha = !usesReflectiveMask
    && alphaUsage !== 'Opaque'
    && (alphaUsage === 'Opacity' || alphaMode === 'Blend' || alphaMode === 'Mask');
  const legacyMultipassType = family === 'tie'
    ? readNumberExtra(source, ['TieMultipassType', 'DlTieMultipassType'], 0)
    : 0;
  const passFlags = family === 'tie'
    ? readNumberExtra(source, ['TiePassFlags', 'DlTiePassFlags', 'TieMultipassType', 'DlTieMultipassType'], legacyMultipassType)
    : 0;
  const passEnvironmentModeBits = family === 'tie'
    ? readNumberExtra(
      source,
      ['TieEnvironmentPassBits', 'DlTieEnvironmentPassBits'],
      passFlags & tieEnvironmentPassMask)
    : 0;
  const secondPassMode = family === 'tie'
    ? readStringExtra(source, ['TieSecondPassMode', 'DlTieSecondPassMode'])
      ?? inferTieSecondPassMode(passFlags, passEnvironmentModeBits)
    : null;
  const materialEmissiveTint = family === 'tie'
    ? readMaterialEmissiveTint(source)
    : null;
  const materialEmissiveStrength = family === 'tie'
    ? readMaterialEmissiveStrength(source)
    : null;
  const ps2GlowTint = family === 'tie'
    ? readPs2GlowTint(readStringExtra(source, ['TieGlowRgba', 'DlTieGlowRgba']))
    : null;
  const usesGlowEmission = family === 'tie'
    ? readBooleanExtra(source, ['TieUsesGlowEmission', 'DlTieUsesGlowEmission']) === true || materialEmissiveTint !== null
    : false;
  const glowEmissionStrength = family === 'tie'
    ? readNumberExtra(source, ['TieGlowEmissionStrength', 'DlTieGlowEmissionStrength'], materialEmissiveStrength ?? 1.5)
    : 0;
  const glowTint = family === 'tie'
    ? ps2GlowTint ?? materialEmissiveTint ?? new THREE.Color(1, 1, 1)
    : new THREE.Color(1, 1, 1);
  const normalizedAlphaMode = normalizeAlphaMode(alphaMode);
  return {
    family,
    alphaUsage,
    alphaMode: normalizedAlphaMode,
    usesOpacityAlpha,
    usesReflectiveMask,
    usesAlphaBlend: usesOpacityAlpha && normalizedAlphaMode === 'Blend',
    usesAlphaMask: usesOpacityAlpha && normalizedAlphaMode === 'Mask',
    fullOpacityAlpha: readFullOpacityAlpha(source, family),
    passFlags,
    passEnvironmentModeBits,
    secondPassMode,
    usesGlowEmission,
    glowEmissionStrength,
    glowTint,
    reflectiveEnvironmentSource: family === 'tie'
      ? readStringExtra(source, ['TieReflectiveEnvironmentSource', 'DlTieReflectiveEnvironmentSource'])
      : null,
    reflectiveBleedColor: readColorExtra(
      source,
      ['TieReflectiveBleedColorFactor', 'DlTieReflectiveBleedColorFactor'],
      modelReflectiveBleedColor)
  };
}

export function configureModelMaterialTransparency(
  material: THREE.Material,
  info: ModelMaterialInfo,
  options: { alphaCutoff?: number; alphaBlendDepthWrite?: boolean } = {}
): void {
  const alphaCutoff = options.alphaCutoff ?? modelDefaultAlphaCutoff;
  material.opacity = 1;
  material.side = THREE.DoubleSide;
  material.alphaHash = false;
  material.alphaToCoverage = false;

  if (info.usesReflectiveMask || info.alphaUsage === 'Opaque') {
    material.transparent = false;
    material.depthWrite = true;
    material.alphaTest = 0;
  } else if (info.usesAlphaBlend) {
    const alphaBlendDepthWrite = options.alphaBlendDepthWrite ?? false;
    material.transparent = true;
    material.depthWrite = alphaBlendDepthWrite;
    material.alphaTest = alphaBlendDepthWrite ? alphaCutoff : 0;
  } else if (info.usesAlphaMask) {
    material.transparent = false;
    material.depthWrite = true;
    material.alphaTest = alphaCutoff;
  }

  material.forceSinglePass = false;
}

export function modelMaterialUsesAlphaBlend(material: THREE.Material | THREE.Material[]): boolean {
  if (Array.isArray(material)) {
    return material.some(modelMaterialUsesAlphaBlend);
  }

  return material.transparent && material.alphaTest <= 0;
}

export function createModelOpacityNode(
  material: THREE.MeshBasicNodeMaterial,
  info: ModelMaterialInfo
): Node<'float'> | null {
  if (!info.usesOpacityAlpha || !material.map) {
    return null;
  }

  return texture(material.map, uv()).a
    .div(uniform(info.fullOpacityAlpha))
    .clamp(0, 1);
}

export function applyModelMaterialFeatureColorNode(
  material: THREE.MeshBasicNodeMaterial,
  info: ModelMaterialInfo,
  baseColorNode: Node<'vec3'>,
  litColorNode: Node<'vec3'>,
  options: ModelMaterialFeatureOptions = {}
): Node<'vec3'> {
  let colorNode = litColorNode;

  if (info.usesGlowEmission) {
    colorNode = createModelGlowNode(info, baseColorNode);
  }

  if (info.usesReflectiveMask) {
    return createModelReflectionSecondPassNode(material, info, baseColorNode, colorNode, options.shine);
  }

  return applyModelMaterialDebugMode(
    colorNode,
    baseColorNode,
    litColorNode,
    vec3(0, 0, 0),
    vec3(0, 0, 0),
    options.shine?.materialDebugModeNode ?? null
  );
}

function createModelGlowNode(
  info: ModelMaterialInfo,
  baseColorNode: Node<'vec3'>
): Node<'vec3'> {
  return baseColorNode
    .mul(uniform(new THREE.Vector3(info.glowTint.r, info.glowTint.g, info.glowTint.b)));
}

function createModelReflectionSecondPassNode(
  material: THREE.MeshBasicNodeMaterial,
  info: ModelMaterialInfo,
  baseColorNode: Node<'vec3'>,
  litColorNode: Node<'vec3'>,
  options: ModelShineOptions = {}
): Node<'vec3'> {
  const mask = createReflectiveMaskNode(material);
  const viewDirection = normalize(cameraPosition.sub(positionWorld));
  const normal = normalize(normalWorld);
  const reflectionScale = options.skyboxReflectionScaleNode ?? float(options.skyboxTexture ? 1 : 0);
  const shineScale = options.shineScaleNode ?? float(1);
  const bleedTint = uniform(new THREE.Vector3(
    info.reflectiveBleedColor.r,
    info.reflectiveBleedColor.g,
    info.reflectiveBleedColor.b
  ));
  const skyboxReflection = options.skyboxTexture
    ? createReflectiveSkyboxReflectionNode(options.skyboxTexture, info, viewDirection, normal, options)
    : vec3(0, 0, 0);
  // The env shader's GS ALPHA value is 0x0000008000000058:
  // source * destination-alpha + destination. The first-pass texture alpha is
  // therefore the reflection mask, and the uploaded bleed RGB tints the source.
  const reflectionColor = (sRGBTransferOETF(skyboxReflection) as Node<'vec3'>)
    .mul(bleedTint)
    .clamp(0, 1)
    .mul(mask)
    .mul(reflectionScale)
    .mul(shineScale)
    .toVar('modelTieEnvPassColor');
  // The GS blends the encoded framebuffer bytes. Re-encode around the additive
  // pass so partial masks do not get the much brighter linear-light result.
  const finalColor = sRGBTransferEOTF(
    (sRGBTransferOETF(litColorNode.clamp(0, 1)) as Node<'vec3'>)
      .add(reflectionColor)
      .clamp(0, 1)
  ) as Node<'vec3'>;

  return applyModelMaterialDebugMode(
    finalColor,
    baseColorNode,
    litColorNode,
    sRGBTransferEOTF(reflectionColor.clamp(0, 1)) as Node<'vec3'>,
    vec3(mask, mask, mask),
    options.materialDebugModeNode ?? null
  );
}

function applyModelMaterialDebugMode(
  normalColor: Node<'vec3'>,
  baseColor: Node<'vec3'>,
  litColor: Node<'vec3'>,
  reflectionColor: Node<'vec3'>,
  maskColor: Node<'vec3'>,
  debugModeNode: Node<'float'> | null
): Node<'vec3'> {
  if (!debugModeNode) {
    return normalColor;
  }

  const baseWeight = smoothstep(float(0.5), float(0.51), debugModeNode)
    .mul(float(1).sub(smoothstep(float(1.5), float(1.51), debugModeNode)));
  const litWeight = smoothstep(float(1.5), float(1.51), debugModeNode)
    .mul(float(1).sub(smoothstep(float(2.5), float(2.51), debugModeNode)));
  const reflectionWeight = smoothstep(float(2.5), float(2.51), debugModeNode)
    .mul(float(1).sub(smoothstep(float(3.5), float(3.51), debugModeNode)));
  const maskWeight = smoothstep(float(3.5), float(3.51), debugModeNode);
  const normalWeight = float(1).sub(
    clamp(baseWeight.add(litWeight).add(reflectionWeight).add(maskWeight), float(0), float(1))
  );

  return normalColor.mul(normalWeight)
    .add(baseColor.mul(baseWeight))
    .add(litColor.mul(litWeight))
    .add(reflectionColor.mul(reflectionWeight))
    .add(maskColor.mul(maskWeight));
}

function createSkyboxReflectionNode(
  textureSource: THREE.Texture,
  viewDirection: Node<'vec3'>,
  normal: Node<'vec3'>
): Node<'vec3'> {
  const reflected = normalize(reflect(viewDirection.negate(), normal));
  const reflectedUv = clamp(
    vec2(
      reflected.x.mul(float(0.42)).add(float(0.5)),
      reflected.y.mul(float(-0.42)).add(float(0.5))
    ),
    vec2(0, 0),
    vec2(1, 1)
  );
  return createSkyboxUvReflectionNode(textureSource, reflectedUv);
}

function createReflectiveSkyboxReflectionNode(
  textureSource: THREE.Texture,
  info: ModelMaterialInfo,
  viewDirection: Node<'vec3'>,
  normal: Node<'vec3'>,
  options: ModelShineOptions
): Node<'vec3'> {
  if (usesGeneratedEnvPassReflection(info)) {
    return createSkyboxGeneratedEnvPassReflectionNode(textureSource);
  }

  return options.useSecondUvReflection === true
    ? createSkyboxSecondUvReflectionNode(textureSource, uv(1), viewDirection, normal)
    : createSkyboxReflectionNode(textureSource, viewDirection, normal);
}

function createSkyboxGeneratedEnvPassReflectionNode(
  textureSource: THREE.Texture
): Node<'vec3'> {
  // FUN_00592e10 stores the normalized camera-to-instance-origin vector at
  // +0x90; VU0 entry 0x2a reflects it and maps XY as reflection * 0.3 + 0.5.
  const instanceOriginWorld = modelWorldMatrix
    .mul(vec4(attribute<'vec3'>(tieReflectionOriginAttributeName, 'vec3'), 1))
    .xyz;
  const incidentView = normalize(
    cameraViewMatrix
      .mul(vec4(instanceOriginWorld.sub(cameraPosition), 0))
      .xyz
  );
  const reflectedView = reflect(incidentView, normalize(normalView));
  const generatedUv = reflectedView.xy
    .mul(float(0.3))
    .add(vec2(0.5, 0.5))
    .toVarying('modelGeneratedEnvPassUv');
  return texture(textureSource, generatedUv).rgb;
}

function createSkyboxSecondUvReflectionNode(
  textureSource: THREE.Texture,
  baseUv: Node<'vec2'>,
  viewDirection: Node<'vec3'>,
  normal: Node<'vec3'>
): Node<'vec3'> {
  const viewNormal = normalize(normalView);
  const cameraForwardY = vec3(0, 0, -1).transformDirection(cameraWorldMatrix).y;
  const transformedUv = screenUV
    .sub(vec2(0.5, 0.5))
    .mul(vec2(0.72, 0.62))
    .add(vec2(0.5, 0.48))
    .add(vec2(
      viewNormal.x.mul(float(-0.28)),
      viewNormal.y.mul(float(-0.16)).add(cameraForwardY.mul(float(0.9)))
    ));
  const sourceUvMask = baseUv
    .sub(vec2(0.5, 0.5))
    .mul(vec2(0.04, 0.02));
  const uGate = smoothstep(float(-0.08), float(0.04), transformedUv.x)
    .mul(float(1).sub(smoothstep(float(0.96), float(1.08), transformedUv.x)));
  const vGate = smoothstep(float(-0.12), float(0.02), transformedUv.y)
    .mul(float(1).sub(smoothstep(float(0.98), float(1.14), transformedUv.y)));
  const faceGate = smoothstep(
    float(0.08),
    float(0.28),
    max(dot(normal, viewDirection), float(0))
  );
  const uvMaskGate = float(1)
    .sub(sourceUvMask.x.mul(sourceUvMask.x).add(sourceUvMask.y.mul(sourceUvMask.y)).clamp(0, 0.18));
  return createSkyboxUvReflectionNode(textureSource, transformedUv, uGate.mul(vGate).mul(faceGate).mul(uvMaskGate));
}

function createSkyboxUvReflectionNode(
  textureSource: THREE.Texture,
  reflectionUv: Node<'vec2'>,
  opacityGate: Node<'float'> | null = null
): Node<'vec3'> {
  const shellSample = texture(textureSource, reflectionUv);
  const shellAlpha = shellSample.a
    .div(float(modelFullOpacityAlphaByte / 255))
    .mul(opacityGate ?? float(1))
    .clamp(0, 1);
  return mix(
    vec3(0.025, 0.045, 0.075),
    shellSample.rgb,
    shellAlpha.mul(float(0.9))
  );
}

function createReflectiveMaskNode(material: THREE.MeshBasicNodeMaterial): Node<'float'> {
  if (!material.map) {
    return float(1);
  }

  return texture(material.map, uv()).a
    .div(float(modelFullOpacityAlphaByte / 255))
    .clamp(0, 1);
}

function inferTieSecondPassMode(passFlags: number, environmentPassBits: number): string {
  const envBits = environmentPassBits || (passFlags & tieEnvironmentPassMask);
  if (envBits !== 0) {
    return envBits === 0x02
      ? 'GeneratedEnvPass'
      : envBits === 0x04
        ? 'GeneratedEnvPassAlt'
        : 'GeneratedEnvPassMixed';
  }

  return (passFlags & tieTextureMatrixPassMask) !== 0 ? 'TextureMatrix' : 'None';
}

function usesGeneratedEnvPassReflection(info: ModelMaterialInfo): boolean {
  return info.family === 'tie'
    && (info.passEnvironmentModeBits !== 0
      || (info.passFlags & tieEnvironmentPassMask) !== 0
      || info.secondPassMode === 'GeneratedEnvPass'
      || info.secondPassMode === 'GeneratedEnvPassAlt'
      || info.secondPassMode === 'GeneratedEnvPassMixed');
}

function readFullOpacityAlpha(source: THREE.Material, family: ModelMaterialFamily): number {
  const value = readNumberExtra(source, alphaExtraNames(family, 'TextureFullOpacityAlpha'), modelFullOpacityAlphaByte);
  const normalized = value > 1 ? value / 255 : value;
  return THREE.MathUtils.clamp(normalized, 1 / 255, 1);
}

function readPs2GlowTint(value: string | null): THREE.Color | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^#?([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!match) {
    return null;
  }

  const rgb = Number.parseInt(match[1], 16);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  const max = Math.max(r, g, b);
  return new THREE.Color(
    r === max ? 1 : r / 255,
    g === max ? 1 : g / 255,
    b === max ? 1 : b / 255
  );
}

function readMaterialEmissiveTint(source: THREE.Material): THREE.Color | null {
  const emissive = (source as Partial<THREE.MeshStandardMaterial>).emissive;
  if (!(emissive instanceof THREE.Color) || (emissive.r <= 0 && emissive.g <= 0 && emissive.b <= 0)) {
    return null;
  }

  return emissive.clone();
}

function readMaterialEmissiveStrength(source: THREE.Material): number | null {
  const strength = (source as Partial<THREE.MeshStandardMaterial>).emissiveIntensity;
  return typeof strength === 'number' && Number.isFinite(strength) ? strength : null;
}

function alphaExtraNames(family: ModelMaterialFamily, suffix: string): string[] {
  const prefix = family === 'tie' ? 'Tie' : family === 'shrub' ? 'Shrub' : 'Moby';
  const legacyPrefix = family === 'tie' ? 'DlTie' : family === 'shrub' ? 'DlShrub' : 'DlMoby';
  return [`${prefix}${suffix}`, `${legacyPrefix}${suffix}`];
}

function resolveAlphaUsage(source: THREE.Material, family: ModelMaterialFamily): string | null {
  const alphaUsage = readStringExtra(source, alphaExtraNames(family, 'TextureAlphaUsage'));
  if (alphaUsage || family !== 'moby') {
    return alphaUsage;
  }

  const minAlpha = readOptionalNumberExtra(source, ['MobyTextureMinAlpha', 'MinAlpha']);
  if (minAlpha !== null) {
    return minAlpha >= modelFullOpacityAlphaByte ? 'Opaque' : 'Opacity';
  }

  const hasAlpha = readBooleanExtra(source, ['MobyTextureHasAlpha', 'HasAlpha']);
  return hasAlpha === null ? null : hasAlpha ? 'Opacity' : 'Opaque';
}

function resolveAlphaMode(source: THREE.Material, family: ModelMaterialFamily): string | null {
  return readStringExtra(source, alphaExtraNames(family, 'TextureAlphaMode'))
    ?? readStringExtra(source, alphaExtraNames(family, 'TextureGltfAlphaMode'))
    ?? (family === 'moby'
      ? readStringExtra(source, ['MobyTextureGltfAlphaMode', 'GltfAlphaMode'])
        ?? readStringExtra(source, ['MobyTextureAlphaMode', 'AlphaMode'])
      : null)
    ?? normalizeSourceAlphaMode(source.alphaTest, source.transparent);
}

function normalizeSourceAlphaMode(alphaTest: number, transparent: boolean): string | null {
  if (transparent) {
    return 'Blend';
  }

  return alphaTest > 0 ? 'Mask' : null;
}

function normalizeAlphaMode(value: string | null): string | null {
  if (value === 'BLEND') {
    return 'Blend';
  }

  if (value === 'MASK') {
    return 'Mask';
  }

  return value;
}

function readStringExtra(source: THREE.Material, names: string[]): string | null {
  const value = readExtra(source, names);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readBooleanExtra(source: THREE.Material, names: string[]): boolean | null {
  const value = readExtra(source, names);
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') {
      return true;
    }

    if (value.toLowerCase() === 'false') {
      return false;
    }
  }

  return null;
}

function readNumberExtra(source: THREE.Material, names: string[], fallback: number): number {
  const value = readExtra(source, names);
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readOptionalNumberExtra(source: THREE.Material, names: string[]): number | null {
  const value = readExtra(source, names);
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readColorExtra(source: THREE.Material, names: string[], fallback: THREE.Color): THREE.Color {
  const value = readExtra(source, names);
  if (Array.isArray(value) && value.length >= 3) {
    const r = Number(value[0]);
    const g = Number(value[1]);
    const b = Number(value[2]);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return new THREE.Color(r, g, b);
    }
  }

  return fallback.clone();
}

function readExtra(source: THREE.Material, names: string[]): unknown {
  for (const name of names) {
    if (source.userData?.[name] !== undefined) {
      return source.userData[name];
    }
  }

  return undefined;
}
