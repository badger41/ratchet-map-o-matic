import * as THREE from 'three/webgpu';
import type { SkyboxRenderOptions } from '../../../../services/mapPackages/mapPackageTypes';
import {
  numberExtra,
  readVector3,
  skyboxPrimitiveData,
  vectorHasValue
} from './skyboxMetadata';

export interface SkyboxShellAnimation {
  object: THREE.Object3D;
  baseQuaternion: THREE.Quaternion;
  hasSourceRotationTicks: boolean;
  sourceInitial: THREE.Vector3;
  sourceVelocity: THREE.Vector3;
  tickRadians: number;
  runtimeFrameRate: number;
  initial: THREE.Vector3;
  velocity: THREE.Vector3;
}

const defaultTickRadians = Math.PI / 32768;

const ps2ToGltfBasisMatrix = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, -1, 0, 0,
  0, 0, 0, 1
);
const gltfToPs2BasisMatrix = ps2ToGltfBasisMatrix.clone().invert();
const shellAnimationEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const shellAnimationQuaternion = new THREE.Quaternion();
const shellSourceRotationMatrix = new THREE.Matrix4();
const shellGltfRotationMatrix = new THREE.Matrix4();

export function buildSkyboxAnimations(root: THREE.Object3D): SkyboxShellAnimation[] {
  const animations: SkyboxShellAnimation[] = [];

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    const data = skyboxPrimitiveData(mesh);
    const sourceInitial = readVector3(data.SkyboxShellRotationRaw);
    const sourceVelocity = readVector3(data.SkyboxShellRotationDeltaRaw);
    const initial = readVector3(data.SkyboxShellRotationRadians);
    const velocity = readVector3(data.SkyboxShellAngularVelocityRadiansPerSecond);
    const hasSourceRotationTicks = Array.isArray(data.SkyboxShellRotationRaw)
      || Array.isArray(data.SkyboxShellRotationDeltaRaw);
    const hasInitialRotation = vectorHasValue(sourceInitial) || vectorHasValue(initial);
    const hasRuntimeRotation = vectorHasValue(sourceVelocity) || vectorHasValue(velocity);
    if (!hasInitialRotation && !hasRuntimeRotation) {
      return;
    }

    animations.push({
      object,
      baseQuaternion: object.quaternion.clone(),
      hasSourceRotationTicks,
      sourceInitial,
      sourceVelocity,
      tickRadians: numberExtra(data.SkyboxRotationTickRadians, defaultTickRadians),
      runtimeFrameRate: numberExtra(data.SkyboxRuntimeFrameRate, 60),
      initial,
      velocity
    });
  });

  return animations;
}

export function updateSkyboxAnimations(
  animations: SkyboxShellAnimation[],
  animationStartSeconds: number,
  options: SkyboxRenderOptions,
  nowSeconds = performance.now() / 1000
): void {
  if (animations.length === 0) {
    return;
  }

  const speed = options.animationEnabled ? Math.max(0, options.animationSpeed) : 0;
  const elapsed = Math.max(nowSeconds - animationStartSeconds, 0) * speed;
  for (const animation of animations) {
    if (animation.hasSourceRotationTicks) {
      const frameCount = elapsed * animation.runtimeFrameRate;
      setGameSkyShellQuaternion(
        shellAnimationQuaternion,
        (animation.sourceInitial.x + animation.sourceVelocity.x * frameCount) * animation.tickRadians,
        (animation.sourceInitial.y + animation.sourceVelocity.y * frameCount) * animation.tickRadians,
        (animation.sourceInitial.z + animation.sourceVelocity.z * frameCount) * animation.tickRadians
      );
    } else {
      shellAnimationEuler.set(
        animation.initial.x + animation.velocity.x * elapsed,
        animation.initial.y + animation.velocity.y * elapsed,
        animation.initial.z + animation.velocity.z * elapsed,
        'XYZ'
      );
      shellAnimationQuaternion.setFromEuler(shellAnimationEuler);
    }

    animation.object.quaternion.copy(animation.baseQuaternion).multiply(shellAnimationQuaternion);
    animation.object.matrixWorldNeedsUpdate = true;
  }
}

function setGameSkyShellQuaternion(target: THREE.Quaternion, x: number, y: number, z: number): void {
  const sx = Math.sin(x);
  const cx = Math.cos(x);
  const sy = Math.sin(y);
  const cy = Math.cos(y);
  const sz = Math.sin(z);
  const cz = Math.cos(z);

  shellSourceRotationMatrix.set(
    cy * cz, -cy * sz, sy, 0,
    cz * sx * sy + cx * sz, cx * cz - sx * sy * sz, -cy * sx, 0,
    -cx * sy * cz + sx * sz, cz * sx + cx * sy * sz, cx * cy, 0,
    0, 0, 0, 1
  );
  shellGltfRotationMatrix
    .copy(ps2ToGltfBasisMatrix)
    .multiply(shellSourceRotationMatrix)
    .multiply(gltfToPs2BasisMatrix);
  target.setFromRotationMatrix(shellGltfRotationMatrix);
}
