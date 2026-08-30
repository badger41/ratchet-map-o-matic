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
import { evaluatePs2DirectionalLight } from '../TfragMaterialState.ts';
import {
  lightSelectorAttributeName,
  tieDirectionalLightSlotCount,
  type PreparedTieRecord,
  type TieDirectionalLightBinding,
  type TiePrimitive
} from './TieTypes.ts';

export interface TieSourceColor {
  r: number;
  g: number;
  b: number;
  valid: boolean;
}

export function applyTieSourceLighting(
  color: TieSourceColor,
  sourceIndex: number,
  record: PreparedTieRecord,
  primitive: TiePrimitive,
  directionalLights: DirectionalLightRecord[]
): TieSourceColor {
  const packedIndex = sourceIndex - 2;
  const packedNormal = primitive.packedLightNormals[packedIndex];
  if (!Number.isFinite(packedNormal)) {
    return color;
  }

  const contribution = evaluateTieDirectionalLight(
    record.source.lightSelector,
    transformTieNormal(decodeTiePackedNormal(packedNormal), record),
    directionalLights);
  const lit = {
    r: clampByte(color.r + Math.floor(contribution[0] * 127)),
    g: clampByte(color.g + Math.floor(contribution[1] * 127)),
    b: clampByte(color.b + Math.floor(contribution[2] * 127)),
    valid: true
  };
  if (((primitive.packedLightModeBits ?? 0) & 1) === 0) {
    return lit;
  }

  const scale = primitive.packedLightScales[packedIndex] ?? 128;
  return {
    r: clampByte(Math.floor(lit.r * scale / 128)),
    g: clampByte(Math.floor(lit.g * scale / 128)),
    b: clampByte(Math.floor(lit.b * scale / 128)),
    valid: true
  };
}

function decodeTiePackedNormal(packed: number): [number, number, number] {
  const azimuth = (packed & 0xff) * Math.PI / 128;
  const elevation = ((packed >> 8) & 0xff) * Math.PI / 128;
  const elevationCos = Math.cos(elevation);
  return [
    -Math.cos(azimuth) * elevationCos,
    -Math.sin(azimuth) * elevationCos,
    -Math.sin(elevation)
  ];
}

function transformTieNormal(
  normal: [number, number, number],
  record: PreparedTieRecord
): [number, number, number] {
  const rows = record.source.matrixRows.map((row, index) => {
    const length = Math.hypot(row[0], row[1], row[2]);
    return length > 0.000001
      ? [row[0] / length, row[1] / length, row[2] / length]
      : [index === 0 ? 1 : 0, index === 1 ? 1 : 0, index === 2 ? 1 : 0];
  });
  return [
    rows[0][0] * normal[0] + rows[1][0] * normal[1] + rows[2][0] * normal[2],
    rows[0][1] * normal[0] + rows[1][1] * normal[1] + rows[2][1] * normal[2],
    rows[0][2] * normal[0] + rows[1][2] * normal[1] + rows[2][2] * normal[2]
  ];
}

function evaluateTieDirectionalLight(
  selector: number,
  normal: [number, number, number],
  directionalLights: DirectionalLightRecord[]
): [number, number, number] {
  const primary = directionalLights[selector & 0x0f];
  if (!primary) {
    return [0, 0, 0];
  }

  const blendAmount = ((selector >> 8) & 0xff) / 256;
  const secondary = blendAmount > 0 ? directionalLights[(selector >> 4) & 0x0f] : null;
  if (!secondary) {
    return evaluatePs2DirectionalLight(
      primary.topColor,
      vec3Value(primary.topDirection),
      primary.inverseColor,
      vec3Value(primary.inverseDirection),
      normal);
  }

  return evaluatePs2DirectionalLight(
    mixVec4Value(primary.topColor, secondary.topColor, blendAmount),
    mixVec3Value(primary.topDirection, secondary.topDirection, blendAmount),
    mixVec4Value(primary.inverseColor, secondary.inverseColor, blendAmount),
    mixVec3Value(primary.inverseDirection, secondary.inverseDirection, blendAmount),
    normal);
}

function vec3Value(value: Vec4): [number, number, number] {
  return [value[0], value[1], value[2]];
}

function mixVec3Value(left: Vec4, right: Vec4, amount: number): [number, number, number] {
  return [
    left[0] * (1 - amount) + right[0] * amount,
    left[1] * (1 - amount) + right[1] * amount,
    left[2] * (1 - amount) + right[2] * amount
  ];
}

function mixVec4Value(left: Vec4, right: Vec4, amount: number): Vec4 {
  return [
    left[0] * (1 - amount) + right[0] * amount,
    left[1] * (1 - amount) + right[1] * amount,
    left[2] * (1 - amount) + right[2] * amount,
    left[3] * (1 - amount) + right[3] * amount
  ];
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

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
  )).setInterpolation('linear');
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
