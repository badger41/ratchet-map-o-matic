import { AppShell, Badge, Group, Stack, Text, Title } from '@mantine/core';

export default function App() {
  return (
    <AppShell header={{ height: 56 }} padding="xl">
      <AppShell.Header className="appHeader">
        <Group h="100%" px="xl" justify="space-between">
          <Text fw={700}>Map-O-Matic</Text>
          <Badge variant="light" color="teal">
            Home
          </Badge>
        </Group>
      </AppShell.Header>

      <AppShell.Main className="mainSurface">
        <Stack gap="sm" className="homePanel">
          <Title order={1}>Hello world</Title>
          <Text c="dimmed" size="lg">
            Map-O-Matic
          </Text>
        </Stack>
      </AppShell.Main>
    </AppShell>
  );
}
