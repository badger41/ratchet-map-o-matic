import {
  Button,
  Checkbox,
  Group,
  Paper,
  Stack,
  Text
} from '@mantine/core';
import type { MapSceneDebugTuning } from '../../renderer/MapSceneRenderer';
import { DebugSlider, debugSliderStep } from './DebugSlider';

interface WaterDebugPanelProps {
  debugTuning: MapSceneDebugTuning;
  onChange: <K extends keyof MapSceneDebugTuning>(key: K, value: MapSceneDebugTuning[K]) => void;
  onReset: () => void;
}

export function WaterDebugPanel({
  debugTuning,
  onChange,
  onReset
}: WaterDebugPanelProps) {
  return (
    <Paper
      pos="absolute"
      right={{ base: 10, sm: 16 }}
      bottom={{ base: 10, sm: 16 }}
      w={{ base: 'min(280px, calc(100vw - 20px))', sm: 280 }}
      p="xs"
      radius="md"
      bg="rgba(17, 24, 32, 0.88)"
      withBorder
      style={{
        zIndex: 2,
        borderColor: 'rgba(159, 174, 188, 0.22)',
        backdropFilter: 'blur(10px)',
        maxHeight: 'calc(100dvh - 32px)',
        overflowY: 'auto'
      }}
    >
      <Stack gap={6}>
        <Group gap="xs" justify="space-between" wrap="nowrap">
          <Text size="xs" c="dimmed" fw={700}>Water Debug</Text>
          <Button size="compact-xs" variant="subtle" onClick={onReset}>
            Reset
          </Button>
        </Group>
        <Checkbox
          size="xs"
          label="Show texture bounds"
          checked={debugTuning.waterUnderlayRingDebugEnabled}
          onChange={(event) => onChange('waterUnderlayRingDebugEnabled', event.currentTarget.checked)}
        />
        <DebugSlider
          label="Sphere depth"
          grow={false}
          value={debugTuning.waterUnderlaySphereDepth}
          min={0}
          max={2}
          step={debugSliderStep}
          onChange={(value) => onChange('waterUnderlaySphereDepth', value)}
        />
        <DebugSlider
          label="Wave angle"
          grow={false}
          value={debugTuning.waterWaveDirectionOffsetDegrees}
          min={-360}
          max={360}
          step={1}
          onChange={(value) => onChange('waterWaveDirectionOffsetDegrees', value)}
        />
        <DebugSlider
          label="Dark contrast"
          grow={false}
          value={debugTuning.waterUnderlayDarkContrast}
          min={0}
          max={4}
          step={debugSliderStep}
          onChange={(value) => onChange('waterUnderlayDarkContrast', value)}
        />
        <DebugSlider
          label="Light contrast"
          grow={false}
          value={debugTuning.waterUnderlayBrightContrast}
          min={0}
          max={4}
          step={debugSliderStep}
          onChange={(value) => onChange('waterUnderlayBrightContrast', value)}
        />
        <DebugSlider
          label="Dark opacity"
          grow={false}
          value={debugTuning.waterUnderlayDarkMinOpacity}
          min={0}
          max={1}
          step={debugSliderStep}
          onChange={(value) => onChange('waterUnderlayDarkMinOpacity', value)}
        />
        <DebugSlider
          label="Saturation"
          grow={false}
          value={debugTuning.waterColorSaturation}
          min={0}
          max={2}
          step={debugSliderStep}
          onChange={(value) => onChange('waterColorSaturation', value)}
        />
        <DebugSlider
          label="Color contrast"
          grow={false}
          value={debugTuning.waterColorContrast}
          min={0}
          max={3}
          step={debugSliderStep}
          onChange={(value) => onChange('waterColorContrast', value)}
        />
        <DebugSlider
          label="Water fog"
          grow={false}
          value={debugTuning.waterFogStrength}
          min={0}
          max={2}
          step={debugSliderStep}
          onChange={(value) => onChange('waterFogStrength', value)}
        />
        <DebugSlider
          label="Overlay strength"
          grow={false}
          value={debugTuning.waterOverlayColorStrength}
          min={0}
          max={3}
          step={debugSliderStep}
          onChange={(value) => onChange('waterOverlayColorStrength', value)}
        />
        <DebugSlider
          label="Overlay alpha"
          grow={false}
          value={debugTuning.waterOverlayOpacityScale}
          min={0}
          max={1.5}
          step={debugSliderStep}
          onChange={(value) => onChange('waterOverlayOpacityScale', value)}
        />
      </Stack>
    </Paper>
  );
}
