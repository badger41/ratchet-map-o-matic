import { Alert, Box, Button, Stack } from '@mantine/core';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  deadlockedMaps,
  defaultDeadlockedMap
} from '../../data/deadlockedMaps';
import {
  loadDeadlockedMapRenderPackage,
  preloadDeadlockedMapConverter,
  type DeadlockedMapLoadResult
} from '../../services/mapLoading/deadlockedMapLoadPipeline';
import { MapLoadProgress } from './components/MapLoadProgress';
import { WelcomeScreen } from './components/WelcomeScreen';
import {
  applyStageUpdate,
  createMapLoadStages,
  markActiveStageFailed,
  type MapLoaderPhase,
  type MapLoadStageState
} from './mapLoaderState';

const mapOptions = deadlockedMaps.map((map) => ({
  value: map.id,
  label: map.label
}));

const MapViewerScreen = lazy(async () => {
  const module = await import('../map-viewer/components/MapViewerScreen');
  return { default: module.MapViewerScreen };
});

export function MapLoader() {
  const [phase, setPhase] = useState<MapLoaderPhase>('welcome');
  const [selectedMapId, setSelectedMapId] = useState(defaultDeadlockedMap.id);
  const [stages, setStages] = useState<MapLoadStageState[]>(() => createMapLoadStages());
  const [result, setResult] = useState<DeadlockedMapLoadResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const selectedMap = useMemo(() => {
    return deadlockedMaps.find((map) => map.id === selectedMapId) ?? defaultDeadlockedMap;
  }, [selectedMapId]);

  useEffect(() => {
    if (phase !== 'welcome') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void preloadDeadlockedMapConverter(selectedMap);
    }, 1000);

    return () => window.clearTimeout(timeoutId);
  }, [phase, selectedMap]);

  async function viewSelectedMap() {
    setMapPickerOpen(false);
    setPhase('loading');
    setResult(null);
    setLastError(null);
    setStages(createMapLoadStages('download'));

    try {
      const loadResult = await loadDeadlockedMapRenderPackage(selectedMap, (update) => {
        setStages((current) => applyStageUpdate(current, update));
      });

      setResult(loadResult);
      setPhase('ready');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      setStages((current) => markActiveStageFailed(current, message));
      setPhase('error');
    }
  }

  const chooseAnotherMap = useCallback(() => {
    if (result) {
      setMapPickerOpen(true);
      return;
    }

    setPhase('welcome');
    setResult(null);
    setLastError(null);
    setStages(createMapLoadStages());
  }, [result]);

  if (phase === 'loading') {
    return <MapLoadProgress map={selectedMap} stages={stages} />;
  }

  if (phase === 'ready' && result) {
    return (
      <Suspense fallback={<MapLoadProgress map={result.map} stages={stages} />}>
        <MapViewerScreen result={result} onChooseAnother={chooseAnotherMap} />
        {mapPickerOpen ? (
          <Box
            pos="fixed"
            top={56}
            left={0}
            right={0}
            bottom={0}
            bg="rgba(7, 10, 13, 0.72)"
            style={{ zIndex: 20, backdropFilter: 'blur(3px)' }}
          >
            <WelcomeScreen
              mapOptions={mapOptions}
              selectedMap={selectedMap}
              selectedMapId={selectedMapId}
              onMapChange={(mapId) => {
                if (mapId) {
                  setSelectedMapId(mapId);
                }
              }}
              onView={viewSelectedMap}
              onClose={() => setMapPickerOpen(false)}
            />
          </Box>
        ) : null}
      </Suspense>
    );
  }

  if (phase === 'error') {
    return (
      <MapLoadProgress map={selectedMap} stages={stages}>
        <Stack gap="lg">
          <Alert color="red" icon={<AlertCircle size={18} />} title="Map load failed">
            {lastError}
          </Alert>
          <Button variant="default" leftSection={<RotateCcw size={16} />} onClick={chooseAnotherMap}>
            Choose Another Map
          </Button>
        </Stack>
      </MapLoadProgress>
    );
  }

  return (
    <WelcomeScreen
      mapOptions={mapOptions}
      selectedMap={selectedMap}
      selectedMapId={selectedMapId}
      onMapChange={(mapId) => {
        if (mapId) {
          setSelectedMapId(mapId);
        }
      }}
      onView={viewSelectedMap}
    />
  );
}
