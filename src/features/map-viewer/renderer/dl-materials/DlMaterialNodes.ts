import * as THREE from 'three/webgpu';
import {
  cameraPosition,
  cameraWorldMatrix,
  clamp,
  distance,
  dot,
  float,
  max,
  normalView,
  mix,
  normalWorld,
  normalize,
  positionViewDirection,
  positionWorld,
  pow,
  reflect,
  screenUV,
  smoothstep,
  sqrt,
  texture,
  uv,
  vec2,
  vec3
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

export type DlMaterialFamily =
  | 'tie'
  | 'shrub';

export interface DlMaterialInfo {
  family: DlMaterialFamily;
  alphaUsage: string | null;
  alphaMode: string | null;
  hasTextureAlpha: boolean;
  usesOpacityAlpha: boolean;
  usesReflectiveMask: boolean;
  usesAlphaBlend: boolean;
  usesAlphaMask: boolean;
  fullOpacityAlpha: number;
  multipassOffset: number;
  passFlags: number;
  passEnvironmentModeBits: number;
  secondPassMode: string | null;
  multipassUvSize: number;
  usesGlowEmission: boolean;
  glowEmissionStrength: number;
  glowTint: THREE.Color;
  materialRole: string | null;
  textureRgbUsage: string | null;
  reflectiveMaskChannel: string | null;
  reflectiveTintSource: string | null;
  reflectiveEnvironmentSource: string | null;
  reflectiveEnvironmentTextureRole: string | null;
  reflectiveEnvironmentGltfTextureIndex: number | null;
  reflectiveEnvironmentShaderIndex: number | null;
  reflectiveEnvironmentTextureUri: string | null;
  reflectiveBlendMode: string | null;
  reflectivePreviewBaseColor: THREE.Color;
  reflectivePreviewTextureRgbScale: number;
  reflectiveMaskFocusPower: number;
  reflectiveEnvironmentStrength: number;
  reflectiveMaxBlend: number;
  reflectiveBleedColor: THREE.Color;
  reflectiveBleedAlpha: number;
  preserveTieMultipass: boolean;
}

export interface DlMaterialFeatureOptions {
  shine?: DlShineOptions;
}

export interface DlShineOptions {
  tintNode?: Node<'vec3'> | null;
  skyboxTexture?: THREE.Texture | null;
  shineScaleNode?: Node<'float'> | null;
  skyboxReflectionScaleNode?: Node<'float'> | null;
  materialDebugModeNode?: Node<'float'> | null;
  useSecondUvReflection?: boolean;
}

const dlFullOpacityAlphaByte = 128;
const dlDefaultAlphaCutoff = 0.06;
const dlReflectiveMaskFocusPower = 0.55;
const dlReflectiveEnvironmentStrength = 1.35;
const dlReflectiveMaxBlend = 0.58;
const dlReflectivePreviewBaseColor = new THREE.Color(0.035, 0.045, 0.06);
const dlReflectiveBleedColor = new THREE.Color(1, 1, 1);
const dlReflectivePreviewTextureRgbScale = 0.2;
const dlTieTextureMatrixPassMask = 0x01;
const dlTieEnvironmentPassMask = 0x06;

export function resolveDlMaterialInfo(source: THREE.Material, family: DlMaterialFamily): DlMaterialInfo {
  const alphaUsage = readStringExtra(source, alphaExtraNames(family, 'TextureAlphaUsage'));
  const alphaMode = readStringExtra(source, alphaExtraNames(family, 'TextureAlphaMode'))
    ?? readStringExtra(source, alphaExtraNames(family, 'TextureGltfAlphaMode'))
    ?? normalizeSourceAlphaMode(source.alphaTest, source.transparent);
  const inferredTextureAlpha = alphaUsage === 'Opacity'
    || alphaUsage === 'ReflectiveMask'
    || alphaMode === 'Blend'
    || alphaMode === 'Mask';
  const hasTextureAlpha = readBooleanExtra(source, alphaExtraNames(family, 'TextureHasAlpha'))
    ?? inferredTextureAlpha;
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
      passFlags & dlTieEnvironmentPassMask)
    : 0;
  const secondPassMode = family === 'tie'
    ? readStringExtra(source, ['TieSecondPassMode', 'DlTieSecondPassMode'])
      ?? inferTieSecondPassMode(passFlags, passEnvironmentModeBits)
    : null;
  const multipassOffset = family === 'tie'
    ? readNumberExtra(source, ['TieMultipassOffset', 'DlTieMultipassOffset'], 0)
    : 0;
  const multipassUvSize = family === 'tie'
    ? readNumberExtra(source, ['TieMultipassUvSize', 'DlTieMultipassUvSize'], 0)
    : 0;
  const usesGlowEmission = family === 'tie'
    ? readBooleanExtra(source, ['TieUsesGlowEmission', 'DlTieUsesGlowEmission']) === true
    : false;
  const glowEmissionStrength = family === 'tie'
    ? readNumberExtra(source, ['TieGlowEmissionStrength', 'DlTieGlowEmissionStrength'], 1.5)
    : 0;
  const glowTint = family === 'tie'
    ? readPs2GlowTint(readStringExtra(source, ['TieGlowRgba', 'DlTieGlowRgba']))
    : new THREE.Color(1, 1, 1);
  const normalizedAlphaMode = normalizeAlphaMode(alphaMode);
  const materialRole = family === 'tie'
    ? readStringExtra(source, ['TieMaterialRole', 'DlTieMaterialRole'])
    : null;
  const textureRgbUsage = family === 'tie'
    ? readStringExtra(source, ['TieTextureRgbUsage', 'DlTieTextureRgbUsage'])
    : null;
  const reflectivePreviewBaseColor = readColorExtra(
    source,
    ['TieReflectivePreviewBaseColorFactor', 'DlTieReflectivePreviewBaseColorFactor'],
    dlReflectivePreviewBaseColor);

  return {
    family,
    alphaUsage,
    alphaMode: normalizedAlphaMode,
    hasTextureAlpha,
    usesOpacityAlpha,
    usesReflectiveMask,
    usesAlphaBlend: usesOpacityAlpha && normalizedAlphaMode === 'Blend',
    usesAlphaMask: usesOpacityAlpha && normalizedAlphaMode === 'Mask',
    fullOpacityAlpha: readFullOpacityAlpha(source, family),
    multipassOffset,
    passFlags,
    passEnvironmentModeBits,
    secondPassMode,
    multipassUvSize,
    usesGlowEmission,
    glowEmissionStrength,
    glowTint,
    materialRole,
    textureRgbUsage,
    reflectiveMaskChannel: family === 'tie'
      ? readStringExtra(source, ['TieReflectiveMaskChannel', 'DlTieReflectiveMaskChannel'])
      : null,
    reflectiveTintSource: family === 'tie'
      ? readStringExtra(source, ['TieReflectiveTintSource', 'DlTieReflectiveTintSource'])
      : null,
    reflectiveEnvironmentSource: family === 'tie'
      ? readStringExtra(source, ['TieReflectiveEnvironmentSource', 'DlTieReflectiveEnvironmentSource'])
      : null,
    reflectiveEnvironmentTextureRole: family === 'tie'
      ? readStringExtra(source, ['TieReflectiveEnvironmentTextureRole', 'DlTieReflectiveEnvironmentTextureRole'])
      : null,
    reflectiveEnvironmentGltfTextureIndex: family === 'tie'
      ? readOptionalNumberExtra(source, ['TieReflectiveEnvironmentGltfTextureIndex', 'DlTieReflectiveEnvironmentGltfTextureIndex'])
      : null,
    reflectiveEnvironmentShaderIndex: family === 'tie'
      ? readOptionalNumberExtra(source, ['TieReflectiveEnvironmentShaderIndex', 'DlTieReflectiveEnvironmentShaderIndex'])
      : null,
    reflectiveEnvironmentTextureUri: family === 'tie'
      ? readStringExtra(source, ['TieReflectiveEnvironmentTextureUri', 'DlTieReflectiveEnvironmentTextureUri'])
      : null,
    reflectiveBlendMode: family === 'tie'
      ? readStringExtra(source, ['TieReflectiveBlendMode', 'DlTieReflectiveBlendMode'])
      : null,
    reflectivePreviewBaseColor,
    reflectivePreviewTextureRgbScale: readNumberExtra(
      source,
      ['TieReflectivePreviewTextureRgbScale', 'DlTieReflectivePreviewTextureRgbScale'],
      dlReflectivePreviewTextureRgbScale),
    reflectiveMaskFocusPower: readNumberExtra(
      source,
      ['TieReflectiveMaskFocusPower', 'DlTieReflectiveMaskFocusPower'],
      dlReflectiveMaskFocusPower),
    reflectiveEnvironmentStrength: readNumberExtra(
      source,
      ['TieReflectiveEnvironmentStrength', 'DlTieReflectiveEnvironmentStrength'],
      dlReflectiveEnvironmentStrength),
    reflectiveMaxBlend: readNumberExtra(
      source,
      ['TieReflectiveMaxBlend', 'DlTieReflectiveMaxBlend'],
      dlReflectiveMaxBlend),
    reflectiveBleedColor: readColorExtra(
      source,
      ['TieReflectiveBleedColorFactor', 'DlTieReflectiveBleedColorFactor'],
      dlReflectiveBleedColor),
    reflectiveBleedAlpha: readNumberExtra(
      source,
      ['TieReflectiveBleedAlpha', 'DlTieReflectiveBleedAlpha'],
      1),
    preserveTieMultipass: family === 'tie' && (usesReflectiveMask || passFlags !== 0 || usesGlowEmission)
  };
}

