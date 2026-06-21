import * as THREE from 'three/webgpu';

const skyboxEyeHeightRatio = 0;

export function skyboxInsideCameraEye(box: THREE.Box3): THREE.Vector3 {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const originY = box.min.y <= 0 && box.max.y >= 0
    ? 0
    : box.min.y;
  const height = skyboxEyeHeightRatio * maxDim;
  return new THREE.Vector3(
    center.x,
    originY + height + Math.max(maxDim / 10000, 0.001),
    center.z
  );
}
