import * as THREE from 'three/webgpu';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { float, texture, uv, vec3 } from 'three/tsl';
import type { SkyboxRenderOptions } from '../../../../services/mapPackages/mapPackageTypes';

const nightStarRadius = 50;
const nightStarFrameRate = 60;
const ps2FullOpacity = 127;
const ps2FullIntensity = 128;
const nightStarUpdateColor = new THREE.Color();

export interface SkyboxNightStarDefinition {
  textureId: number;
  twinkles: boolean;
  position: readonly [number, number, number];
  size: number;
  rotation: number;
  baseRgb: readonly [number, number, number];
  alpha: number;
  seed: number;
}

interface SkyboxNightStarInstance {
  definition: SkyboxNightStarDefinition;
  mesh: THREE.InstancedMesh;
  index: number;
}

export interface SkyboxNightStars {
  textures: THREE.Texture[];
  twinklers: SkyboxNightStarInstance[];
  meshes: THREE.InstancedMesh[];
  lastTick: number;
}

export async function buildSkyboxNightStars(
  root: THREE.Object3D,
  gltf: GLTF,
  center: THREE.Vector3
): Promise<SkyboxNightStars | null> {
  const config = readNightStarConfig(root);
  if (!config) {
    return null;
  }

  const textures = await Promise.all(config.textureIds.map(async (textureId) => {
    const loaded = await gltf.parser.getDependency('texture', textureId) as THREE.Texture;
    if (!loaded?.isTexture) {
      throw new Error(`Skybox night-star texture ${textureId} did not load`);
    }

    loaded.colorSpace = THREE.NoColorSpace;
    loaded.magFilter = THREE.LinearFilter;
    loaded.minFilter = THREE.LinearFilter;
    loaded.generateMipmaps = false;
    loaded.wrapS = THREE.ClampToEdgeWrapping;
    loaded.wrapT = THREE.ClampToEdgeWrapping;
    loaded.needsUpdate = true;
    return loaded;
  }));
  const definitions = generateSkyboxNightStars(config.count, config.textureIds);
  const definitionsByTexture = new Map(config.textureIds.map((textureId) => [textureId, [] as SkyboxNightStarDefinition[]]));
  for (const definition of definitions) {
    definitionsByTexture.get(definition.textureId)?.push(definition);
  }

  const geometry = new THREE.PlaneGeometry(2, 2);
  const group = new THREE.Group();
  group.name = 'skybox_night_stars';
  group.userData.mapOmaticSkyboxNightStars = true;
  const meshes: THREE.InstancedMesh[] = [];
  const twinklers: SkyboxNightStarInstance[] = [];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  for (const [textureIndex, textureId] of config.textureIds.entries()) {
    const stars = definitionsByTexture.get(textureId) ?? [];
    if (stars.length === 0) {
      continue;
    }

    const material = createNightStarMaterial(textures[textureIndex], textureId);
    const mesh = new THREE.InstancedMesh(geometry, material, stars.length);
    mesh.name = `skybox_night_stars_${String(textureId).padStart(4, '0')}`;
    mesh.renderOrder = 0.5;
    mesh.frustumCulled = false;
    mesh.userData.mapOmaticSkyboxNightStars = true;

    for (const [index, star] of stars.entries()) {
      dummy.position.set(...star.position).add(center);
      dummy.scale.setScalar(star.size);
      dummy.lookAt(center);
      dummy.rotateZ(star.rotation);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      setNightStarColor(color, star, 0);
      mesh.setColorAt(index, color);
      if (star.twinkles) {
        twinklers.push({ definition: star, mesh, index });
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
    meshes.push(mesh);
  }

  root.add(group);
  return { textures, twinklers, meshes, lastTick: 0 };
}

export function updateSkyboxNightStars(
  stars: SkyboxNightStars | null,
  animationStartSeconds: number,
  options: SkyboxRenderOptions,
  nowSeconds: number
): void {
  if (!stars || !options.animationEnabled || options.animationSpeed <= 0) {
    return;
  }

  const tick = Math.max(0, Math.floor((nowSeconds - animationStartSeconds) * nightStarFrameRate * options.animationSpeed));
  if (tick === stars.lastTick) {
    return;
  }

  for (const star of stars.twinklers) {
    setNightStarColor(nightStarUpdateColor, star.definition, tick);
    star.mesh.setColorAt(star.index, nightStarUpdateColor);
  }
  for (const mesh of stars.meshes) {
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  }
  stars.lastTick = tick;
}

export function generateSkyboxNightStars(
  count: number,
  textureIds: readonly number[],
  random: () => number = Math.random
): SkyboxNightStarDefinition[] {
  if (count <= 0 || textureIds.length < 2) {
    return [];
  }

  return Array.from({ length: count }, () => {
    const twinkles = randomInt(random, 2) === 1;
    const size = (randomInt(random, 88) + 56) / 256;
    const textureId = size > 0.4
      ? textureIds[1]
      : textureIds[randomInt(random, 2)];
    const y = random() * 2 - 1;
    const azimuth = random() * Math.PI * 2;
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
    const tint = randomInt(random, 32);
    const baseRgb: [number, number, number] = [0x50, 0x50, 0x50];
    if (randomInt(random, 2) === 0) {
      baseRgb[0] |= tint;
      baseRgb[1] += tint;
    } else {
      baseRgb[2] += tint;
    }

    return {
      textureId,
      twinkles,
      position: [
        horizontal * Math.cos(azimuth) * nightStarRadius,
        y * nightStarRadius,
        horizontal * Math.sin(azimuth) * nightStarRadius
      ],
      size,
      rotation: random() * Math.PI * 2,
      baseRgb,
      alpha: 0x38 + randomInt(random, 0x38),
      seed: Math.floor(random() * 0x100000000) >>> 0
    };
  });
}

export function nightStarRgb(star: SkyboxNightStarDefinition, tick: number): [number, number, number] {
  const alpha = star.alpha / ps2FullOpacity;
  return [
    nightStarChannel(star, tick, 0, alpha),
    nightStarChannel(star, tick, 1, alpha),
    nightStarChannel(star, tick, 2, alpha)
  ];
}

function setNightStarColor(color: THREE.Color, star: SkyboxNightStarDefinition, tick: number): void {
  const alpha = star.alpha / ps2FullOpacity;
  color.setRGB(
    nightStarChannel(star, tick, 0, alpha),
    nightStarChannel(star, tick, 1, alpha),
    nightStarChannel(star, tick, 2, alpha)
  );
}

function nightStarChannel(star: SkyboxNightStarDefinition, tick: number, index: number, alpha: number): number {
  const twinkle = star.twinkles ? hash5(star.seed, tick, index) * 4 - 0x20 : 0;
  return THREE.MathUtils.clamp((star.baseRgb[index] + twinkle) / ps2FullIntensity, 0, 1) * alpha;
}

function createNightStarMaterial(textureSource: THREE.Texture, textureId: number): THREE.MeshBasicNodeMaterial {
  const textureSample = texture(textureSource, uv());
  const material = new THREE.MeshBasicNodeMaterial({
    name: `skybox_night_star_${String(textureId).padStart(4, '0')}`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  material.colorNode = textureSample.rgb;
  Object.assign(material, { emissiveNode: vec3(0) });
  material.opacityNode = textureSample.a.div(float(ps2FullOpacity / 255)).clamp(0, 1);
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.SrcAlphaFactor;
  material.blendDst = THREE.OneFactor;
  material.blendEquationAlpha = THREE.AddEquation;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  material.forceSinglePass = true;
  material.userData.mapOmaticSkyboxAdditiveBlend = true;
  material.userData.mapOmaticSkyboxNightStars = true;
  return material;
}

function readNightStarConfig(root: THREE.Object3D): { count: number; textureIds: number[] } | null {
  let result: { count: number; textureIds: number[] } | null = null;
  root.traverse((object) => {
    if (result) {
      return;
    }

    const rawCount = object.userData?.SkyboxNightSpriteCount;
    const count = typeof rawCount === 'number' && Number.isFinite(rawCount) ? rawCount : null;
    const textureIds = Array.isArray(object.userData?.SkyboxNightSpriteTextureIds)
      ? object.userData.SkyboxNightSpriteTextureIds
        .filter((value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0)
      : [];
    if (count !== null && count > 0 && count <= 16384 && textureIds.length >= 2) {
      result = { count: Math.floor(count), textureIds: textureIds.slice(0, 2) };
    }
  });
  return result;
}

function randomInt(random: () => number, maxExclusive: number): number {
  return Math.floor(random() * maxExclusive);
}

function hash5(seed: number, tick: number, channel: number): number {
  let value = seed ^ Math.imul(tick + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) & 0x1f;
}