export function configureDlMaterialTransparency(
  material: THREE.Material,
  info: DlMaterialInfo,
  options: { alphaCutoff?: number } = {}
): void {
  const alphaCutoff = options.alphaCutoff ?? dlDefaultAlphaCutoff;
  material.opacity = 1;
  material.side = THREE.DoubleSide;
  material.alphaHash = false;
  material.alphaToCoverage = false;

  if (info.usesReflectiveMask || info.alphaUsage === 'Opaque') {
    material.transparent = false;
    material.depthWrite = true;
    material.alphaTest = 0;
  } else if (info.usesAlphaBlend) {
    material.transparent = true;
    material.depthWrite = true;
    material.alphaTest = 0;
  } else if (info.usesAlphaMask) {
    material.transparent = false;
    material.depthWrite = true;
    material.alphaTest = alphaCutoff;
  }

  material.forceSinglePass = false;
}

export function createDlOpacityNode(
  material: THREE.MeshBasicNodeMaterial,
  info: DlMaterialInfo
): Node<'float'> | null {
  if (!info.usesOpacityAlpha || !material.map) {
    return null;
  }

  return texture(material.map, uv()).a
    .div(float(info.fullOpacityAlpha))
    .clamp(0, 1);
}

export function applyDlMaterialFeatureColorNode(
  material: THREE.MeshBasicNodeMaterial,
  info: DlMaterialInfo,
  baseColorNode: Node<'vec3'>,
  litColorNode: Node<'vec3'>,
  options: DlMaterialFeatureOptions = {}
): Node<'vec3'> {
  let colorNode = litColorNode;

  if (info.usesGlowEmission) {
    colorNode = colorNode.add(createDlGlowNode(info, baseColorNode));
  }

  if (info.usesReflectiveMask) {
    return createDlReflectionSecondPassNode(material, info, baseColorNode, colorNode, options.shine);
  } else if (info.family === 'tie' && info.passFlags !== 0 && !info.usesGlowEmission) {
    colorNode = colorNode.add(createDlShineNode(material, info, options.shine));
  }

  return applyDlMaterialDebugMode(
    colorNode,
    baseColorNode,
    litColorNode,
    vec3(0, 0, 0),
    vec3(0, 0, 0),
    options.shine?.materialDebugModeNode ?? null
  );
}

