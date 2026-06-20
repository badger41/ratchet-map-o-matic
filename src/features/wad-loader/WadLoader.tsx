import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title
} from '@mantine/core';
import { AlertCircle, Download, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  deadlockedMaps,
  defaultDeadlockedMap
} from '../../data/deadlockedMaps';
import {
  unpackDeadlockedWad,
  type WadUnpackResult
} from '../../lib/wadUnpack';
import { PackageSummary } from './components/PackageSummary';
import { WadEntryTable } from './components/WadEntryTable';
import {
  idleProgress,
  progressForPhase,
  statusColor,
  type LoadProgressState,
  type LoadStatus
} from './wadLoaderState';

const mapOptions = deadlockedMaps.map((map) => ({
  value: map.id,
  label: map.label
}));

export function WadLoader() {
  const [selectedMapId, setSelectedMapId] = useState(defaultDeadlockedMap.id);
  const selectedMap = useMemo(() => {
    return deadlockedMaps.find((map) => map.id === selectedMapId) ?? defaultDeadlockedMap;
  }, [selectedMapId]);
  const [wadUrl, setWadUrl] = useState(selectedMap.wadUrl);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [progress, setProgress] = useState<LoadProgressState>(idleProgress);
  const [result, setResult] = useState<WadUnpackResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const entries = useMemo(() => result?.entries ?? [], [result]);
  const isLoading = status === 'loading';

  async function loadSelectedWad() {
    setStatus('loading');
    setProgress({ value: 0, label: 'Fetching WAD' });
    setResult(null);
    setLastError(null);

    try {
      const unpacked = await unpackDeadlockedWad(selectedMap, wadUrl, (update) => {
        setProgress(progressForPhase(update.phase, update.loaded, update.total));
      });

      setResult(unpacked);
      setStatus('ready');
      setProgress({ value: 100, label: 'Unpacked' });
    } catch (error: unknown) {
      setStatus('error');
      setProgress({ value: 100, label: 'Failed' });
      setLastError(error instanceof Error ? error.message : String(error));
    }
  }

  function selectMap(mapId: string | null) {
    if (!mapId) {
      return;
    }

    const map = deadlockedMaps.find((candidate) => candidate.id === mapId);
    if (!map) {
      return;
    }

    setSelectedMapId(map.id);
    setWadUrl(map.wadUrl);
    resetResultState();
  }

  function resetSource() {
    setWadUrl(selectedMap.wadUrl);
    resetResultState();
  }

  function resetResultState() {
    setResult(null);
    setLastError(null);
    setStatus('idle');
    setProgress(idleProgress);
  }

  return (
    <div className="workspace">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Title order={2}>Deadlocked WAD Loader</Title>
            <Text c="dimmed">{selectedMap.label}</Text>
          </Stack>
          <Badge variant="outline" color="gray">
            {selectedMap.gameId} level {selectedMap.level.toString().padStart(2, '0')}
          </Badge>
        </Group>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
          <Paper className="toolPanel" withBorder>
            <Stack gap="md">
              <Select
                label="Map"
                data={mapOptions}
                value={selectedMap.id}
                disabled={isLoading}
                allowDeselect={false}
                onChange={selectMap}
              />

              <TextInput
                label="WAD URL"
                value={wadUrl}
                disabled={isLoading}
                onChange={(event) => setWadUrl(event.currentTarget.value)}
              />

              <Progress value={progress.value} size="sm" radius="xs" color={statusColor(status)} />

              <Group grow>
                <Button
                  leftSection={<Download size={16} />}
                  loading={isLoading}
                  onClick={loadSelectedWad}
                >
                  Unpack WAD
                </Button>
                <Button
                  leftSection={<RotateCcw size={16} />}
                  variant="default"
                  disabled={isLoading}
                  onClick={resetSource}
                >
                  Reset
                </Button>
              </Group>

              <Badge variant="light" color={statusColor(status)} className="statusBadge">
                {progress.label}
              </Badge>
            </Stack>
          </Paper>

          <Paper className="toolPanel" withBorder>
            <PackageSummary result={result} />
          </Paper>
        </SimpleGrid>

        {lastError ? (
          <Alert color="red" icon={<AlertCircle size={18} />} title="WAD load failed">
            {lastError}
          </Alert>
        ) : null}

        <WadEntryTable entries={entries} sourceUrl={result?.sourceUrl ?? null} />
      </Stack>
    </div>
  );
}
