import * as THREE from 'three/webgpu';
import {
  attribute,
  dot,
  float,
  floor,
  max,
  mix,
  mod,
  normalGeometry,
  normalWorldGeometry,
  normalize,
  step,
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
  lightSelectorAttributeName,
  shrubDirectionalLightSlotCount,
  shrubLightBasisXAttributeName,
  shrubLightBasisYAttributeName,
  shrubLightBasisZAttributeName,
  shrubLightingUniformsUserDataKey,
  type PreparedShrubRecord,
  type ShrubDirectionalLightBinding,
  type ShrubLightingUniforms
} from './ShrubTypes';

type DirectionalLightScale = Node<'float'> | number;

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
    writeVec3(topDirections, offset, gameDirectionToGltf(record.topDirection), 1);
    writeVec3(inverseDirections, offset, gameDirectionToGltf(record.inverseDirection), 1);
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

export function createLightSelectorInstanceAttribute(records: PreparedShrubRecord[]): THREE.InstancedBufferAttribute {
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

export function createShrubInstanceLightingNormalNode(): Node<'vec3'> {
  const sourceNormal = normalGeometry;
  return attribute<'vec3'>(shrubLightBasisXAttributeName, 'vec3').mul(sourceNormal.x)
    .add(attribute<'vec3'>(shrubLightBasisYAttributeName, 'vec3').mul(sourceNormal.y))
    .add(attribute<'vec3'>(shrubLightBasisZAttributeName, 'vec3').mul(sourceNormal.z));
}

export function createShrubLightingUniforms(options: ShrubRenderOptions): ShrubLightingUniforms {
  const blendScales = resolveShrubBlendScales(options);
  return {
    ambientScale: uniform(resolveShrubAmbientIntensity(options)),
    directionalScale: uniform(resolveShrubDirectionalIntensity(options)),
    exposureScale: uniform(resolveShrubExposure(options)),
    directionalColorStrength: uniform(resolveShrubDirectionalColorStrength(options)),
    directionalFrontScale: uniform(resolveShrubDirectionalFrontIntensity(options)),
    directionalBackScale: uniform(resolveShrubDirectionalBackIntensity(options)),
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
  uniforms.exposureScale.value = resolveShrubExposure(options);
  uniforms.directionalColorStrength.value = resolveShrubDirectionalColorStrength(options);
  uniforms.directionalFrontScale.value = resolveShrubDirectionalFrontIntensity(options);
  uniforms.directionalBackScale.value = resolveShrubDirectionalBackIntensity(options);
  uniforms.blendAdditiveScale.value = blendScales.additive;
  uniforms.blendModulateScale.value = blendScales.modulate;
}

export function createShrubDirectionalLightNode(
  binding: ShrubDirectionalLightBinding,
  lightingUniforms: ShrubLightingUniforms,
  staticOptions?: Pick<ShrubRenderOptions, 'directionalFrontIntensity' | 'directionalBackIntensity'>,
  lightingNormal: Node<'vec3'> = normalize(normalWorldGeometry)
): Node<'vec4'> {
  const selector = floor(max(attribute<'float'>(lightSelectorAttributeName, 'float'), float(0)).add(float(0.5)));
  const primarySlot = mod(selector, float(binding.slotCount));
  const secondarySlot = mod(floor(selector.div(float(16))), float(binding.slotCount));
  const blendAmount = max(float(0), floor(selector.div(float(256))).div(float(256))).min(float(1));
  const primaryUv = vec2(primarySlot.add(float(0.5)).div(float(binding.slotCount)), float(0.5));
  const secondaryUv = vec2(secondarySlot.add(float(0.5)).div(float(binding.slotCount)), float(0.5));
  const primaryTopColor = texture(binding.topColors, primaryUv);
  const secondaryTopColor = texture(binding.topColors, secondaryUv);
  const primaryInverseColor = texture(binding.inverseColors, primaryUv);
  const secondaryInverseColor = texture(binding.inverseColors, secondaryUv);
  const hasBlend = step(float(1 / 512), blendAmount);
  const topColor = vec4(
    mix(primaryTopColor.rgb, secondaryTopColor.rgb, blendAmount),
    primaryTopColor.a.add(secondaryTopColor.a.mul(hasBlend))
  );
  const inverseColor = vec4(
    mix(primaryInverseColor.rgb, secondaryInverseColor.rgb, blendAmount),
    primaryInverseColor.a.add(secondaryInverseColor.a.mul(hasBlend))
  );
  const topDirection = normalize(mix(
    texture(binding.topDirections, primaryUv).rgb,
    texture(binding.topDirections, secondaryUv).rgb,
    blendAmount
  ));
  const inverseDirection = normalize(mix(
    texture(binding.inverseDirections, primaryUv).rgb,
    texture(binding.inverseDirections, secondaryUv).rgb,
    blendAmount
  ));
  const topDotRaw = dot(lightingNormal, topDirection.mul(float(-1)));
  const inverseDotRaw = dot(lightingNormal, inverseDirection.mul(float(-1)));
  const topDot = max(topDotRaw, topDotRaw.mul(topColor.a));
  const inverseDot = max(inverseDotRaw, inverseDotRaw.mul(inverseColor.a));
  const frontScale = staticOptions
    ? resolveShrubDirectionalFrontIntensity(staticOptions)
    : lightingUniforms.directionalFrontScale;
  const backScale = staticOptions
    ? resolveShrubDirectionalBackIntensity(staticOptions)
    : lightingUniforms.directionalBackScale;
  const light = max(
    scaleDirectionalLightNode(topColor.rgb.mul(topDot), frontScale)
      .add(scaleDirectionalLightNode(inverseColor.rgb.mul(inverseDot), backScale)),
    vec3(0, 0, 0)
  );
  return vertexStage(vec4(light, 1));
}

function scaleDirectionalLightNode(lightNode: Node<'vec3'>, scale: DirectionalLightScale): Node<'vec3'> {
  if (typeof scale === 'number') {
    if (scale <= 0) {
      return vec3(0, 0, 0);
    }

    if (Math.abs(scale - 1) < 0.0001) {
      return lightNode;
    }

    return lightNode.mul(float(scale));
  }

  return lightNode.mul(scale);
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

function resolveShrubDirectionalColorStrength(options: ShrubRenderOptions): number {
  return Number.isFinite(options.directionalColorStrength) ? Math.max(0, options.directionalColorStrength) : 1;
}

function resolveShrubExposure(options: ShrubRenderOptions): number {
  return Number.isFinite(options.exposure) ? Math.max(0, options.exposure) : 1;
}

function resolveShrubDirectionalFrontIntensity(options: Pick<ShrubRenderOptions, 'directionalFrontIntensity'>): number {
  return Number.isFinite(options.directionalFrontIntensity) ? Math.max(0, options.directionalFrontIntensity) : 0.75;
}

function resolveShrubDirectionalBackIntensity(options: Pick<ShrubRenderOptions, 'directionalBackIntensity'>): number {
  return Number.isFinite(options.directionalBackIntensity) ? Math.max(0, options.directionalBackIntensity) : 1;
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
