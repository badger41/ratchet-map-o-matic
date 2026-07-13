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
  createWaterBackgroundDarkenObject,
  createWaterLayerMaterial,
  createWaterUnderlayObject,
  ps2FullOpacityAlphaByte,
  setWaterPlaneTimeSeconds,
  waterBackgroundDarkenScale,
  type WaterColor,
  type WaterFog,
  type WaterWaveComponent,
  type WaterWaveSettings
} from './WaterPlaneMaterial';

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
  overlayMipChain: WaterOverlayMipChain;
  underlayColor: WaterColor;
  overlayColor: WaterColor;
  fog: WaterFog | null;
  waves: WaterWaveSettings;
  posZ: number;
}

interface WaterOverlayMipChain {
  // Offsets 0x64-0x69 are signed FX_LEVEL-relative ids for the game's manual overlay mip chain.
  fxTexIds: number[];
  // Offset 0x60 feeds the GS TEX1 K value after the game subtracts its computed texture footprint.
  lodBias: number;
  // Offset 0x6a selects MMIN 5 instead of 4 when nonzero.
  useLinearMipFilter: boolean;
}

interface WaterLayer {
  object: THREE.Mesh;
  configIndex: number;
  texture: THREE.Texture | null;
  textureMode: WaterTextureMode;
  direction: THREE.Vector2;
  scrollOffset: THREE.Vector2;
  speed: number;
  tileSize: number;
  heightOffset: number;
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
const waterPlaneRenderOrder = 1_000_000_000;
const ps2ColorByteScale = 1 / ps2FullOpacityAlphaByte;
const waterOverlayAlphaEnableThreshold = 0x10;
const waterFogIntensityScale = 1 / 100;
const waterWaveComponentCount = 8;
const waterDetailWaveSlopeScale = 1.75;
const waterWaveDirectionSlots = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const waterWaveSizeBlendStep = 0.29166666;
const waterWaveMinWavelength = 0.001;
const waterWaveBaseHeightScale = 0.1;
const waterAnimationSpeedScale = 1.2;
const tau = Math.PI * 2;

export class WaterPlaneMobyClass extends MobyClass {
  private readonly layers: WaterLayer[] = [];
  private readonly ps2Position = new THREE.Vector3();
  private readonly viewerPosition = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();
  private readonly waterPatchRight = new THREE.Vector2(1, 0);
  private readonly waterPatchForward = new THREE.Vector2(0, 1);
  private cameraPitchAmount = 0;
  private waterPatchScale = 1;
  private elapsedSeconds = 0;

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
    super(context, waterPlaneMobyClassId, new THREE.BundleGroup());
    context.root.renderOrder = Math.max(context.root.renderOrder, waterPlaneRenderOrder);
    this.group.renderOrder = waterPlaneRenderOrder;
  }

  override setEnabled(enabled: boolean): void {
    super.setEnabled(enabled);
    this.context.mobyController.setClassVisible(waterPlaneMobyClassId, !enabled);
  }

  override update(update: MobyClassUpdate): void {
    this.elapsedSeconds += update.stepSeconds * waterAnimationSpeedScale;
    setWaterPlaneTimeSeconds(this.elapsedSeconds);
    for (const layer of this.layers) {
      if (!layer.texture) {
        continue;
      }

      layer.scrollOffset.addScaledVector(layer.direction, layer.speed * update.stepSeconds * waterAnimationSpeedScale);
      layer.scrollOffset.x = wrapUnit(layer.scrollOffset.x);
      layer.scrollOffset.y = wrapUnit(layer.scrollOffset.y);
    }
  }

  override render(_frame: MobyClassFrame): void {
    this.updateWaterPatchBasis();
    for (const layer of this.layers) {
      const config = this.configs[layer.configIndex];
      this.ps2Position.set(this.context.camera.position.x, -this.context.camera.position.z, getWaterRenderPosZ(config));
      this.viewerPosition.copy(this.ps2Position).applyMatrix4(ps2ToGltfBasisMatrix);
      this.updateWaterPatchScale(this.viewerPosition.y);
      layer.object.position.copy(this.viewerPosition);
      layer.object.position.y += layer.heightOffset;
      updateWaterPatchMesh(layer.object, this.waterPatchRight, this.waterPatchForward, this.waterPatchScale);
      if (layer.texture && layer.textureMode === 'world') {
        // DL water VU packet uses overlay UVs in a rotated PS2 basis: u = -Y, v = X.
        layer.texture.offset.set(
          wrapUnit(layer.scrollOffset.x - this.ps2Position.y / layer.tileSize),
          wrapUnit(layer.scrollOffset.y + this.ps2Position.x / layer.tileSize)
        );
      }
    }
  }

