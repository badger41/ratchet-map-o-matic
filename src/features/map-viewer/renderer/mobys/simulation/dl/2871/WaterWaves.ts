import * as THREE from 'three/webgpu';

const directionSlots = [0, 2, 1, 3, 6, 4, 5, 7] as const;
const sizeBlendStep = 0.29166666;
const tau = Math.PI * 2;

export function createWaterWaveComponents({
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
}) {
  const waveSpeed = finiteNumber(speed, 0);
  const amplitudeScale = finiteNumber(crest, 0);
  const longWavelength = finiteNumber(surge, 0);
  const shortWavelength = finiteNumber(rippleSize, 0);
  if (amplitudeScale === 0) {
    return [];
  }

  const geometricMean = Math.sqrt(longWavelength * shortWavelength);
  const sizeBlend = finiteNumber(shimmerIntensity, 0);
  const wavelengths = directionSlots.map((_, index) => (
    index < 4
      ? shortWavelength + (geometricMean - shortWavelength) * sizeBlend * index * sizeBlendStep
      : longWavelength + (geometricMean - longWavelength) * sizeBlend * (7 - index) * sizeBlendStep
  ));
  const waveAcceleration = waveSpeed * tau * waveSpeed * 2
    / (shortWavelength + wavelengths[3]);
  return wavelengths.map((wavelength, index) => {
    const direction = degreesToRadians(
      finiteNumber(directionDegrees, 0)
      + finiteNumber(directionVariation, 0) * 45 * (directionSlots[index] - 3.5)
    );
    return {
      amplitude: wavelength * amplitudeScale,
      waveVector: new THREE.Vector2(
        Math.cos(direction) * tau / wavelength,
        Math.sin(direction) * tau / wavelength
      ),
      angularSpeed: -Math.sqrt(waveAcceleration * tau / wavelength),
      phase: index * Math.PI * 0.25
    };
  });
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function degreesToRadians(value: number): number {
  return finiteNumber(value, 0) * Math.PI / 180;
}
