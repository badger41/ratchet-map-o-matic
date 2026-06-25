import * as THREE from 'three/webgpu';
import {
  attribute,
  clamp,
  dot,
  float,
  floor,
  max,
  mix,
  mod,
  normalWorld,
  normalize,
  texture,
  uniform,
  vec2,
  vec3,
  vertexStage
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import type {
  DirectionalLightRecord,
  TieBlendMode,
  TieLightingMode,
  TieMaterialDebugMode,
  TieRenderOptions,
  Vec4
} from '../../../../services/mapPackages/mapPackageTypes';
import {
  lightSelectorAttributeName,
  tieDirectionalLightFloor,
  tieDirectionalLightSlotCount,
  type PreparedTieRecord,
  type TieDirectionalLightBinding,
  type TieLightingUniforms
} from './TieTypes';

export function createTieDirectionalLightBinding(directionalLights: DirectionalLightRecord[]): TieDirectionalLightBinding | null {
  if (directionalLights.length === 0) {
    return null;
  }

  const topColors = new Float32Array(tieDirectionalLightSlotCount * 4);
  const topDirections = new Float32Array(tieDirectionalLightSlotCount * 4);
  const inverseColors = new Float32Array(tieDirectionalLightSlotCount * 4);
  const inverseDirections = new Float32Array(tieDirectionalLightSlotCount * 4);

  for (let slot = 0; slot < tieDirectionalLightSlotCount; slot += 1) {
    const record = directionalLights[slot];
    const offset = slot * 4;
    if (!record) {
      writeVec4(topColors, offset, [0, 0, 0, 0]);
      writeVec4(inverseColors, offset, [0, 0, 0, 0]);
      writeVec4(topDirections, offset, [0, 1, 0, 0]);
      writeVec4(inverseDirections, offset, [0, -1, 0, 0]);
      continue;
    }

    writeVec4(topColors, offset, record.topColor);
    writeVec4(inverseColors, offset, record.inverseColor);
    writeVec3(topDirections, offset, normalizeTuple3(gameDirectionToGltf(record.topDirection)));
    writeVec3(inverseDirections, offset, normalizeTuple3(gameDirectionToGltf(record.inverseDirection)));
  }

  return {
    topColors: createTieLightTexture(topColors, 'tie_directional_top_colors'),
    topDirections: createTieLightTexture(topDirections, 'tie_directional_top_directions'),
    inverseColors: createTieLightTexture(inverseColors, 'tie_directional_inverse_colors'),
    inverseDirections: createTieLightTexture(inverseDirections, 'tie_directional_inverse_directions'),
    slotCount: tieDirectionalLightSlotCount
  };
}

export function disposeTieDirectionalLightBinding(binding: TieDirectionalLightBinding): void {
  binding.topColors.dispose();
  binding.topDirections.dispose();
  binding.inverseColors.dispose();
  binding.inverseDirections.dispose();
}

export function createLightSelectorInstanceAttribute(records: PreparedTieRecord[]): THREE.InstancedBufferAttribute {
  const selectors = new Float32Array(records.length);
  for (let index = 0; index < records.length; index += 1) {
    const selector = Number(records[index].source.lightSelector);
    selectors[index] = Number.isFinite(selector) ? selector : 15;
  }

  return new THREE.InstancedBufferAttribute(selectors, 1);
}

export function createTieLightingUniforms(
  options: TieRenderOptions,
  hasAmbient: boolean,
  hasDirectional: boolean
): TieLightingUniforms {
  const scales = resolveTieLightingScales(options, hasAmbient, hasDirectional);
  const blendScales = resolveTieBlendScales(options, hasAmbient, hasDirectional);
  return {
    ambientScale: uniform(scales.ambient),
    directionalScale: uniform(scales.directional),
    rawColorScale: uniform(scales.rawColor),
    rawByteScale: uniform(scales.rawBytes),
    rawDirectionalScale: uniform(scales.rawDirectional),
    rawDirectionalColorScale: uniform(scales.rawDirectionalColor),
    colorStrength: uniform(resolveTieColorStrength(options)),
    blendAdditiveScale: uniform(blendScales.additive),
    blendTintedWorldScale: uniform(blendScales.tintedWorld),
    blendModulateScale: uniform(blendScales.modulate),
    blendMaxLightScale: uniform(blendScales.maxLight),
    shineScale: uniform(resolveTieShineIntensity(options)),
    reflectionScale: uniform(resolveTieReflectionIntensity(options)),
    materialDebugMode: uniform(resolveTieMaterialDebugMode(options.materialDebugMode)),
    directionalOverrideEnabled: uniform(resolveTieDirectionalOverrideEnabled(options)),
    directionalOverrideSlot: uniform(resolveTieDirectionalOverrideSlot(options))
  };
}

export function updateTieMaterialLightingUniforms(
  material: THREE.Material | THREE.Material[],
  options: TieRenderOptions,
  hasAmbient: boolean
): void {
  if (Array.isArray(material)) {
    for (const item of material) {
      updateTieMaterialLightingUniforms(item, options, hasAmbient);
    }
    return;
  }

  const uniforms = material.userData.mapOmaticTieLightingUniforms as TieLightingUniforms | undefined;
  if (!uniforms) {
    return;
  }

  const hasDirectional = Boolean(material.userData.mapOmaticTieDirectionalLightMaterial);
  const scales = resolveTieLightingScales(options, hasAmbient, hasDirectional);
  const blendScales = resolveTieBlendScales(options, hasAmbient, hasDirectional);
  uniforms.ambientScale.value = scales.ambient;
  uniforms.directionalScale.value = scales.directional;
  uniforms.rawColorScale.value = scales.rawColor;
  uniforms.rawByteScale.value = scales.rawBytes;
  uniforms.rawDirectionalScale.value = scales.rawDirectional;
  uniforms.rawDirectionalColorScale.value = scales.rawDirectionalColor;
  uniforms.colorStrength.value = resolveTieColorStrength(options);
  uniforms.blendAdditiveScale.value = blendScales.additive;
  uniforms.blendTintedWorldScale.value = blendScales.tintedWorld;
  uniforms.blendModulateScale.value = blendScales.modulate;
  uniforms.blendMaxLightScale.value = blendScales.maxLight;
  uniforms.shineScale.value = resolveTieShineIntensity(options);
  uniforms.reflectionScale.value = resolveTieReflectionIntensity(options);
  uniforms.materialDebugMode.value = resolveTieMaterialDebugMode(options.materialDebugMode);
  uniforms.directionalOverrideEnabled.value = resolveTieDirectionalOverrideEnabled(options);
  uniforms.directionalOverrideSlot.value = resolveTieDirectionalOverrideSlot(options);
}

export function createTieDirectionalLightNode(
  binding: TieDirectionalLightBinding,
  lightingUniforms: TieLightingUniforms
): Node<'vec3'> {
  const selector = createTieDirectionalSelectorNode(lightingUniforms);
  const primarySlot = mod(selector, float(binding.slotCount));
  const secondarySlot = mod(floor(selector.div(float(16))), float(binding.slotCount));
  const blendAmount = clamp(floor(selector.div(float(256))).div(float(256)), 0, 1);
  const normal = normalize(normalWorld);
  const primary = createTieDirectionalSlotLightNode(binding, primarySlot, normal);
  const secondary = createTieDirectionalSlotLightNode(binding, secondarySlot, normal);
  return vertexStage(mix(primary, secondary, blendAmount));
}

export function createTieDirectionalColorNode(
  binding: TieDirectionalLightBinding,
  lightingUniforms: TieLightingUniforms
): Node<'vec3'> {
  const selector = createTieDirectionalSelectorNode(lightingUniforms);
  const primarySlot = mod(selector, float(binding.slotCount));
  const secondarySlot = mod(floor(selector.div(float(16))), float(binding.slotCount));
  const blendAmount = clamp(floor(selector.div(float(256))).div(float(256)), 0, 1);
  const primary = createTieDirectionalSlotColorNode(binding, primarySlot);
  const secondary = createTieDirectionalSlotColorNode(binding, secondarySlot);
  return vertexStage(mix(primary, secondary, blendAmount));
}

export function resolveTieMaterialDebugMode(value: TieMaterialDebugMode | undefined): number {
  switch (value) {
    case 'base':
      return 1;
    case 'lit':
      return 2;
    case 'reflection':
      return 3;
    case 'mask':
      return 4;
    case 'normal':
    default:
      return 0;
  }
}

function createTieDirectionalSelectorNode(lightingUniforms: TieLightingUniforms): Node<'float'> {
  const instanceSelector = floor(max(attribute<'float'>(lightSelectorAttributeName, 'float'), float(0)).add(float(0.5)));
  return floor(mix(instanceSelector, lightingUniforms.directionalOverrideSlot, lightingUniforms.directionalOverrideEnabled));
}

function createTieDirectionalSlotLightNode(
  binding: TieDirectionalLightBinding,
  slot: Node<'float'>,
  normal: Node<'vec3'>
): Node<'vec3'> {
  const lightUv = vec2(slot.add(float(0.5)).div(float(binding.slotCount)), float(0.5));
  const topColor = texture(binding.topColors, lightUv);
  const inverseColor = texture(binding.inverseColors, lightUv);
  const topDirection = normalize(texture(binding.topDirections, lightUv).rgb);
  const inverseDirection = normalize(texture(binding.inverseDirections, lightUv).rgb);
  const topDotRaw = dot(normal, topDirection.mul(float(-1)));
  const inverseDotRaw = dot(normal, inverseDirection);
  const topDot = max(topDotRaw, topDotRaw.mul(topColor.a));
  const inverseDot = max(inverseDotRaw, inverseDotRaw.mul(inverseColor.a));
  return max(
    topColor.rgb.mul(topDot).add(inverseColor.rgb.mul(inverseDot)),
    vec3(0, 0, 0)
  );
}

function createTieDirectionalSlotColorNode(
  binding: TieDirectionalLightBinding,
  slot: Node<'float'>
): Node<'vec3'> {
  const lightUv = vec2(slot.add(float(0.5)).div(float(binding.slotCount)), float(0.5));
  const topColor = texture(binding.topColors, lightUv);
  const inverseColor = texture(binding.inverseColors, lightUv);
  return topColor.rgb.add(inverseColor.rgb).mul(float(0.5));
}

function resolveTieLightingScales(
  options: TieRenderOptions,
  hasAmbient: boolean,
  hasDirectional: boolean
): {
  ambient: number;
  directional: number;
  rawColor: number;
  rawBytes: number;
  rawDirectional: number;
  rawDirectionalColor: number;
} {
  const mode = normalizeTieLightingMode(options.lightingMode);
  if (mode === 'color-data') {
    return {
      ambient: 0,
      directional: 0,
      rawColor: hasAmbient ? Math.max(0, options.ambientIntensity) : 0,
      rawBytes: 0,
      rawDirectional: 0,
      rawDirectionalColor: 0
    };
  }

  if (mode === 'color-raw') {
    return {
      ambient: 0,
      directional: 0,
      rawColor: 0,
      rawBytes: hasAmbient ? Math.max(0, options.ambientIntensity) : 0,
      rawDirectional: 0,
      rawDirectionalColor: 0
    };
  }

  if (mode === 'world-rays') {
    return {
      ambient: 0,
      directional: 0,
      rawColor: 0,
      rawBytes: 0,
      rawDirectional: hasDirectional ? Math.max(0, options.directionalIntensity) : 0,
      rawDirectionalColor: 0
    };
  }

  if (mode === 'world-colors') {
    return {
      ambient: 0,
      directional: 0,
      rawColor: 0,
      rawBytes: 0,
      rawDirectional: 0,
      rawDirectionalColor: hasDirectional ? Math.max(0, options.directionalIntensity) : 0
    };
  }

  const effectiveMode = hasAmbient ? mode : mode === 'ambient' ? 'directional' : mode;
  return {
    ambient: hasAmbient && effectiveMode !== 'directional' ? Math.max(0, options.ambientIntensity) : 0,
    directional: hasDirectional && effectiveMode !== 'ambient' ? Math.max(0, options.directionalIntensity) : 0,
    rawColor: 0,
    rawBytes: 0,
    rawDirectional: 0,
    rawDirectionalColor: 0
  };
}

function normalizeTieLightingMode(value: TieLightingMode | undefined): TieLightingMode {
  return value === 'ambient' ||
    value === 'directional' ||
    value === 'color-data' ||
    value === 'color-raw' ||
    value === 'world-rays' ||
    value === 'world-colors'
    ? value
    : 'combined';
}

function resolveTieBlendScales(
  options: TieRenderOptions,
  hasAmbient: boolean,
  hasDirectional: boolean
): {
  additive: number;
  tintedWorld: number;
  modulate: number;
  maxLight: number;
} {
  if (normalizeTieLightingMode(options.lightingMode) !== 'combined' || !hasAmbient || !hasDirectional) {
    return {
      additive: 1,
      tintedWorld: 0,
      modulate: 0,
      maxLight: 0
    };
  }

  const mode = normalizeTieBlendMode(options.blendMode);
  return {
    additive: mode === 'additive' ? 1 : 0,
    tintedWorld: mode === 'tinted-world' ? 1 : 0,
    modulate: mode === 'modulate' ? 1 : 0,
    maxLight: mode === 'max-light' ? 1 : 0
  };
}

function normalizeTieBlendMode(value: TieBlendMode | undefined): TieBlendMode {
  return value === 'additive' ||
    value === 'modulate' ||
    value === 'max-light'
    ? value
    : 'tinted-world';
}

function resolveTieColorStrength(options: TieRenderOptions): number {
  return Number.isFinite(options.colorStrength) ? Math.max(0, options.colorStrength) : 1;
}

function resolveTieShineIntensity(options: TieRenderOptions): number {
  return Number.isFinite(options.shineIntensity) ? Math.max(0, options.shineIntensity) : 1.35;
}

function resolveTieReflectionIntensity(options: TieRenderOptions): number {
  return Number.isFinite(options.reflectionIntensity)
    ? Math.max(0, Math.min(options.reflectionIntensity, 2))
    : 1;
}

function resolveTieDirectionalOverrideEnabled(options: TieRenderOptions): number {
  return options.directionalOverrideSlot === null ? 0 : 1;
}

function resolveTieDirectionalOverrideSlot(options: TieRenderOptions): number {
  const slot = options.directionalOverrideSlot;
  return slot === null ? 0 : Math.max(0, Math.min(tieDirectionalLightSlotCount - 1, Math.floor(slot)));
}

function createTieLightTexture(data: Float32Array, name: string): THREE.DataTexture {
  const lightTexture = new THREE.DataTexture(data, tieDirectionalLightSlotCount, 1, THREE.RGBAFormat, THREE.FloatType);
  lightTexture.name = name;
  lightTexture.magFilter = THREE.NearestFilter;
  lightTexture.minFilter = THREE.NearestFilter;
  lightTexture.wrapS = THREE.ClampToEdgeWrapping;
  lightTexture.wrapT = THREE.ClampToEdgeWrapping;
  lightTexture.flipY = false;
  lightTexture.colorSpace = THREE.NoColorSpace;
  lightTexture.needsUpdate = true;
  return lightTexture;
}

function writeVec4(target: Float32Array, offset: number, value: Vec4): void {
  target[offset] = value[0];
  target[offset + 1] = value[1];
  target[offset + 2] = value[2];
  target[offset + 3] = value[3];
}

function writeVec3(target: Float32Array, offset: number, value: [number, number, number]): void {
  target[offset] = value[0];
  target[offset + 1] = value[1];
  target[offset + 2] = value[2];
  target[offset + 3] = 0;
}

function gameDirectionToGltf(direction: Vec4): [number, number, number] {
  return [direction[0], direction[2], -direction[1]];
}

function normalizeTuple3(value: [number, number, number]): [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= 0.000001) {
    return [0, 1, 0];
  }

  return [value[0] / length, value[1] / length, value[2] / length];
}
