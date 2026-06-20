import { AppShell } from '@mantine/core';
import { AppHeader } from './components/AppHeader';
import { WadLoader } from './features/wad-loader/WadLoader';

export default function App() {
  return (
    <AppShell header={{ height: 56 }} padding={0}>
      <AppShell.Header className="appHeader">
        <AppHeader />
      </AppShell.Header>

      <AppShell.Main className="mainSurface">
        <WadLoader />
      </AppShell.Main>
    </AppShell>
  );
}