function createDlGlowNode(info: DlMaterialInfo, baseColorNode: Node<'vec3'>): Node<'vec3'> {
  return baseColorNode
    .mul(vec3(info.glowTint.r, info.glowTint.g, info.glowTint.b))
    .mul(float(Math.max(0, info.glowEmissionStrength)));
}

function createDlShineNode(
  material: THREE.MeshBasicNodeMaterial,
  info: DlMaterialInfo,
  options: DlShineOptions = {}
): Node<'vec3'> {
  const mask = float(1);
  const viewDirection = normalize(cameraPosition.sub(positionWorld));
  const normal = normalize(normalWorld);
  const viewFacing = max(dot(normal, viewDirection), float(0));
  const fresnel = pow(float(1).sub(viewFacing), float(info.usesReflectiveMask ? 2.35 : 4));
  const strength = info.usesReflectiveMask ? 1.75 : 0.34;
  const lightTintSource = max(options.tintNode ?? vec3(1, 1, 1), vec3(0.025, 0.025, 0.025));
  const lightTintPeak = max(
    max(lightTintSource.r, lightTintSource.g),
    max(lightTintSource.b, float(0.05))
  );
  const lightTint = mix(lightTintSource, lightTintSource.div(lightTintPeak), float(0.72));
  const skyboxReflection = options.skyboxTexture
    ? createDlSkyboxReflectionNode(options.skyboxTexture, viewDirection, normal)
    : vec3(1, 1, 1);
  const reflectionScale = options.skyboxReflectionScaleNode ?? float(options.skyboxTexture ? 1 : 0);
  const reflectionMix = clamp(reflectionScale.mul(float(0.72)), float(0), float(1));
  const reflectionBase = options.skyboxTexture
    ? reflectionScale.mul(float(info.usesReflectiveMask ? 0.3 : 0.05))
    : float(0);
  const shineScale = options.shineScaleNode ?? float(1);
  const reflectionTextureTint = clamp(
    skyboxReflection.mul(float(1.65)).add(vec3(0.18, 0.18, 0.18)),
    vec3(0.18, 0.18, 0.18),
    vec3(1.35, 1.35, 1.35)
  );
  const reflectionTint = mix(
    vec3(0.82, 0.82, 0.82),
    reflectionTextureTint,
    reflectionMix
  );

  return lightTint
    .mul(reflectionTint)
    .mul(fresnel.add(reflectionBase))
    .mul(mask)
    .mul(float(strength))
    .mul(shineScale);
}

