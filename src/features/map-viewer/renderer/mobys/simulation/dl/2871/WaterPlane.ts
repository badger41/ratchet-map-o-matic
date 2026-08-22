import * as THREE from 'three/webgpu';
import {
  dirnamePackagePath,
  joinPackagePath
} from '../../../../../../../services/mapAssets/mapAssetPackage';
import type { DlMobyInstance } from '../../../../../../../services/wasm/ratchetPs2Wasm';
import { ps2ToGltfBasisMatrix } from '../../../../shrubs/ShrubTypes';
import {
  MobyClass,
  type MobyClassContext,
  type MobyClassFrame,
  type MobyClassUpdate
} from '../../MobyClass';
import {
  createWaterPatchGeometry,
  updateWaterPatchMesh,
  waterPlaneSize
} from './WaterPlaneGeometry';
import {
  colorByteScale,
  createWaterLayerMaterial,
  createWaterUnderlayMaterial,
  ps2FullOpacityAlphaByte,
  setWaterPlaneViewDirection,
  setWaterPlaneTimeSeconds,
  type WaterColor,
  type WaterFog,
  type WaterWaveComponent,
  type WaterWaveSettings
} from './WaterPlaneMaterial';
import { createWaterWaveComponents } from './WaterWaves';
import {
  resolveWaterSurfaceHeight,
  setWaterSurface,
  waterRenderOrder
} from '../../../../WaterSurfacePass';

export {
  defaultWaterPlaneDebugOptions,
  setWaterPlaneDebugOptions,
  type WaterPlaneDebugOptions
} from './WaterPlaneMaterial';

export const waterPlaneMobyClassId = 2871;

interface WaterPvar {
  overlayFxTexId: number;
  underlayFxTexId: number;
  overlayTiling: number;
  overlayDirection: number;
  overlaySpeed: number;
  overlayAdditive: boolean;
  underlayColor: WaterColor;
  overlayColor: WaterColor;
  fog: WaterFog | null;
  waves: WaterWaveSettings;
  posZ: number;
}

interface WaterLayer {
  object: THREE.Mesh;
  configIndex: number;
  texture: THREE.Texture | null;
  textureMode: WaterTextureMode;
  direction: THREE.Vector2;
  speed: number;
  tileSize: number;
}

interface FxTextureManifest {
  Textures?: Array<{
    Index?: unknown;
    Path?: unknown;
  }>;
}

type WaterTextureMode = 'none' | 'world' | 'worldUnderlay';

const dlFxLevelTextureBaseId = 0x62;
const uyaFxLevelTextureBaseId = dlFxLevelTextureBaseId + 2;
const waterPvarByteLength = 0x70;
const waterOverlayAlphaEnableThreshold = 0x10;
const waterFogIntensityScale = 1 / 100;

export class WaterPlaneMobyClass extends MobyClass {
  private readonly layers: WaterLayer[] = [];
  private readonly ps2Position = new THREE.Vector3();
  private readonly viewerPosition = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();
  private readonly waterPatchForward = new THREE.Vector2(0, 1);
  private elapsedSeconds = 0;
  private readonly surfaceY: number | null;

  static async create(context: MobyClassContext): Promise<WaterPlaneMobyClass | null> {
    const configs = context.instances
      .map((instance) => parseWaterPvar(instance))
      .filter((config): config is WaterPvar => config !== null);
    if (configs.length === 0) {
      return null;
    }

    const textureUrls = await loadFxTextureUrls(context);
    const water = new WaterPlaneMobyClass(context, configs);
    await water.loadLayers(textureUrls, fxLevelTextureBaseIdForGame(context.mapPackage.rootManifest.Game));
    if (water.layers.length === 0) {
      water.dispose();
      return null;
    }

    water.context.mobyController.setClassVisible(waterPlaneMobyClassId, false);
    return water;
  }

  private constructor(
    context: MobyClassContext,
    private readonly configs: WaterPvar[]
  ) {
    super(context, waterPlaneMobyClassId);
    this.surfaceY = resolveWaterSurfaceHeight(configs.map(getWaterRenderPosZ));
    this.group.renderOrder = waterRenderOrder;
  }

