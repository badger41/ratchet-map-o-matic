import * as THREE from 'three/webgpu';

export function createShrubLightBasisInstanceAttributes(
  records: Array<{ instanceMatrix: THREE.Matrix4 }>,
  primitiveMatrix: THREE.Matrix4
): {
  x: THREE.InstancedBufferAttribute;
  y: THREE.InstancedBufferAttribute;
  z: THREE.InstancedBufferAttribute;
} {
  const x = new Float32Array(records.length * 3);
  const y = new Float32Array(records.length * 3);
  const z = new Float32Array(records.length * 3);
  const matrix = new THREE.Matrix4();

  for (let index = 0; index < records.length; index += 1) {
    matrix.multiplyMatrices(records[index].instanceMatrix, primitiveMatrix);
    const elements = matrix.elements;
    const offset = index * 3;
    writeNormalizedBasis(x, offset, elements[0], elements[1], elements[2]);
    writeNormalizedBasis(y, offset, elements[4], elements[5], elements[6]);
    writeNormalizedBasis(z, offset, elements[8], elements[9], elements[10]);
  }

  return {
    x: new THREE.InstancedBufferAttribute(x, 3),
    y: new THREE.InstancedBufferAttribute(y, 3),
    z: new THREE.InstancedBufferAttribute(z, 3)
  };
}

function writeNormalizedBasis(target: Float32Array, offset: number, x: number, y: number, z: number): void {
  const inverseLength = 1 / Math.max(Math.hypot(x, y, z), 0.000001);
  target[offset] = x * inverseLength;
  target[offset + 1] = y * inverseLength;
  target[offset + 2] = z * inverseLength;
}
