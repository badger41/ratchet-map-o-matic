import { Badge, Button, Checkbox, Group, Menu, Stack, Text } from '@mantine/core';
import { Bug, FileArchive, RotateCcw } from 'lucide-react';
import { useAppChrome } from '../features/app-chrome/AppChromeProvider';

export function AppHeader() {
  const {
    debugModeEnabled,
    setDebugModeEnabled,
    debugPanelsVisible,
    setDebugPanelsVisible,
    viewerChrome
  } = useAppChrome();

  const setDebugMode = (enabled: boolean) => {
    setDebugModeEnabled(enabled);
    if (!enabled) {
      setDebugPanelsVisible(false);
    }
  };

  return (
    <Group h="100%" px="xl" justify="space-between" wrap="nowrap">
      <Group gap="sm" wrap="nowrap" flex="0 0 auto">
        <FileArchive size={20} />
        <Text fw={700}>Map-O-Matic</Text>
      </Group>

      <Group gap="md" wrap="nowrap" justify="flex-end" flex={1} miw={0}>
        {viewerChrome.visible ? (
          <Group gap="sm" wrap="nowrap" miw={0}>
            <Text size="sm" fw={700} truncate maw="min(320px, 30vw)">
              {viewerChrome.mapLabel}
            </Text>
            <Text size="sm" c="dimmed" truncate maw="min(260px, 24vw)" visibleFrom="sm">
              {viewerChrome.status}
            </Text>
            <Badge
              variant="light"
              color={viewerChrome.state === 'ready' ? 'teal' : viewerChrome.state === 'failed' ? 'red' : 'blue'}
            >
              {viewerChrome.state}
            </Badge>
            {viewerChrome.onChooseAnother ? (
              <Button
                variant="default"
                size="xs"
                leftSection={<RotateCcw size={14} />}
                onClick={viewerChrome.onChooseAnother}
              >
                Choose Map
              </Button>
            ) : null}
          </Group>
        ) : null}

        <Menu position="bottom-end" closeOnItemClick={false} withinPortal>
          <Menu.Target>
            <Button
              variant={debugModeEnabled ? 'light' : 'subtle'}
              size="xs"
              leftSection={<Bug size={14} />}
            >
              Debug
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Stack gap="xs" p="xs" miw={160}>
              <Checkbox
                checked={debugModeEnabled}
                label="Debug renderer"
                size="xs"
                onChange={(event) => setDebugMode(event.currentTarget.checked)}
              />
              <Checkbox
                checked={debugModeEnabled && debugPanelsVisible}
                label="Show panels"
                size="xs"
                disabled={!debugModeEnabled}
                onChange={(event) => setDebugPanelsVisible(event.currentTarget.checked)}
              />
            </Stack>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
  );
}
