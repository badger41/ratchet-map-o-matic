import * as THREE from 'three/webgpu';
import type { GameplaySpline } from '../../../../../services/wasm/ratchetPs2Wasm';
import { lerpWrappedRadians } from './SimulationMath.ts';

export interface GameplaySplinePath {
  points: THREE.Vector3[];
  cumulativeDistances: number[];
  length: number;
}

export function indexGameplaySplines(splines: GameplaySpline[]): Map<number, GameplaySpline> {
  return new Map(splines.map((spline) => [spline.index, spline]));
}

export function createGameplaySplinePath(spline: GameplaySpline): GameplaySplinePath | null {
  if (spline.points.length < 2) {
    return null;
  }

  const points = spline.points.map((point) => new THREE.Vector3(point.x, point.y, point.z));
  const cumulativeDistances = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulativeDistances.push(cumulativeDistances[index - 1] + points[index - 1].distanceTo(points[index]));
  }
  const length = cumulativeDistances.at(-1) ?? 0;
  return length > 0 ? { points, cumulativeDistances, length } : null;
}

export function sampleGameplaySplinePath(
  path: GameplaySplinePath,
  distance: number,
  position: THREE.Vector3,
  tangent: THREE.Vector3
): number {
  const wrappedDistance = ((distance % path.length) + path.length) % path.length;
  for (let index = 0; index < path.points.length - 1; index += 1) {
    const startDistance = path.cumulativeDistances[index];
    const endDistance = path.cumulativeDistances[index + 1];
    if (endDistance <= startDistance || wrappedDistance >= endDistance) {
      continue;
    }

    const amount = (wrappedDistance - startDistance) / (endDistance - startDistance);
    position.lerpVectors(path.points[index], path.points[index + 1], amount);
    tangent.subVectors(path.points[index + 1], path.points[index]).normalize();

    const nextPoint = path.points[(index + 2) % path.points.length];
    const nextX = nextPoint.x - path.points[index + 1].x;
    const nextY = nextPoint.y - path.points[index + 1].y;
    const nextZ = nextPoint.z - path.points[index + 1].z;
    if (nextX !== 0 || nextY !== 0 || nextZ !== 0) {
      const pitch = lerpWrappedRadians(
        -Math.atan2(tangent.z, Math.hypot(tangent.x, tangent.y)),
        -Math.atan2(nextZ, Math.hypot(nextX, nextY)),
        amount
      );
      const yaw = lerpWrappedRadians(
        Math.atan2(tangent.y, tangent.x),
        Math.atan2(nextY, nextX),
        amount
      );
      const horizontalLength = Math.cos(pitch);
      tangent.set(
        Math.cos(yaw) * horizontalLength,
        Math.sin(yaw) * horizontalLength,
        -Math.sin(pitch)
      );
    }
    return wrappedDistance;
  }

  position.copy(path.points[0]);
  tangent.subVectors(path.points[1], path.points[0]).normalize();
  return wrappedDistance;
}
