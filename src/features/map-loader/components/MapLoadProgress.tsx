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
          <Stack gap="md">
            {stages.map((stage) => (
              <Paper
                key={stage.id}
                p="sm"
                radius="md"
                bg="#0d1319"
                withBorder
                style={{
                  borderColor: 'rgba(159, 174, 188, 0.16)',
                  minHeight: 88
                }}
              >
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
              </Paper>
            ))}
          </Stack>
        </Paper>

        {children}
      </Stack>
    </Container>
  );
}
