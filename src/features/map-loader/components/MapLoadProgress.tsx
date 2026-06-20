import {
  Badge,
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
  return (
    <div className="workspace">
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

        <Paper className="loadPanel" withBorder>
          <Stack gap="md">
            {stages.map((stage) => (
              <div className="loadStage" key={stage.id}>
                <Group justify="space-between" wrap="nowrap">
                  <Stack gap={2}>
                    <Text fw={700}>{stage.label}</Text>
                    <Text size="sm" c="dimmed">
                      {stage.detail || 'Waiting'}
                    </Text>
                  </Stack>
                  <Badge variant="light" color={stageColor(stage.status)}>
                    {stage.status}
                  </Badge>
                </Group>
                <Progress
                  value={stageProgressValue(stage)}
                  color={stageColor(stage.status)}
                  radius="xs"
                  size="sm"
                />
                {stage.loaded !== null ? (
                  <Text size="xs" c="dimmed">
                    {formatByteSize(stage.loaded)}
                    {stage.total ? ` / ${formatByteSize(stage.total)}` : ''}
                  </Text>
                ) : null}
              </div>
            ))}
          </Stack>
        </Paper>

        {children}
      </Stack>
    </div>
  );
}