  override setEnabled(enabled: boolean): void {
    super.setEnabled(enabled);
    setWaterSurface(this.surfaceY, enabled);
    this.context.mobyController.setClassVisible(waterPlaneMobyClassId, !enabled);
  }

  override update(update: MobyClassUpdate): void {
    this.elapsedSeconds += update.stepSeconds;
    setWaterPlaneTimeSeconds(this.elapsedSeconds);
  }

  override render(_frame: MobyClassFrame): void {
    this.updateWaterPatchBasis();
    setWaterPlaneViewDirection(this.waterPatchForward.x, this.waterPatchForward.y);
    let updatedGeometry: THREE.BufferGeometry | null = null;
    for (const layer of this.layers) {
      const config = this.configs[layer.configIndex];
      if (layer.object.geometry !== updatedGeometry) {
        this.ps2Position.set(this.context.camera.position.x, -this.context.camera.position.z, getWaterRenderPosZ(config));
        this.viewerPosition.copy(this.ps2Position).applyMatrix4(ps2ToGltfBasisMatrix);
        updateWaterPatchMesh(
          layer.object,
          this.context.camera,
          this.viewerPosition.y,
          config.waves.amplitudeSum
        );
        updatedGeometry = layer.object.geometry;
      }
      layer.object.position.copy(this.viewerPosition);
      layer.object.visible = this.context.camera.position.y >= layer.object.position.y;
      if (layer.texture && layer.textureMode === 'world') {
        // DL water VU packet uses overlay UVs in a rotated PS2 basis: u = -Y, v = X.
        const scrollDistance = layer.speed * this.elapsedSeconds;
        layer.texture.offset.set(
          wrapUnit(layer.direction.x * scrollDistance - this.ps2Position.y / layer.tileSize),
          wrapUnit(layer.direction.y * scrollDistance + this.ps2Position.x / layer.tileSize)
        );
      }
    }
  }

  override dispose(): void {
    setWaterSurface(null, false);
    this.context.mobyController.setClassVisible(waterPlaneMobyClassId, true);
    for (const layer of this.layers) {
      layer.texture?.dispose();
    }

    super.dispose();
  }

  private async loadLayers(textureUrls: Map<number, string>, fxLevelTextureBaseId: number): Promise<void> {
    const loader = new THREE.TextureLoader();
    for (let index = 0; index < this.configs.length; index += 1) {
      const config = this.configs[index];
      const underlayTextureUrl = config.underlayFxTexId >= 0
        ? resolveFxTextureUrl(textureUrls, config.underlayFxTexId, fxLevelTextureBaseId)
        : null;
      await this.addLayer({
        config,
        configIndex: index,
        name: underlayTextureUrl ? 'base_underlay' : 'base',
        textureUrl: underlayTextureUrl,
        color: config.underlayColor,
        directionDegrees: 0,
        speed: 0,
        repeatScale: 1,
        textureMode: underlayTextureUrl ? 'worldUnderlay' : 'none',
        additive: false,
        loader
      });
      await this.addLayer({
        config,
        configIndex: index,
        name: 'overlay',
        textureUrl: resolveFxTextureUrl(textureUrls, config.overlayFxTexId, fxLevelTextureBaseId),
        color: config.overlayColor,
        directionDegrees: config.overlayDirection,
        speed: config.overlaySpeed,
        repeatScale: config.overlayTiling,
        textureMode: 'world',
        additive: config.overlayAdditive,
        loader
      });
    }
  }

