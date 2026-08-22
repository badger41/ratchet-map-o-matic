import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  createWaterPatchGeometry,
  updateWaterPatchMesh
} from '../src/features/map-viewer/renderer/mobys/simulation/dl/2871/WaterPlaneGeometry.ts';
import { createWaterWaveComponents } from '../src/features/map-viewer/renderer/mobys/simulation/dl/2871/WaterWaves.ts';

test('uses the game wave slot order and keeps zero-speed waves', () => {
  const waves = createWaterWaveComponents({
    speed: 0,
    crest: 0.1,
    surge: 16,
    rippleSize: 4,
    directionDegrees: 0,
    directionVariation: 1,
    shimmerIntensity: 0
  });

  assert.deepEqual(
    waves.map(({ waveVector }) => Math.round(Math.atan2(waveVector.y, waveVector.x) * 180 / Math.PI * 10) / 10),
    [-157.5, -67.5, -112.5, -22.5, 112.5, 22.5, 67.5, 157.5]
  );
  assert.deepEqual(waves.map(({ amplitude }) => amplitude), [0.4, 0.4, 0.4, 0.4, 1.6, 1.6, 1.6, 1.6]);
  assert.equal(waves.every(({ angularSpeed }) => angularSpeed === 0), true);
});

test('uses the VU water strip sampling bands', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 10_000);
  camera.position.set(0, 10, 0);
  camera.lookAt(0, 0, -10);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const mesh = new THREE.Mesh(createWaterPatchGeometry());
  updateWaterPatchMesh(mesh, camera, 0, 0);

  const position = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  const waveBank0Scale = mesh.geometry.getAttribute('waterWaveBank0Scale');
  const waveBank1Scale = mesh.geometry.getAttribute('waterWaveBank1Scale');
  const columns = 33;
  const centerColumn = 16;
  const rowDistance = (row: number) => Math.hypot(
    position.getX(row * columns + centerColumn),
    position.getY(row * columns + centerColumn)
  );
  const bottomWidth = position.getX(columns - 1) - position.getX(0);
  const topRow = position.count - columns;
  const topWidth = position.getX(position.count - 1) - position.getX(topRow);
  assert.equal(position.array.every(Number.isFinite), true);
  assert.equal(position.usage, THREE.DynamicDrawUsage);
  assert.equal(uv.usage, THREE.DynamicDrawUsage);
  assert.equal(position.count, columns * 106);
  assert.equal(waveBank1Scale.getX(0), 1);
  assert.equal(waveBank1Scale.getX(25 * columns), 0.5);
  assert.equal(waveBank1Scale.getX(50 * columns), 0);
  assert.equal(waveBank0Scale.getX(50 * columns), 1);
  assert.equal(waveBank0Scale.getX(75 * columns), 0.5);
  assert.equal(waveBank0Scale.getX(100 * columns), 0);
  assert.equal(waveBank0Scale.getX(105 * columns), 0);
  assert.ok(Math.abs(rowDistance(50) - rowDistance(49) - 1) < 1e-3);
  assert.ok(Math.abs(rowDistance(51) - rowDistance(50) - 2) < 1e-3);
  assert.ok(Math.abs(rowDistance(101) - rowDistance(100) - 200) < 1e-3);
  assert.ok(bottomWidth < topWidth / 2);
});

test('covers the viewport when looking straight down', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10_000);
  camera.position.set(0, 10, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const mesh = new THREE.Mesh(createWaterPatchGeometry());
  updateWaterPatchMesh(mesh, camera, 0, 0);

  const position = mesh.geometry.getAttribute('position');
  const projected = new THREE.Vector3();
  let minY = Infinity;
  let maxY = -Infinity;
  for (let row = 0; row < 106; row += 1) {
    const index = row * 33 + 16;
    projected.set(position.getX(index), 0, -position.getY(index)).project(camera);
    minY = Math.min(minY, projected.y);
    maxY = Math.max(maxY, projected.y);
  }

  assert.ok(minY <= -1);
  assert.ok(maxY >= 1);
});

test('keeps the full wave envelope outside the viewport edges', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 10_000);
  camera.position.set(0, 10, 0);
  camera.lookAt(0, 0, -10);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const mesh = new THREE.Mesh(createWaterPatchGeometry());
  updateWaterPatchMesh(mesh, camera, 0, 2);

  const position = mesh.geometry.getAttribute('position');
  const project = (index: number, height: number) => new THREE.Vector3(
    position.getX(index),
    height,
    -position.getY(index)
  ).project(camera);

  assert.ok(project(16, 2).y <= -1 + 1e-6);
  assert.ok(project(0, -2).x <= -1 + 1e-6);
  assert.ok(project(32, -2).x >= 1 - 1e-6);
});
