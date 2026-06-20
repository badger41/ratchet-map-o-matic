import {
  Badge,
  Button,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title
} from '@mantine/core';
import { RotateCcw } from 'lucide-react';
import { formatByteSize, formatDurationMs } from '../../../shared/format';
import type { DeadlockedMapLoadResult } from '../../../services/mapLoading/deadlockedMapLoadPipeline';

interface MapReadyPanelProps {
  result: DeadlockedMapLoadResult;
  onChooseAnother: () => void;
}

export function MapReadyPanel({ result, onChooseAnother }: MapReadyPanelProps) {
  return (
    <div className="workspace">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Title order={2}>Map Ready</Title>
            <Text c="dimmed">{result.map.label}</Text>
          </Stack>
          <Badge variant="light" color="teal">
            Cached
          </Badge>
        </Group>

        <Paper className="toolPanel" withBorder>
          <Stack gap="md">
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
              <Stat label="WAD" value={formatByteSize(result.wadByteLength)} />
              <Stat label="Render Package" value={formatByteSize(result.packedByteLength)} />
              <Stat label="Entries" value={result.entryCount.toString()} />
              <Stat label="Time" value={formatDurationMs(result.durationMs)} />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
              <Stat label="WASM" value={result.apiVersion} />
              <Stat label="Package" value={result.cachedPackage.id} />
            </SimpleGrid>

            <Button variant="default" leftSection={<RotateCcw size={16} />} onClick={onChooseAnother}>
              Choose Another Map
            </Button>
          </Stack>
        </Paper>
      </Stack>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="statBox">
      <Text size="xs" c="dimmed" fw={700}>
        {label}
      </Text>
      <Text fw={700}>{value}</Text>
    </div>
  );
}
