import {
  Badge,
  Button,
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
    <div className="welcomeSurface">
      <Paper className="welcomePanel" withBorder>
        <Stack gap="lg">
          <Group justify="space-between" align="flex-start">
            <Stack gap={4}>
              <Title order={1}>Ratchet Map-O-Matic</Title>
              <Text c="dimmed">{selectedMap.label}</Text>
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

          <Button size="md" leftSection={<Play size={18} />} onClick={onView}>
            View Map
          </Button>
        </Stack>
      </Paper>
    </div>
  );
}
