import { Badge, Group, Paper, Progress, Stack, Text } from '@mantine/core';
import { formatByteSize } from '../../../shared/format';
import {
  viewerStageColor,
  viewerStageProgressValue,
  type MapViewerStageState
} from '../mapViewerState';

interface MapViewerStageListProps {
  stages: MapViewerStageState[];
}

export function MapViewerStageList({ stages }: MapViewerStageListProps) {
  return (
    <Stack gap="sm">
      {stages.map((stage) => (
        <Paper
          key={stage.id}
          p="xs"
          radius="md"
          bg="#0d1319"
          withBorder
          style={{
            borderColor: 'rgba(159, 174, 188, 0.16)',
            minHeight: 74
          }}
        >
          <Group justify="space-between" wrap="nowrap">
            <Stack gap={2}>
              <Text size="sm" fw={700}>{stage.label}</Text>
              <Text size="xs" c="dimmed">
                {stage.detail || 'Waiting'}
              </Text>
            </Stack>
            <Badge variant="light" color={viewerStageColor(stage.status)}>
              {stage.status}
            </Badge>
          </Group>
          <Progress
            value={viewerStageProgressValue(stage)}
            color={viewerStageColor(stage.status)}
            radius="xs"
            size="xs"
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
  );
}
