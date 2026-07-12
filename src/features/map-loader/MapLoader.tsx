import { Alert, Box, Button, Stack } from '@mantine/core';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  mapCatalog,
  defaultMap,
  type MapDefinition,
  type RatchetGameId
} from '../../data/mapCatalog';
import { fetchHorizonUyaCustomMaps } from '../../services/customMaps/horizonUyaMaps';
import {
  loadMapRenderPackage,
  preloadMapConverter,
  type MapLoadResult
} from '../../services/mapLoading/mapLoadPipeline';
import { MapLoadProgress } from './components/MapLoadProgress';
import { WelcomeScreen } from './components/WelcomeScreen';
import {
  applyStageUpdate,
  createMapLoadStages,
  markActiveStageFailed,
  type CustomMapsStatus,
  type MapLoaderPhase,
  type MapSource,
  type MapLoadStageState
} from './mapLoaderState';

const gameOptions: Array<{ gameId: RatchetGameId; label: string }> = [
  { gameId: 'UYA', label: 'Up Your Arsenal' },
  { gameId: 'DL', label: 'Deadlocked' }
];
const vanillaRouteSegment = 'vanilla';
const customRouteSegment = 'custom';

interface MapRouteSeed {
  gameId: RatchetGameId | null;
  source: MapSource;
  map: MapDefinition | null;
  customMapId: string | null;
}

const MapViewerScreen = lazy(async () => {
  const module = await import('../map-viewer/components/MapViewerScreen');
  return { default: module.MapViewerScreen };
});

