import * as THREE from 'three/webgpu';
import {
  attribute,
  float,
  mix,
  texture,
  vec3,
  vec4,
  viewportTexture
} from 'three/tsl';
import type { GameplaySpline } from '../../../../../services/wasm/ratchetPs2Wasm';
import { applyModelColorGammaNode } from '../../ModelFog';
import { aboveWaterRenderOrder } from '../../WaterSurfacePass';
import {
  fxLevelTextureBaseIdForGame,
  loadFxTexture,
  loadFxTextureUrls,
  resolveFxTextureUrl
} from './FxTextures';
import {
  MobyClass,
  type MobyClassContext,
  type MobyClassUpdate
} from './MobyClass';
import {
  advanceWaterTristripOffset,
  createWaterTristripGeometry,
  waterTristripColorPasses,
  type WaterTristripPvar,
  type WaterTristripPvarParser
} from './WaterTristripData';

export const waterTristripMobyClassId = 0x19b0;

interface WaterTristripConfig extends WaterTristripPvar {
  spline: GameplaySpline;
}

interface WaterTristripLayer {
  texture: THREE.Texture;
  direction: readonly [number, number];
  scrollSpeed: number;
  scrollOffsetSpeed: THREE.Vector2;
  oscillationAmplitude: number;
  oscillationPeriodTicks: number;
}

const waterTristripRenderOrder = aboveWaterRenderOrder + 1;

export async function createWaterTristripMobyClass(
  context: MobyClassContext,
  parsePvar: WaterTristripPvarParser
): Promise<MobyClass | null> {
  const splines = new Map(context.splines.map((spline) => [spline.index, spline]));
  const configs = context.instances.flatMap((instance): WaterTristripConfig[] => {
    const pvar = parsePvar(instance.pvar?.data);
    const spline = pvar && splines.get(pvar.splineIndex);
    return pvar && spline && spline.points.length >= 3 ? [{ ...pvar, spline }] : [];
  });
  if (configs.length === 0) {
    return null;
  }

  const water = new WaterTristripMobyClass(context);
  await water.load(
    configs,
    await loadFxTextureUrls(context.mapPackage),
    fxLevelTextureBaseIdForGame(context.mapPackage.rootManifest.Game)
  );
  if (water.group.children.length === 0) {
    water.dispose();
    return null;
  }

  context.mobyController.setClassVisible(waterTristripMobyClassId, false);
  return water;
}

class WaterTristripMobyClass extends MobyClass {
  private readonly layers: WaterTristripLayer[] = [];
  private readonly textures = new Set<THREE.Texture>();
  private readonly namePrefix: string;

  constructor(context: MobyClassContext) {
    super(context, waterTristripMobyClassId);
    const game = context.mapPackage.rootManifest.Game;
    this.namePrefix = `${typeof game === 'string' ? game.toLowerCase() : 'unknown'}_water_tristrip`;
  }

  override setEnabled(enabled: boolean): void {
    super.setEnabled(enabled);
    this.context.mobyController.setClassVisible(waterTristripMobyClassId, !enabled);
  }

  override update(update: MobyClassUpdate): void {
    for (const layer of this.layers) {
      advanceWaterTristripOffset(
        layer.texture.offset,
        layer.direction,
        layer.scrollSpeed,
        layer.scrollOffsetSpeed,
        layer.oscillationAmplitude,
        layer.oscillationPeriodTicks,
        update.tick,
        update.stepSeconds
      );
    }
  }

  override dispose(): void {
    this.context.mobyController.setClassVisible(waterTristripMobyClassId, true);
    for (const texture of this.textures) {
      texture.dispose();
    }
    this.textures.clear();
    super.dispose();
  }

