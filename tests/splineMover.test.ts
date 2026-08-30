import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  isSplineMoverSpawnTarget,
  materializeSplineMoverSpawnTargets,
  parseSplineMoverPvar,
  resolveSplineMoverTarget,
  stepSplineMoverAngle
} from '../src/features/map-viewer/renderer/mobys/simulation/dl/5992/SplineMoverData.ts';
import {
  createGameplaySplinePath,
  indexGameplaySplines,
  sampleGameplaySplinePath
} from '../src/features/map-viewer/renderer/mobys/simulation/GameplaySplinePath.ts';
import { lerpWrappedRadians } from '../src/features/map-viewer/renderer/mobys/simulation/SimulationMath.ts';
import type { DlMobyInstance } from '../src/services/wasm/ratchetPs2Wasm.ts';

test('decodes and advances the DL spline mover', () => {
  const pvar = new Uint8Array(0x160);
  const view = new DataView(pvar.buffer);
  view.setInt32(0xe8, 34, true);
  view.setInt32(0x114, -1, true);
  view.setInt32(0x118, 337, true);
  view.setFloat32(0x128, 0.01, true);
  view.setFloat32(0x12c, 0.2, true);
  view.setFloat32(0x130, 12, true);
  view.setInt32(0x13c, 1, true);
  assert.deepEqual(parseSplineMoverPvar(pvar), {
    splineIndex: 34,
    targetMobyClassId: -1,
    targetMobyIndex: 337,
    rotationStiffness: Math.fround(0.01),
    rotationDamping: Math.fround(0.2),
    speed: 12,
    startPointIndex: 1
  });

  const spline = {
    index: 34,
    points: [
      { x: 0, y: 0, z: 0, w: -1 },
      { x: 3, y: 0, z: 0, w: -1 },
      { x: 3, y: 4, z: 0, w: -1 }
    ]
  };
  assert.equal(indexGameplaySplines([spline]).get(34), spline);
  const path = createGameplaySplinePath(spline);
  assert.ok(path);
  const position = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  sampleGameplaySplinePath(path, 1.5, position, tangent);
  assert.ok(Math.abs(Math.atan2(tangent.y, tangent.x) - Math.PI / 4) < 1e-6);
  assert.equal(sampleGameplaySplinePath(path, path.cumulativeDistances[1] + 2, position, tangent), 5);
  assert.deepEqual(position.toArray(), [3, 2, 0]);
  sampleGameplaySplinePath(path, path.length + 1, position, tangent);
  assert.deepEqual(position.toArray(), [1, 0, 0]);
});

test('interpolates and damps rotation across the angle wrap', () => {
  const degrees = THREE.MathUtils.degToRad;
  assert.ok(Math.abs(Math.abs(lerpWrappedRadians(degrees(170), degrees(-170), 0.5)) - Math.PI) < 1e-6);

  const state = { value: degrees(170), velocity: 0 };
  stepSplineMoverAngle(state, degrees(-170), 0.01, 0.2);
  assert.ok(state.velocity > 0);
  assert.ok(state.value > degrees(170));
});

test('materializes class-based spline mover targets', () => {
  const pvar = new Uint8Array(0x160);
  const view = new DataView(pvar.buffer);
  view.setInt32(0x114, 0x212b, true);
  view.setInt32(0x118, -1, true);
  const controller = moby(0x1768, pvar);
  const source = {
    staticCount: 2,
    spawnableMobyCount: 400,
    pad8: 0,
    padC: 0,
    instances: [controller, moby(0x212b)],
    trailingByteLength: 0
  };

  const result = materializeSplineMoverSpawnTargets(source);
  assert.equal(result.instances.length, 3);
  const parsed = parseSplineMoverPvar(controller.pvar?.data);
  assert.ok(parsed);
  assert.equal(resolveSplineMoverTarget(controller, parsed, result.instances), result.instances[2]);
  assert.equal(result.instances[2].classId, 0x212b);
  assert.ok(isSplineMoverSpawnTarget(result.instances[2]));

  const indexedPvar = new Uint8Array(pvar);
  new DataView(indexedPvar.buffer).setInt32(0x118, 3, true);
  const indexedController = moby(0x1768, indexedPvar);
  const indexedTarget = moby(0x269b);
  const indexedParsed = parseSplineMoverPvar(indexedPvar);
  assert.ok(indexedParsed);
  assert.equal(
    resolveSplineMoverTarget(indexedController, indexedParsed, [moby(1), moby(2), indexedController, indexedTarget]),
    indexedTarget
  );
});

function moby(classId: number, pvar?: Uint8Array): DlMobyInstance {
  return {
    size: 0x70,
    mission: 32,
    uid: 1,
    bolts: 0,
    classId,
    scale: 1,
    drawDistance: 64,
    updateDistance: 64,
    unused20: 0,
    unused24: 0,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    group: -1,
    isRooted: 0,
    rootedDistance: 0,
    unused4C: 0,
    pvarIndex: pvar ? 0 : -1,
    occlusion: 0,
    modeBits: 0,
    color: { red: 0, green: 0, blue: 0 },
    light: 0,
    unused6C: 0,
    pvar: pvar ? { index: 0, offset: 0, length: pvar.length, data: pvar } : null
  };
}
