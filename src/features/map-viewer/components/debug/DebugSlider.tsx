import { Group, Stack, Text } from '@mantine/core';

export const debugSliderStep = 0.05;

interface DebugSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  grow?: boolean;
  onChange: (value: number) => void;
}

export function DebugSlider({
  label,
  value,
  min,
  max,
  step,
  grow = true,
  onChange
}: DebugSliderProps) {
  return (
    <Stack gap={2} style={{ flex: grow ? '1 1 150px' : '0 0 auto', minWidth: grow ? 150 : 0, width: '100%' }}>
      <Group gap={6} justify="space-between" wrap="nowrap">
        <Text size="xs" c="dimmed" fw={700}>
          {label}
        </Text>
        <Text size="xs" fw={700}>
          {formatDebugSliderValue(value, step)}
        </Text>
      </Group>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        style={{ width: '100%' }}
      />
    </Stack>
  );
}

function formatDebugSliderValue(value: number, step: number): string {
  if (step < 0.01) {
    return value.toFixed(3);
  }

  if (step < 0.1) {
    return value.toFixed(2);
  }

  return value.toFixed(1);
}
