import {
  Alert,
  Box,
  Center,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Table,
  Text
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { AlertCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppChrome } from '../../../features/app-chrome/AppChromeProvider';
import type { DeadlockedMapLoadResult } from '../../../services/mapLoading/deadlockedMapLoadPipeline';
import {
  defaultTfragMaterialOptions,
  type ShrubStats,
  type SkyboxStats,
  type TieStats,
  type TfragStats
} from '../../../services/mapPackages/mapPackageTypes';
import { loadViewerPackageSource } from '../../../services/mapPackages/viewerPackageSource';
import { toIndexedDbPackageSource } from '../../../services/renderPackages/indexedDbRenderPackageStore';
import { formatByteSize } from '../../../shared/format';
import {
  applyViewerStageUpdate,
  createMapViewerStages,
  markActiveViewerStageFailed,
  type MapViewerStageState
} from '../mapViewerState';
import {
  MapSceneRenderer,
  type MapSceneFrameStats
} from '../renderer/MapSceneRenderer';
import type { CameraVirtualMoveInput } from '../renderer/FpsCameraController';
import { MapViewerStageList } from './MapViewerStageList';
import { MobileCameraControls } from './MobileCameraControls';

interface MapViewerScreenProps {
  result: DeadlockedMapLoadResult;
  onChooseAnother: () => void;
}

const frameRateOptions = ['30', '60', '120', '240'].map((value) => ({
  value,
  label: value
}));

export function MapViewerScreen({ result, onChooseAnother }: MapViewerScreenProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<MapSceneRenderer | null>(null);
  const {
    debugPanelsVisible,
    setViewerChrome,
    resetViewerChrome
  } = useAppChrome();
  const [status, setStatus] = useState('Initializing renderer');
  const [stages, setStages] = useState<MapViewerStageState[]>(() => createMapViewerStages('manifest'));
  const [tfragStats, setTfragStats] = useState<TfragStats | null>(null);
  const [skyboxStats, setSkyboxStats] = useState<SkyboxStats | null>(null);
  const [tieStats, setTieStats] = useState<TieStats | null>(null);
  const [shrubStats, setShrubStats] = useState<ShrubStats | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [frameRateLimit, setFrameRateLimit] = useState(120);
  const [frameStats, setFrameStats] = useState<MapSceneFrameStats>({
    fps: 0,
    frameMs: 0,
    frameRateLimit
  });
  const mobileControlsVisible = useMediaQuery('(pointer: coarse)', false);

  const handleMobileMoveInputChange = useCallback((input: CameraVirtualMoveInput) => {
    rendererRef.current?.setVirtualMoveInput(input);
  }, []);

  useEffect(() => {
    return () => resetViewerChrome();
  }, [resetViewerChrome]);

  useEffect(() => {
    setViewerChrome({
      visible: true,
      mapLabel: result.map.label,
      status,
      state: lastError ? 'failed' : ready ? 'ready' : 'loading',
      onChooseAnother
    });
  }, [
    lastError,
    onChooseAnother,
    ready,
    result.map.label,
    setViewerChrome,
    status
  ]);

  useEffect(() => {
    rendererRef.current?.setFrameRateLimit(frameRateLimit);
  }, [frameRateLimit]);

  useEffect(() => {
    const container = viewportRef.current;
    if (!container) {
      return;
    }

    let disposed = false;
    const renderer = new MapSceneRenderer({
      container,
      materialOptions: defaultTfragMaterialOptions,
      frameRateLimit,
      onStatus: (nextStatus) => {
        if (!disposed) {
          setStatus(nextStatus);
        }
      },
      onLoadProgress: (update) => {
        if (!disposed) {
          setStages((current) => applyViewerStageUpdate(current, update));
        }
      },
      onTfragStats: (stats) => {
        if (!disposed) {
          setTfragStats(stats);
        }
      },
      onSkyboxStats: (stats) => {
        if (!disposed) {
          setSkyboxStats(stats);
        }
      },
      onTieStats: (stats) => {
        if (!disposed) {
          setTieStats(stats);
        }
      },
      onShrubStats: (stats) => {
        if (!disposed) {
          setShrubStats(stats);
        }
      },
      onFrameStats: (stats) => {
        if (!disposed) {
          setFrameStats(stats);
        }
      }
    });
    rendererRef.current = renderer;

    async function loadScene() {
      setReady(false);
      setLastError(null);
      setTfragStats(null);
      setSkyboxStats(null);
      setTieStats(null);
      setShrubStats(null);
      setStages(createMapViewerStages('manifest'));

      try {
        setStatus('Initializing renderer');
        await renderer.initialize();
        if (disposed) {
          renderer.dispose();
          return;
        }

        setStages((current) => applyViewerStageUpdate(current, {
          id: 'manifest',
          status: 'active',
          detail: 'Opening IndexedDB package'
        }));
        setStatus('Reading package manifests');
        const loadedPackage = await loadViewerPackageSource(toIndexedDbPackageSource(result.cachedPackage.id));
        if (disposed) {
          loadedPackage.assetPackage.dispose();
          return;
        }

        setStages((current) => applyViewerStageUpdate(current, {
          id: 'manifest',
          status: 'done',
          detail: `${loadedPackage.directionalLights.length.toLocaleString()} lights`
        }));

        await renderer.loadPackage(loadedPackage);
        if (!disposed) {
          setReady(true);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (!disposed) {
          setLastError(message);
          setStatus(message);
          setStages((current) => markActiveViewerStageFailed(current, message));
        }
      }
    }

    void loadScene();

    return () => {
      disposed = true;
      rendererRef.current = null;
      renderer.dispose();
    };
  }, [result.cachedPackage.id]);

  return (
    <Box pos="relative" mih="calc(100vh - 56px)" bg="#070a0d" style={{ overflow: 'hidden' }}>
      <Box pos="absolute" inset={0} ref={viewportRef} />

      <Paper
        pos="absolute"
        top={{ base: 10, sm: 16 }}
        right={{ base: 10, sm: 16 }}
        p="xs"
        radius="md"
        bg="rgba(17, 24, 32, 0.9)"
        withBorder
        style={{
          zIndex: 2,
          borderColor: 'rgba(159, 174, 188, 0.22)',
          backdropFilter: 'blur(10px)'
        }}
      >
        <Group gap="sm" wrap="nowrap" align="center">
          <Stack gap={0} w={42}>
            <Text size="xs" c="dimmed" fw={700}>FPS</Text>
            <Text size="lg" fw={700}>
              {frameStats.fps > 0 ? frameStats.fps.toFixed(0) : '-'}
            </Text>
          </Stack>
          <SegmentedControl
            size="xs"
            value={String(frameRateLimit)}
            data={frameRateOptions}
            onChange={(value) => setFrameRateLimit(Number(value))}
          />
        </Group>
      </Paper>

      {!ready || lastError ? (
        <Center pos="absolute" inset={0} p="md" style={{ zIndex: 2, pointerEvents: 'none' }}>
          <Paper
            w="min(440px, 100%)"
            p="md"
            radius="md"
            bg="rgba(17, 24, 32, 0.92)"
            withBorder
            style={{
              borderColor: 'rgba(159, 174, 188, 0.22)',
              backdropFilter: 'blur(10px)',
              pointerEvents: 'auto'
            }}
          >
            <Stack gap="md">
              {lastError ? (
                <Alert color="red" icon={<AlertCircle size={18} />} title="Scene load failed">
                  {lastError}
                </Alert>
              ) : null}
              <MapViewerStageList stages={stages} />
            </Stack>
          </Paper>
        </Center>
      ) : null}

      {ready && mobileControlsVisible ? (
        <MobileCameraControls onMoveInputChange={handleMobileMoveInputChange} />
      ) : null}

      {debugPanelsVisible && ready && tfragStats ? (
        <Paper
          pos="absolute"
          bottom={{ base: 10, sm: 16 }}
          left={{ base: 10, sm: 16 }}
          right={{ base: 10, sm: 'auto' }}
          w={{ base: 'auto', sm: 'min(360px, calc(100vw - 32px))' }}
          p="sm"
          radius="md"
          bg="rgba(17, 24, 32, 0.88)"
          withBorder
          style={{
            zIndex: 2,
            borderColor: 'rgba(159, 174, 188, 0.22)',
            backdropFilter: 'blur(10px)'
          }}
        >
          <Stack gap="xs">
            <Text size="xs" c="dimmed" fw={700}>Scene Debug</Text>
            <Table withRowBorders={false} verticalSpacing={2}>
              <Table.Tbody>
                <DebugRow label="Tfrag meshes" value={tfragStats.meshes.toLocaleString()} />
                <DebugRow label="Tfrag primitives" value={tfragStats.sourcePrimitives.toLocaleString()} />
                <DebugRow label="Tfrag triangles" value={tfragStats.triangles.toLocaleString()} />
                <DebugRow label="Tfrag LOD0" value={tfragStats.lod0Triangles?.toLocaleString() ?? '-'} />
                <DebugRow label="Skybox" value={skyboxStats?.loaded ? 'loaded' : 'none'} />
                <DebugRow label="Skybox shells" value={skyboxStats?.shells.toLocaleString() ?? '-'} />
                <DebugRow label="Skybox triangles" value={skyboxStats?.triangles.toLocaleString() ?? '-'} />
                <DebugRow label="Animated shells" value={skyboxStats?.animatedShells.toLocaleString() ?? '-'} />
                <DebugRow label="Tie classes" value={formatTieLoadedClasses(tieStats)} />
                <DebugRow label="Tie instances" value={tieStats?.renderedInstances.toLocaleString() ?? '-'} />
                <DebugRow label="Tie batches" value={tieStats?.batches.toLocaleString() ?? '-'} />
                <DebugRow label="Tie primitives" value={tieStats?.primitives.toLocaleString() ?? '-'} />
                <DebugRow label="Tie triangles" value={tieStats?.triangles.toLocaleString() ?? '-'} />
                <DebugRow label="Tie color rows" value={tieStats?.colorEntries.toLocaleString() ?? '-'} />
                <DebugRow label="Tie ambient batches" value={tieStats?.ambientBatches.toLocaleString() ?? '-'} />
                <DebugRow label="Missing ties" value={tieStats?.missingClasses.toLocaleString() ?? '-'} />
                <DebugRow label="Shrub classes" value={formatShrubLoadedClasses(shrubStats)} />
                <DebugRow label="Shrub instances" value={shrubStats?.renderedInstances.toLocaleString() ?? '-'} />
                <DebugRow label="Shrub batches" value={shrubStats?.batches.toLocaleString() ?? '-'} />
                <DebugRow label="Shrub billboards" value={shrubStats?.billboardBatches.toLocaleString() ?? '-'} />
                <DebugRow label="Shrub primitives" value={shrubStats?.primitives.toLocaleString() ?? '-'} />
                <DebugRow label="Shrub triangles" value={shrubStats?.triangles.toLocaleString() ?? '-'} />
                <DebugRow label="Missing shrubs" value={shrubStats?.missingClasses.toLocaleString() ?? '-'} />
                <DebugRow label="Directional Lights" value={tfragStats.directionalLightRecords.toLocaleString()} />
                <DebugRow label="Material Rebakes" value={tfragStats.materialRebakes.toLocaleString()} />
                <DebugRow label="Render Package" value={formatByteSize(result.packedByteLength)} />
                <DebugRow label="Cache Key" value={result.cachedPackage.id} />
              </Table.Tbody>
            </Table>
          </Stack>
        </Paper>
      ) : null}
    </Box>
  );
}

function formatTieLoadedClasses(stats: TieStats | null): string {
  if (!stats) {
    return '-';
  }

  return `${stats.loadedClasses.toLocaleString()} / ${stats.classIds.toLocaleString()}`;
}

function formatShrubLoadedClasses(stats: ShrubStats | null): string {
  if (!stats) {
    return '-';
  }

  return `${stats.loadedClasses.toLocaleString()} / ${stats.classIds.toLocaleString()}`;
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <Table.Tr>
      <Table.Td>
        <Text size="xs" c="dimmed" fw={700}>
          {label}
        </Text>
      </Table.Td>
      <Table.Td ta="right" maw={170}>
        <Text size="xs" fw={700} truncate>
          {value}
        </Text>
      </Table.Td>
    </Table.Tr>
  );
}
