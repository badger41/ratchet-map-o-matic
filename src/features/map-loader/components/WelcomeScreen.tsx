import {
  Badge,
  Button,
  Center,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Title
} from '@mantine/core';
import { Play } from 'lucide-react';
import type { DeadlockedMapDefinition } from '../../../data/deadlockedMaps';

interface WelcomeScreenProps {
  mapOptions: Array<{ value: string; label: string }>;
  selectedMap: DeadlockedMapDefinition;
  selectedMapId: string;
  onMapChange: (mapId: string | null) => void;
  onView: () => void;
}

export function WelcomeScreen({
  mapOptions,
  selectedMap,
  selectedMapId,
  onMapChange,
  onView
}: WelcomeScreenProps) {
  return (
    <Center mih="calc(100vh - 56px)" p="sm">
      <Paper
        w="min(520px, 100%)"
        p="lg"
        radius="md"
        bg="#111820"
        withBorder
        style={{ borderColor: 'rgba(159, 174, 188, 0.22)' }}
      >
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <Stack gap={4}>
              <Title order={2}>Map-O-Matic</Title>
              <Text size="sm" c="dimmed">{selectedMap.label}</Text>
            </Stack>
            <Badge variant="outline" color="gray">
              {selectedMap.gameId} level {selectedMap.level.toString().padStart(2, '0')}
            </Badge>
          </Group>

          <Select
            label="Map"
            data={mapOptions}
            value={selectedMapId}
            allowDeselect={false}
            onChange={onMapChange}
          />

          <Button size="sm" leftSection={<Play size={16} />} onClick={onView}>
            View Map
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
}
