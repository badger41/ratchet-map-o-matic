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
import { flushSync } from 'react-dom';
import { useAppChrome } from '../../../features/app-chrome/AppChromeProvider';
import { dirnamePackagePath, joinPackagePath } from '../../../services/mapAssets/mapAssetPackage';
import type { MapLoadResult } from '../../../services/mapLoading/mapLoadPipeline';
import {
  defaultShrubRenderOptions,
  defaultSkyboxRenderOptions,
  defaultTieRenderOptions,
  defaultTfragMaterialOptions,
  type MobyStats,
  type ShrubStats,
  type SkyboxStats,
  type TieStats,
  type TfragStats,
  type LoadedMapPackage
} from '../../../services/mapPackages/mapPackageTypes';
import { loadViewerPackageSource } from '../../../services/mapPackages/viewerPackageSource';
import { formatByteSize } from '../../../shared/format';
import { fxTextureName } from '../fxTextureCatalog';
import {
  applyViewerStageUpdate,
  createMapViewerStages,
  markActiveViewerStageFailed,
  type MapViewerStageState
} from '../mapViewerState';
import {
  defaultGlowBloomFalloffDistance,
  defaultMapSceneDebugTuning,
  MapSceneRenderer,
  type MapSceneDebugTuning,
  type MapSceneFrameStats
} from '../renderer/MapSceneRenderer';
import type { CameraVirtualMoveInput } from '../renderer/FpsCameraController';
import type { TieMaterialMode } from '../renderer/ties/TieTypes';
import { LightingDebugPanel } from './debug/LightingDebugPanel';
import { WaterDebugPanel } from './debug/WaterDebugPanel';
import { FxTextureWindow, type FxTextureView } from './FxTextureWindow';
import { MapViewerStageList } from './MapViewerStageList';
import { MobileCameraControls } from './MobileCameraControls';

interface MapViewerScreenProps {
  result: MapLoadResult;
  onChooseAnother: () => void;
}

interface FxTextureManifest {
  Textures?: FxTextureManifestEntry[];
}

