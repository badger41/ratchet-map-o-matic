import {
  Alert,
  Box,
  Center,
  Checkbox,
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
  defaultShrubRenderOptions,
  defaultSkyboxRenderOptions,
  defaultTieRenderOptions,
  defaultTfragMaterialOptions,
  type ShrubStats,
  type SkyboxStats,
  type TieStats,
  type TfragStats
} from '../../../services/mapPackages/mapPackageTypes';
import { loadViewerPackageSource } from '../../../services/mapPackages/viewerPackageSource';
import { formatByteSize } from '../../../shared/format';
import {
  applyViewerStageUpdate,
  createMapViewerStages,
  markActiveViewerStageFailed,
  type MapViewerStageState
} from '../mapViewerState';
import {
  defaultGlowBloomFalloffDistance,
  MapSceneRenderer,
  type MapSceneFrameStats
} from '../renderer/MapSceneRenderer';
import type { CameraVirtualMoveInput } from '../renderer/FpsCameraController';
import type { TieMaterialMode } from '../renderer/ties/TieTypes';
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

const glowBloomDistanceOptions = ['100', '250', '500', '1000', '2000'].map((value) => ({
  value,
  label: value
}));

const tieMaterialOptions: Array<{ value: TieMaterialMode; label: string }> = [
  { value: 'full', label: 'Full' },
  { value: 'texture', label: 'Texture' },
  { value: 'plain', label: 'Plain' }
];

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
  const [terrainVisible, setTerrainVisible] = useState(true);
  const [skyboxVisible, setSkyboxVisible] = useState(true);
  const [tiesVisible, setTiesVisible] = useState(true);
  const [shrubsVisible, setShrubsVisible] = useState(true);
  const [tieMaterialMode, setTieMaterialMode] = useState<TieMaterialMode>('full');
  const [tieColorsEnabled, setTieColorsEnabled] = useState(true);
  const [tieBundleEnabled, setTieBundleEnabled] = useState(true);
  const [glowBloomEnabled, setGlowBloomEnabled] = useState(true);
  const [glowBloomFalloffDistance, setGlowBloomFalloffDistance] = useState(defaultGlowBloomFalloffDistance);
  const [frameStats, setFrameStats] = useState<MapSceneFrameStats>({
    fps: 0,
    frameMs: 0,
    submitMs: 0,
    frameRateLimit,
    renderPasses: 0,
    drawCalls: 0,
    triangles: 0,
    bloomStatus: 'off',
    bloomMs: 0,
    bloomSources: 0
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
    rendererRef.current?.setTerrainVisible(terrainVisible);
  }, [terrainVisible]);

  useEffect(() => {
    rendererRef.current?.setSkyboxRenderOptions({
      ...defaultSkyboxRenderOptions,
      visible: skyboxVisible
    });
  }, [skyboxVisible]);

  useEffect(() => {
    rendererRef.current?.setTieVisible(tiesVisible);
  }, [tiesVisible]);

  useEffect(() => {
    rendererRef.current?.setTieMaterialMode(tieMaterialMode);
  }, [tieMaterialMode]);

  useEffect(() => {
    rendererRef.current?.setTieBundleEnabled(tieBundleEnabled);
  }, [tieBundleEnabled]);

  useEffect(() => {
    rendererRef.current?.setGlowBloomEnabled(glowBloomEnabled);
  }, [glowBloomEnabled]);

  useEffect(() => {
    rendererRef.current?.setGlowBloomFalloffDistance(glowBloomFalloffDistance);
  }, [glowBloomFalloffDistance]);

  useEffect(() => {
    rendererRef.current?.setTieRenderOptions({
      ...defaultTieRenderOptions,
      colorsEnabled: tieColorsEnabled
    });
  }, [tieColorsEnabled]);

  useEffect(() => {
    rendererRef.current?.setShrubRenderOptions({
      ...defaultShrubRenderOptions,
      visible: shrubsVisible
    });
  }, [shrubsVisible]);

  useEffect(() => {
    const container = viewportRef.current;
    if (!container) {
      return;
    }

    let disposed = false;
    const renderer = new MapSceneRenderer({
      container,
      materialOptions: defaultTfragMaterialOptions,
      skyboxRenderOptions: {
        ...defaultSkyboxRenderOptions,
        visible: skyboxVisible
      },
      shrubRenderOptions: {
        ...defaultShrubRenderOptions,
        visible: shrubsVisible
      },
      tieRenderOptions: {
        ...defaultTieRenderOptions,
        colorsEnabled: tieColorsEnabled
      },
      levelSettings: result.levelSettings,
      glowBloomEnabled,
      glowBloomFalloffDistance,
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
      },
      onRuntimeError: (message) => {
        if (!disposed) {
          setReady(false);
          setLastError(message);
          setStatus(message);
          setStages((current) => markActiveViewerStageFailed(current, message));
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
          detail: 'Opening package'
        }));
        setStatus('Reading package manifests');
        const loadedPackage = await loadViewerPackageSource(result.packageSource);
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
        renderer.setTerrainVisible(terrainVisible);
        renderer.setTieVisible(tiesVisible);
        renderer.setTieMaterialMode(tieMaterialMode);
        renderer.setTieBundleEnabled(tieBundleEnabled);
        renderer.setGlowBloomEnabled(glowBloomEnabled);
        renderer.setGlowBloomFalloffDistance(glowBloomFalloffDistance);
        renderer.setTieRenderOptions({
          ...defaultTieRenderOptions,
          colorsEnabled: tieColorsEnabled
        });
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
  }, [result.packageSource, result.levelSettings]);

  return (
    <Box
      pos="relative"
      bg="#070a0d"
      style={{
        height: 'calc(100dvh - 56px)',
        minHeight: 'calc(100dvh - 56px)',
        overflow: 'hidden'
      }}
    >
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
                <Alert color="red" icon={<AlertCircle size={18} />} title="Scene renderer failed">
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
            <Group gap="xs" wrap="wrap">
              <Checkbox
                size="xs"
                label="Terrain"
                checked={terrainVisible}
                onChange={(event) => setTerrainVisible(event.currentTarget.checked)}
              />
              <Checkbox
                size="xs"
                label="Skybox"
                checked={skyboxVisible}
                onChange={(event) => setSkyboxVisible(event.currentTarget.checked)}
              />
              <Checkbox
                size="xs"
                label="Ties"
                checked={tiesVisible}
                onChange={(event) => setTiesVisible(event.currentTarget.checked)}
              />
              <Group gap={6} wrap="nowrap">
                <Text size="xs" c="dimmed" fw={700}>Tie material</Text>
                <SegmentedControl
                  size="xs"
                  value={tieMaterialMode}
                  data={tieMaterialOptions}
                  onChange={(value) => setTieMaterialMode(value as TieMaterialMode)}
                />
              </Group>
              <Checkbox
                size="xs"
                label="Tie colors"
                checked={tieColorsEnabled}
                onChange={(event) => setTieColorsEnabled(event.currentTarget.checked)}
              />
              <Checkbox
                size="xs"
                label="Instance bundles"
                checked={tieBundleEnabled}
                onChange={(event) => setTieBundleEnabled(event.currentTarget.checked)}
              />
              <Checkbox
                size="xs"
                label="Glow bloom"
                checked={glowBloomEnabled}
                onChange={(event) => setGlowBloomEnabled(event.currentTarget.checked)}
              />
              <Group gap={6} wrap="nowrap">
                <Text size="xs" c="dimmed" fw={700}>Glow range</Text>
                <SegmentedControl
                  size="xs"
                  value={String(glowBloomFalloffDistance)}
                  data={glowBloomDistanceOptions}
                  onChange={(value) => setGlowBloomFalloffDistance(Number(value))}
                />
              </Group>
              <Checkbox
                size="xs"
                label="Shrubs"
                checked={shrubsVisible}
                onChange={(event) => setShrubsVisible(event.currentTarget.checked)}
              />
            </Group>
            <Table withRowBorders={false} verticalSpacing={2}>
              <Table.Tbody>
                <DebugRow label="Frame ms" value={frameStats.frameMs > 0 ? frameStats.frameMs.toFixed(1) : '-'} />
                <DebugRow label="Submit ms" value={frameStats.submitMs > 0 ? frameStats.submitMs.toFixed(1) : '-'} />
                <DebugRow label="Render passes" value={frameStats.renderPasses.toLocaleString()} />
                <DebugRow label="Draw calls" value={frameStats.drawCalls.toLocaleString()} />
                <DebugRow label="Frame triangles" value={frameStats.triangles.toLocaleString()} />
                <DebugRow label="Bloom status" value={frameStats.bloomStatus} />
                <DebugRow label="Bloom CPU ms" value={frameStats.bloomMs.toFixed(2)} />
                <DebugRow label="Bloom sources" value={frameStats.bloomSources.toLocaleString()} />
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
                <DebugRow label="Package Source" value={result.cachedPackage?.id ?? result.packageSource} />
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