  override dispose(): void {
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
      this.addBackgroundDarkenLayer(config, index);
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
        yOffset: 0,
        loader
      });
      if (config.overlayFxTexId >= 0) {
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
          yOffset: 0,
          loader
        });
      }
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
    yOffset,
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
    yOffset: number;
    loader: THREE.TextureLoader;
  }): Promise<void> {
    if (color.opacity <= 0) {
      return;
    }

    const texture = textureUrl ? await loadTexture(loader, textureUrl) : null;
    if (textureMode === 'world' && !texture) {
      return;
    }

    const tileSize = Math.max(1, Math.abs(repeatScale));
    if (texture) {
      if (textureMode === 'world') {
        texture.repeat.setScalar(waterPlaneSize / tileSize);
      } else {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.repeat.set(1, 1);
        texture.offset.set(0, 0);
        texture.needsUpdate = true;
      }
    }

    const opacity = color.opacity;
    const transparent = textureMode === 'world' || opacity < 1 || additive;
    const materialName = `dl_water_${configIndex}_${name}`;
    const materialColor = color.color.clone();
    const object = textureMode === 'worldUnderlay' && texture
      ? await createWaterUnderlayObject(materialName, texture, materialColor, opacity, config.waves, config.fog)
      : new THREE.Mesh(createWaterPatchGeometry(), createWaterLayerMaterial({
        name: materialName,
        textureSource: texture,
        color: materialColor,
        opacity,
        transparent,
        additive,
        polygonOffset: textureMode === 'world',
        underlayColor: textureMode === 'world' ? config.underlayColor.color : null,
        waves: config.waves,
        fog: config.fog
      }));
    object.name = materialName;
    object.frustumCulled = false;
    object.rotation.x = -Math.PI / 2;
    object.position.y = config.posZ + yOffset;
    setObjectRenderOrder(object, waterPlaneRenderOrder + (textureMode === 'world' ? 1 : 0));
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
      scrollOffset: new THREE.Vector2(),
      speed: finiteNumber(speed, 0) / tileSize,
      tileSize,
      heightOffset: yOffset
    });
  }

  private addBackgroundDarkenLayer(config: WaterPvar, configIndex: number): void {
    const opacity = clamp01((1 - config.underlayColor.opacity) * waterBackgroundDarkenScale);
    if (opacity <= 0) {
      return;
    }

    const materialName = `dl_water_${configIndex}_background_darken`;
    const object = createWaterBackgroundDarkenObject(materialName, opacity, config.waves);
    object.rotation.x = -Math.PI / 2;
    object.position.y = config.posZ;
    setObjectRenderOrder(object, waterPlaneRenderOrder - 1);
    this.group.add(object);
    this.layers.push({
      object,
      configIndex,
      texture: null,
      textureMode: 'none',
      direction: new THREE.Vector2(),
      scrollOffset: new THREE.Vector2(),
      speed: 0,
      tileSize: 1,
      heightOffset: 0
    });
  }

  private updateWaterPatchBasis(): void {
    this.context.camera.getWorldDirection(this.cameraForward);
    this.cameraPitchAmount = Math.abs(this.cameraForward.y);
    this.cameraForward.y = 0;
    if (this.cameraForward.lengthSq() <= 1e-8) {
      return;
    }

    this.cameraForward.normalize();
    this.waterPatchForward.set(this.cameraForward.x, -this.cameraForward.z);
    this.waterPatchRight.set(-this.cameraForward.z, -this.cameraForward.x);
  }

  private updateWaterPatchScale(waterY: number): void {
    const heightScale = Math.abs(this.context.camera.position.y - waterY) / waterPlaneSize;
    this.waterPatchScale = Math.max(1, 1 + this.cameraPitchAmount * heightScale * 4);
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
    overlayMipChain: readWaterOverlayMipChain(view),
    overlayColor: readWaterColor(view, 0x30, waterOverlayAlphaEnableThreshold),
    underlayColor: readWaterColor(view, 0x34),
    fog: readWaterFog(view),
    waves: readWaterWaves(view),
    posZ: view.getFloat32(0x4c, true)
  };
}

function getWaterRenderPosZ(config: WaterPvar): number {
  // Ghidra computes DAT_002236cc as the summed wave envelope and uses it while building the water draw.
  return config.posZ + config.waves.amplitudeSum * waterWaveBaseHeightScale;
}

function fxLevelTextureBaseIdForGame(game: unknown): number {
  return typeof game === 'string' && game.toUpperCase() === 'UYA'
    ? uyaFxLevelTextureBaseId
    : dlFxLevelTextureBaseId;
}

