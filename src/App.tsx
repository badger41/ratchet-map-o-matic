import { AppShell } from '@mantine/core';
import { AppHeader } from './components/AppHeader';
import { MapLoader } from './features/map-loader/MapLoader';

export default function App() {
  return (
    <AppShell header={{ height: 56 }} padding={0}>
      <AppShell.Header className="appHeader">
        <AppHeader />
      </AppShell.Header>

      <AppShell.Main className="mainSurface">
        <MapLoader />
      </AppShell.Main>
    </AppShell>
  );
}
