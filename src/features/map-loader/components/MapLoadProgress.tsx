import {
  Badge,
  Container,
  Group,
  Paper,
  Progress,
  Stack,
  Text,
  Title
} from '@mantine/core';
import type { ReactNode } from 'react';
import type { DeadlockedMapDefinition } from '../../../data/deadlockedMaps';
import { formatByteSize } from '../../../shared/format';
import {
  stageColor,
  stageProgressValue,
  type MapLoadStageState
} from '../mapLoaderState';

interface MapLoadProgressProps {
  map: DeadlockedMapDefinition;
  stages: MapLoadStageState[];
  children?: ReactNode;
}

export function MapLoadProgress({ map, stages, children }: MapLoadProgressProps) {
  const stage = currentStage(stages);
  const color = stage ? stageColor(stage.status) : 'gray';

  return (
    <Container size={1180} px="md" py="xl">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Title order={2}>Loading Map</Title>
            <Text c="dimmed">{map.label}</Text>
          </Stack>
          <Badge variant="outline" color="gray">
            {map.gameId} level {map.level.toString().padStart(2, '0')}
          </Badge>
        </Group>

        <Paper
          p="lg"
          radius="md"
          bg="#111820"
          withBorder
          style={{ borderColor: 'rgba(159, 174, 188, 0.22)' }}
        >
          {stage ? (
            <Stack gap="xs">
              <Group justify="space-between" wrap="nowrap">
                <Stack gap={2}>
                  <Text fw={700}>{stage.label}</Text>
                  <Text size="sm" c="dimmed">
                    {formatStageDetail(stage)}
                  </Text>
                </Stack>
                <Badge variant="light" color={color}>
                  {stage.status}
                </Badge>
              </Group>
              <Progress
                value={stageProgressValue(stage)}
                color={color}
                radius="xs"
                size="md"
                transitionDuration={stage.status === 'active' ? 180 : 0}
              />
            </Stack>
          ) : null}
        </Paper>

        {children}
      </Stack>
    </Container>
  );
}

function currentStage(stages: MapLoadStageState[]): MapLoadStageState | null {
  const current = stages.find((stage) => stage.status === 'active')
    ?? stages.find((stage) => stage.status === 'error');
  if (current) {
    return current;
  }

  for (let index = stages.length - 1; index >= 0; index -= 1) {
    if (stages[index].status === 'done') {
      return stages[index];
    }
  }

  return stages[0] ?? null;
}

function formatStageDetail(stage: MapLoadStageState): string {
  if (stage.loaded !== null) {
    return `${formatByteSize(stage.loaded)}${stage.total ? ` / ${formatByteSize(stage.total)}` : ''}`;
  }

  return stage.detail || 'Waiting';
}