interface FxTextureManifestEntry {
  Index?: unknown;
  Path?: unknown;
  Width?: unknown;
  Height?: unknown;
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

const lightingDebugStorageKey = 'map-viewer-lighting-debug-tuning-v15';

export function MapViewerScreen({ result, onChooseAnother }: MapViewerScreenProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<MapSceneRenderer | null>(null);
  const {
    debugModeEnabled,
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
  const [mobyStats, setMobyStats] = useState<MobyStats | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [fxTextures, setFxTextures] = useState<FxTextureView[]>([]);
  const [fxTextureLoadError, setFxTextureLoadError] = useState<string | null>(null);
  const [fxTextureWindowOpen, setFxTextureWindowOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [frameRateLimit, setFrameRateLimit] = useState(120);
  const [terrainVisible, setTerrainVisible] = useState(true);
  const [skyboxVisible, setSkyboxVisible] = useState(true);
  const [tiesVisible, setTiesVisible] = useState(true);
  const [shrubsVisible, setShrubsVisible] = useState(true);
  const [mobysVisible, setMobysVisible] = useState(true);
  const [mobySimulationEnabled, setMobySimulationEnabled] = useState(true);
  const [tieMaterialMode, setTieMaterialMode] = useState<TieMaterialMode>('full');
  const [tieColorsEnabled, setTieColorsEnabled] = useState(true);
  const [tieBundleEnabled, setTieBundleEnabled] = useState(false);
  const [glowBloomEnabled, setGlowBloomEnabled] = useState(false);
  const [glowBloomFalloffDistance, setGlowBloomFalloffDistance] = useState(defaultGlowBloomFalloffDistance);
  const [debugTuning, setDebugTuning] = useState<MapSceneDebugTuning>(readStoredDebugTuning);
  const detailedFrameStatsEnabled = debugModeEnabled && debugPanelsVisible;
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

  const openFxTextureWindow = useCallback(() => {
    setFxTextureWindowOpen(true);
  }, []);

  const handleMobileMoveInputChange = useCallback((input: CameraVirtualMoveInput) => {
    rendererRef.current?.setVirtualMoveInput(input);
  }, []);

  const setDebugTuningValue = useCallback(<K extends keyof MapSceneDebugTuning,>(key: K, value: MapSceneDebugTuning[K]) => {
    setDebugTuning((current) => ({
      ...current,
      [key]: value
    }));
  }, []);

  const resetDebugTuning = useCallback(() => {
    setDebugTuning({ ...defaultMapSceneDebugTuning });
  }, []);

  const resetWaterDebugTuning = useCallback(() => {
    setDebugTuning((current) => ({
      ...current,
      waterUnderlayRingDebugEnabled: defaultMapSceneDebugTuning.waterUnderlayRingDebugEnabled,
      waterUnderlaySphereDepth: defaultMapSceneDebugTuning.waterUnderlaySphereDepth,
      waterWaveDirectionOffsetDegrees: defaultMapSceneDebugTuning.waterWaveDirectionOffsetDegrees,
      waterUnderlayDarkContrast: defaultMapSceneDebugTuning.waterUnderlayDarkContrast,
      waterUnderlayBrightContrast: defaultMapSceneDebugTuning.waterUnderlayBrightContrast,
      waterUnderlayDarkMinOpacity: defaultMapSceneDebugTuning.waterUnderlayDarkMinOpacity,
      waterColorSaturation: defaultMapSceneDebugTuning.waterColorSaturation,
      waterColorContrast: defaultMapSceneDebugTuning.waterColorContrast,
      waterFogStrength: defaultMapSceneDebugTuning.waterFogStrength,
      waterOverlayColorStrength: defaultMapSceneDebugTuning.waterOverlayColorStrength,
      waterOverlayOpacityScale: defaultMapSceneDebugTuning.waterOverlayOpacityScale
    }));
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
      onChooseAnother,
      onOpenFxTextures: ready ? openFxTextureWindow : undefined
    });
  }, [
    lastError,
    onChooseAnother,
    openFxTextureWindow,
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
    rendererRef.current?.setMobyVisible(mobysVisible);
  }, [mobysVisible]);

  useEffect(() => {
    rendererRef.current?.setMobySimulationEnabled(mobySimulationEnabled);
  }, [mobySimulationEnabled]);

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
    rendererRef.current?.setFrameStatsDetailEnabled(detailedFrameStatsEnabled);
  }, [detailedFrameStatsEnabled]);

  useEffect(() => {
    if (!debugModeEnabled) {
      return;
    }

    rendererRef.current?.setDebugTuning(debugTuning);
    const timeoutId = window.setTimeout(() => writeStoredDebugTuning(debugTuning), 150);
    return () => window.clearTimeout(timeoutId);
  }, [debugModeEnabled, debugTuning]);

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
      mobyInstances: result.mobyInstances,
      glowBloomEnabled,
      glowBloomFalloffDistance,
      mobySimulationEnabled,
      frameRateLimit,
      frameStatsDetailEnabled: detailedFrameStatsEnabled,
      debugTuning: debugModeEnabled ? debugTuning : undefined,
      lightingDebugEnabled: debugModeEnabled,
      onStatus: (nextStatus) => {
        if (!disposed) {
          setStatus(nextStatus);
        }
      },
      onLoadProgress: (update) => {
        if (!disposed) {
          const applyUpdate = () => setStages((current) => applyViewerStageUpdate(current, update));
          if (update.id === 'compile') {
            flushSync(applyUpdate);
          } else {
            applyUpdate();
          }
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
      onMobyStats: (stats) => {
        if (!disposed) {
          setMobyStats(stats);
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
      setMobyStats(null);
      setFxTextures([]);
      setFxTextureLoadError(null);
      setFxTextureWindowOpen(false);
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

        try {
          const loadedFxTextures = await loadFxTextureViews(loadedPackage);
          if (!disposed) {
            setFxTextures(loadedFxTextures);
          }
        } catch (error: unknown) {
          if (!disposed) {
            setFxTextures([]);
            setFxTextureLoadError(error instanceof Error ? error.message : String(error));
          }
        }

        if (disposed) {
          loadedPackage.assetPackage.dispose();
          return;
        }

        await renderer.loadPackage(loadedPackage);
        renderer.setTerrainVisible(terrainVisible);
        renderer.setTieVisible(tiesVisible);
        renderer.setTieMaterialMode(tieMaterialMode);
        renderer.setMobyVisible(mobysVisible);
        renderer.setMobySimulationEnabled(mobySimulationEnabled);
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
  }, [result.packageSource, result.levelSettings, result.mobyInstances, debugModeEnabled]);

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

      {debugModeEnabled && debugPanelsVisible && ready && tfragStats ? (
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
            backdropFilter: 'blur(10px)',
            maxHeight: 'calc(100dvh - 120px)',
            overflowY: 'auto'
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
              <Checkbox
                size="xs"
                label="Mobys"
                checked={mobysVisible}
                onChange={(event) => setMobysVisible(event.currentTarget.checked)}
              />
              <Checkbox
                size="xs"
                label="Moby simulation"
                checked={mobySimulationEnabled}
                onChange={(event) => setMobySimulationEnabled(event.currentTarget.checked)}
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
                <DebugRow label="Moby classes" value={formatMobyLoadedClasses(mobyStats)} />
                <DebugRow label="Moby instances" value={mobyStats?.renderedInstances.toLocaleString() ?? '-'} />
                <DebugRow label="Moby batches" value={mobyStats?.batches.toLocaleString() ?? '-'} />
                <DebugRow label="Moby primitives" value={mobyStats?.primitives.toLocaleString() ?? '-'} />
                <DebugRow label="Moby triangles" value={mobyStats?.triangles.toLocaleString() ?? '-'} />
                <DebugRow label="Missing mobys" value={mobyStats?.missingClasses.toLocaleString() ?? '-'} />
                <DebugRow label="Directional Lights" value={tfragStats.directionalLightRecords.toLocaleString()} />
                <DebugRow label="Material Rebakes" value={tfragStats.materialRebakes.toLocaleString()} />
                <DebugRow label="Render Package" value={formatByteSize(result.packedByteLength)} />
                <DebugRow label="Package Source" value={result.cachedPackage?.id ?? result.packageSource} />
              </Table.Tbody>
            </Table>
          </Stack>
        </Paper>
      ) : null}

      {debugModeEnabled && debugPanelsVisible && ready ? (
        <LightingDebugPanel
          debugTuning={debugTuning}
          onChange={setDebugTuningValue}
          onReset={resetDebugTuning}
        />
      ) : null}

      {debugModeEnabled && debugPanelsVisible && ready ? (
        <WaterDebugPanel
          debugTuning={debugTuning}
          onChange={setDebugTuningValue}
          onReset={resetWaterDebugTuning}
        />
      ) : null}

      <FxTextureWindow
        opened={fxTextureWindowOpen}
        textures={fxTextures}
        error={fxTextureLoadError}
        onClose={() => setFxTextureWindowOpen(false)}
      />
    </Box>
  );
}

