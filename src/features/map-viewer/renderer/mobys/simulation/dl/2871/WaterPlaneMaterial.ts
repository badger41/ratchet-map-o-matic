import * as THREE from 'three/webgpu';
import {
  abs,
  cameraPosition,
  cos,
  dot,
  float,
  floor,
  length,
  mix,
  modelPosition,
  normalize,
  positionLocal,
  positionView,
  positionWorld,
  reflect,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { applyModelColorGammaNode } from '../../../../ModelFog';
import { createWaterPatchGeometry } from './WaterPlaneGeometry';

export interface WaterPlaneDebugOptions {
  waterUnderlayRingDebugEnabled: boolean;
  waterUnderlaySphereDepth: number;
  waterWaveDirectionOffsetDegrees: number;
  waterUnderlayDarkContrast: number;
  waterUnderlayBrightContrast: number;
  waterUnderlayDarkMinOpacity: number;
  waterColorSaturation: number;
  waterColorContrast: number;
  waterFogStrength: number;
  waterOverlayColorStrength: number;
  waterOverlayOpacityScale: number;
}

export interface WaterWaveSettings {
  components: WaterWaveComponent[];
  amplitudeSum: number;
  shimmerScale: number;
  shimmerThreshold: number;
}

export interface WaterWaveComponent {
  amplitude: number;
  waveVector: THREE.Vector2;
  angularSpeed: number;
  phase: number;
  slopeScale: number;
}

export interface WaterColor {
  color: THREE.Color;
  opacity: number;
}

export interface WaterFog {
  color: THREE.Color;
  nearDistance: number;
  farDistance: number;
  nearIntensity: number;
  farIntensity: number;
}

export const ps2FullOpacityAlphaByte = 0x80;
export const colorByteScale = 1 / 255;
export const waterBackgroundDarkenScale = 0.7;

const defaultWaterUnderlaySphereDepth = 0.3;
const waterUnderlayRingDebugWidth = 2 / 128;
const defaultWaterUnderlayDarkContrast = 1;
const defaultWaterUnderlayBrightContrast = 1;
const waterUnderlayTextureContrastPivot = 0.5;
const defaultWaterUnderlayDarkMinOpacity = 0.45;
const waterShimmerUvScale = 0.06;
const waterShimmerMaxUvOffset = 0.095;
const waterShimmerLightScale = 0.34;
const waterShimmerMinLight = 0.6;
const waterShimmerMaxLight = 1.42;
const defaultWaterColorSaturation = 1;
const defaultWaterColorContrast = 1;
const defaultWaterFogStrength = 1;
const waterColorContrastPivot = 0.12;
const defaultWaterOverlayColorStrength = 1;
const waterOverlayUnderlayTint = 0;
const defaultWaterOverlayOpacityScale = 0.25;
const defaultWaterWorldLift = 2.4;
const waterWaveHeightScale = 1;

export const defaultWaterPlaneDebugOptions: WaterPlaneDebugOptions = {
  waterUnderlayRingDebugEnabled: false,
  waterUnderlaySphereDepth: defaultWaterUnderlaySphereDepth,
  waterWaveDirectionOffsetDegrees: 0,
  waterUnderlayDarkContrast: defaultWaterUnderlayDarkContrast,
  waterUnderlayBrightContrast: defaultWaterUnderlayBrightContrast,
  waterUnderlayDarkMinOpacity: defaultWaterUnderlayDarkMinOpacity,
  waterColorSaturation: defaultWaterColorSaturation,
  waterColorContrast: defaultWaterColorContrast,
  waterFogStrength: defaultWaterFogStrength,
  waterOverlayColorStrength: defaultWaterOverlayColorStrength,
  waterOverlayOpacityScale: defaultWaterOverlayOpacityScale
};

const waterUnderlayRingDebugEnabled = uniform(defaultWaterPlaneDebugOptions.waterUnderlayRingDebugEnabled ? 1 : 0);
const waterUnderlaySphereDepth = uniform(defaultWaterPlaneDebugOptions.waterUnderlaySphereDepth);
const waterWaveDirectionOffsetRadians = uniform(degreesToRadians(defaultWaterPlaneDebugOptions.waterWaveDirectionOffsetDegrees));
const waterUnderlayDarkContrast = uniform(defaultWaterPlaneDebugOptions.waterUnderlayDarkContrast);
const waterUnderlayBrightContrast = uniform(defaultWaterPlaneDebugOptions.waterUnderlayBrightContrast);
const waterUnderlayDarkMinOpacity = uniform(defaultWaterPlaneDebugOptions.waterUnderlayDarkMinOpacity);
const waterColorSaturation = uniform(defaultWaterPlaneDebugOptions.waterColorSaturation);
const waterColorContrast = uniform(defaultWaterPlaneDebugOptions.waterColorContrast);
const waterFogStrength = uniform(defaultWaterPlaneDebugOptions.waterFogStrength);
const waterOverlayColorStrength = uniform(defaultWaterPlaneDebugOptions.waterOverlayColorStrength);
const waterOverlayOpacityScale = uniform(defaultWaterPlaneDebugOptions.waterOverlayOpacityScale);
const waterWorldLiftInverse = uniform(1 / defaultWaterWorldLift);
const waterTimeSeconds = uniform(0);

export function setWaterPlaneDebugOptions(options: Partial<WaterPlaneDebugOptions> & { worldDisplayLift?: number }): void {
  waterUnderlayRingDebugEnabled.value = options.waterUnderlayRingDebugEnabled === true ? 1 : 0;
  waterUnderlaySphereDepth.value = finiteNumber(
    options.waterUnderlaySphereDepth ?? defaultWaterUnderlaySphereDepth,
    defaultWaterUnderlaySphereDepth
  );
  waterWaveDirectionOffsetRadians.value = degreesToRadians(
    finiteNumber(options.waterWaveDirectionOffsetDegrees ?? defaultWaterPlaneDebugOptions.waterWaveDirectionOffsetDegrees, defaultWaterPlaneDebugOptions.waterWaveDirectionOffsetDegrees)
  );
  waterUnderlayDarkContrast.value = finiteNonNegative(options.waterUnderlayDarkContrast, defaultWaterPlaneDebugOptions.waterUnderlayDarkContrast);
  waterUnderlayBrightContrast.value = finiteNonNegative(options.waterUnderlayBrightContrast, defaultWaterPlaneDebugOptions.waterUnderlayBrightContrast);
  waterUnderlayDarkMinOpacity.value = clamp01(finiteNumber(options.waterUnderlayDarkMinOpacity ?? defaultWaterPlaneDebugOptions.waterUnderlayDarkMinOpacity, defaultWaterPlaneDebugOptions.waterUnderlayDarkMinOpacity));
  waterColorSaturation.value = finiteNonNegative(options.waterColorSaturation, defaultWaterPlaneDebugOptions.waterColorSaturation);
  waterColorContrast.value = finiteNonNegative(options.waterColorContrast, defaultWaterPlaneDebugOptions.waterColorContrast);
  waterFogStrength.value = finiteNonNegative(options.waterFogStrength, defaultWaterPlaneDebugOptions.waterFogStrength);
  waterOverlayColorStrength.value = finiteNonNegative(options.waterOverlayColorStrength, defaultWaterPlaneDebugOptions.waterOverlayColorStrength);
  waterOverlayOpacityScale.value = finiteNonNegative(options.waterOverlayOpacityScale, defaultWaterPlaneDebugOptions.waterOverlayOpacityScale);
  const lift = finiteNumber(options.worldDisplayLift ?? defaultWaterWorldLift, defaultWaterWorldLift);
  waterWorldLiftInverse.value = lift > 0 ? 1 / lift : 1;
}

export function setWaterPlaneTimeSeconds(seconds: number): void {
  waterTimeSeconds.value = seconds;
}

export function createWaterUnderlayObject(
  name: string,
  textureSource: THREE.Texture,
  color: THREE.Color,
  opacity: number,
  waves: WaterWaveSettings,
  fog: WaterFog | null
): THREE.Mesh {
  const material = createWaterUnderlayMaterial(name, textureSource, color, opacity, waves, fog);
  const mesh = new THREE.Mesh(createWaterPatchGeometry(), material);
  mesh.name = material.name;
  mesh.frustumCulled = false;
  return mesh;
}

export function createWaterBackgroundDarkenObject(
  name: string,
  opacity: number,
  waves: WaterWaveSettings
): THREE.Mesh {
  const material = new THREE.MeshBasicNodeMaterial({
    name,
    color: 0x000000,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  material.positionNode = createWaterWavePositionNode(waves);
  material.opacityNode = float(opacity);
  material.colorNode = vec3(0);
  const mesh = new THREE.Mesh(createWaterPatchGeometry(), material);
  mesh.name = material.name;
  mesh.frustumCulled = false;
  return mesh;
}

function createWaterUnderlayMaterial(
  name: string,
  textureSource: THREE.Texture,
  color: THREE.Color,
  opacity: number,
  waves: WaterWaveSettings,
  fog: WaterFog | null
): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    name,
    color,
    transparent: true,
    opacity,
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  material.positionNode = createWaterWavePositionNode(waves);
  const baseColor = vec3(color.r, color.g, color.b);
  const underlaySample = texture(textureSource, createWaterUnderlayUv(waves));
  const underlayAlpha = underlaySample.a
    .div(float(ps2FullOpacityAlphaByte * colorByteScale))
    .clamp(0, 1);
  const underlayTextureColor = applyWaterUnderlayTextureContrastNode(
    underlaySample.rgb,
    underlayAlpha
  );
  const waterColor = mix(
    applyWaterPs2ColorNode(baseColor),
    applyWaterPs2TextureModulateNode(underlayTextureColor, baseColor),
    underlayAlpha
  );
  const waveColor = applyWaterWaveColorNode(waterColor, waves);
  material.colorNode = mix(applyWaterDisplayNode(applyWaterFogNode(waveColor, fog)), vec3(1, 0.55, 0), createWaterUnderlayRingDebugMask());
  return material;
}

export function createWaterLayerMaterial({
  name,
  textureSource,
  color,
  opacity,
  transparent,
  additive,
  polygonOffset,
  underlayColor,
  waves,
  fog
}: {
  name: string;
  textureSource: THREE.Texture | null;
  color: THREE.Color;
  opacity: number;
  transparent: boolean;
  additive: boolean;
  polygonOffset: boolean;
  underlayColor: THREE.Color | null;
  waves: WaterWaveSettings;
  fog: WaterFog | null;
}): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    name,
    color,
    transparent,
    opacity,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: true,
    polygonOffset,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  material.positionNode = createWaterWavePositionNode(waves);
  const baseColor = vec3(color.r, color.g, color.b);
  const layerTint = polygonOffset && underlayColor
    ? mix(baseColor, vec3(underlayColor.r, underlayColor.g, underlayColor.b), float(waterOverlayUnderlayTint))
    : baseColor;
  const textureSample = textureSource ? texture(textureSource) : null;
  const layerColor = textureSample
    ? polygonOffset
      ? additive
        ? applyWaterPs2TextureRgbNode(textureSample.rgb)
        : applyWaterPs2TextureModulateNode(applyWaterPs2TextureRgbNode(textureSample.rgb), layerTint)
      : applyWaterPs2TextureModulateNode(applyWaterPs2TextureRgbNode(textureSample.rgb), layerTint)
    : applyWaterPs2ColorNode(layerTint);
  const waveLayerColor = applyWaterWaveColorNode(layerColor, waves);
  material.colorNode = polygonOffset
    ? applyWaterFogNode(waveLayerColor.mul(waterOverlayColorStrength), fog)
    : applyWaterDisplayNode(applyWaterFogNode(waveLayerColor, fog));
  if (textureSample) {
    const overlayOpacityScale = additive
      ? waterOverlayOpacityScale
        .mul(dot(layerTint, vec3(0.299, 0.587, 0.114)))
        .mul(float(ps2FullOpacityAlphaByte / 255))
      : waterOverlayOpacityScale;
    material.opacityNode = polygonOffset
      ? float(opacity)
        .mul(overlayOpacityScale)
        .clamp(0, 1)
      : textureSample.a
        .div(float(ps2FullOpacityAlphaByte * colorByteScale))
        .mul(float(opacity))
        .clamp(0, 1);
  }

  return material;
}

function createWaterWavePositionNode(waves: WaterWaveSettings): Node<'vec3'> {
  if (waves.components.length === 0) {
    return positionLocal;
  }

  return positionLocal.add(vec3(0, 0, createWaterWaveHeightNode(waves).mul(float(waterWaveHeightScale))));
}

function applyWaterWaveColorNode(colorNode: Node<'vec3'>, waves: WaterWaveSettings): Node<'vec3'> {
  if (waves.components.length === 0 || waves.amplitudeSum <= 0) {
    return colorNode;
  }

  const waveAmount = createWaterWaveHeightNode(waves)
    .div(float(waves.amplitudeSum))
    .mul(float(0.5))
    .add(float(0.5))
    .clamp(0, 1);
  return colorNode
    .mul(mix(float(0.92), float(1.08), waveAmount))
    .mul(createWaterWaveLightNode(waves));
}

function createWaterWaveHeightNode(waves: WaterWaveSettings): Node<'float'> {
  const ps2X = modelPosition.x.add(positionLocal.x);
  const ps2Y = modelPosition.z.negate().add(positionLocal.y);
  let heightNode: Node<'float'> = float(0);
  for (const component of waves.components) {
    const waveVector = createWaterWaveVectorNode(component);
    const phase = ps2X.mul(waveVector.x)
      .add(ps2Y.mul(waveVector.y))
      .add(waterTimeSeconds.mul(component.angularSpeed))
      .add(float(component.phase));
    heightNode = heightNode.add(sin(phase).mul(component.amplitude));
  }

  return heightNode;
}

function createWaterWaveUvOffsetNode(waves: WaterWaveSettings): Node<'vec2'> {
  if (waves.shimmerScale <= 0) {
    return vec2(0);
  }

  const slope = createWaterWaveSlopeNode(waves);
  // PS2 Y maps to viewer -Z for the reflected underlay UV.
  return vec2(slope.x, slope.y.negate())
    .mul(float(waves.shimmerScale * waterShimmerUvScale))
    .clamp(-waterShimmerMaxUvOffset, waterShimmerMaxUvOffset);
}

function createWaterWaveLightNode(waves: WaterWaveSettings): Node<'float'> {
  if (waves.shimmerScale <= 0) {
    return float(1);
  }

  const slope = createWaterWaveSlopeNode(waves);
  const viewDirection = normalize(vec2(
    cameraPosition.x.sub(positionWorld.x),
    positionWorld.z.sub(cameraPosition.z)
  ));
  const facingSlope = slope.x.mul(viewDirection.x).add(slope.y.mul(viewDirection.y));
  return facingSlope
    .mul(float(waves.shimmerScale * waterShimmerLightScale))
    .add(float(1))
    .clamp(waterShimmerMinLight, waterShimmerMaxLight);
}

function createWaterWaveSlopeNode(waves: WaterWaveSettings): Node<'vec2'> {
  const ps2X = modelPosition.x.add(positionLocal.x);
  const ps2Y = modelPosition.z.negate().add(positionLocal.y);
  let slopeX: Node<'float'> = float(0);
  let slopeY: Node<'float'> = float(0);
  for (const component of waves.components) {
    const waveVector = createWaterWaveVectorNode(component);
    const phase = ps2X.mul(waveVector.x)
      .add(ps2Y.mul(waveVector.y))
      .add(waterTimeSeconds.mul(component.angularSpeed))
      .add(float(component.phase));
    const slopePhase = cos(phase).mul(component.amplitude * component.slopeScale);
    slopeX = slopeX.add(slopePhase.mul(waveVector.x));
    slopeY = slopeY.add(slopePhase.mul(waveVector.y));
  }

  return vec2(slopeX, slopeY);
}

function createWaterWaveVectorNode(component: WaterWaveComponent): Node<'vec2'> {
  const vectorX = float(component.waveVector.x);
  const vectorY = float(component.waveVector.y);
  const offsetCos = cos(waterWaveDirectionOffsetRadians);
  const offsetSin = sin(waterWaveDirectionOffsetRadians);
  return vec2(
    vectorX.mul(offsetCos).sub(vectorY.mul(offsetSin)),
    vectorX.mul(offsetSin).add(vectorY.mul(offsetCos))
  );
}

function applyWaterFogNode(colorNode: Node<'vec3'>, fog: WaterFog | null): Node<'vec3'> {
  if (!fog || fog.farDistance <= fog.nearDistance || (fog.nearIntensity <= 0 && fog.farIntensity <= 0)) {
    return colorNode;
  }

  const distanceMix = positionView.z.negate()
    .sub(float(fog.nearDistance))
    .div(float(fog.farDistance - fog.nearDistance))
    .clamp(0, 1);
  const fogAmount = mix(float(fog.nearIntensity), float(fog.farIntensity), distanceMix)
    .mul(waterFogStrength)
    .clamp(0, 1);
  const displayColor = applyModelColorGammaNode(colorNode, 1 / 2.2);
  const displayFog = applyModelColorGammaNode(vec3(fog.color.r, fog.color.g, fog.color.b), 1 / 2.2);
  return applyModelColorGammaNode(mix(displayColor, displayFog, fogAmount), 2.2);
}

function applyWaterPs2ColorNode(colorNode: Node<'vec3'>): Node<'vec3'> {
  return applyModelColorGammaNode(colorNode, 2.2);
}

function applyWaterPs2TextureRgbNode(textureColorNode: Node<'vec3'>): Node<'vec3'> {
  return textureColorNode
    .div(float(ps2FullOpacityAlphaByte * colorByteScale))
    .clamp(0, 1);
}

function applyWaterPs2TextureModulateNode(textureColorNode: Node<'vec3'>, colorNode: Node<'vec3'>): Node<'vec3'> {
  return applyModelColorGammaNode(textureColorNode.mul(colorNode).clamp(0, 1), 2.2);
}

function applyWaterUnderlayTextureContrastNode(textureColorNode: Node<'vec3'>, alphaNode: Node<'float'>): Node<'vec3'> {
  const textureLuma = dot(textureColorNode, vec3(0.2126, 0.7152, 0.0722));
  const darkContrastTexture = textureColorNode
    .sub(vec3(waterUnderlayTextureContrastPivot))
    .mul(waterUnderlayDarkContrast)
    .add(vec3(waterUnderlayTextureContrastPivot))
    .clamp(0, 1);
  const brightContrastTexture = textureColorNode
    .sub(vec3(waterUnderlayTextureContrastPivot))
    .mul(waterUnderlayBrightContrast)
    .add(vec3(waterUnderlayTextureContrastPivot))
    .clamp(0, 1);
  const brightWeight = smoothstep(float(waterUnderlayTextureContrastPivot), float(1), textureLuma);
  const darkWeight = float(1)
    .sub(smoothstep(float(0), float(waterUnderlayTextureContrastPivot), textureLuma))
    .mul(smoothstep(waterUnderlayDarkMinOpacity, float(1), alphaNode));
  return mix(mix(textureColorNode, brightContrastTexture, brightWeight), darkContrastTexture, darkWeight);
}

function applyWaterDisplayNode(colorNode: Node<'vec3'>): Node<'vec3'> {
  const luma = dot(colorNode, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(luma), colorNode, waterColorSaturation)
    .sub(vec3(waterColorContrastPivot))
    .mul(waterColorContrast)
    .add(vec3(waterColorContrastPivot))
    .mul(waterWorldLiftInverse)
    .clamp(0, 1);
}

function createWaterUnderlayUv(waves?: WaterWaveSettings): Node<'vec2'> {
  return createWaterUnderlayQuadrantUv(waves);
}

function createWaterUnderlayQuadrantUv(waves?: WaterWaveSettings): Node<'vec2'> {
  const sourceUv = createWaterUnderlaySourceUv()
    .add(waves ? createWaterWaveUvOffsetNode(waves) : vec2(0))
    .clamp(0, 1);
  const scaledUv = sourceUv.mul(float(2));
  const quadrant = floor(scaledUv).clamp(0, 1);
  const localUv = scaledUv.sub(quadrant).clamp(0, 1);
  const rotatedLocalUv = vec2(1).sub(localUv);
  return quadrant.add(rotatedLocalUv).mul(float(0.5)).clamp(0, 1);
}

function createWaterUnderlaySourceUv(): Node<'vec2'> {
  const viewRay = normalize(positionWorld.sub(cameraPosition));
  const reflected = normalize(reflect(viewRay, vec3(0, 1, 0)));
  const reflectedDisk = vec2(reflected.x, reflected.z);
  const radius = length(reflectedDisk).clamp(0, 1);
  return reflectedDisk
    .mul(mix(radius, radius.mul(radius), waterUnderlaySphereDepth))
    .mul(float(0.5))
    .add(vec2(0.5))
    .clamp(0, 1);
}

function createWaterUnderlayRingDebugMask(): Node<'float'> {
  const radius = length(createWaterUnderlaySourceUv().mul(float(2)).sub(vec2(1))).clamp(0, 1);
  const distanceToRing = abs(radius.sub(float(1)));
  return float(1).sub(smoothstep(float(0), float(waterUnderlayRingDebugWidth), distanceToRing))
    .mul(waterUnderlayRingDebugEnabled);
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function degreesToRadians(value: number): number {
  return finiteNumber(value, 0) * Math.PI / 180;
}
