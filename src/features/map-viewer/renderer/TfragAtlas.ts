import * as THREE from 'three/webgpu';

export interface TfragAtlasRegion {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
}

export interface TfragAtlas {
  texture: THREE.CanvasTexture;
  regionsByTexture: Map<string, TfragAtlasRegion>;
}

interface AtlasSource {
  key: string;
  texture: THREE.Texture;
  image: CanvasImageSource;
  width: number;
  height: number;
}

interface AtlasRectInput {
  key: string;
  width: number;
  height: number;
}

interface PackedAtlasRect extends AtlasRectInput {
  x: number;
  y: number;
}

export function createTfragAtlas(root: THREE.Object3D): TfragAtlas | null {
  const sources = collectAtlasSources(root);
  if (sources.length < 2) {
    return null;
  }

  const packed = packTfragAtlasRects(sources);
  const canvas = document.createElement('canvas');
  canvas.width = packed.width;
  canvas.height = packed.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  context.imageSmoothingEnabled = false;

  const sourcesByKey = new Map(sources.map((source) => [source.key, source]));
  const regionsByTexture = new Map<string, TfragAtlasRegion>();
  for (const rect of packed.rects) {
    const source = sourcesByKey.get(rect.key)!;
    drawAtlasSource(context, source, rect.x, rect.y);
    regionsByTexture.set(source.texture.uuid, {
      offsetX: (rect.x + 1) / packed.width,
      offsetY: (rect.y + 1) / packed.height,
      scaleX: source.width / packed.width,
      scaleY: source.height / packed.height
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `tfrag_atlas_${packed.width}x${packed.height}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, regionsByTexture };
}

export function packTfragAtlasRects(inputs: AtlasRectInput[]): {
  width: number;
  height: number;
  rects: PackedAtlasRect[];
} {
  const sorted = [...inputs].sort((left, right) => right.height - left.height || right.width - left.width);
  const totalArea = sorted.reduce((sum, input) => sum + (input.width + 2) * (input.height + 2), 0);
  const largest = sorted.reduce((size, input) => Math.max(size, input.width + 2, input.height + 2), 1);
  const width = Math.max(nextPowerOfTwo(largest), nearestPowerOfTwo(Math.sqrt(totalArea)));
  const packed = packShelves(sorted, width);
  return { width, height: packed.height, rects: packed.rects };
}

export function canRemapTfragAtlasUvs(
  uv: Pick<THREE.BufferAttribute | THREE.InterleavedBufferAttribute, 'count' | 'getX' | 'getY'>
): boolean {
  for (let index = 0; index < uv.count; index += 1) {
    const u = uv.getX(index);
    const v = uv.getY(index);
    if (!Number.isFinite(u) || u < 0 || u > 1 || !Number.isFinite(v) || v < 0 || v > 1) {
      return false;
    }
  }
  return true;
}

export function remapTfragAtlasUv(value: number, offset: number, scale: number): number {
  return offset + value * scale;
}

function collectAtlasSources(root: THREE.Object3D): AtlasSource[] {
  const sources = new Map<string, AtlasSource>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh !== true) {
      return;
    }

    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const map = (material as Partial<THREE.MeshBasicMaterial> | null)?.map ?? null;
    const image = map?.image as { width?: unknown; height?: unknown } | null;
    const width = Number(image?.width);
    const height = Number(image?.height);
    if (!material || material.transparent || material.opacity !== 1 || material.alphaTest !== 0 || !map
      || !Number.isInteger(width) || width <= 0
      || !Number.isInteger(height) || height <= 0
      || !isSupportedWrap(map.wrapS) || !isSupportedWrap(map.wrapT)
      || map.magFilter !== THREE.LinearFilter || map.minFilter !== THREE.LinearFilter
      || map.flipY || map.anisotropy !== 1) {
      return;
    }

    sources.set(map.uuid, {
      key: map.uuid,
      texture: map,
      image: image as CanvasImageSource,
      width,
      height
    });
  });
  return [...sources.values()];
}

function isSupportedWrap(wrap: number): boolean {
  return wrap === THREE.RepeatWrapping || wrap === THREE.ClampToEdgeWrapping;
}

function packShelves(inputs: AtlasRectInput[], widthLimit: number): { height: number; rects: PackedAtlasRect[] } {
  const rects: PackedAtlasRect[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const input of inputs) {
    const width = input.width + 2;
    const height = input.height + 2;
    if (x + width > widthLimit) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }

    rects.push({ ...input, x, y });
    x += width;
    rowHeight = Math.max(rowHeight, height);
  }
  return { height: y + rowHeight, rects };
}

function drawAtlasSource(
  context: CanvasRenderingContext2D,
  source: AtlasSource,
  x: number,
  y: number
): void {
  const { image, texture, width, height } = source;
  const left = texture.wrapS === THREE.RepeatWrapping ? width - 1 : 0;
  const right = texture.wrapS === THREE.RepeatWrapping ? 0 : width - 1;
  const top = texture.wrapT === THREE.RepeatWrapping ? height - 1 : 0;
  const bottom = texture.wrapT === THREE.RepeatWrapping ? 0 : height - 1;
  context.drawImage(image, x + 1, y + 1, width, height);
  context.drawImage(image, 0, top, width, 1, x + 1, y, width, 1);
  context.drawImage(image, 0, bottom, width, 1, x + 1, y + height + 1, width, 1);
  context.drawImage(image, left, 0, 1, height, x, y + 1, 1, height);
  context.drawImage(image, right, 0, 1, height, x + width + 1, y + 1, 1, height);
  context.drawImage(image, left, top, 1, 1, x, y, 1, 1);
  context.drawImage(image, right, top, 1, 1, x + width + 1, y, 1, 1);
  context.drawImage(image, left, bottom, 1, 1, x, y + height + 1, 1, 1);
  context.drawImage(image, right, bottom, 1, 1, x + width + 1, y + height + 1, 1, 1);
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

function nearestPowerOfTwo(value: number): number {
  return 2 ** Math.round(Math.log2(Math.max(1, value)));
}
