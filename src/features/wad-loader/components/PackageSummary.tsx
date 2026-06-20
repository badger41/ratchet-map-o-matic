import { Badge, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { Archive } from 'lucide-react';
import { formatByteSize, formatDurationMs } from '../../../lib/format';
import type { WadUnpackResult } from '../../../lib/wadUnpack';

interface PackageSummaryProps {
  result: WadUnpackResult | null;
}

export function PackageSummary({ result }: PackageSummaryProps) {
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Group gap="sm">
          <Archive size={18} />
          <Text fw={700}>Package</Text>
        </Group>
        <Badge variant="light" color={result ? 'teal' : 'gray'}>
          {result ? `${result.entries.length} entries` : 'Waiting'}
        </Badge>
      </Group>

      {result ? (
        <SimpleGrid cols={2} spacing="sm">
          <Stat label="WAD" value={formatByteSize(result.wadByteLength)} />
          <Stat label="Packed" value={formatByteSize(result.packedByteLength)} />
          <Stat label="WASM" value={result.apiVersion} />
          <Stat label="Time" value={formatDurationMs(result.durationMs)} />
        </SimpleGrid>
      ) : (
        <div className="emptyState">
          <Text c="dimmed">No WAD unpacked</Text>
        </div>
      )}
    </Stack>
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