export function MapLoader() {
  const [routeSeed] = useState(readMapRoute);
  const [phase, setPhase] = useState<MapLoaderPhase>('welcome');
  const [selectedGameId, setSelectedGameId] = useState<RatchetGameId | null>(routeSeed.gameId);
  const [selectedSource, setSelectedSource] = useState<MapSource>(routeSeed.source);
  const [selectedMapId, setSelectedMapId] = useState(routeSeed.map?.id ?? defaultMap.id);
  const [customMaps, setCustomMaps] = useState<MapDefinition[]>([]);
  const [customMapsStatus, setCustomMapsStatus] = useState<CustomMapsStatus>('idle');
  const [customMapsError, setCustomMapsError] = useState<string | null>(null);
  const [customMapsRetryKey, setCustomMapsRetryKey] = useState(0);
  const [selectedCustomMapId, setSelectedCustomMapId] = useState<string | null>(routeSeed.customMapId);
  const [stages, setStages] = useState<MapLoadStageState[]>(() => createMapLoadStages());
  const [result, setResult] = useState<MapLoadResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const selectedMap = useMemo(() => {
    if (selectedGameId === 'UYA' && selectedSource === 'custom') {
      return findCustomMap(customMaps, selectedCustomMapId)
        ?? customMaps[0]
        ?? firstMapForGame(selectedGameId)
        ?? defaultMap;
    }

    return mapCatalog.find((map) => map.id === selectedMapId)
      ?? firstMapForGame(selectedGameId)
      ?? defaultMap;
  }, [customMaps, selectedCustomMapId, selectedGameId, selectedMapId, selectedSource]);
  const mapOptions = useMemo(() => {
    if (selectedGameId === 'UYA' && selectedSource === 'custom') {
      return customMaps.map((map) => ({
        value: map.id,
        label: map.name
      }));
    }

    return selectedGameId
      ? mapsForGame(selectedGameId).map((map) => ({
        value: map.id,
        label: map.label
      }))
      : [];
  }, [customMaps, selectedGameId, selectedSource]);
  const selectedOptionId = selectedSource === 'custom'
    ? findCustomMap(customMaps, selectedCustomMapId)?.id ?? customMaps[0]?.id ?? selectedCustomMapId ?? ''
    : selectedMapId;
  const canViewSelectedMap = selectedSource !== 'custom' || selectedMap.sourceKind === 'customZip';

  useEffect(() => {
    const onPopState = () => {
      const route = readMapRoute();
      setSelectedGameId(route.gameId);
      setSelectedSource(route.source);
      setSelectedMapId(route.map?.id ?? firstMapForGame(route.gameId)?.id ?? defaultMap.id);
      setSelectedCustomMapId(route.customMapId);
      setMapPickerOpen(false);
      setPhase('welcome');
      setResult(null);
      setLastError(null);
      setStages(createMapLoadStages());
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (selectedGameId !== 'UYA' || selectedSource !== 'custom' || customMaps.length > 0) {
      return;
    }

    const controller = new AbortController();
    setCustomMapsStatus('loading');
    setCustomMapsError(null);
    fetchHorizonUyaCustomMaps(controller.signal)
      .then((maps) => {
        setCustomMaps(maps);
        setCustomMapsStatus('ready');
        setSelectedCustomMapId((current) => resolveCustomMapId(maps, current));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        setCustomMapsStatus('error');
        setCustomMapsError(message);
      });

    return () => controller.abort();
  }, [customMaps.length, customMapsRetryKey, selectedGameId, selectedSource]);

  useEffect(() => {
    if (phase !== 'welcome' || !selectedGameId || (selectedSource === 'custom' && selectedMap.sourceKind !== 'customZip')) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void preloadMapConverter(selectedMap);
    }, 1000);

    return () => window.clearTimeout(timeoutId);
  }, [phase, selectedGameId, selectedMap, selectedSource]);

  async function viewSelectedMap() {
    if (!selectedGameId || !canViewSelectedMap) {
      return;
    }

    setMapPickerOpen(false);
    setPhase('loading');
    setResult(null);
    setLastError(null);
    setStages(createMapLoadStages('download'));
    if (selectedMap.sourceKind === 'customZip') {
      writeCustomRoute(selectedMap);
    } else {
      writeMapRoute(selectedMap.gameId, selectedMap);
    }

    try {
      const loadResult = await loadMapRenderPackage(selectedMap, (update) => {
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

  const selectGame = useCallback((gameId: RatchetGameId) => {
    const firstMap = firstMapForGame(gameId) ?? defaultMap;
    setSelectedGameId(gameId);
    setSelectedSource('vanilla');
    setSelectedMapId(firstMap.id);
    setSelectedCustomMapId(null);
    setPhase('welcome');
    setResult(null);
    setLastError(null);
    setStages(createMapLoadStages());
    writeMapRoute(gameId);
  }, []);

  const selectMap = useCallback((mapId: string | null) => {
    const map = mapCatalog.find((candidate) => candidate.id === mapId);
    if (!map) {
      return;
    }

    setSelectedGameId(map.gameId);
    setSelectedSource('vanilla');
    setSelectedMapId(map.id);
    writeMapRoute(map.gameId);
  }, []);

  const selectHorizonCustomMaps = useCallback(() => {
    setSelectedGameId('UYA');
    setSelectedSource('custom');
    setPhase('welcome');
    setResult(null);
    setLastError(null);
    setStages(createMapLoadStages());
    setCustomMapsRetryKey((value) => value + 1);
    writeCustomRoute();
  }, []);

  const selectVanillaMaps = useCallback(() => {
    const firstMap = firstMapForGame('UYA') ?? defaultMap;
    setSelectedGameId('UYA');
    setSelectedSource('vanilla');
    setSelectedMapId(firstMap.id);
    setPhase('welcome');
    setResult(null);
    setLastError(null);
    setStages(createMapLoadStages());
    writeMapRoute('UYA');
  }, []);

  const selectCustomMap = useCallback((mapId: string | null) => {
    if (!mapId) {
      return;
    }

    setSelectedCustomMapId(mapId);
    writeCustomRoute();
  }, []);

  const returnToGameSelect = useCallback(() => {
    setSelectedGameId(null);
    setSelectedSource('vanilla');
    setSelectedCustomMapId(null);
    setMapPickerOpen(false);
    setPhase('welcome');
    setResult(null);
    setLastError(null);
    setStages(createMapLoadStages());
    writeMapRoute(null);
  }, []);

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
              gameOptions={gameOptions}
              selectedGameId={selectedGameId}
              selectedSource={selectedSource}
              mapOptions={mapOptions}
              selectedMap={selectedMap}
              selectedMapId={selectedOptionId}
              customMapsStatus={customMapsStatus}
              customMapsError={customMapsError}
              canView={canViewSelectedMap}
              onGameSelect={selectGame}
              onMapChange={selectedSource === 'custom' ? selectCustomMap : selectMap}
              onCustomMapsSelect={selectHorizonCustomMaps}
              onVanillaMapsSelect={selectVanillaMaps}
              onBack={returnToGameSelect}
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
      gameOptions={gameOptions}
      selectedGameId={selectedGameId}
      selectedSource={selectedSource}
      mapOptions={mapOptions}
      selectedMap={selectedMap}
      selectedMapId={selectedOptionId}
      customMapsStatus={customMapsStatus}
      customMapsError={customMapsError}
      canView={canViewSelectedMap}
      onGameSelect={selectGame}
      onMapChange={selectedSource === 'custom' ? selectCustomMap : selectMap}
      onCustomMapsSelect={selectHorizonCustomMaps}
      onVanillaMapsSelect={selectVanillaMaps}
      onBack={returnToGameSelect}
      onView={viewSelectedMap}
    />
  );
}

function mapsForGame(gameId: RatchetGameId | null): MapDefinition[] {
  return gameId
    ? mapCatalog.filter((map) => map.gameId === gameId)
    : [];
}

function firstMapForGame(gameId: RatchetGameId | null): MapDefinition | null {
  return mapsForGame(gameId)[0] ?? null;
}

function findCustomMap(maps: MapDefinition[], id: string | null): MapDefinition | null {
  if (!id) {
    return null;
  }

  return maps.find((map) => map.id === id || map.customMapRouteId === id) ?? null;
}

function resolveCustomMapId(maps: MapDefinition[], id: string | null): string | null {
  return findCustomMap(maps, id)?.id ?? maps[0]?.id ?? null;
}

function readMapRoute(): MapRouteSeed {
  const [gameSlug, sourceSlug, itemSlug] = window.location.pathname
    .replace(/^\/+|\/+$/g, '')
    .split('/');
  const gameId = parseRouteGameId(gameSlug);
  if (!gameId) {
    return { gameId: null, source: 'vanilla', map: null, customMapId: null };
  }

  const maps = mapsForGame(gameId);
  const sourceSegment = sourceSlug?.toLowerCase();
  if (gameId === 'UYA' && sourceSegment === customRouteSegment) {
    return {
      gameId,
      source: 'custom',
      map: null,
      customMapId: decodeRouteSegment(itemSlug)
    };
  }

  if (sourceSegment && sourceSegment !== vanillaRouteSegment && parseRouteLevel(sourceSegment) === null) {
    return { gameId, source: 'vanilla', map: maps[0] ?? null, customMapId: null };
  }

  const levelSlug = sourceSegment === vanillaRouteSegment ? itemSlug : sourceSlug;
  const level = parseRouteLevel(levelSlug);
  return {
    gameId,
    source: 'vanilla',
    map: level === null
      ? maps[0] ?? null
      : maps.find((map) => map.level === level) ?? maps[0] ?? null,
    customMapId: null
  };
}

function parseRouteGameId(value: string | undefined): RatchetGameId | null {
  const normalized = value?.toUpperCase();
  return normalized === 'DL' || normalized === 'UYA' ? normalized : null;
}

function parseRouteLevel(value: string | undefined): number | null {
  const match = /^level(\d+)$/i.exec(value ?? '');
  return match ? Number(match[1]) : null;
}

function decodeRouteSegment(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function writeMapRoute(gameId: RatchetGameId | null, map?: MapDefinition): void {
  const nextPath = gameId
    ? `/${gameId.toLowerCase()}${map ? `/${vanillaRouteSegment}/level${map.level.toString().padStart(2, '0')}` : ''}`
    : '/';
  pushRoute(nextPath);
}

function writeCustomRoute(map?: MapDefinition): void {
  const routeId = map?.customMapRouteId ?? null;
  const nextPath = routeId
    ? `/uya/${customRouteSegment}/${encodeURIComponent(routeId)}`
    : `/uya/${customRouteSegment}`;
  pushRoute(nextPath);
}

function pushRoute(nextPath: string): void {
  if (window.location.pathname !== nextPath) {
    window.history.pushState(null, '', nextPath);
  }
}