  private async addLayer({
    config,
    configIndex,
    name,
    textureUrl,
    color,
    directionDegrees,
    speed,
    repeatScale,
    textureMode,
    additive,
    loader
  }: {
    config: WaterPvar;
    configIndex: number;
    name: string;
    textureUrl: string | null;
    color: WaterColor;
    directionDegrees: number;
    speed: number;
    repeatScale: number;
    textureMode: WaterTextureMode;
    additive: boolean;
    loader: THREE.TextureLoader;
  }): Promise<void> {
    if (color.opacity <= 0) {
      return;
    }

    const texture = textureUrl ? await loadTexture(loader, textureUrl) : null;
    const tileSize = finiteNonZero(repeatScale, 1);
    if (texture) {
      if (textureMode === 'world') {
        texture.repeat.setScalar(waterPlaneSize / tileSize);
      } else {
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
      }
    }

    const opacity = color.opacity;
    const materialName = `dl_water_${configIndex}_${name}`;
    const previousLayer = this.layers.at(-1);
    const geometry = previousLayer?.configIndex === configIndex
      ? previousLayer.object.geometry
      : createWaterPatchGeometry();
    const material = textureMode === 'worldUnderlay' && texture
      ? createWaterUnderlayMaterial(materialName, texture, color.color, opacity, config.waves, config.fog)
      : createWaterLayerMaterial({
        name: materialName,
        textureSource: texture,
        color: color.color,
        opacity,
        additive,
        overlay: textureMode === 'world',
        waves: config.waves,
        fog: config.fog
      });
    const object = new THREE.Mesh(geometry, material);
    object.name = materialName;
    object.frustumCulled = false;
    object.rotation.x = -Math.PI / 2;
    object.renderOrder = waterRenderOrder + (textureMode === 'world' ? 1 : 0);
    this.group.add(object);
    this.layers.push({
      object,
      configIndex,
      texture,
      textureMode,
      direction: new THREE.Vector2(
        Math.sin(degreesToRadians(directionDegrees)),
        -Math.cos(degreesToRadians(directionDegrees))
      ),
      speed: finiteNumber(speed, 0) / tileSize,
      tileSize
    });
  }

  private updateWaterPatchBasis(): void {
    this.context.camera.getWorldDirection(this.cameraForward);
    this.cameraForward.y = 0;
    if (this.cameraForward.lengthSq() <= 1e-8) {
      return;
    }

    this.cameraForward.normalize();
    this.waterPatchForward.set(this.cameraForward.x, -this.cameraForward.z);
  }
}