function resolveFxTextureUrl(textureUrls: Map<number, string>, pvarTextureId: number, fxLevelTextureBaseId: number): string | null {
  return pvarTextureId >= 0 ? textureUrls.get(fxLevelTextureBaseId + pvarTextureId) ?? null : null;
}

function readWaterOverlayMipChain(view: DataView): WaterOverlayMipChain {
  const fxTexIds: number[] = [];
  for (let offset = 0x64; offset <= 0x69; offset += 1) {
    const fxTexId = view.getInt8(offset);
    if (fxTexId < 0) {
      break;
    }

    fxTexIds.push(fxTexId);
  }

  return {
    fxTexIds,
    lodBias: view.getInt32(0x60, true),
    useLinearMipFilter: view.getUint8(0x6a) !== 0
  };
}

function readWaterColor(view: DataView, offset: number, alphaThreshold = 0): WaterColor {
  const alpha = view.getUint8(offset + 3);
  const color = new THREE.Color(
    view.getUint8(offset) * ps2ColorByteScale,
    view.getUint8(offset + 1) * ps2ColorByteScale,
    view.getUint8(offset + 2) * ps2ColorByteScale
  );

  return {
    color,
    opacity: clamp01((alpha - alphaThreshold) / (ps2FullOpacityAlphaByte - alphaThreshold))
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
    amplitudeSum: components.reduce((total, component) => total + Math.abs(component.amplitude), 0),
    shimmerScale: slopeNormalization > 0
      ? Math.max(0, overlayBrightnessScale * shimmerThreshold / slopeNormalization)
      : 0,
    shimmerThreshold
  };
}

function createWaterWaveComponents({
  speed,
  crest,
  surge,
  rippleSize,
  directionDegrees,
  directionVariation,
  shimmerIntensity
}: {
  speed: number;
  crest: number;
  surge: number;
  rippleSize: number;
  directionDegrees: number;
  directionVariation: number;
  shimmerIntensity: number;
}): WaterWaveComponent[] {
  const waveSpeed = finiteNumber(speed, 0);
  const amplitudeScale = finiteNumber(crest, 0);
  const longWavelength = Math.max(waterWaveMinWavelength, Math.abs(finiteNumber(surge, 0)));
  const shortWavelength = Math.max(waterWaveMinWavelength, Math.abs(finiteNumber(rippleSize, 0)));
  if (waveSpeed === 0 || amplitudeScale === 0) {
    return [];
  }

  const geometricMean = Math.sqrt(longWavelength * shortWavelength);
  const sizeBlend = finiteNumber(shimmerIntensity, 0);
  const wavelengths = new Array<number>(waterWaveComponentCount);
  for (let index = 0; index < waterWaveComponentCount; index += 1) {
    wavelengths[index] = index < 4
      ? shortWavelength + (geometricMean - shortWavelength) * sizeBlend * index * waterWaveSizeBlendStep
      : longWavelength + (geometricMean - longWavelength) * sizeBlend * (waterWaveComponentCount - 1 - index) * waterWaveSizeBlendStep;
    wavelengths[index] = Math.max(waterWaveMinWavelength, Math.abs(wavelengths[index]));
  }

  const waveAcceleration = (waveSpeed * tau * waveSpeed * 2)
    / Math.max(waterWaveMinWavelength, shortWavelength + wavelengths[3]);
  return wavelengths.map((wavelength, index) => {
    const direction = degreesToRadians(
      finiteNumber(directionDegrees, 0)
      + finiteNumber(directionVariation, 0) * 45 * (waterWaveDirectionSlots[index] - 3.5)
    );
    return {
      amplitude: wavelength * amplitudeScale,
      waveVector: new THREE.Vector2(
        Math.cos(direction) * tau / wavelength,
        Math.sin(direction) * tau / wavelength
      ),
      angularSpeed: -Math.sqrt(Math.max(0, waveAcceleration * tau / wavelength)),
      phase: index * Math.PI * 0.25,
      slopeScale: index < 4 ? waterDetailWaveSlopeScale : 1
    };
  });
}

function computeWaterWaveSlopeNormalization(components: WaterWaveComponent[]): number {
  let slopeX = 0;
  let slopeY = 0;
  for (const component of components) {
    slopeX += Math.abs(component.amplitude * component.slopeScale * component.waveVector.x);
    slopeY += Math.abs(component.amplitude * component.slopeScale * component.waveVector.y);
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

function setObjectRenderOrder(object: THREE.Mesh, renderOrder: number): void {
  object.renderOrder = renderOrder;
}
