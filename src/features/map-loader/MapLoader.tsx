import { Alert, Button, Stack } from '@mantine/core';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  deadlockedMaps,
  defaultDeadlockedMap
} from '../../data/deadlockedMaps';
import {
  loadDeadlockedMapRenderPackage,
  type DeadlockedMapLoadResult
} from '../../services/mapLoading/deadlockedMapLoadPipeline';
import { MapLoadProgress } from './components/MapLoadProgress';
import { MapReadyPanel } from './components/MapReadyPanel';
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

export function MapLoader() {
  const [phase, setPhase] = useState<MapLoaderPhase>('welcome');
  const [selectedMapId, setSelectedMapId] = useState(defaultDeadlockedMap.id);
  const [stages, setStages] = useState<MapLoadStageState[]>(() => createMapLoadStages());
  const [result, setResult] = useState<DeadlockedMapLoadResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const selectedMap = useMemo(() => {
    return deadlockedMaps.find((map) => map.id === selectedMapId) ?? defaultDeadlockedMap;
  }, [selectedMapId]);

  async function viewSelectedMap() {
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

  function chooseAnotherMap() {
    setPhase('welcome');
    setResult(null);
    setLastError(null);
    setStages(createMapLoadStages());
  }

  if (phase === 'loading') {
    return <MapLoadProgress map={selectedMap} stages={stages} />;
  }

  if (phase === 'ready' && result) {
    return <MapReadyPanel result={result} onChooseAnother={chooseAnotherMap} />;
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
