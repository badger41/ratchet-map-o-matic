import { AppShell } from '@mantine/core';
import { AppHeader } from './components/AppHeader';
import { AppChromeProvider } from './features/app-chrome/AppChromeProvider';
import { MapLoader } from './features/map-loader/MapLoader';

export default function App() {
  return (
    <AppChromeProvider>
      <AppShell header={{ height: 56 }} padding={0}>
        <AppShell.Header
          bg="#10161d"
          style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}
        >
          <AppHeader />
        </AppShell.Header>

        <AppShell.Main bg="#0b0f14" mih="calc(100vh - 56px)">
          <MapLoader />
        </AppShell.Main>
      </AppShell>
    </AppChromeProvider>
  );
}
