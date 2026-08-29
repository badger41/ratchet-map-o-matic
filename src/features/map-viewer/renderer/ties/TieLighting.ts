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
  vec2,
  vec3,
  vertexStage
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import type {
  DirectionalLightRecord,
  Vec4
} from '../../../../services/mapPackages/mapPackageTypes';
import {
  lightSelectorAttributeName,
  tieDirectionalLightSlotCount,
  type PreparedTieRecord,
  type TieDirectionalLightBinding
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
    writeVec3(topDirections, offset, gameDirectionToGltf(record.topDirection));
    writeVec3(inverseDirections, offset, gameDirectionToGltf(record.inverseDirection));
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

export function createTieDirectionalLightNode(binding: TieDirectionalLightBinding): Node<'vec3'> {
  const selector = floor(max(attribute<'float'>(lightSelectorAttributeName, 'float'), float(0)).add(float(0.5)));
  const primarySlot = mod(selector, float(binding.slotCount));
  const secondarySlot = mod(floor(selector.div(float(16))), float(binding.slotCount));
  const blendAmount = clamp(floor(selector.div(float(256))).div(float(256)), 0, 1);
  const primaryUv = vec2(primarySlot.add(float(0.5)).div(float(binding.slotCount)), float(0.5));
  const secondaryUv = vec2(secondarySlot.add(float(0.5)).div(float(binding.slotCount)), float(0.5));
  const normal = normalize(normalWorld);
  const topColor = mix(texture(binding.topColors, primaryUv), texture(binding.topColors, secondaryUv), blendAmount);
  const inverseColor = mix(texture(binding.inverseColors, primaryUv), texture(binding.inverseColors, secondaryUv), blendAmount);
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
  const topDotRaw = dot(normal, topDirection.mul(float(-1)));
  const inverseDotRaw = dot(normal, inverseDirection.mul(float(-1)));
  const topDot = max(topDotRaw, topDotRaw.mul(topColor.a));
  const inverseDot = max(inverseDotRaw, inverseDotRaw.mul(inverseColor.a));
  return vertexStage(max(
    topColor.rgb.mul(topDot).add(inverseColor.rgb.mul(inverseDot)),
    vec3(0, 0, 0)
  ));
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
