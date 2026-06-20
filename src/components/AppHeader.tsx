import { Group, Text } from '@mantine/core';
import { FileArchive } from 'lucide-react';

export function AppHeader() {
  return (
    <Group h="100%" px="xl" justify="space-between">
      <Group gap="sm">
        <FileArchive size={20} />
        <Text fw={700}>Ratchet Map-O-Matic</Text>
      </Group>
    </Group>
  );
}
