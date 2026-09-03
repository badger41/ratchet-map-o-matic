import * as THREE from 'three/webgpu';
import { attribute, dot, float, max, normalWorld, normalize, vertexStage } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import type { Rc1PointLightRecord } from '../../../../services/mapPackages/rc1/Rc1PointLights.ts';
import type { PreparedTieRecord } from '../ties/TieTypes.ts';

export const rc1TiePointDirectionAttributeName = 'rc1TiePointDirection';
export const rc1TiePointColorAttributeName = 'rc1TiePointColor';

export interface Rc1TiePointLightAttributes {
  direction: THREE.InstancedBufferAttribute;
  color: THREE.InstancedBufferAttribute;
}

export interface PreparedRc1PointLight {
  position: [number, number, number];
  radius: number;
  color: [number, number, number];
}

export function decodeRc1TieAmbientColor(words: number[], index: number) {
  const word = words[index];
  if (!Number.isFinite(word)) {
    return { r: 128, g: 128, b: 128, valid: false };
  }

  const expand5 = (value: number) => (value << 3) | (value >> 2);
  return {
    r: expand5(word & 0x1f),
    g: expand5((word >> 5) & 0x1f),
    b: expand5((word >> 10) & 0x1f),
    valid: true
  };
}

export function evaluateRc1PointLighting(
  position: [number, number, number],
  normal: [number, number, number],
  lights: readonly PreparedRc1PointLight[]
): [number, number, number] {
  const color: [number, number, number] = [0, 0, 0];
  let selected = 0;
  for (const light of lights) {
    if (!(light.radius > 0)) {
      continue;
    }

    const dx = light.position[0] - position[0];
    const dy = light.position[1] - position[1];
    const dz = light.position[2] - position[2];
    const distanceSquared = dx * dx + dy * dy + dz * dz;
    if (distanceSquared >= light.radius * light.radius || distanceSquared <= 1e-12) {
      continue;
    }

    const distance = Math.sqrt(distanceSquared);
    const diffuse = Math.max(0, (normal[0] * dx + normal[1] * dy + normal[2] * dz) / distance);
    const attenuation = 1 - distance / light.radius;
    color[0] += light.color[0] * attenuation * diffuse;
    color[1] += light.color[1] * attenuation * diffuse;
    color[2] += light.color[2] * attenuation * diffuse;
    if (++selected === 4) {
      break;
    }
  }

  return color;
}

export function createRc1TiePointLightAttributes(
  records: PreparedTieRecord[],
  lights: readonly PreparedRc1PointLight[]
): Rc1TiePointLightAttributes {
  const directions = new Float32Array(records.length * 3);
  const colors = new Float32Array(records.length * 3);
  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const position = gamePositionToGltf(records[recordIndex].source.position);
    const offset = recordIndex * 3;
    let directionX = 0;
    let directionY = 0;
    let directionZ = 0;
    let selected = 0;
    for (const light of lights) {
      if (!(light.radius > 0)) {
        continue;
      }

      const dx = light.position[0] - position[0];
      const dy = light.position[1] - position[1];
      const dz = light.position[2] - position[2];
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      if (distanceSquared >= light.radius * light.radius || distanceSquared <= 1e-12) {
        continue;
      }

      const distance = Math.sqrt(distanceSquared);
      directionX += dx / distance;
      directionY += dy / distance;
      directionZ += dz / distance;
      const attenuation = 1 - distance / light.radius;
      colors[offset] += light.color[0] * attenuation;
      colors[offset + 1] += light.color[1] * attenuation;
      colors[offset + 2] += light.color[2] * attenuation;
      if (++selected === 4) {
        break;
      }
    }

    const length = Math.hypot(directionX, directionY, directionZ);
    directions[offset] = length > 0.000001 ? directionX / length : 0;
    directions[offset + 1] = length > 0.000001 ? directionY / length : 1;
    directions[offset + 2] = length > 0.000001 ? directionZ / length : 0;
  }

  return {
    direction: new THREE.InstancedBufferAttribute(directions, 3),
    color: new THREE.InstancedBufferAttribute(colors, 3)
  };
}

export function prepareRc1PointLights(lights: readonly Rc1PointLightRecord[]): PreparedRc1PointLight[] {
  return lights.map((light) => ({
    position: gamePositionToGltf(light.position),
    radius: light.radius,
    color: [light.color[0] / 128, light.color[1] / 128, light.color[2] / 128]
  }));
}

export function createRc1TiePointLightNode(): Node<'vec3'> {
  const direction = normalize(attribute<'vec3'>(rc1TiePointDirectionAttributeName, 'vec3'));
  const color = attribute<'vec3'>(rc1TiePointColorAttributeName, 'vec3');
  return vertexStage(color.mul(max(dot(normalize(normalWorld), direction), float(0))))
    .setInterpolation('linear');
}

function gamePositionToGltf(position: readonly number[]): [number, number, number] {
  return [position[0] ?? 0, position[2] ?? 0, -(position[1] ?? 0)];
}