function createDlReflectionSecondPassNode(
  material: THREE.MeshBasicNodeMaterial,
  info: DlMaterialInfo,
  baseColorNode: Node<'vec3'>,
  litColorNode: Node<'vec3'>,
  options: DlShineOptions = {}
): Node<'vec3'> {
  const mask = createDlReflectiveMaskNode(material, info.reflectiveMaskFocusPower);
  const viewDirection = normalize(cameraPosition.sub(positionWorld));
  const normal = normalize(normalWorld);
  const viewFacing = max(dot(normal, viewDirection), float(0));
  const fresnel = pow(float(1).sub(viewFacing), float(2.4));
  const reflectionScale = options.skyboxReflectionScaleNode ?? float(options.skyboxTexture ? 1 : 0);
  const shineScale = options.shineScaleNode ?? float(1);
  const bleedAlpha = clamp(float(info.reflectiveBleedAlpha), float(0), float(2));
  const secondPassAmount = clamp(
    mask
      .mul(fresnel.mul(float(0.45)).add(float(0.65)))
      .mul(reflectionScale)
      .mul(shineScale),
    float(0),
    float(info.reflectiveMaxBlend * 1.15)
  );
  const lightTintSource = clamp(
    options.tintNode ?? vec3(1, 1, 1),
    vec3(0.02, 0.02, 0.02),
    vec3(1, 1, 1)
  );
  const directionalTint = clamp(
    lightTintSource.mul(float(0.35)).add(vec3(0.65, 0.65, 0.65)),
    vec3(0.02, 0.02, 0.02),
    vec3(1.15, 1.15, 1.15)
  );
  const baseColorPeak = max(
    max(baseColorNode.r, baseColorNode.g),
    max(baseColorNode.b, float(0.08))
  );
  const baseHue = clamp(
    baseColorNode.div(baseColorPeak),
    vec3(0, 0, 0),
    vec3(1, 1, 1)
  );
  const rawBleedTint = clamp(
    vec3(info.reflectiveBleedColor.r, info.reflectiveBleedColor.g, info.reflectiveBleedColor.b),
    vec3(0, 0, 0),
    vec3(2, 2, 2)
  );
  const reflectionTint = clamp(
    rawBleedTint.mul(directionalTint),
    vec3(0.02, 0.02, 0.02),
    vec3(2, 2, 2)
  );
  const skyboxReflection = options.skyboxTexture
    ? createDlReflectiveSkyboxReflectionNode(options.skyboxTexture, info, viewDirection, normal, options)
    : vec3(1, 1, 1);
  const reflectionSignal = clamp(
    skyboxReflection.mul(float(3.6)).add(vec3(0.018, 0.018, 0.018)),
    vec3(0.018, 0.018, 0.018),
    vec3(1.2, 1.2, 1.25)
  );
  const boostedReflection = clamp(
    reflectionSignal,
    vec3(0.018, 0.018, 0.018),
    vec3(1.2, 1.2, 1.25)
  );
  const envColor = clamp(
    boostedReflection.mul(float(info.reflectiveEnvironmentStrength * 1.15)),
    vec3(0, 0, 0),
    vec3(1.25, 1.25, 1.32)
  );
  const reflectionColor = clamp(
    envColor.mul(reflectionTint),
    vec3(0, 0, 0),
    vec3(1.05, 1.05, 1.12)
  );
  const reflectionCarrier = clamp(
    baseHue.mul(float(0.94)).add(vec3(0.06, 0.06, 0.06)),
    vec3(0.04, 0.04, 0.04),
    vec3(1, 1, 1)
  );
  const colorPreservedReflection = clamp(
    reflectionColor.mul(reflectionCarrier),
    vec3(0, 0, 0),
    vec3(0.78, 0.78, 0.86)
  );
  const reflectionBlend = clamp(
    secondPassAmount.mul(bleedAlpha),
    float(0),
    float(info.reflectiveMaxBlend * 1.15)
  );
  // FUN_00593d90 and FUN_00595168 route these materials through the generated
  // environment second-pass path. Model that as an overlay signal with a small
  // reflection floor: dark texels should not punch star/skybox dots into the
  // already-rendered base, but they also should not erase the coating entirely.
  const reflectedSurface = litColorNode
    .add(colorPreservedReflection.mul(reflectionBlend).mul(float(0.78)));
  const directionalSheen = litColorNode.add(vec3(0.012, 0.012, 0.012))
    .mul(reflectionTint)
    .mul(reflectionBlend)
    .mul(fresnel.mul(float(0.12)).add(float(0.025)))
    .mul(shineScale)
    .mul(float(0.72));

  const finalColor = clamp(
    reflectedSurface.add(directionalSheen),
    vec3(0, 0, 0),
    vec3(1.02, 1.02, 1.06)
  );
  const reflectionDebugColor = clamp(
    colorPreservedReflection.mul(reflectionBlend).add(directionalSheen),
    vec3(0, 0, 0),
    vec3(1, 1, 1)
  );

  return applyDlMaterialDebugMode(
    finalColor,
    baseColorNode,
    litColorNode,
    reflectionDebugColor,
    vec3(mask, mask, mask),
    options.materialDebugModeNode ?? null
  );
}

