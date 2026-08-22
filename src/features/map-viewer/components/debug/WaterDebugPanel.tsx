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
          label="Wave angle"
          grow={false}
          value={debugTuning.waterWaveDirectionOffsetDegrees}
          min={-360}
          max={360}
          step={1}
          onChange={(value) => onChange('waterWaveDirectionOffsetDegrees', value)}
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
      </Stack>
    </Paper>
  );
}
