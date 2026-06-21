import * as THREE from 'three/webgpu';
import {
  attribute,
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
  vec4,
  vertexStage
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import type {
  DirectionalLightRecord,
  ShrubBlendMode,
  ShrubRenderOptions,
  Vec4
} from '../../../../services/mapPackages/mapPackageTypes';
import {
  dlLightSelectorAttributeName,
  shrubDirectionalLightSlotCount,
  shrubLightingUniformsUserDataKey,
  type PreparedShrubRecord,
  type ShrubDirectionalLightBinding,
  type ShrubLightingUniforms
} from './ShrubTypes';

export function createShrubDirectionalLightBinding(directionalLights: DirectionalLightRecord[]): ShrubDirectionalLightBinding | null {
  if (directionalLights.length === 0) {
    return null;
  }

  const topColors = new Float32Array(shrubDirectionalLightSlotCount * 4);
  const topDirections = new Float32Array(shrubDirectionalLightSlotCount * 4);
  const inverseColors = new Float32Array(shrubDirectionalLightSlotCount * 4);
  const inverseDirections = new Float32Array(shrubDirectionalLightSlotCount * 4);

  for (let slot = 0; slot < shrubDirectionalLightSlotCount; slot += 1) {
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
    writeVec3(topDirections, offset, normalizeTuple3(gameDirectionToGltf(record.topDirection)), 1);
    writeVec3(inverseDirections, offset, normalizeTuple3(gameDirectionToGltf(record.inverseDirection)), 1);
  }

  return {
    topColors: createShrubLightTexture(topColors, 'shrub_directional_top_colors'),
    topDirections: createShrubLightTexture(topDirections, 'shrub_directional_top_directions'),
    inverseColors: createShrubLightTexture(inverseColors, 'shrub_directional_inverse_colors'),
    inverseDirections: createShrubLightTexture(inverseDirections, 'shrub_directional_inverse_directions'),
    slotCount: shrubDirectionalLightSlotCount
  };
}

export function disposeShrubDirectionalLightBinding(binding: ShrubDirectionalLightBinding): void {
  binding.topColors.dispose();
  binding.topDirections.dispose();
  binding.inverseColors.dispose();
  binding.inverseDirections.dispose();
}

export function createDlLightSelectorInstanceAttribute(records: PreparedShrubRecord[]): THREE.InstancedBufferAttribute {
  const selectors = new Float32Array(records.length);
  for (let index = 0; index < records.length; index += 1) {
    const selector = Number(records[index].source.lightSelector);
    selectors[index] = Number.isFinite(selector) ? selector : 15;
  }

  return new THREE.InstancedBufferAttribute(selectors, 1);
}

export function createShrubAmbientColorInstanceAttribute(records: PreparedShrubRecord[]): THREE.InstancedBufferAttribute {
  const colors = new Float32Array(records.length * 3);
  for (let index = 0; index < records.length; index += 1) {
    const color = records[index].ambientColor;
    const offset = index * 3;
    colors[offset] = color[0];
    colors[offset + 1] = color[1];
    colors[offset + 2] = color[2];
  }

  return new THREE.InstancedBufferAttribute(colors, 3);
}

export function createShrubLightingUniforms(options: ShrubRenderOptions): ShrubLightingUniforms {
  const blendScales = resolveShrubBlendScales(options);
  return {
    ambientScale: uniform(resolveShrubAmbientIntensity(options)),
    directionalScale: uniform(resolveShrubDirectionalIntensity(options)),
    blendAdditiveScale: uniform(blendScales.additive),
    blendModulateScale: uniform(blendScales.modulate)
  };
}

export function updateShrubMaterialLightingUniforms(
  material: THREE.Material | THREE.Material[],
  options: ShrubRenderOptions
): void {
  if (Array.isArray(material)) {
    for (const item of material) {
      updateShrubMaterialLightingUniforms(item, options);
    }
    return;
  }

  const uniforms = material.userData[shrubLightingUniformsUserDataKey] as ShrubLightingUniforms | undefined;
  if (!uniforms) {
    return;
  }

  const blendScales = resolveShrubBlendScales(options);
  uniforms.ambientScale.value = resolveShrubAmbientIntensity(options);
  uniforms.directionalScale.value = resolveShrubDirectionalIntensity(options);
  uniforms.blendAdditiveScale.value = blendScales.additive;
  uniforms.blendModulateScale.value = blendScales.modulate;
}

export function createShrubDirectionalLightNode(binding: ShrubDirectionalLightBinding): Node<'vec4'> {
  const selector = floor(max(attribute<'float'>(dlLightSelectorAttributeName, 'float'), float(0)).add(float(0.5)));
  const primarySlot = mod(selector, float(binding.slotCount));
  const secondarySlot = mod(floor(selector.div(float(16))), float(binding.slotCount));
  const blendAmount = max(float(0), floor(selector.div(float(256))).div(float(256))).min(float(1));
  const normal = normalize(normalWorld);
  const primary = createShrubDirectionalSlotLightNode(binding, primarySlot, normal);
  const secondary = createShrubDirectionalSlotLightNode(binding, secondarySlot, normal);
  const effectiveBlend = blendAmount.mul(secondary.a);
  return vertexStage(vec4(mix(primary.rgb, secondary.rgb, effectiveBlend), primary.a));
}

function createShrubDirectionalSlotLightNode(
  binding: ShrubDirectionalLightBinding,
  slot: Node<'float'>,
  normal: Node<'vec3'>
): Node<'vec4'> {
  const lightUv = vec2(slot.add(float(0.5)).div(float(binding.slotCount)), float(0.5));
  const topColor = texture(binding.topColors, lightUv);
  const inverseColor = texture(binding.inverseColors, lightUv);
  const topDirectionSample = texture(binding.topDirections, lightUv);
  const inverseDirectionSample = texture(binding.inverseDirections, lightUv);
  const topDirection = normalize(topDirectionSample.rgb);
  const inverseDirection = normalize(inverseDirectionSample.rgb);
  const valid = topDirectionSample.a;
  const topDotRaw = dot(normal, topDirection.mul(float(-1)));
  const inverseDotRaw = dot(normal, inverseDirection);
  const topDot = max(topDotRaw, topDotRaw.mul(topColor.a));
  const inverseDot = max(inverseDotRaw, inverseDotRaw.mul(inverseColor.a));
  const light = max(
    topColor.rgb.mul(topDot).add(inverseColor.rgb.mul(inverseDot)),
    vec3(0, 0, 0)
  );
  return vec4(light, valid);
}

function resolveShrubBlendScales(options: ShrubRenderOptions): { additive: number; modulate: number } {
  const mode = normalizeShrubBlendMode(options.blendMode);
  return {
    additive: mode === 'additive' ? 1 : 0,
    modulate: mode === 'modulate' ? 1 : 0
  };
}

function normalizeShrubBlendMode(value: ShrubBlendMode | undefined): ShrubBlendMode {
  return value === 'additive' ? 'additive' : 'modulate';
}

function resolveShrubAmbientIntensity(options: ShrubRenderOptions): number {
  return Number.isFinite(options.ambientIntensity) ? Math.max(0, options.ambientIntensity) : 1;
}

function resolveShrubDirectionalIntensity(options: ShrubRenderOptions): number {
  return Number.isFinite(options.directionalIntensity) ? Math.max(0, options.directionalIntensity) : 1;
}

function createShrubLightTexture(data: Float32Array, name: string): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, shrubDirectionalLightSlotCount, 1, THREE.RGBAFormat, THREE.FloatType);
  texture.name = name;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function writeVec4(target: Float32Array, offset: number, value: Vec4): void {
  target[offset] = value[0];
  target[offset + 1] = value[1];
  target[offset + 2] = value[2];
  target[offset + 3] = value[3];
}

function writeVec3(target: Float32Array, offset: number, value: [number, number, number], alpha = 0): void {
  target[offset] = value[0];
  target[offset + 1] = value[1];
  target[offset + 2] = value[2];
  target[offset + 3] = alpha;
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
