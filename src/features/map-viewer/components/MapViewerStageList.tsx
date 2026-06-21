import { Badge, Group, Paper, Progress, Stack, Text } from '@mantine/core';
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
      {stages.map((stage) => {
        const color = viewerStageColor(stage.status);
        const progressText = formatStageProgressText(stage);
        return (
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
              <Badge variant="light" color={color}>
                {stage.status}
              </Badge>
            </Group>
            <Progress
              value={viewerStageProgressValue(stage)}
              color={color}
              radius="xs"
              size="xs"
              transitionDuration={stage.status === 'active' ? 180 : 0}
            />
            {progressText ? (
              <Text size="xs" c="dimmed">
                {progressText}
              </Text>
            ) : null}
          </Paper>
        );
      })}
    </Stack>
  );
}

function formatStageProgressText(stage: MapViewerStageState): string | null {
  if (stage.loaded === null) {
    return null;
  }

  const loaded = stage.loaded.toLocaleString();
  const total = stage.total ? stage.total.toLocaleString() : null;
  const suffix = stage.id === 'ties'
    ? ' classes'
    : stage.id === 'compile'
      ? ' steps'
      : '';

  return total ? `${loaded} / ${total}${suffix}` : `${loaded}${suffix}`;
}
