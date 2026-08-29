import * as THREE from 'three/webgpu';
import {
  abs,
  attribute,
  cameraPosition,
  cos,
  dot,
  float,
  length,
  mix,
  modelPosition,
  normalize,
  positionLocal,
  positionView,
  positionWorld,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
  viewportTexture
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { applyModelColorGammaNode } from '../../../../ModelFog';

export interface WaterPlaneDebugOptions {
  waterUnderlayRingDebugEnabled: boolean;
  waterWaveDirectionOffsetDegrees: number;
  waterFogStrength: number;
}

export interface WaterWaveSettings {
  components: WaterWaveComponent[];
  amplitudeSum: number;
  shimmerScale: number;
}

export interface WaterWaveComponent {
  amplitude: number;
  waveVector: THREE.Vector2;
  angularSpeed: number;
  phase: number;
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

interface WaterWaveNodes {
  height: Node<'float'>;
  slope: Node<'vec2'>;
}

export const ps2FullOpacityAlphaByte = 0x80;
export const colorByteScale = 1 / 255;

const ps2TextureModulateScale = 255 / ps2FullOpacityAlphaByte;
// Both GS passes write RGB regardless of sampled alpha; GS ALPHA uses the pvar byte as FIX.
const waterUnderlayRingDebugWidth = 2 / 128;
const defaultWaterFogStrength = 1;

export const defaultWaterPlaneDebugOptions: WaterPlaneDebugOptions = {
  waterUnderlayRingDebugEnabled: false,
  waterWaveDirectionOffsetDegrees: 0,
  waterFogStrength: defaultWaterFogStrength
};

const waterUnderlayRingDebugEnabled = uniform(defaultWaterPlaneDebugOptions.waterUnderlayRingDebugEnabled ? 1 : 0);
const waterWaveDirectionOffsetRadians = uniform(degreesToRadians(defaultWaterPlaneDebugOptions.waterWaveDirectionOffsetDegrees));
const waterFogStrength = uniform(defaultWaterPlaneDebugOptions.waterFogStrength);
const waterTimeSeconds = uniform(0);
const waterViewDirection = uniform(new THREE.Vector2(0, 1));
const waterWaveBank0Scale = attribute<'float'>('waterWaveBank0Scale', 'float');
const waterWaveBank1Scale = attribute<'float'>('waterWaveBank1Scale', 'float');

export function setWaterPlaneDebugOptions(options: Partial<WaterPlaneDebugOptions>): void {
  waterUnderlayRingDebugEnabled.value = options.waterUnderlayRingDebugEnabled === true ? 1 : 0;
  waterWaveDirectionOffsetRadians.value = degreesToRadians(
    finiteNumber(
      options.waterWaveDirectionOffsetDegrees ?? defaultWaterPlaneDebugOptions.waterWaveDirectionOffsetDegrees,
      defaultWaterPlaneDebugOptions.waterWaveDirectionOffsetDegrees
    )
  );
  waterFogStrength.value = finiteNonNegative(options.waterFogStrength, defaultWaterPlaneDebugOptions.waterFogStrength);
}

export function setWaterPlaneTimeSeconds(seconds: number): void {
  waterTimeSeconds.value = seconds;
}

export function setWaterPlaneViewDirection(x: number, y: number): void {
  waterViewDirection.value.set(x, y);
}

export function createWaterUnderlayMaterial(
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
    blending: THREE.NoBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  material.forceSinglePass = true;
  const waveNodes = createWaterWaveNodes(waves);
  material.positionNode = createWaterWavePositionNode(waveNodes);
  const baseColor = vec3(color.r, color.g, color.b);
  const underlayStq = createWaterUnderlayStq(waveNodes);
  const underlayUv = underlayStq.xy.div(underlayStq.z);
  const underlaySample = texture(textureSource, underlayUv);
  const underlayColor = applyWaterPs2TextureModulateNode(
    underlaySample.rgb,
    baseColor
  );
  const layerColor = mix(
    applyWaterFogNode(underlayColor, fog),
    applyWaterPs2ColorNode(vec3(1, 0.55, 0)),
    createWaterUnderlayRingDebugMask(underlayUv)
  );
  // The ocean underlay is a fixed-alpha pass; tristrip GS modes are isolated in 6576.
  setWaterGsOutputNode(material, layerColor, opacity, false);
  return material;
}

export function createWaterLayerMaterial({
  name,
  textureSource,
  color,
  opacity,
  additive,
  overlay,
  waves,
  fog
}: {
  name: string;
  textureSource: THREE.Texture | null;
  color: THREE.Color;
  opacity: number;
  additive: boolean;
  overlay: boolean;
  waves: WaterWaveSettings;
  fog: WaterFog | null;
}): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    name,
    color,
    transparent: true,
    opacity,
    blending: THREE.NoBlending,
    depthWrite: overlay,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  material.forceSinglePass = true;
  const waveNodes = createWaterWaveNodes(waves);
  material.positionNode = createWaterWavePositionNode(waveNodes);
  const baseColor = vec3(color.r, color.g, color.b);
  const vertexColor = overlay
    ? applyWaterOverlayShimmerNode(baseColor, waveNodes, waves.shimmerScale)
    : baseColor;
  const textureSample = textureSource ? texture(textureSource) : null;
  const layerColor = textureSample
    ? applyWaterPs2TextureModulateNode(textureSample.rgb, vertexColor)
    : applyWaterPs2ColorNode(vertexColor);
  setWaterGsOutputNode(material, applyWaterFogNode(layerColor, fog), opacity, additive);
  return material;
}

function setWaterGsOutputNode(
  material: THREE.MeshBasicNodeMaterial,
  sourceColor: Node<'vec3'>,
  opacity: number,
  additive: boolean
): void {
  // The GS blends its encoded 8-bit colors; WebGPU's fixed blend would blend linear values.
  const destination = viewportTexture();
  const destinationPs2 = applyModelColorGammaNode(
    destination.rgb.clamp(0, 1),
    1 / 2.2
  );
  const sourcePs2 = applyModelColorGammaNode(sourceColor, 1 / 2.2);
  const fixedAlpha = float(opacity);
  const blendedPs2 = additive
    ? destinationPs2.add(sourcePs2.mul(fixedAlpha))
    : mix(destinationPs2, sourcePs2, fixedAlpha);
  const blendedAlpha = additive
    ? destination.a.add(fixedAlpha)
    : mix(destination.a, float(1), fixedAlpha);
  material.fragmentNode = vec4(
    applyModelColorGammaNode(blendedPs2.clamp(0, 1), 2.2),
    blendedAlpha.clamp(0, 1)
  );
}

function createWaterWavePositionNode(waves: WaterWaveNodes | null): Node<'vec3'> {
  if (!waves) {
    return positionLocal;
  }

  return positionLocal.add(vec3(0, 0, waves.height));
}

function createWaterWaveNodes(waves: WaterWaveSettings): WaterWaveNodes | null {
  if (waves.components.length === 0) {
    return null;
  }

  const ps2X = modelPosition.x.add(positionLocal.x);
  const ps2Y = modelPosition.z.negate().add(positionLocal.y);
  let heightNode: Node<'float'> = float(0);
  let slopeX: Node<'float'> = float(0);
  let slopeY: Node<'float'> = float(0);
  for (const [index, component] of waves.components.entries()) {
    const waveVector = createWaterWaveVectorNode(component);
    const phase = ps2X.mul(waveVector.x)
      .add(ps2Y.mul(waveVector.y))
      .add(waterTimeSeconds.mul(component.angularSpeed))
      .add(float(component.phase));
    const waveScale = index < 4 ? waterWaveBank0Scale : waterWaveBank1Scale;
    const amplitude = float(component.amplitude).mul(waveScale);
    heightNode = heightNode.add(sin(phase).mul(amplitude));
    const slopePhase = cos(phase).mul(amplitude);
    slopeX = slopeX.add(slopePhase.mul(waveVector.x));
    slopeY = slopeY.add(slopePhase.mul(waveVector.y));
  }

  return { height: heightNode, slope: vec2(slopeX, slopeY) };
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

function applyWaterOverlayShimmerNode(
  colorNode: Node<'vec3'>,
  waves: WaterWaveNodes | null,
  shimmerScale: number
): Node<'vec3'> {
  if (!waves || shimmerScale === 0) {
    return colorNode;
  }

  const brightness = waves.slope.x
    .mul(waterViewDirection.x)
    .add(waves.slope.y.mul(waterViewDirection.y))
    .mul(float(-shimmerScale))
    .add(float(1));
  return colorNode.mul(brightness);
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
    .clamp(0, 1)
    .toVarying('waterFogAmount')
    .setInterpolation(THREE.InterpolationSamplingType.LINEAR);
  const displayColor = applyModelColorGammaNode(colorNode, 1 / 2.2);
  const displayFog = applyModelColorGammaNode(vec3(fog.color.r, fog.color.g, fog.color.b), 1 / 2.2);
  return applyModelColorGammaNode(mix(displayColor, displayFog, fogAmount), 2.2);
}

function applyWaterPs2ColorNode(colorNode: Node<'vec3'>): Node<'vec3'> {
  return applyModelColorGammaNode(colorNode.clamp(0, 1), 2.2);
}

function applyWaterPs2TextureModulateNode(textureColorNode: Node<'vec3'>, colorNode: Node<'vec3'>): Node<'vec3'> {
  return applyModelColorGammaNode(
    textureColorNode.mul(colorNode).mul(float(ps2TextureModulateScale)).clamp(0, 1),
    2.2
  );
}

function createWaterUnderlayStq(waves: WaterWaveNodes | null): Node<'vec3'> {
  const normal = !waves
    ? vec3(0, 0, 1)
    : normalize(vec3(waves.slope.x.negate(), waves.slope.y.negate(), 1));
  const pointToCamera = vec3(
    cameraPosition.x.sub(positionWorld.x),
    positionWorld.z.sub(cameraPosition.z),
    cameraPosition.y.sub(positionWorld.y)
  );
  const projected = normal
    .mul(dot(pointToCamera, normal))
    .sub(pointToCamera.mul(dot(normal, normal).mul(0.5)));
  return vec3(projected.xy, length(projected).add(projected.z).mul(2));
}

function createWaterUnderlayRingDebugMask(underlayUv: Node<'vec2'>): Node<'float'> {
  const radius = length(underlayUv).clamp(0, 1);
  return float(1)
    .sub(smoothstep(float(0), float(waterUnderlayRingDebugWidth), abs(radius.sub(float(1)))))
    .mul(waterUnderlayRingDebugEnabled);
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function degreesToRadians(value: number): number {
  return finiteNumber(value, 0) * Math.PI / 180;
}
