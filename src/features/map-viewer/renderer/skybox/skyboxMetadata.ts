import * as THREE from 'three/webgpu';

export function skyboxPrimitiveData(object: THREE.Mesh): Record<string, unknown> {
  return {
    ...(object.userData || {}),
    ...(object.geometry?.userData || {})
  };
}

export function readVector3(value: unknown): THREE.Vector3 {
  if (Array.isArray(value) && value.length >= 3) {
    return new THREE.Vector3(
      Number(value[0]) || 0,
      Number(value[1]) || 0,
      Number(value[2]) || 0
    );
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return new THREE.Vector3(
      Number(record.X ?? record.x) || 0,
      Number(record.Y ?? record.y) || 0,
      Number(record.Z ?? record.z) || 0
    );
  }

  return new THREE.Vector3();
}

export function vectorHasValue(vector: THREE.Vector3): boolean {
  return vector.lengthSq() > 0.000000000001;
}

export function hasGeometryColorAttribute(object: THREE.Mesh): boolean {
  return Boolean(object.geometry?.getAttribute('color'));
}

export function countGeometryTriangles(geometry: THREE.BufferGeometry): number {
  if (geometry.index) {
    return Math.floor(geometry.index.count / 3);
  }

  const position = geometry.getAttribute('position');
  return position ? Math.floor(position.count / 3) : 0;
}

export function numberExtra(value: unknown, fallback: number): number {
  const parsed = numberValue(value);
  return parsed ?? fallback;
}

export function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
