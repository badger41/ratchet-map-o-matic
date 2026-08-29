import type {
  GameplayCuboid,
  GameplayVector3
} from '../../../../../services/wasm/ratchetPs2Wasm';

export function isPointInsideAnyGameplayCuboid(
  point: GameplayVector3,
  cuboidIndices: number[],
  cuboids: GameplayCuboid[]
): boolean {
  return cuboidIndices.some((index) => isPointInsideGameplayCuboid(point, cuboids[index]));
}

function isPointInsideGameplayCuboid(
  point: GameplayVector3,
  cuboid: GameplayCuboid | undefined
): boolean {
  if (!cuboid || cuboid.matrix.length < 15 || cuboid.inverseRotationMatrix.length < 11) {
    return false;
  }

  const x = point.x - cuboid.matrix[12];
  const y = point.y - cuboid.matrix[13];
  const z = point.z - cuboid.matrix[14];
  // Match FastPointInCuboid's column-major multiply against the stored inverse basis.
  const inverse = cuboid.inverseRotationMatrix;
  const localX = inverse[0] * x + inverse[4] * y + inverse[8] * z;
  const localY = inverse[1] * x + inverse[5] * y + inverse[9] * z;
  const localZ = inverse[2] * x + inverse[6] * y + inverse[10] * z;
  return Number.isFinite(localX)
    && Number.isFinite(localY)
    && Number.isFinite(localZ)
    && Math.abs(localX) <= 1
    && Math.abs(localY) <= 1
    && Math.abs(localZ) <= 1;
}
