import * as THREE from 'three/webgpu';
import {
  dot,
  float,
  max,
  mix,
  positionView,
  pow,
  uniform,
  vec3
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

const modelFogEnabled = uniform(0);
const modelFogRed = uniform(0);
const modelFogGreen = uniform(0);
const modelFogBlue = uniform(0);
const modelFogNearDistance = uniform(0);
const modelFogFarDistance = uniform(1);
const modelFogNearIntensity = uniform(0);
const modelFogFarIntensity = uniform(0);
const modelFogNearDistanceScale = uniform(1);
const modelFogFarDistanceScale = uniform(1);
const modelFogNearIntensityScale = uniform(1);
const modelFogFarIntensityScale = uniform(1);
const modelFogColorScale = uniform(1);
const modelFogModulationMaxAmount = uniform(1);
const modelTfragDisplayLift = uniform(1);
const modelTieDisplayLift = uniform(1);
const modelShrubDisplayLift = uniform(1);
const modelTfragFogEnabled = uniform(1);
const modelTieFogEnabled = uniform(1);
const modelShrubFogEnabled = uniform(1);

export interface ModelFogDebugOptions {
  fogNearDistanceScale: number;
  fogFarDistanceScale: number;
  fogNearIntensityScale: number;
  fogFarIntensityScale: number;
  fogMeshColorStrength: number;
  fogModulationMaxAmount: number;
}

export const defaultModelFogDebugOptions: ModelFogDebugOptions = {
  fogNearDistanceScale: 1,
  fogFarDistanceScale: 1.5,
  fogNearIntensityScale: 1,
  fogFarIntensityScale: 1,
  fogMeshColorStrength: 1,
  fogModulationMaxAmount: 0.5
};

export interface ModelFamilyDisplayOptions {
  tfragUplift: number;
  tieUplift: number;
  shrubUplift: number;
  tfragFogEnabled: boolean;
  tieFogEnabled: boolean;
  shrubFogEnabled: boolean;
}

export interface ModelFogSettings {
  color: THREE.Color;
  nearDistance: number;
  farDistance: number;
  nearIntensity: number;
  farIntensity: number;
}

export function setModelFog(fog: ModelFogSettings | null): void {
  modelFogEnabled.value = fog ? 1 : 0;
  modelFogRed.value = fog?.color.r ?? 0;
  modelFogGreen.value = fog?.color.g ?? 0;
  modelFogBlue.value = fog?.color.b ?? 0;
  modelFogNearDistance.value = Math.max(0, fog?.nearDistance ?? 0);
  modelFogFarDistance.value = Math.max(modelFogNearDistance.value + 0.001, fog?.farDistance ?? 1);
  modelFogNearIntensity.value = finiteNumber(fog?.nearIntensity, 0);
  modelFogFarIntensity.value = finiteNumber(fog?.farIntensity, 0);
}

export function setModelFogDebugOptions(options: ModelFogDebugOptions): void {
  modelFogNearDistanceScale.value = finiteNonNegative(options.fogNearDistanceScale, defaultModelFogDebugOptions.fogNearDistanceScale);
  modelFogFarDistanceScale.value = finiteNonNegative(options.fogFarDistanceScale, defaultModelFogDebugOptions.fogFarDistanceScale);
  modelFogNearIntensityScale.value = finiteNonNegative(options.fogNearIntensityScale, defaultModelFogDebugOptions.fogNearIntensityScale);
  modelFogFarIntensityScale.value = finiteNonNegative(options.fogFarIntensityScale, defaultModelFogDebugOptions.fogFarIntensityScale);
  modelFogColorScale.value = finiteNonNegative(options.fogMeshColorStrength, defaultModelFogDebugOptions.fogMeshColorStrength);
  modelFogModulationMaxAmount.value = finiteNonNegative(options.fogModulationMaxAmount, defaultModelFogDebugOptions.fogModulationMaxAmount);
}

export function setModelFamilyDisplayOptions(options: ModelFamilyDisplayOptions): void {
  modelTfragDisplayLift.value = finiteNonNegative(options.tfragUplift, 1);
  modelTieDisplayLift.value = finiteNonNegative(options.tieUplift, 1);
  modelShrubDisplayLift.value = finiteNonNegative(options.shrubUplift, 1);
  modelTfragFogEnabled.value = options.tfragFogEnabled ? 1 : 0;
  modelTieFogEnabled.value = options.tieFogEnabled ? 1 : 0;
  modelShrubFogEnabled.value = options.shrubFogEnabled ? 1 : 0;
}

export function applyTfragDisplayLiftNode(colorNode: Node<'vec3'>): Node<'vec3'> {
  return applyModelDisplayLiftNode(colorNode, modelTfragDisplayLift);
}

export function applyTieDisplayLiftNode(colorNode: Node<'vec3'>): Node<'vec3'> {
  return applyModelDisplayLiftNode(colorNode, modelTieDisplayLift);
}

export function applyShrubDisplayLiftNode(colorNode: Node<'vec3'>): Node<'vec3'> {
  return applyModelDisplayLiftNode(colorNode, modelShrubDisplayLift);
}

export function applyTfragFogNode(colorNode: Node<'vec3'>): Node<'vec3'> {
  return applyModelFogNode(colorNode, modelTfragFogEnabled);
}

export function applyTieFogNode(colorNode: Node<'vec3'>): Node<'vec3'> {
  return applyModelFogNode(colorNode, modelTieFogEnabled);
}

export function applyShrubFogNode(colorNode: Node<'vec3'>): Node<'vec3'> {
  return applyModelFogNode(colorNode, modelShrubFogEnabled);
}

function applyModelFogNode(colorNode: Node<'vec3'>, familyFogEnabled: Node<'float'>): Node<'vec3'> {
  const nearDistance = modelFogNearDistance.mul(modelFogNearDistanceScale);
  const farDistance = max(modelFogFarDistance.mul(modelFogFarDistanceScale), nearDistance.add(float(0.001)));
  const distanceMix = positionView.z.negate()
    .sub(nearDistance)
    .div(farDistance.sub(nearDistance))
    .clamp(0, 1);
  const nearIntensity = modelFogNearIntensity.mul(modelFogNearIntensityScale);
  const farIntensity = modelFogFarIntensity.mul(modelFogFarIntensityScale);
  const fogAmount = mix(nearIntensity, farIntensity, distanceMix)
    .mul(modelFogEnabled)
    .mul(familyFogEnabled)
    .clamp(0, modelFogModulationMaxAmount);
  const displayColor = applyModelColorGammaNode(colorNode, 1 / 2.2);
  const displayFogBase = applyModelColorGammaNode(vec3(modelFogRed, modelFogGreen, modelFogBlue), 1 / 2.2);
  const displayFog = displayFogBase.mul(modelFogColorScale).clamp(0, 1);
  return applyModelColorGammaNode(mix(displayColor, displayFog, fogAmount), 2.2);
}

export function applyModelColorGammaNode(colorNode: Node<'vec3'>, exponent: number): Node<'vec3'> {
  return vec3(
    pow(colorNode.r.clamp(0, 1), float(exponent)),
    pow(colorNode.g.clamp(0, 1), float(exponent)),
    pow(colorNode.b.clamp(0, 1), float(exponent))
  );
}

export function applyModelDisplayModulateNode(baseColorNode: Node<'vec3'>, lightTermNode: Node<'vec3'>): Node<'vec3'> {
  return applyModelColorGammaNode(
    applyModelColorGammaNode(baseColorNode, 1 / 2.2).mul(lightTermNode),
    2.2
  );
}

export function applyModelColorStrengthNode(colorNode: Node<'vec3'>, strengthNode: Node<'float'>): Node<'vec3'> {
  const lumaNode = dot(colorNode, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(lumaNode, lumaNode, lumaNode), colorNode, strengthNode).clamp(0, 1);
}

function applyModelDisplayLiftNode(colorNode: Node<'vec3'>, lift: Node<'float'>): Node<'vec3'> {
  const lumaNode = dot(colorNode, vec3(0.2126, 0.7152, 0.0722));
  const liftedLumaNode = lumaNode.mul(lift).clamp(0, 1);
  const ratioNode = liftedLumaNode.div(max(lumaNode, float(0.001)));
  return colorNode.mul(ratioNode).clamp(0, 1);
}

function finiteNonNegative(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
