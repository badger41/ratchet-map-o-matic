export function hasTieBloomSourceNear(
  centers: readonly number[],
  position: { x: number; y: number; z: number },
  distance: number
): boolean {
  for (let index = 0; index < centers.length; index += 4) {
    const maxDistance = distance + centers[index + 3];
    const dx = centers[index] - position.x;
    const dy = centers[index + 1] - position.y;
    const dz = centers[index + 2] - position.z;
    if ((dx * dx) + (dy * dy) + (dz * dz) <= maxDistance * maxDistance) {
      return true;
    }
  }

  return false;
}