function parseWaterPvar(instance: DlMobyInstance): WaterPvar | null {
  const data = instance.pvar?.data;
  if (!data || data.byteLength < waterPvarByteLength) {
    return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const overlayFxTexId = view.getInt32(0x00, true);
  const underlayFxTexId = view.getInt32(0x04, true);
  return {
    overlayFxTexId: overlayFxTexId >= 0 && view.getUint8(0x33) >= waterOverlayAlphaEnableThreshold ? overlayFxTexId : -1,
    underlayFxTexId,
    overlayTiling: view.getFloat32(0x24, true),
    overlayDirection: view.getFloat32(0x28, true),
    overlaySpeed: view.getFloat32(0x2c, true),
    overlayAdditive: view.getUint8(0x39) !== 0,
    overlayColor: readWaterColor(view, 0x30),
    underlayColor: readWaterColor(view, 0x34),
    fog: readWaterFog(view),
    waves: readWaterWaves(view),
    posZ: view.getFloat32(0x4c, true)
  };
}

function getWaterRenderPosZ(config: WaterPvar): number {
  return config.posZ + config.waves.amplitudeSum;
}

function fxLevelTextureBaseIdForGame(game: unknown): number {
  return typeof game === 'string' && ['GC', 'UYA'].includes(game.toUpperCase())
    ? uyaFxLevelTextureBaseId
    : dlFxLevelTextureBaseId;
}

function resolveFxTextureUrl(textureUrls: Map<number, string>, pvarTextureId: number, fxLevelTextureBaseId: number): string | null {
  return pvarTextureId >= 0 ? textureUrls.get(fxLevelTextureBaseId + pvarTextureId) ?? null : null;
}

function readWaterColor(view: DataView, offset: number): WaterColor {
  const alpha = view.getUint8(offset + 3);
  const color = new THREE.Color(
    view.getUint8(offset) * colorByteScale,
    view.getUint8(offset + 1) * colorByteScale,
    view.getUint8(offset + 2) * colorByteScale
  );

  return {
    color,
    opacity: clamp01(alpha / ps2FullOpacityAlphaByte)
  };
}

function readWaterWaves(view: DataView): WaterWaveSettings {
  const components = createWaterWaveComponents({
    speed: view.getFloat32(0x08, true),
    crest: view.getFloat32(0x0c, true),
    surge: view.getFloat32(0x10, true),
    rippleSize: view.getFloat32(0x14, true),
    directionDegrees: view.getFloat32(0x18, true),
    directionVariation: view.getFloat32(0x1c, true),
    shimmerIntensity: view.getFloat32(0x20, true)
  });
  const slopeNormalization = computeWaterWaveSlopeNormalization(components);
  const maxOverlayByte = Math.max(view.getUint8(0x30), view.getUint8(0x31), view.getUint8(0x32));
  const overlayBrightnessScale = maxOverlayByte < ps2FullOpacityAlphaByte
    ? 1
    : (0xff - maxOverlayByte) / ps2FullOpacityAlphaByte;
  const shimmerThreshold = finiteNumber(view.getFloat32(0x48, true), 0);
  return {
    components,
    amplitudeSum: components.reduce((total, component) => total + component.amplitude, 0),
    shimmerScale: slopeNormalization > 0
      ? overlayBrightnessScale * shimmerThreshold / slopeNormalization
      : 0
  };
}

function computeWaterWaveSlopeNormalization(components: WaterWaveComponent[]): number {
  let slopeX = 0;
  let slopeY = 0;
  for (const component of components) {
    slopeX += component.amplitude * Math.abs(component.waveVector.x);
    slopeY += component.amplitude * Math.abs(component.waveVector.y);
  }

  return Math.sqrt(slopeX * slopeX + slopeY * slopeY);
}

function readWaterFog(view: DataView): WaterFog | null {
  const nearDistance = Math.max(0, finiteNumber(view.getFloat32(0x40, true), 0));
  const farDistance = Math.max(0, finiteNumber(view.getFloat32(0x44, true), 0));
  const nearIntensity = clamp01(view.getUint8(0x3d) * waterFogIntensityScale);
  const farIntensity = clamp01(view.getUint8(0x3e) * waterFogIntensityScale);
  if (farDistance <= nearDistance || (nearIntensity <= 0 && farIntensity <= 0)) {
    return null;
  }

  return {
    color: new THREE.Color(
      view.getUint8(0x3a) * colorByteScale,
      view.getUint8(0x3b) * colorByteScale,
      view.getUint8(0x3c) * colorByteScale
    ).convertSRGBToLinear(),
    nearDistance,
    farDistance,
    nearIntensity,
    farIntensity
  };
}

async function loadFxTextureUrls(context: MobyClassContext): Promise<Map<number, string>> {
  const assetRootPath = dirnamePackagePath(context.mapPackage.assetManifestPath);
  const manifest = await context.mapPackage.assetPackage.readOptionalJson<FxTextureManifest>(
    joinPackagePath(assetRootPath, 'fx/manifest.json')
  );
  const urls = new Map<number, string>();
  for (const entry of manifest?.Textures ?? []) {
    const index = numberValue(entry.Index);
    const path = stringValue(entry.Path);
    if (index === null || !path) {
      continue;
    }

    urls.set(index, await context.mapPackage.assetPackage.resolveUrl(joinPackagePath(assetRootPath, path)));
  }

  return urls;
}

async function loadTexture(loader: THREE.TextureLoader, url: string): Promise<THREE.Texture | null> {
  try {
    const texture = await loader.loadAsync(url);
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.needsUpdate = true;
    return texture;
  } catch {
    return null;
  }
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function finiteNonZero(value: number, fallback: number): number {
  return Number.isFinite(value) && value !== 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(finiteNumber(value, min), min), max);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function degreesToRadians(value: number): number {
  return finiteNumber(value, 0) * Math.PI / 180;
}

function wrapUnit(value: number): number {
  return value - Math.floor(value);
}
