import * as THREE from 'three/webgpu';
import {
  attribute,
  float,
  texture,
  uniform,
  vec2,
  vertexStage
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import type { DirectionalLightRecord } from '../../../../services/mapPackages/mapPackageTypes';
import { tieAmbientPackedColor } from '../../../../services/mapPackages/tiePackageParsers.ts';
import { getTieAmbientAttribute } from './TieClassSource.ts';
import { applyTieSourceLighting } from './TieLighting.ts';
import {
  tieAmbientAttributeName,
  tieAmbientInstanceRowAttributeName,
  tieAmbientPs2NeutralByte,
  type PreparedTieRecord,
  type TieAmbientColorRecipe,
  type TieAmbientTextureBinding,
  type TiePrimitive
} from './TieTypes.ts';
import { clampByte } from './tieUtils.ts';

export function createTieAmbientTextureBinding(
  records: PreparedTieRecord[],
  primitive: TiePrimitive,
  directionalLights: DirectionalLightRecord[] = []
): TieAmbientTextureBinding | null {
  if (primitive.isGlowOverlay || !primitive.hasAmbientAttribute || records.length === 0) {
    return null;
  }

  const ambientIndices = getOrCreateTieAmbientSourceIndices(primitive);
  if (ambientIndices.length === 0 || !records.some((record) => record.colorEntry !== null)) {
    return null;
  }

  const textureResult = createTieAmbientTexture(records, ambientIndices, primitive, directionalLights);
  return {
    texture: textureResult.texture,
    wordCount: ambientIndices.length,
    instanceCount: records.length,
    recipeCount: primitive.ambientColorRecipes.length,
    recipeSamples: textureResult.recipeSamples,
    validSamples: textureResult.validSamples,
    hasBakedDirectionalLight: textureResult.hasBakedDirectionalLight,
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
  const wordCount = uniform(Math.max(1, ambientBinding.wordCount));
  const instanceCount = uniform(Math.max(1, ambientBinding.instanceCount));
  const ambientUv = vec2(
    ambientIndex.add(float(0.5)).div(wordCount).clamp(0, 1),
    ambientRow.add(float(0.5)).div(instanceCount).clamp(0, 1)
  );
  return vertexStage(texture(ambientBinding.texture, ambientUv).rgb).setInterpolation('linear');
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
  primitive: TiePrimitive,
  directionalLights: DirectionalLightRecord[]
): {
  texture: THREE.DataTexture;
  recipeSamples: number;
  validSamples: number;
  hasBakedDirectionalLight: boolean;
} {
  const width = Math.max(1, ambientIndices.length);
  const height = Math.max(1, records.length);
  const data = new Uint8Array(width * height * 4);
  const recipeByTargetIndex = buildTieAmbientRecipeMap(primitive.ambientColorRecipes);
  const packedSourceCount = Math.max(0, (primitive.ambientWordCount ?? 2) - 2);
  const hasPackedLightData = packedSourceCount > 0
    && primitive.packedLightNormals.length >= packedSourceCount
    && (
      ((primitive.packedLightModeBits ?? 0) & 1) === 0
      || primitive.packedLightScales.length >= packedSourceCount
    );
  const hasBakedDirectionalLight = hasPackedLightData && directionalLights.length > 0;
  let recipeSamples = 0;
  let validSamples = 0;

  for (let y = 0; y < height; y += 1) {
    const record = records[y];
    const words = record?.colorEntry?.words ?? [];
    const resolveSourceColor = (sourceIndex: number) => {
      const color = tieAmbientPackedColor(words, sourceIndex);
      return hasPackedLightData && color.valid && record
        ? applyTieSourceLighting(color, sourceIndex, record, primitive, directionalLights)
        : color;
    };
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const sourceIndex = ambientIndices[x] ?? 0;
      const recipe = recipeByTargetIndex.get(sourceIndex);
      const color = recipe
        ? tieAmbientRecipeColor(recipe, resolveSourceColor)
        : resolveSourceColor(sourceIndex);

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
  return { texture, recipeSamples, validSamples, hasBakedDirectionalLight };
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
  recipe: TieAmbientColorRecipe,
  resolveSourceColor: (sourceIndex: number) => TiePackedColor
): TiePackedColor {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const sourceIndex of recipe.sourceIndices) {
    const color = resolveSourceColor(sourceIndex);
    if (!color.valid) {
      return tieAmbientNeutralPackedColor(false);
    }

    r += color.r;
    g += color.g;
    b += color.b;
  }

  const divisor = Math.max(1, Math.floor(recipe.divisor || recipe.sourceIndices.length || 1));
  return {
    r: clampByte(Math.floor(r / divisor)),
    g: clampByte(Math.floor(g / divisor)),
    b: clampByte(Math.floor(b / divisor)),
    valid: true
  };
}

interface TiePackedColor {
  r: number;
  g: number;
  b: number;
  valid: boolean;
}

function tieAmbientNeutralPackedColor(valid: boolean): TiePackedColor {
  return {
    r: tieAmbientPs2NeutralByte,
    g: tieAmbientPs2NeutralByte,
    b: tieAmbientPs2NeutralByte,
    valid
  };
}