function applyDlMaterialDebugMode(
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

function createDlSkyboxReflectionNode(
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
  return createDlSkyboxUvReflectionNode(textureSource, reflectedUv);
}

function createDlReflectiveSkyboxReflectionNode(
  textureSource: THREE.Texture,
  info: DlMaterialInfo,
  viewDirection: Node<'vec3'>,
  normal: Node<'vec3'>,
  options: DlShineOptions
): Node<'vec3'> {
  if (usesDlGeneratedEnvPassReflection(info)) {
    return createDlSkyboxGeneratedEnvPassReflectionNode(textureSource, viewDirection, normal, options);
  }

  return options.useSecondUvReflection === true
    ? createDlSkyboxSecondUvReflectionNode(textureSource, uv(1), viewDirection, normal)
    : createDlSkyboxReflectionNode(textureSource, viewDirection, normal);
}

function createDlSkyboxGeneratedEnvPassReflectionNode(
  textureSource: THREE.Texture,
  viewDirection: Node<'vec3'>,
  normal: Node<'vec3'>,
  options: DlShineOptions
): Node<'vec3'> {
  // DL retail assembly separates this from ordinary UV projection:
  // FUN_00593d90 masks pass bits at 0x00594244/0x00594248 and branches to
  // generated envpass code; FUN_00595168 does the same at 0x00595618/0x0059561c.
  // For flags like 0x0A, FUN_00595168 selects the inline helper at 0x005947d0
  // (0x00595934-0x00595954); when bit 0x02 is clear it selects FUN_00594bf0.
  // Those helpers unpack packed normals/positions and emit generated UVs before
  // rasterization. Use this as a vertex-varying approximation against the
  // authored tie reflection texture; the earlier skybox-shell remapping/biasing
  // is intentionally avoided here.
  const viewNormal = normalize(normalView);
  const reflectedView = normalize(reflect(positionViewDirection.negate(), viewNormal));
  const reflectedZ = reflectedView.z.add(float(1));
  const sphereDenominator = max(
    sqrt(
      reflectedView.x.mul(reflectedView.x)
        .add(reflectedView.y.mul(reflectedView.y))
        .add(reflectedZ.mul(reflectedZ))
    ).mul(float(2)),
    float(0.001)
  );
  const sphereX = reflectedView.x.div(sphereDenominator).mul(float(-1));
  const sphereY = reflectedView.y.div(sphereDenominator).mul(float(-1));
  const cameraDistance = distance(cameraPosition, positionWorld);
  const distanceZoom = clamp(
    cameraDistance
      .div(cameraDistance.add(float(700)))
      .sub(float(0.48))
      .mul(float(0.24))
      .add(float(1)),
    float(0.88),
    float(1.1)
  );
  const generatedUv = vec2(
    sphereX.mul(distanceZoom).add(float(0.5)),
    sphereY.mul(distanceZoom).add(float(0.5))
  ).toVarying('dlGeneratedEnvPassUv');
  return createDlSkyboxUvReflectionNode(textureSource, generatedUv);
}

function createDlSkyboxSecondUvReflectionNode(
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
  return createDlSkyboxUvReflectionNode(textureSource, transformedUv, uGate.mul(vGate).mul(faceGate).mul(uvMaskGate));
}

function createDlSkyboxUvReflectionNode(
  textureSource: THREE.Texture,
  reflectionUv: Node<'vec2'>,
  opacityGate: Node<'float'> | null = null
): Node<'vec3'> {
  const shellSample = texture(textureSource, reflectionUv);
  const shellAlpha = shellSample.a
    .div(float(dlFullOpacityAlphaByte / 255))
    .mul(opacityGate ?? float(1))
    .clamp(0, 1);
  return mix(
    vec3(0.025, 0.045, 0.075),
    shellSample.rgb,
    shellAlpha.mul(float(0.9))
  );
}

function createDlReflectiveMaskNode(
  material: THREE.MeshBasicNodeMaterial,
  focusPower: number
): Node<'float'> {
  if (!material.map) {
    return float(1);
  }

  const normalizedAlpha = texture(material.map, uv()).a
    .div(float(dlFullOpacityAlphaByte / 255))
    .clamp(0, 1);
  return pow(normalizedAlpha, float(Math.max(1.05, Math.min(1.65, focusPower * 1.15))));
}

function inferTieSecondPassMode(passFlags: number, environmentPassBits: number): string {
  const envBits = environmentPassBits || (passFlags & dlTieEnvironmentPassMask);
  if (envBits !== 0) {
    return envBits === 0x02
      ? 'GeneratedEnvPass'
      : envBits === 0x04
        ? 'GeneratedEnvPassAlt'
        : 'GeneratedEnvPassMixed';
  }

  return (passFlags & dlTieTextureMatrixPassMask) !== 0 ? 'TextureMatrix' : 'None';
}

function usesDlGeneratedEnvPassReflection(info: DlMaterialInfo): boolean {
  return info.family === 'tie'
    && (info.passEnvironmentModeBits !== 0
      || (info.passFlags & dlTieEnvironmentPassMask) !== 0
      || info.secondPassMode === 'GeneratedEnvPass'
      || info.secondPassMode === 'GeneratedEnvPassAlt'
      || info.secondPassMode === 'GeneratedEnvPassMixed');
}

function readFullOpacityAlpha(source: THREE.Material, family: DlMaterialFamily): number {
  const value = readNumberExtra(source, alphaExtraNames(family, 'TextureFullOpacityAlpha'), dlFullOpacityAlphaByte);
  const normalized = value > 1 ? value / 255 : value;
  return THREE.MathUtils.clamp(normalized, 1 / 255, 1);
}

function readPs2GlowTint(value: string | null): THREE.Color {
  if (!value) {
    return new THREE.Color(1, 1, 1);
  }

  const match = value.match(/^#?([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!match) {
    return new THREE.Color(1, 1, 1);
  }

  const rgb = Number.parseInt(match[1], 16);
  return new THREE.Color(
    THREE.MathUtils.clamp(((rgb >> 16) & 0xff) / dlFullOpacityAlphaByte, 0, 2),
    THREE.MathUtils.clamp(((rgb >> 8) & 0xff) / dlFullOpacityAlphaByte, 0, 2),
    THREE.MathUtils.clamp((rgb & 0xff) / dlFullOpacityAlphaByte, 0, 2)
  );
}

function alphaExtraNames(family: DlMaterialFamily, suffix: string): string[] {
  const prefix = family === 'tie' ? 'Tie' : 'Shrub';
  const legacyPrefix = family === 'tie' ? 'DlTie' : 'DlShrub';
  return [`${prefix}${suffix}`, `${legacyPrefix}${suffix}`];
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
