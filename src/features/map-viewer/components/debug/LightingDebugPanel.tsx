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

interface LightingDebugPanelProps {
  debugTuning: MapSceneDebugTuning;
  onChange: <K extends keyof MapSceneDebugTuning>(key: K, value: MapSceneDebugTuning[K]) => void;
  onReset: () => void;
}

export function LightingDebugPanel({
  debugTuning,
  onChange,
  onReset
}: LightingDebugPanelProps) {
  return (
    <Paper
      pos="absolute"
      top={{ base: 90, sm: 96 }}
      right={{ base: 10, sm: 16 }}
      left={{ base: 10, sm: 'auto' }}
      w={{ base: 'auto', sm: 'min(520px, calc(100vw - 32px))' }}
      p="sm"
      radius="md"
      bg="rgba(17, 24, 32, 0.88)"
      withBorder
      style={{
        zIndex: 2,
        borderColor: 'rgba(159, 174, 188, 0.22)',
        backdropFilter: 'blur(10px)',
        maxHeight: 'calc(100dvh - 112px)',
        overflowY: 'auto'
      }}
    >
      <Stack gap="xs">
        <Group gap="xs" justify="space-between" wrap="nowrap">
          <Text size="xs" c="dimmed" fw={700}>Lighting Debug</Text>
          <Button size="compact-xs" variant="subtle" onClick={onReset}>
            Reset
          </Button>
        </Group>
        <Text size="xs" c="dimmed" fw={700}>Scene</Text>
        <Group gap="xs" align="end">
          <DebugSlider label="Front light" value={debugTuning.directionalFrontScale} min={0} max={2} step={debugSliderStep} onChange={(value) => onChange('directionalFrontScale', value)} />
          <DebugSlider label="Back light" value={debugTuning.directionalBackScale} min={0} max={2} step={debugSliderStep} onChange={(value) => onChange('directionalBackScale', value)} />
          <DebugSlider label="Light color" value={debugTuning.directionalColorStrength} min={0} max={3} step={debugSliderStep} onChange={(value) => onChange('directionalColorStrength', value)} />
          <DebugSlider label="All exposure" value={debugTuning.sceneExposure} min={0} max={2} step={debugSliderStep} onChange={(value) => onChange('sceneExposure', value)} />
          <DebugSlider label="World lift" value={debugTuning.worldDisplayLift} min={0} max={4} step={debugSliderStep} onChange={(value) => onChange('worldDisplayLift', value)} />
          <DebugSlider label="Scene haze" value={debugTuning.sceneHazeStrength} min={0} max={0.5} step={debugSliderStep} onChange={(value) => onChange('sceneHazeStrength', value)} />
        </Group>
        <Text size="xs" c="dimmed" fw={700}>Meshes</Text>
        <Group gap="xs" align="end">
          <DebugSlider label="Tfrag exposure" value={debugTuning.tfragExposure} min={0} max={2} step={debugSliderStep} onChange={(value) => onChange('tfragExposure', value)} />
          <DebugSlider label="Tfrag lift" value={debugTuning.tfragUplift} min={0} max={4} step={debugSliderStep} onChange={(value) => onChange('tfragUplift', value)} />
          <DebugSlider label="Tie exposure" value={debugTuning.tieExposure} min={0} max={2} step={debugSliderStep} onChange={(value) => onChange('tieExposure', value)} />
          <DebugSlider label="Tie ambient" value={debugTuning.tieAmbientScale} min={0} max={2} step={debugSliderStep} onChange={(value) => onChange('tieAmbientScale', value)} />
          <DebugSlider label="Tie lift" value={debugTuning.tieUplift} min={0} max={4} step={debugSliderStep} onChange={(value) => onChange('tieUplift', value)} />
          <DebugSlider label="Shrub exposure" value={debugTuning.shrubExposure} min={0} max={2} step={debugSliderStep} onChange={(value) => onChange('shrubExposure', value)} />
          <DebugSlider label="Shrub lift" value={debugTuning.shrubUplift} min={0} max={4} step={debugSliderStep} onChange={(value) => onChange('shrubUplift', value)} />
        </Group>
        <Text size="xs" c="dimmed" fw={700}>Fog</Text>
        <Group gap="xs" wrap="wrap">
          <Checkbox
            size="xs"
            label="Tfrag fog"
            checked={debugTuning.tfragFogEnabled}
            onChange={(event) => onChange('tfragFogEnabled', event.currentTarget.checked)}
          />
          <Checkbox
            size="xs"
            label="Tie fog"
            checked={debugTuning.tieFogEnabled}
            onChange={(event) => onChange('tieFogEnabled', event.currentTarget.checked)}
          />
          <Checkbox
            size="xs"
            label="Shrub fog"
            checked={debugTuning.shrubFogEnabled}
            onChange={(event) => onChange('shrubFogEnabled', event.currentTarget.checked)}
          />
        </Group>
        <Group gap="xs" align="end">
          <DebugSlider label="Near strength" value={debugTuning.fogNearIntensityScale} min={0} max={3} step={debugSliderStep} onChange={(value) => onChange('fogNearIntensityScale', value)} />
          <DebugSlider label="Near distance" value={debugTuning.fogNearDistanceScale} min={0} max={3} step={debugSliderStep} onChange={(value) => onChange('fogNearDistanceScale', value)} />
          <DebugSlider label="Far strength" value={debugTuning.fogFarIntensityScale} min={0} max={3} step={debugSliderStep} onChange={(value) => onChange('fogFarIntensityScale', value)} />
          <DebugSlider label="Far distance" value={debugTuning.fogFarDistanceScale} min={0.1} max={3} step={debugSliderStep} onChange={(value) => onChange('fogFarDistanceScale', value)} />
          <DebugSlider label="Mesh fog color" value={debugTuning.fogMeshColorStrength} min={0} max={6} step={debugSliderStep} onChange={(value) => onChange('fogMeshColorStrength', value)} />
          <DebugSlider label="Fog cap" value={debugTuning.fogModulationMaxAmount} min={0} max={1} step={debugSliderStep} onChange={(value) => onChange('fogModulationMaxAmount', value)} />
        </Group>
      </Stack>
    </Paper>
  );
}
