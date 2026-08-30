import * as THREE from 'three/webgpu';
import type { DlMobyInstance } from '../../../../services/wasm/ratchetPs2Wasm';
import {
  gltfToPs2BasisMatrix,
  ps2ToGltfBasisMatrix
} from '../shrubs/ShrubTypes';

export function buildMobyInstanceMatrix(record: DlMobyInstance): THREE.Matrix4 {
  const position = new THREE.Vector3(
    finiteNumber(record.position.x),
    finiteNumber(record.position.y),
    finiteNumber(record.position.z)
  ).applyMatrix4(ps2ToGltfBasisMatrix);
  const sourceRotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
    finiteNumber(record.rotation.x),
    finiteNumber(record.rotation.y),
    finiteNumber(record.rotation.z),
    'ZYX'
  ));
  const rotationMatrix = new THREE.Matrix4()
    .copy(ps2ToGltfBasisMatrix)
    .multiply(sourceRotation)
    .multiply(gltfToPs2BasisMatrix);
  const rotation = new THREE.Quaternion().setFromRotationMatrix(rotationMatrix);
  const scale = Number.isFinite(record.scale) && Math.abs(record.scale) > 1e-8 ? record.scale : 1;

  return new THREE.Matrix4().compose(
    position,
    rotation,
    new THREE.Vector3(scale, scale, scale)
  );
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