async function loadFxTextureViews(mapPackage: LoadedMapPackage): Promise<FxTextureView[]> {
  const assetRootPath = dirnamePackagePath(mapPackage.assetManifestPath);
  const manifestPath = joinPackagePath(assetRootPath, 'fx/manifest.json');
  const manifest = await mapPackage.assetPackage.readOptionalJson<FxTextureManifest>(manifestPath);
  const textures = Array.isArray(manifest?.Textures) ? manifest.Textures : [];
  const views = await Promise.all(textures.map(async (entry) => {
    const index = numberValue(entry.Index);
    const path = stringValue(entry.Path);
    if (index === null || !path) {
      return null;
    }

    const packagePath = joinPackagePath(assetRootPath, path);
    return {
      index,
      name: fxTextureName(mapPackage.rootManifest.Game, index),
      path: packagePath,
      url: await mapPackage.assetPackage.resolveUrl(packagePath),
      width: numberValue(entry.Width),
      height: numberValue(entry.Height)
    } satisfies FxTextureView;
  }));

  return views
    .filter((texture): texture is FxTextureView => texture !== null)
    .sort((a, b) => a.index - b.index);
}

function formatTieLoadedClasses(stats: TieStats | null): string {
  if (!stats) {
    return '-';
  }

  return `${stats.loadedClasses.toLocaleString()} / ${stats.classIds.toLocaleString()}`;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function formatShrubLoadedClasses(stats: ShrubStats | null): string {
  if (!stats) {
    return '-';
  }

  return `${stats.loadedClasses.toLocaleString()} / ${stats.classIds.toLocaleString()}`;
}

function formatMobyLoadedClasses(stats: MobyStats | null): string {
  if (!stats) {
    return '-';
  }

  return `${stats.loadedClasses.toLocaleString()} / ${stats.classIds.toLocaleString()}`;
}

function readStoredDebugTuning(): MapSceneDebugTuning {
  if (typeof window === 'undefined') {
    return { ...defaultMapSceneDebugTuning };
  }

  try {
    const stored = window.localStorage.getItem(lightingDebugStorageKey);
    return stored
      ? { ...defaultMapSceneDebugTuning, ...(JSON.parse(stored) as Partial<MapSceneDebugTuning>) }
      : { ...defaultMapSceneDebugTuning };
  } catch {
    return { ...defaultMapSceneDebugTuning };
  }
}

function writeStoredDebugTuning(tuning: MapSceneDebugTuning): void {
  try {
    window.localStorage.setItem(lightingDebugStorageKey, JSON.stringify(tuning));
  } catch {
    // Debug tuning persistence is optional.
  }
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
