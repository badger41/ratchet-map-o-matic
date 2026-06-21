import * as THREE from 'three/webgpu';
import {
  attribute,
  float,
  texture,
  vec2,
  vertexStage
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { tieAmbientPackedColor } from '../../../../services/mapPackages/tiePackageParsers';
import { getTieAmbientAttribute } from './TieClassSource';
import {
  tieAmbientAttributeName,
  tieAmbientInstanceRowAttributeName,
  tieAmbientPs2NeutralByte,
  type PreparedTieRecord,
  type TieAmbientColorRecipe,
  type TieAmbientTextureBinding,
  type TiePrimitive
} from './TieTypes';
import { clampByte } from './tieUtils';

export function createTieAmbientTextureBinding(
  records: PreparedTieRecord[],
  primitive: TiePrimitive
): TieAmbientTextureBinding | null {
  if (primitive.isGlowOverlay || !primitive.hasAmbientAttribute || records.length === 0) {
    return null;
  }

  const ambientIndices = getOrCreateTieAmbientSourceIndices(primitive);
  if (ambientIndices.length === 0 || !records.some((record) => record.colorEntry !== null)) {
    return null;
  }

  const textureResult = createTieAmbientTexture(records, ambientIndices, primitive.ambientColorRecipes);
  return {
    texture: textureResult.texture,
    wordCount: ambientIndices.length,
    instanceCount: records.length,
    recipeCount: primitive.ambientColorRecipes.length,
    recipeSamples: textureResult.recipeSamples,
    validSamples: textureResult.validSamples,
    rowByRecord: createTieAmbientRowMap(records),
    statsCounted: false
  };
}

export function createTieAmbientRowAttribute(
  records: PreparedTieRecord[],
  binding: TieAmbientTextureBinding
): Float32Array {
  const rows = new Float32Array(records.length);
  for (let index = 0; index < records.length; index += 1) {
    rows[index] = binding.rowByRecord.get(records[index]) ?? 0;
  }

  return rows;
}

export function createTieAmbientRawColorNode(
  ambientBinding: TieAmbientTextureBinding
): Node<'vec3'> {
  const ambientIndex = attribute<'float'>(tieAmbientAttributeName, 'float');
  const ambientRow = attribute<'float'>(tieAmbientInstanceRowAttributeName, 'float');
  const ambientUv = vec2(
    ambientIndex.add(float(0.5)).div(float(ambientBinding.wordCount)).clamp(0, 1),
    ambientRow.add(float(0.5)).div(float(ambientBinding.instanceCount)).clamp(0, 1)
  );
  return vertexStage(texture(ambientBinding.texture, ambientUv).rgb);
}

function createTieAmbientRowMap(records: PreparedTieRecord[]): WeakMap<PreparedTieRecord, number> {
  const rowByRecord = new WeakMap<PreparedTieRecord, number>();
  for (let index = 0; index < records.length; index += 1) {
    rowByRecord.set(records[index], index);
  }

  return rowByRecord;
}

function getOrCreateTieAmbientSourceIndices(primitive: TiePrimitive): number[] {
  if (primitive.ambientSourceIndices) {
    return primitive.ambientSourceIndices;
  }

  const ambientAttribute = getTieAmbientAttribute(primitive.geometry);
  if (!ambientAttribute) {
    primitive.ambientSourceIndices = [];
    return primitive.ambientSourceIndices;
  }

  primitive.ambientSourceIndices = compactTieAmbientAttribute(primitive.geometry, ambientAttribute);
  return primitive.ambientSourceIndices;
}

function compactTieAmbientAttribute(
  geometry: THREE.BufferGeometry,
  ambientAttribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute
): number[] {
  const compactBySourceIndex = new Map<number, number>();
  const sourceIndices: number[] = [];
  const compactValues = new Float32Array(ambientAttribute.count);

  for (let index = 0; index < ambientAttribute.count; index += 1) {
    const sourceIndex = Math.floor(Math.max(readAttributeX(ambientAttribute, index), 0) + 0.5);
    if (!Number.isFinite(sourceIndex)) {
      compactValues[index] = 0;
      continue;
    }

    let compactIndex = compactBySourceIndex.get(sourceIndex);
    if (compactIndex === undefined) {
      compactIndex = sourceIndices.length;
      compactBySourceIndex.set(sourceIndex, compactIndex);
      sourceIndices.push(sourceIndex);
    }

    compactValues[index] = compactIndex;
  }

  geometry.setAttribute(tieAmbientAttributeName, new THREE.BufferAttribute(compactValues, 1));
  return sourceIndices;
}

function readAttributeX(
  attributeValue: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number
): number {
  return Number(attributeValue.getX(index) ?? 0);
}

function createTieAmbientTexture(
  records: PreparedTieRecord[],
  ambientIndices: number[],
  recipes: TieAmbientColorRecipe[]
): { texture: THREE.DataTexture; recipeSamples: number; validSamples: number } {
  const width = Math.max(1, ambientIndices.length);
  const height = Math.max(1, records.length);
  const data = new Uint8Array(width * height * 4);
  const recipeByTargetIndex = buildTieAmbientRecipeMap(recipes);
  let recipeSamples = 0;
  let validSamples = 0;

  for (let y = 0; y < height; y += 1) {
    const words = records[y]?.colorEntry?.words ?? [];
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const sourceIndex = ambientIndices[x] ?? 0;
      const recipe = recipeByTargetIndex.get(sourceIndex);
      const color = recipe
        ? tieAmbientRecipeColor(words, recipe)
        : tieAmbientPackedColor(words, sourceIndex);

      if (recipe) {
        recipeSamples += 1;
      }

      if (color.valid) {
        validSamples += 1;
      }

      data[offset] = color.r;
      data[offset + 1] = color.g;
      data[offset + 2] = color.b;
      data[offset + 3] = color.valid ? 255 : 0;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  const firstRecord = records[0]?.source;
  texture.name = `tie_ambient_${firstRecord ? `${firstRecord.classId}_${firstRecord.index}` : 'empty'}_${width}x${height}`;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return { texture, recipeSamples, validSamples };
}

function buildTieAmbientRecipeMap(recipes: TieAmbientColorRecipe[]): Map<number, TieAmbientColorRecipe> {
  const map = new Map<number, TieAmbientColorRecipe>();
  for (const recipe of recipes) {
    if (!Number.isFinite(recipe.targetIndex)) {
      continue;
    }

    map.set(Math.floor(recipe.targetIndex), recipe);
  }

  return map;
}

function tieAmbientRecipeColor(
  words: number[],
  recipe: TieAmbientColorRecipe
): { r: number; g: number; b: number; valid: boolean } {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const sourceIndex of recipe.sourceIndices) {
    const color = tieAmbientPackedColor(words, sourceIndex);
    if (!color.valid) {
      return tieAmbientNeutralPackedColor(false);
    }

    r += color.r;
    g += color.g;
    b += color.b;
  }

  const divisor = Math.max(1, Math.floor(recipe.divisor || recipe.sourceIndices.length || 1));
  return {
    r: clampByte(r / divisor),
    g: clampByte(g / divisor),
    b: clampByte(b / divisor),
    valid: true
  };
}

function tieAmbientNeutralPackedColor(valid: boolean): { r: number; g: number; b: number; valid: boolean } {
  return {
    r: tieAmbientPs2NeutralByte,
    g: tieAmbientPs2NeutralByte,
    b: tieAmbientPs2NeutralByte,
    valid
  };
}