  async load(
    configs: WaterTristripConfig[],
    textureUrls: Map<number, string>,
    fxLevelTextureBaseId: number
  ): Promise<void> {
    const loader = new THREE.TextureLoader();
    for (const [configIndex, config] of configs.entries()) {
      this.addMesh(
        `${this.namePrefix}_${configIndex}_underlay`,
        createWaterTristripGeometry(
          config.spline,
          1,
          1,
          config.directionalFadeStart,
          config.directionalFadeEnd
        ),
        createWaterTristripMaterial(
          `${this.namePrefix}_${configIndex}_underlay`,
          null,
          null,
          config.underlayColor.color,
          config.underlayColor.opacity,
          'underlay'
        ),
        waterTristripRenderOrder
      );

      if (config.colorPassCount <= 0) {
        continue;
      }
      const textureUrl = resolveFxTextureUrl(
        textureUrls,
        config.overlayFxTexId,
        fxLevelTextureBaseId
      );
      const sourceTexture = textureUrl ? await loadFxTexture(loader, textureUrl) : null;
      if (!sourceTexture) {
        continue;
      }

      for (const [pass, passConfig] of waterTristripColorPasses
        .slice(0, config.colorPassCount)
        .entries()) {
        const colorTexture = pass === 0 ? sourceTexture : sourceTexture.clone();
        const alphaTexture = sourceTexture.clone();
        alphaTexture.channel = 1;
        colorTexture.needsUpdate = true;
        alphaTexture.needsUpdate = true;
        this.textures.add(colorTexture);
        this.textures.add(alphaTexture);
        const name = `${this.namePrefix}_${configIndex}_overlay_${pass}`;
        this.addMesh(
          name,
          createWaterTristripGeometry(
            config.spline,
            passConfig.uvScale,
            passConfig.alphaUvScale,
            config.directionalFadeStart,
            config.directionalFadeEnd
          ),
          createWaterTristripMaterial(
            name,
            colorTexture,
            alphaTexture,
            config.overlayColor.color,
            config.overlayColor.opacity,
            config.invertOverlayColor ? 'invert' : 'add'
          ),
          waterTristripRenderOrder + (pass + 1) * 0.2
        );
        this.layers.push({
          texture: colorTexture,
          direction: passConfig.direction,
          scrollSpeed: config.scrollSpeed,
          scrollOffsetSpeed: config.scrollOffsetSpeed,
          oscillationAmplitude: config.oscillationAmplitude,
          oscillationPeriodTicks: config.oscillationPeriodTicks
        });
        this.layers.push({
          texture: alphaTexture,
          direction: passConfig.alphaDirection,
          scrollSpeed: config.scrollSpeed,
          scrollOffsetSpeed: config.scrollOffsetSpeed,
          oscillationAmplitude: config.oscillationAmplitude,
          oscillationPeriodTicks: config.oscillationPeriodTicks
        });
      }
    }
  }

  private addMesh(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    renderOrder: number
  ): void {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.renderOrder = renderOrder;
    this.group.add(mesh);
  }
}

function createWaterTristripMaterial(
  name: string,
  textureSource: THREE.Texture | null,
  alphaTextureSource: THREE.Texture | null,
  color: THREE.Color,
  opacity: number,
  blend: 'underlay' | 'add' | 'invert'
): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    name,
    transparent: true,
    blending: THREE.NoBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  const destination = viewportTexture();
  const destinationPs2 = applyModelColorGammaNode(destination.rgb.clamp(0, 1), 1 / 2.2);
  const baseColor = vec3(color.r, color.g, color.b);
  const sourcePs2 = (textureSource ? texture(textureSource).rgb : vec3(1))
    .mul(baseColor).mul(float(0xff / 0x80)).clamp(0, 1);
  const blendAlpha = (alphaTextureSource
    ? texture(alphaTextureSource).a.mul(float(opacity * 0xff / 0x80))
    : float(opacity))
    .mul(attribute('waterTristripFade', 'float'))
    .clamp(0, 1);
  const blendedPs2 = blend === 'underlay'
    ? mix(destinationPs2, sourcePs2, blendAlpha)
    : blend === 'invert'
      ? destinationPs2.add(destinationPs2.sub(sourcePs2).mul(blendAlpha))
      : destinationPs2.add(sourcePs2.mul(blendAlpha));
  const blendedAlpha = blend === 'underlay'
    ? mix(destination.a, float(1), blendAlpha)
    : destination.a.add(blendAlpha);
  material.fragmentNode = vec4(
    applyModelColorGammaNode(blendedPs2.clamp(0, 1), 2.2),
    blendedAlpha.clamp(0, 1)
  );
  return material;
}
