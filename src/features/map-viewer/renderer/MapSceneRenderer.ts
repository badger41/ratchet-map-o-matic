import * as THREE from 'three/webgpu';
import { WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  diffuseColor,
  dot,
  emissive,
  float,
  max,
  mix,
  mrt,
  output,
  pass,
  sRGBTransferEOTF,
  sRGBTransferOETF,
  step,
  uniform,
  vec3,
  vec4
} from 'three/tsl';
import type BloomNode from 'three/addons/tsl/display/BloomNode.js';
import type Node from 'three/src/nodes/core/Node.js';
import type PassNode from 'three/src/nodes/display/PassNode.js';
import type UniformNode from 'three/src/nodes/core/UniformNode.js';
import {
  defaultShrubRenderOptions,
  defaultSkyboxRenderOptions,
  defaultTieRenderOptions,
  defaultTfragMaterialOptions,
  type LoadedMapPackage,
  type MapSceneLoadStageUpdate,
  type MobyStats,
  type ShrubRenderOptions,
  type ShrubStats,
  type SkyboxRenderOptions,
  type SkyboxStats,
  type TieRenderOptions,
  type TieStats,
  type TfragMaterialOptions,
  type TfragStats
} from '../../../services/mapPackages/mapPackageTypes';
import type {
  DlMobyInstances,
  DlLevelSettings
} from '../../../services/wasm/ratchetPs2Wasm';
import {
  createInitialSceneCameraFrame,
  type SceneCameraStart
} from './camera/SceneCameraFraming';
import { tagTfragTextureSourceKeys, TfragMaterialController } from './TfragMaterialController';
import {
  FpsCameraController,
  type CameraVirtualMoveInput
} from './FpsCameraController';
import {
  assertWebGpuAvailable,
  createRendererDeviceLostError,
  createRendererInitializationError,
  createRendererRuntimeError,
  isKnownGpuDeviceLostError,
  type RendererDeviceLostInfo
} from './RendererCompatibility';
import {
  disposeObject3D,
  runRendererCleanup
} from './RendererDisposal';
import { yieldToBrowser } from './RendererTiming';
import { MobyInstanceController } from './mobys/MobyInstanceController';
import { MobySimulationController } from './mobys/MobySimulationController';
import {
  defaultWaterPlaneDebugOptions,
  setWaterPlaneDebugOptions,
  type WaterPlaneDebugOptions
} from './mobys/simulation/dl/2871/WaterPlane';
import { SkyboxController } from './skybox/SkyboxController';
import { mapLinearColorFromRgb96 } from './skybox/SkyboxBackground';
import { ShrubInstanceController } from './shrubs/ShrubInstanceController';
import { TieInstanceController } from './ties/TieInstanceController';
import { setTieBloomDistanceFadeRange } from './ties/TieMaterials';
import {
  createModelDisplayNodeOptions,
  defaultModelFogDebugOptions,
  setModelFog,
  setModelFogDebugOptions,
  setModelFamilyDisplayOptions,
  type ModelDisplayNodeOptions,
  type ModelFogDebugOptions
} from './ModelFog';
import type { TieMaterialMode } from './ties/TieTypes';
import {
  ps2SkyBloom,
  ps2SkyBloomProfileForGame,
  tightBloom,
  tightBloomVersion
} from './TightBloomNode';

interface MapSceneRendererOptions {
  container: HTMLElement;
  materialOptions?: TfragMaterialOptions;
  skyboxRenderOptions?: SkyboxRenderOptions;
  tieRenderOptions?: TieRenderOptions;
  shrubRenderOptions?: ShrubRenderOptions;
  levelSettings?: DlLevelSettings | null;
  mobyInstances?: DlMobyInstances | null;
  glowBloomEnabled?: boolean;
  glowBloomFalloffDistance?: number;
  mobySimulationEnabled?: boolean;
  frameRateLimit?: number;
  frameStatsDetailEnabled?: boolean;
  debugTuning?: Partial<MapSceneDebugTuning>;
  lightingDebugEnabled?: boolean;
  onLoadProgress: (update: MapSceneLoadStageUpdate) => void;
  onStatus: (status: string) => void;
  onTfragStats: (stats: TfragStats) => void;
  onSkyboxStats: (stats: SkyboxStats) => void;
  onTieStats: (stats: TieStats) => void;
  onShrubStats: (stats: ShrubStats) => void;
  onMobyStats: (stats: MobyStats) => void;
  onFrameStats?: (stats: MapSceneFrameStats) => void;
  onRuntimeError?: (message: string) => void;
}

interface TfragGltfSource {
  url: string;
  name: string;
  label: string;
}

const canvasClearColor = 0x070a0d;
const canvasClearAlpha = 1;
const statsUpdateIntervalMs = 500;
const defaultWorldDisplayLift = 2.4;
const dlWorldPositionScale = 1 / 1024;
const dlFogDistanceScale = dlWorldPositionScale;
const subtleSceneFogStrength = 0.3;
export const defaultGlowBloomFalloffDistance = 100;
const glowBloomFullStrengthRatio = 0.25;
const mobySimulationStepSeconds = 1 / 60;
const mobySimulationMaxStepsPerFrame = 5;

export interface MapSceneDebugTuning extends ModelFogDebugOptions, WaterPlaneDebugOptions {
  directionalFrontScale: number;
  directionalBackScale: number;
  directionalColorStrength: number;
  sceneExposure: number;
  tfragExposure: number;
  tieExposure: number;
  tieAmbientScale: number;
  shrubExposure: number;
  worldDisplayLift: number;
  tfragUplift: number;
  tieUplift: number;
  shrubUplift: number;
  tfragFogEnabled: boolean;
  tieFogEnabled: boolean;
  shrubFogEnabled: boolean;
  sceneHazeStrength: number;
}

export const defaultMapSceneDebugTuning: MapSceneDebugTuning = {
  ...defaultModelFogDebugOptions,
  ...defaultWaterPlaneDebugOptions,
  directionalFrontScale: 1,
  directionalBackScale: 0,
  directionalColorStrength: 1,
  sceneExposure: 0.8,
  tfragExposure: 0.9,
  tieExposure: 2,
  tieAmbientScale: 0.55,
  shrubExposure: 1,
  worldDisplayLift: defaultWorldDisplayLift,
  tfragUplift: 4,
  tieUplift: 1,
  shrubUplift: 1,
  tfragFogEnabled: true,
  tieFogEnabled: true,
  shrubFogEnabled: true,
  sceneHazeStrength: subtleSceneFogStrength
};

interface MapSceneEnvironment {
  backgroundColor: THREE.Color;
  fog: MapSceneFog | null;
}

interface MapSceneFog {
  color: THREE.Color;
  nearDistance: number;
  farDistance: number;
  nearIntensity: number;
  farIntensity: number;
}

export interface MapSceneFrameStats {
  fps: number;
  frameMs: number;
  submitMs: number;
  frameRateLimit: number;
  renderPasses: number;
  drawCalls: number;
  triangles: number;
  bloomStatus: string;
  bloomMs: number;
  bloomSources: number;
}

interface RendererRenderInfo {
  frameCalls?: number;
  drawCalls?: number;
  triangles?: number;
}

type PassTextureNode = ReturnType<PassNode['getTextureNode']>;

type MapRenderPipeline = {
  renderPipeline: THREE.RenderPipeline;
  skyPass: PassNode;
  scenePass: PassNode;
  bloomNodes: BloomNode[];
  bloomVersion: string;
};

interface SceneCompilePart {
  label: string;
  objects: THREE.Object3D[];
}

type BundleFlaggedObject = THREE.Object3D & {
  isBundleGroup?: boolean;
};

export class MapSceneRenderer {
  private readonly container: HTMLElement;
  private readonly onLoadProgress: (update: MapSceneLoadStageUpdate) => void;
  private readonly onStatus: (status: string) => void;
  private readonly onTfragStats: (stats: TfragStats) => void;
  private readonly onSkyboxStats: (stats: SkyboxStats) => void;
  private readonly onTieStats: (stats: TieStats) => void;
  private readonly onShrubStats: (stats: ShrubStats) => void;
  private readonly onMobyStats: (stats: MobyStats) => void;
  private readonly onFrameStats?: (stats: MapSceneFrameStats) => void;
  private readonly onRuntimeError?: (message: string) => void;
  private readonly scene = new THREE.Scene();
  private readonly skyScene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 50000);
  private readonly skyCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 50000);
  private readonly loader = new GLTFLoader();
  private readonly tfragController = new TfragMaterialController();
  private readonly skyboxController = new SkyboxController();
  private readonly tieController = new TieInstanceController();
  private readonly shrubController = new ShrubInstanceController();
  private readonly mobyController = new MobyInstanceController();
  private readonly mobySimulationController = new MobySimulationController();
  private readonly materialOptions: TfragMaterialOptions;
  private skyboxRenderOptions: SkyboxRenderOptions;
  private tieRenderOptions: TieRenderOptions;
  private shrubRenderOptions: ShrubRenderOptions;
  private readonly sceneEnvironment: MapSceneEnvironment;
  private readonly mobyInstances: DlMobyInstances | null;
  private readonly lightingDebugEnabled: boolean;
  private debugTuning: MapSceneDebugTuning;
  private renderer: WebGPURenderer | null = null;
  private baseRenderPipeline: MapRenderPipeline | null = null;
  private bloomRenderPipeline: MapRenderPipeline | null = null;
  private controls: FpsCameraController | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private pendingResizeFrame: number | null = null;
  private currentRoot: THREE.Object3D | null = null;
  private terrainRoot: THREE.Object3D | null = null;
  private currentPackage: LoadedMapPackage | null = null;
  private readonly worldDisplayLift = uniform(defaultWorldDisplayLift);
  private readonly sceneHazeStrength = uniform(subtleSceneFogStrength);
  private frameRateLimit: number;
  private minRenderIntervalMs: number;
  private glowBloomEnabled: boolean;
  private glowBloomRuntimeDisabled = false;
  private glowBloomFalloffDistance: number;
  private mobySimulationEnabled: boolean;
  private mobySimulationAccumulatorSeconds = 0;
  private lastMobySimulationTime = performance.now();
  private frameStatsDetailEnabled: boolean;
  private instanceBundleEnabled = false;
  private renderPaused = false;
  private animationRenderSuspended = false;
  private rendererUnavailable = false;
  private disposed = false;
  private lastRenderSubmitTime = 0;
  private lastFrameTime = performance.now();
  private lastStatsUpdateTime = this.lastFrameTime;
  private frameSampleTotalMs = 0;
  private submitSampleTotalMs = 0;
  private bloomSampleTotalMs = 0;
  private frameSampleCount = 0;
  private lastBloomStatus = 'off';

  constructor(options: MapSceneRendererOptions) {
    this.container = options.container;
    this.onLoadProgress = options.onLoadProgress;
    this.onStatus = options.onStatus;
    this.onTfragStats = options.onTfragStats;
    this.onSkyboxStats = options.onSkyboxStats;
    this.onTieStats = options.onTieStats;
    this.onShrubStats = options.onShrubStats;
    this.onMobyStats = options.onMobyStats;
    this.onFrameStats = options.onFrameStats;
    this.onRuntimeError = options.onRuntimeError;
    this.materialOptions = options.materialOptions ?? defaultTfragMaterialOptions;
    this.skyboxRenderOptions = options.skyboxRenderOptions ?? defaultSkyboxRenderOptions;
    this.tieRenderOptions = options.tieRenderOptions ?? defaultTieRenderOptions;
    this.shrubRenderOptions = options.shrubRenderOptions ?? defaultShrubRenderOptions;
    this.sceneEnvironment = resolveMapSceneEnvironment(options.levelSettings ?? null);
    this.mobyInstances = options.mobyInstances ?? null;
    this.lightingDebugEnabled = options.lightingDebugEnabled ?? false;
    this.debugTuning = resolveMapSceneDebugTuning(this.lightingDebugEnabled ? options.debugTuning : undefined);
    setModelFog(this.sceneEnvironment.fog);
    this.applyDebugTuning();
    this.glowBloomEnabled = options.glowBloomEnabled ?? false;
    this.glowBloomFalloffDistance = resolveGlowBloomFalloffDistance(options.glowBloomFalloffDistance);
    this.mobySimulationEnabled = options.mobySimulationEnabled ?? true;
    this.mobySimulationController.setEnabled(this.mobySimulationEnabled);
    this.frameStatsDetailEnabled = options.frameStatsDetailEnabled ?? false;
    this.frameRateLimit = resolveFrameRateLimit(options.frameRateLimit ?? 120);
    this.minRenderIntervalMs = frameIntervalForLimit(this.frameRateLimit);
  }

  async initialize(): Promise<void> {
    await assertWebGpuAvailable();

    this.scene.background = null;
    this.skyScene.background = this.sceneEnvironment.backgroundColor.clone().convertLinearToSRGB();

    const renderer = new WebGPURenderer({
      antialias: false,
      alpha: false
    });
    const defaultOnDeviceLost = renderer.onDeviceLost.bind(renderer);
    renderer.onDeviceLost = (info) => {
      defaultOnDeviceLost(info);
      this.handleDeviceLost(info);
    };

    try {
      await renderer.init();
    } catch (error) {
      renderer.dispose();
      throw createRendererInitializationError(error);
    }

    this.rendererUnavailable = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = false;
    renderer.setClearColor(canvasClearColor, canvasClearAlpha);
    renderer.setPixelRatio(1);
    renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    Object.assign(renderer.domElement.style, {
      display: 'block',
      width: '100%',
      height: '100%',
      outline: 'none',
      touchAction: 'none'
    });

    this.renderer = renderer;
    this.container.replaceChildren(renderer.domElement);
    this.controls = new FpsCameraController(this.camera, renderer.domElement);

    this.resizeObserver = new ResizeObserver(this.scheduleResize);
    this.resizeObserver.observe(this.container);
    window.addEventListener('resize', this.scheduleResize);
    window.visualViewport?.addEventListener('resize', this.scheduleResize);
    this.resize();
    this.start();
    this.onStatus('WebGPU renderer initialized');
  }

  async loadPackage(mapPackage: LoadedMapPackage): Promise<TfragStats> {
    if (!this.renderer) {
      throw new Error('Renderer has not initialized');
    }

    const loadStartMs = performance.now();
    this.logTimingStart('load package');
    this.animationRenderSuspended = true;
    this.disposeRenderPipelines();
    this.disposeCurrentRoot();
    this.currentPackage = mapPackage;

    const root = new THREE.Group();
    root.name = 'map_package';
    const modelDisplayOptions = this.createModelDisplayNodeOptions();

    try {
      const skyboxPromise = this.timeAsyncStep('load skybox', () => this.loadSkybox(mapPackage));
      const loadPromises = [
        this.timeAsyncStep('load terrain', () => this.loadTerrain(root, mapPackage, modelDisplayOptions)),
        skyboxPromise,
        skyboxPromise.then(() => this.timeAsyncStep('load ties', () => this.loadTies(root, mapPackage, modelDisplayOptions))),
        this.timeAsyncStep('load shrubs', () => this.loadShrubs(root, mapPackage, modelDisplayOptions)),
        this.timeAsyncStep('load mobys', () => this.loadMobys(root, mapPackage, modelDisplayOptions))
      ] as const;
      let loadResults;
      try {
        loadResults = await Promise.all(loadPromises);
      } catch (error: unknown) {
        await Promise.allSettled(loadPromises);
        throw error;
      }
      const [tfragStats, skyboxStats, tieStats, shrubStats, mobyStats] = loadResults;
      await this.timeAsyncStep('load moby simulation', () => this.mobySimulationController.load(
        root,
        mapPackage,
        this.mobyInstances,
        this.mobyController,
        this.tieController,
        this.camera
      ));
      this.tieController.moveAlphaBlendPassToEnd();
      this.shrubController.moveAlphaBlendPassToEnd();
      this.mobyController.moveAlphaBlendPassToEnd();
      this.mobySimulationController.setEnabled(this.mobySimulationEnabled);
      this.resetMobySimulationClock(performance.now());

      await this.timeAsyncStep('first frame setup', () => this.prepareFirstFrame(root));
      this.onLoadProgress({
        id: 'compile',
        status: 'done',
        detail: 'Ready'
      });
      this.onStatus([
        `${tfragStats.triangles.toLocaleString()} terrain triangles`,
        skyboxStats.loaded ? `${skyboxStats.shells.toLocaleString()} skybox shells` : null,
        tieStats.renderedInstances > 0 ? `${tieStats.renderedInstances.toLocaleString()} tie instances` : null,
        shrubStats.renderedInstances > 0 ? `${shrubStats.renderedInstances.toLocaleString()} shrub instances` : null,
        mobyStats.renderedInstances > 0 ? `${mobyStats.renderedInstances.toLocaleString()} moby instances` : null
      ].filter(Boolean).join(', '));
      this.logTimingEnd('load package', loadStartMs);
      return tfragStats;
    } catch (error: unknown) {
      this.logTimingEnd('load package failed', loadStartMs);
      const loadError = createRendererRuntimeError(error);
      this.animationRenderSuspended = false;
      this.cleanupFailedPackageLoad(root, mapPackage);
      throw loadError;
    }
  }

  private async loadTerrain(
    root: THREE.Object3D,
    mapPackage: LoadedMapPackage,
    modelDisplayOptions: ModelDisplayNodeOptions
  ): Promise<TfragStats> {
    const tfragSources = getTfragGltfSources(mapPackage);
    if (tfragSources.length === 0) {
      const tfragStats: TfragStats = {
        meshes: 0,
        sourcePrimitives: 0,
        triangles: 0,
        lod0Triangles: null,
        directionalLightRecords: mapPackage.directionalLights.length,
        materialRebakes: 0
      };
      this.onTfragStats(tfragStats);
      this.onLoadProgress({ id: 'tfrag', status: 'done', detail: 'Skipped' });
      return tfragStats;
    }

    const tfragRoot = new THREE.Group();
    tfragRoot.name = 'level_tfrag';
    root.add(tfragRoot);
    this.terrainRoot = tfragRoot;
    this.onStatus(tfragSources.length === 1 ? 'Loading tfrag glTF' : `Loading ${tfragSources.length} tfrag glTFs`);

    for (const [index, source] of tfragSources.entries()) {
      this.onLoadProgress({
        id: 'tfrag',
        status: 'active',
        detail: `Loading ${source.label}`,
        loaded: index,
        total: tfragSources.length
      });
      const gltf = await this.loader.loadAsync(source.url);
      tagTfragTextureSourceKeys(gltf, source.url);
      gltf.scene.name = source.name;
      tfragRoot.add(gltf.scene);
    }

    this.onLoadProgress({ id: 'tfrag', status: 'active', detail: 'Preparing materials' });
    await yieldToBrowser();
    const tfragStats = this.tfragController.prepare(
      tfragRoot,
      mapPackage.directionalLights,
      this.resolveTfragMaterialOptions(),
      modelDisplayOptions
    );
    this.onTfragStats(tfragStats);
    this.onLoadProgress({
      id: 'tfrag',
      status: 'done',
      detail: `${tfragStats.triangles.toLocaleString()} triangles`
    });
    return tfragStats;
  }

  private async loadSkybox(mapPackage: LoadedMapPackage): Promise<SkyboxStats> {
    if (!this.renderer) {
      throw new Error('Renderer has not initialized');
    }

    this.onLoadProgress({ id: 'skybox', status: 'active', detail: 'Loading glTF' });
    this.onStatus('Loading skybox');
    const skyboxStats = await this.skyboxController.load(
      this.skyScene,
      mapPackage,
      this.loader,
      this.skyboxRenderOptions
    );
    this.onSkyboxStats(skyboxStats);
    this.onLoadProgress({
      id: 'skybox',
      status: 'done',
      detail: skyboxStats.loaded ? `${skyboxStats.shells.toLocaleString()} shells` : 'No skybox'
    });
    return skyboxStats;
  }

  private async loadTies(
    root: THREE.Object3D,
    mapPackage: LoadedMapPackage,
    modelDisplayOptions: ModelDisplayNodeOptions
  ): Promise<TieStats> {
    this.onLoadProgress({ id: 'ties', status: 'active', detail: 'Preparing instances' });
    this.onStatus('Loading tie instances');
    const tieStats = await this.tieController.load(
      root,
      mapPackage,
      this.loader,
      this.resolveTieRenderOptions(),
      this.skyboxController.getReflectionTexture(),
      modelDisplayOptions,
      (loaded, total) => {
        this.onLoadProgress({
          id: 'ties',
          status: 'active',
          detail: `${loaded.toLocaleString()} / ${total.toLocaleString()} classes`,
          loaded,
          total
        });
      }
    );
    this.tieController.setBundleEnabled(this.instanceBundleEnabled);
    this.onTieStats(tieStats);
    this.onLoadProgress({
      id: 'ties',
      status: 'done',
      detail: tieStats.renderedInstances > 0
        ? `${tieStats.renderedInstances.toLocaleString()} instances`
        : 'No ties'
    });
    return tieStats;
  }

  private async loadShrubs(
    root: THREE.Object3D,
    mapPackage: LoadedMapPackage,
    modelDisplayOptions: ModelDisplayNodeOptions
  ): Promise<ShrubStats> {
    this.onLoadProgress({ id: 'shrubs', status: 'active', detail: 'Preparing instances' });
    this.onStatus('Loading shrub instances');
    const shrubStats = await this.shrubController.load(
      root,
      mapPackage,
      this.loader,
      this.resolveShrubRenderOptions(),
      modelDisplayOptions,
      (loaded, total) => {
        this.onLoadProgress({
          id: 'shrubs',
          status: 'active',
          detail: `${loaded.toLocaleString()} / ${total.toLocaleString()} classes`,
          loaded,
          total
        });
      }
    );
    this.shrubController.setBundleEnabled(this.instanceBundleEnabled);
    this.onShrubStats(shrubStats);
    this.onLoadProgress({
      id: 'shrubs',
      status: 'done',
      detail: shrubStats.renderedInstances > 0
        ? `${shrubStats.renderedInstances.toLocaleString()} instances`
        : 'No shrubs'
    });
    return shrubStats;
  }

  private async loadMobys(
    root: THREE.Object3D,
    mapPackage: LoadedMapPackage,
    modelDisplayOptions: ModelDisplayNodeOptions
  ): Promise<MobyStats> {
    this.onLoadProgress({ id: 'mobys', status: 'active', detail: 'Preparing instances' });
    this.onStatus('Loading moby instances');
    const mobyStats = await this.mobyController.load(
      root,
      mapPackage,
      this.loader,
      this.mobyInstances,
      this.resolveShrubRenderOptions(),
      modelDisplayOptions,
      (loaded, total) => {
        this.onLoadProgress({
          id: 'mobys',
          status: 'active',
          detail: `${loaded.toLocaleString()} / ${total.toLocaleString()} classes`,
          loaded,
          total
        });
      }
    );
    this.mobyController.setBundleEnabled(this.instanceBundleEnabled);
    this.onMobyStats(mobyStats);
    this.onLoadProgress({
      id: 'mobys',
      status: 'done',
      detail: mobyStats.renderedInstances > 0
        ? `${mobyStats.renderedInstances.toLocaleString()} instances`
        : 'No mobys'
    });
    return mobyStats;
  }

  private async prepareFirstFrame(root: THREE.Object3D): Promise<void> {
    const compileParts = this.getSceneCompileParts(root);
    const compileStepCount = compileParts.length + (this.skyboxController.isVisible() ? 1 : 0);
    const mayPrepareBloom = this.glowBloomEnabled && this.tieController.hasGlowBloomSources();
    const buildsCompleteSceneWithMobys = compileParts.at(-1)?.label === 'mobys';
    const totalSteps = (buildsCompleteSceneWithMobys ? 2 : 3) + compileStepCount + (mayPrepareBloom ? 1 : 0);

    this.reportFirstFrameProgress('Attaching scene', 1, totalSteps);
    await yieldToBrowser();
    let stepStartMs = this.startTiming('first frame attach scene');
    this.scene.add(root);
    this.currentRoot = root;
    this.reportFirstFrameProgress(`Attached scene (${formatElapsedMs(stepStartMs)})`, 1, totalSteps);
    this.logTimingEnd('first frame attach scene', stepStartMs);

    this.reportFirstFrameProgress('Framing camera', 2, totalSteps);
    await yieldToBrowser();
    stepStartMs = this.startTiming('first frame camera framing');
    this.resize(false);
    this.frameObject();
    this.reportFirstFrameProgress(`Framed camera (${formatElapsedMs(stepStartMs)})`, 2, totalSteps);
    this.logTimingEnd('first frame camera framing', stepStartMs);

    const hasBloomPipeline = this.shouldPrepareBloomPipeline();
    const pipeline = this.ensureRenderPipeline(false);
    let nextStep = 3;
    let completeSceneDrawn = false;
    if (pipeline) {
      const bundleGroups = this.disableVisibleBundleGroupsForCompile();
      const visibleObjects = new Map(
        compileParts.flatMap((part) => part.objects).map((object) => [object, object.visible] as const)
      );
      try {
        for (const object of visibleObjects.keys()) {
          object.visible = false;
        }

        if (this.skyboxController.isVisible()) {
          this.reportFirstFrameProgress('Compiling skybox', nextStep, totalSteps);
          await yieldToBrowser();
          stepStartMs = this.startTiming('first frame compile skybox');
          await pipeline.skyPass.compileAsync(this.renderer!);
          this.logTimingEnd('first frame compile skybox', stepStartMs);
          nextStep += 1;
        }

        for (const part of compileParts) {
          for (const object of part.objects) {
            object.visible = visibleObjects.get(object) ?? false;
          }
          const buildsInstances = part.label === 'ties' || part.label === 'mobys';
          const batchCount = part.label === 'ties'
            ? this.tieController.getStats().batches
            : this.mobyController.getStats().batches;
          const buildsCompleteScene = buildsCompleteSceneWithMobys && part.label === 'mobys';
          const compileDetail = buildsInstances
            ? `Building ${batchCount.toLocaleString()} ${part.label} batches${buildsCompleteScene ? ' and complete scene' : ''}`
            : `Compiling ${part.label}`;
          this.reportFirstFrameProgress(compileDetail, nextStep, totalSteps);
          await yieldToBrowser();
          const timingLabel = `first frame ${buildsInstances ? 'build' : 'compile'} ${part.label}`;
          stepStartMs = this.startTiming(timingLabel);
          if (buildsInstances) {
            if (buildsCompleteScene) {
              for (const [object, visible] of visibleObjects) {
                object.visible = visible;
              }
            }
            const programCount = this.renderer!.info.memory.programs;
            this.renderWithPipeline(false);
            console.log(
              `[MapSceneRenderer timing] ${part.label} GPU programs created: ${(this.renderer!.info.memory.programs - programCount).toLocaleString()}`
            );
            completeSceneDrawn = buildsCompleteScene;
          } else {
            await pipeline.scenePass.compileAsync(this.renderer!);
          }
          this.logTimingEnd(timingLabel, stepStartMs);
          if (!buildsCompleteScene) {
            for (const object of part.objects) {
              object.visible = false;
            }
          }
          nextStep += 1;
        }
      } finally {
        for (const [object, visible] of visibleObjects) {
          object.visible = visible;
        }
        this.restoreBundleGroupsAfterCompile(bundleGroups);
      }
    }

    if (!completeSceneDrawn) {
      this.reportFirstFrameProgress('Drawing complete scene', nextStep, totalSteps);
      await yieldToBrowser();
      stepStartMs = this.startTiming('first frame scene draw');
      this.renderWithPipeline(false);
      this.reportFirstFrameProgress(`Drew complete scene (${formatElapsedMs(stepStartMs)})`, nextStep, totalSteps);
      this.logTimingEnd('first frame scene draw', stepStartMs);
      nextStep += 1;
    }

    if (hasBloomPipeline) {
      this.reportFirstFrameProgress('Enabling bloom overlay', nextStep, totalSteps);
      await yieldToBrowser();
      stepStartMs = this.startTiming('first frame bloom pipeline');
      try {
        await this.prepareRenderPipeline(true, 'first frame bloom');
        this.reportFirstFrameProgress(`Enabled bloom overlay (${formatElapsedMs(stepStartMs)})`, nextStep, totalSteps);
        this.logTimingEnd('first frame bloom pipeline', stepStartMs);
      } catch (error: unknown) {
        if (!this.disableBloomAfterError(error)) {
          throw error;
        }

        this.reportFirstFrameProgress(`Disabled bloom overlay (${formatElapsedMs(stepStartMs)})`, nextStep, totalSteps);
        this.logTimingEnd('first frame bloom disabled', stepStartMs);
      }
      nextStep += 1;
    }

    this.lastFrameTime = performance.now();
    this.lastStatsUpdateTime = this.lastFrameTime;
    this.resetMobySimulationClock(this.lastFrameTime);
    this.animationRenderSuspended = false;
    // ponytail: submitted work is enough for readiness; wait for the GPU queue only if callers require completion semantics.
    this.lastRenderSubmitTime = 0;
  }

  private reportFirstFrameProgress(detail: string, loaded: number, total: number): void {
    this.onLoadProgress({
      id: 'compile',
      status: 'active',
      detail,
      loaded,
      total
    });
    this.onStatus(detail);
  }

  private async timeAsyncStep<T>(label: string, run: () => Promise<T>): Promise<T> {
    const startMs = this.startTiming(label);
    try {
      const result = await run();
      this.logTimingEnd(label, startMs);
      return result;
    } catch (error: unknown) {
      this.logTimingEnd(`${label} failed`, startMs);
      throw error;
    }
  }

  private startTiming(label: string): number {
    this.logTimingStart(label);
    return performance.now();
  }

  private logTimingStart(label: string): void {
    console.log(`[MapSceneRenderer timing] ${label} started`);
  }

  private logTimingEnd(label: string, startMs: number): void {
    console.log(`[MapSceneRenderer timing] ${label}: ${formatElapsedMs(startMs)}`);
  }

  private getSceneCompileParts(root: THREE.Object3D): SceneCompilePart[] {
    return [
      createSceneCompilePart('terrain', this.terrainRoot),
      createSceneCompilePart('ties', root.getObjectByName('tie_instances'), root.getObjectByName('tie_alpha_blend_instances')),
      createSceneCompilePart('shrubs', root.getObjectByName('shrub_instances'), root.getObjectByName('shrub_alpha_blend_instances')),
      createSceneCompilePart(
        'mobys',
        root.getObjectByName('moby_instances'),
        root.getObjectByName('moby_alpha_blend_instances'),
        root.getObjectByName('moby_simulation'))
    ].filter((part): part is SceneCompilePart => part !== null);
  }

  dispose(): void {
    this.disposed = true;
    this.rendererUnavailable = true;
    this.animationRenderSuspended = true;
    this.renderer?.setAnimationLoop(null);
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.scheduleResize);
    window.visualViewport?.removeEventListener('resize', this.scheduleResize);
    if (this.pendingResizeFrame !== null) {
      window.cancelAnimationFrame(this.pendingResizeFrame);
      this.pendingResizeFrame = null;
    }

    this.controls?.dispose();
    this.disposeCurrentRoot();
    this.skyboxController.dispose();
    this.tieController.dispose();
    this.shrubController.dispose();
    this.mobyController.dispose();
    this.mobySimulationController.dispose();
    this.disposeRenderPipelines();
    this.renderer?.dispose();
    this.container.replaceChildren();
  }

  setFrameRateLimit(limit: number): void {
    this.frameRateLimit = resolveFrameRateLimit(limit);
    this.minRenderIntervalMs = frameIntervalForLimit(this.frameRateLimit);
    this.lastRenderSubmitTime = 0;
    this.frameSampleTotalMs = 0;
    this.submitSampleTotalMs = 0;
    this.frameSampleCount = 0;
    this.onFrameStats?.({
      fps: 0,
      frameMs: 0,
      submitMs: 0,
      frameRateLimit: this.frameRateLimit,
      renderPasses: 0,
      drawCalls: 0,
      triangles: 0,
      bloomStatus: 'off',
      bloomMs: 0,
      bloomSources: 0
    });
  }

  setRenderPaused(paused: boolean): void {
    this.renderPaused = paused;
    this.lastRenderSubmitTime = 0;
    this.resetMobySimulationClock(performance.now());
  }

  setFrameStatsDetailEnabled(enabled: boolean): void {
    this.frameStatsDetailEnabled = enabled;
    this.submitSampleTotalMs = 0;
    this.bloomSampleTotalMs = 0;
  }

  setVirtualMoveInput(input: CameraVirtualMoveInput): void {
    this.controls?.setVirtualMoveInput(input);
  }

  setSkyboxRenderOptions(options: SkyboxRenderOptions): SkyboxStats | null {
    this.skyboxRenderOptions = options;
    const stats = this.skyboxController.setOptions(options);
    if (stats) {
      this.onSkyboxStats(stats);
    }

    return stats;
  }

  setTerrainVisible(visible: boolean): void {
    if (this.terrainRoot) {
      this.terrainRoot.visible = visible;
    }
  }

  setTieVisible(visible: boolean): void {
    this.tieController.setVisible(visible);
  }

  setMobyVisible(visible: boolean): void {
    this.mobyController.setVisible(visible);
  }

  setMobySimulationEnabled(enabled: boolean): void {
    this.mobySimulationEnabled = enabled;
    this.mobySimulationController.setEnabled(enabled);
    this.resetMobySimulationClock(performance.now());
  }

  setTieMaterialMode(mode: TieMaterialMode): void {
    this.tieController.setMaterialMode(mode);
  }

  setTieBundleEnabled(enabled: boolean): void {
    this.instanceBundleEnabled = enabled;
    this.tieController.setBundleEnabled(enabled);
    this.shrubController.setBundleEnabled(enabled);
    this.mobyController.setBundleEnabled(enabled);
  }

  setGlowBloomEnabled(enabled: boolean): void {
    this.glowBloomEnabled = enabled;
    if (enabled) {
      this.glowBloomRuntimeDisabled = false;
    }
    if (!enabled) {
      this.disposeRenderPipeline(true);
    }
    this.lastRenderSubmitTime = 0;
  }

  setGlowBloomFalloffDistance(distance: number): void {
    this.glowBloomFalloffDistance = resolveGlowBloomFalloffDistance(distance);
    this.lastRenderSubmitTime = 0;
  }

  setDebugTuning(tuning: Partial<MapSceneDebugTuning>): void {
    if (!this.lightingDebugEnabled) {
      return;
    }

    const previousTfragOptions = this.resolveTfragMaterialOptions();
    this.debugTuning = resolveMapSceneDebugTuning(tuning);
    this.applyDebugTuning();

    const nextTfragOptions = this.resolveTfragMaterialOptions();
    if (this.currentPackage && this.terrainRoot && !sameTfragBakeOptions(previousTfragOptions, nextTfragOptions)) {
      this.onTfragStats(this.tfragController.update(this.currentPackage.directionalLights, nextTfragOptions));
    }

    this.tieController.updateLightingOptions(this.resolveTieRenderOptions());
    this.shrubController.updateLightingOptions(this.resolveShrubRenderOptions());
    this.mobyController.updateLightingOptions(this.resolveShrubRenderOptions());

    this.lastRenderSubmitTime = 0;
  }

  setTieRenderOptions(options: TieRenderOptions): TieStats | null {
    this.tieRenderOptions = options;
    const stats = this.tieController.setOptions(this.resolveTieRenderOptions());
    if (stats) {
      this.onTieStats(stats);
    }

    return stats;
  }

  setShrubRenderOptions(options: ShrubRenderOptions): ShrubStats | null {
    this.shrubRenderOptions = options;
    const stats = this.shrubController.setOptions(this.resolveShrubRenderOptions());
    this.mobyController.updateLightingOptions(this.resolveShrubRenderOptions());
    if (stats) {
      this.onShrubStats(stats);
    }

    return stats;
  }

  private applyDebugTuning(): void {
    setModelFogDebugOptions(this.debugTuning);
    setModelFamilyDisplayOptions(this.debugTuning);
    setWaterPlaneDebugOptions(this.debugTuning);
    this.worldDisplayLift.value = finiteNonNegative(this.debugTuning.worldDisplayLift, defaultWorldDisplayLift);
    this.sceneHazeStrength.value = finiteNonNegative(this.debugTuning.sceneHazeStrength, subtleSceneFogStrength);
  }

  private createModelDisplayNodeOptions(): ModelDisplayNodeOptions {
    return createModelDisplayNodeOptions(
      this.sceneEnvironment.fog,
      this.debugTuning,
      this.debugTuning,
      this.lightingDebugEnabled
    );
  }

  private resolveTfragMaterialOptions(): TfragMaterialOptions {
    const exposure = finiteNonNegative(this.debugTuning.sceneExposure, 1) * finiteNonNegative(this.debugTuning.tfragExposure, 1);
    return {
      ...this.materialOptions,
      exposure: this.materialOptions.exposure * exposure,
      directionalFrontIntensity: finiteNonNegative(this.debugTuning.directionalFrontScale, defaultMapSceneDebugTuning.directionalFrontScale),
      directionalBackIntensity: finiteNonNegative(this.debugTuning.directionalBackScale, defaultMapSceneDebugTuning.directionalBackScale)
    };
  }

  private resolveTieRenderOptions(): TieRenderOptions {
    const exposure = finiteNonNegative(this.debugTuning.sceneExposure, 1) * finiteNonNegative(this.debugTuning.tieExposure, 1);
    return {
      ...this.tieRenderOptions,
      ambientIntensity: this.tieRenderOptions.ambientIntensity * finiteNonNegative(this.debugTuning.tieAmbientScale, 1),
      directionalColorStrength: finiteNonNegative(this.debugTuning.directionalColorStrength, defaultMapSceneDebugTuning.directionalColorStrength),
      exposure: this.tieRenderOptions.exposure * exposure,
      directionalFrontIntensity: finiteNonNegative(this.debugTuning.directionalFrontScale, defaultMapSceneDebugTuning.directionalFrontScale),
      directionalBackIntensity: finiteNonNegative(this.debugTuning.directionalBackScale, defaultMapSceneDebugTuning.directionalBackScale)
    };
  }

  private resolveShrubRenderOptions(): ShrubRenderOptions {
    const exposure = finiteNonNegative(this.debugTuning.sceneExposure, 1) * finiteNonNegative(this.debugTuning.shrubExposure, 1);
    return {
      ...this.shrubRenderOptions,
      directionalColorStrength: finiteNonNegative(this.debugTuning.directionalColorStrength, defaultMapSceneDebugTuning.directionalColorStrength),
      exposure: this.shrubRenderOptions.exposure * exposure,
      directionalFrontIntensity: finiteNonNegative(this.debugTuning.directionalFrontScale, defaultMapSceneDebugTuning.directionalFrontScale),
      directionalBackIntensity: finiteNonNegative(this.debugTuning.directionalBackScale, defaultMapSceneDebugTuning.directionalBackScale)
    };
  }

  private start(): void {
    this.lastFrameTime = performance.now();
    this.lastStatsUpdateTime = this.lastFrameTime;
    this.renderer?.setAnimationLoop((time) => this.handleAnimationFrame(time));
  }

  private readonly scheduleResize = (): void => {
    if (this.pendingResizeFrame !== null) {
      return;
    }

    this.pendingResizeFrame = window.requestAnimationFrame(() => {
      this.pendingResizeFrame = null;
      this.resize();
    });
  };

  private handleAnimationFrame(time: DOMHighResTimeStamp): void {
    if (this.renderPaused || this.animationRenderSuspended || this.rendererUnavailable) {
      this.resetMobySimulationClock(time);
      return;
    }

    try {
      this.updateMobySimulation(time);
      if (this.minRenderIntervalMs > 0 && this.lastRenderSubmitTime > 0) {
        const elapsedMs = time - this.lastRenderSubmitTime;
        if (elapsedMs < this.minRenderIntervalMs - 0.35) {
          return;
        }
      }

      this.lastRenderSubmitTime = time;
      this.renderFrame(time);
    } catch (error: unknown) {
      this.reportRendererRuntimeError(error);
    }
  }

  private updateMobySimulation(time: DOMHighResTimeStamp): void {
    if (!this.mobySimulationEnabled) {
      this.resetMobySimulationClock(time);
      return;
    }

    const deltaSeconds = Math.max(0, Math.min((time - this.lastMobySimulationTime) / 1000, 0.25));
    this.lastMobySimulationTime = time;
    this.mobySimulationAccumulatorSeconds += deltaSeconds;

    let steps = 0;
    while (this.mobySimulationAccumulatorSeconds >= mobySimulationStepSeconds && steps < mobySimulationMaxStepsPerFrame) {
      this.mobySimulationController.fixedUpdate(mobySimulationStepSeconds);
      this.mobySimulationAccumulatorSeconds -= mobySimulationStepSeconds;
      steps += 1;
    }

    if (steps === mobySimulationMaxStepsPerFrame) {
      this.mobySimulationAccumulatorSeconds = 0;
    }
  }

  private resetMobySimulationClock(time: DOMHighResTimeStamp): void {
    this.lastMobySimulationTime = time;
    this.mobySimulationAccumulatorSeconds = 0;
  }

  private renderFrame(time: DOMHighResTimeStamp): void {
    if (!this.renderer || this.rendererUnavailable) {
      return;
    }

    const collectDetails = this.frameStatsDetailEnabled;
    const submitStartMs = collectDetails ? performance.now() : 0;
    const frameMs = time - this.lastFrameTime;
    this.lastFrameTime = time;
    if (frameMs > 0 && frameMs < 250) {
      this.frameSampleTotalMs += frameMs;
      this.frameSampleCount += 1;
    }

    this.controls?.update(frameMs / 1000);
    this.skyboxController.update(time / 1000);
    this.mobySimulationController.renderUpdate(time / 1000);
    this.skyboxController.syncCamera(this.camera, this.skyCamera);
    const bloomStartMs = collectDetails ? performance.now() : 0;
    this.lastBloomStatus = this.resolveGlowBloomStatus();
    const includeBloom = this.lastBloomStatus === 'rendered';
    if (includeBloom) {
      this.syncBloomFadeRange();
    }
    try {
      this.renderWithPipeline(includeBloom);
    } catch (error: unknown) {
      if (!includeBloom || !this.disableBloomAfterError(error)) {
        throw error;
      }

      this.renderWithPipeline(false);
    }
    if (collectDetails) {
      this.bloomSampleTotalMs += performance.now() - bloomStartMs;
    }

    if (collectDetails) {
      this.submitSampleTotalMs += performance.now() - submitStartMs;
    }

    if (this.onFrameStats && time - this.lastStatsUpdateTime >= statsUpdateIntervalMs) {
      const averageFrameMs = this.frameSampleTotalMs / Math.max(1, this.frameSampleCount);
      const averageSubmitMs = collectDetails ? this.submitSampleTotalMs / Math.max(1, this.frameSampleCount) : 0;
      const renderInfo = collectDetails ? this.renderer.info.render as RendererRenderInfo : null;
      this.onFrameStats({
        fps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
        frameMs: averageFrameMs,
        submitMs: averageSubmitMs,
        frameRateLimit: this.frameRateLimit,
        renderPasses: renderInfo?.frameCalls ?? 0,
        drawCalls: renderInfo?.drawCalls ?? 0,
        triangles: renderInfo?.triangles ?? 0,
        bloomStatus: this.lastBloomStatus,
        bloomMs: collectDetails ? this.bloomSampleTotalMs / Math.max(1, this.frameSampleCount) : 0,
        bloomSources: collectDetails ? this.tieController.getGlowBloomSourceCount() : 0
      });
      this.lastStatsUpdateTime = time;
      this.frameSampleTotalMs = 0;
      this.submitSampleTotalMs = 0;
      this.bloomSampleTotalMs = 0;
      this.frameSampleCount = 0;
    }
  }

  private resize(render = true): void {
    if (!this.renderer || this.rendererUnavailable) {
      return;
    }
    if (this.animationRenderSuspended && render) {
      this.lastRenderSubmitTime = 0;
      return;
    }

    try {
      const width = Math.max(1, this.container.clientWidth);
      const height = Math.max(1, this.container.clientHeight);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.skyCamera.aspect = width / height;
      this.skyCamera.updateProjectionMatrix();
      this.renderer.setSize(width, height, false);

      this.lastRenderSubmitTime = 0;
      if (render) {
        this.renderFrame(performance.now());
      }
    } catch (error: unknown) {
      this.reportRendererRuntimeError(error);
    }
  }

  private ensureRenderPipeline(includeBloom: boolean): MapRenderPipeline | null {
    if (!this.renderer) {
      return null;
    }

    const currentPipeline = includeBloom ? this.bloomRenderPipeline : this.baseRenderPipeline;
    if (currentPipeline?.bloomVersion === tightBloomVersion) {
      return currentPipeline;
    }
    this.disposeRenderPipeline(includeBloom);

    const skyPass = pass(this.skyScene, this.skyCamera);
    const scenePass = pass(this.scene, this.camera);
    const hasSkyboxBloom = this.skyboxController.hasBloomLayers();
    const skyBloomProfile = ps2SkyBloomProfileForGame(this.currentPackage?.rootManifest.Game);
    if (hasSkyboxBloom && skyBloomProfile === 'uya') {
      const frameAlpha = diffuseColor.a.mul(128).floor().div(128);
      const alphaWrite = step(float(8 / 128), frameAlpha);
      const skyMrt = mrt({ output, frameAlpha: vec4(frameAlpha, 0, 0, alphaWrite) });
      const frameAlphaBlend = new THREE.BlendMode(THREE.CustomBlending);
      frameAlphaBlend.blendSrc = THREE.SrcAlphaFactor;
      frameAlphaBlend.blendDst = THREE.OneMinusSrcAlphaFactor;
      frameAlphaBlend.blendEquation = THREE.AddEquation;
      skyMrt.setBlendMode('frameAlpha', frameAlphaBlend);
      skyPass.setMRT(skyMrt);
    } else if (hasSkyboxBloom) {
      const skyMrt = mrt({ output, bloomSource: vec4(emissive, diffuseColor.a) });
      skyMrt.setBlendMode('bloomSource', new THREE.BlendMode(THREE.MaterialBlending));
      skyPass.setMRT(skyMrt);
    }
    if (includeBloom) {
      scenePass.setMRT(mrt({
        output,
        emissive
      }));
    }

    const sceneColor = scenePass.getTextureNode('output');
    const skyColor = skyPass.getTextureNode('output');
    // Sky shells were composited in the PS2's nonlinear framebuffer space.
    const linearSkyRgb = sRGBTransferEOTF(skyColor.rgb) as Node<'vec3'>;
    const linearSkyColor = vec4(linearSkyRgb, skyColor.a);
    const sceneWithLift = createWorldLiftNode(sceneColor, this.worldDisplayLift);
    const sceneWithAtmosphere = createSubtleFoggedSceneNode(sceneWithLift, scenePass, this.sceneEnvironment.fog, this.sceneHazeStrength);
    const sceneOverSky = mix(linearSkyColor, sceneWithAtmosphere, sceneColor.a);
    const encodedSceneRgb = sRGBTransferOETF(sceneOverSky.rgb) as Node<'vec3'>;
    let skyBloomPass: BloomNode | null = null;
    if (hasSkyboxBloom) {
      // getTextureNode allocates an attachment, so only request auxiliary MRT outputs that exist.
      const skyBloomSource = skyBloomProfile === 'uya'
        ? vec4(skyColor.rgb, skyPass.getTextureNode('frameAlpha').r)
        : skyPass.getTextureNode('bloomSource');
      skyBloomPass = ps2SkyBloom(
        vec4(
          skyBloomSource.rgb.mul(float(1).sub(sceneColor.a)),
          skyBloomProfile === 'uya' ? skyBloomSource.a : sceneOverSky.a
        ),
        skyBloomProfile
      );
    }
    const tieBloomPass = includeBloom
      ? tightBloom(scenePass.getTextureNode('emissive'), 0.45, 0, 0)
      : null;
    const sceneWithSkyBloom = skyBloomPass
      ? vec4(
        sRGBTransferEOTF(encodedSceneRgb.add(skyBloomPass.rgb)) as Node<'vec3'>,
        sceneOverSky.a
      )
      : sceneOverSky;
    const binding: MapRenderPipeline = {
      renderPipeline: new THREE.RenderPipeline(
        this.renderer,
        tieBloomPass ? sceneWithSkyBloom.add(tieBloomPass) : sceneWithSkyBloom
      ),
      skyPass,
      scenePass,
      bloomNodes: [skyBloomPass, tieBloomPass].filter((node): node is BloomNode => node !== null),
      bloomVersion: tightBloomVersion
    };

    if (includeBloom) {
      this.bloomRenderPipeline = binding;
    } else {
      this.baseRenderPipeline = binding;
    }
    return binding;
  }

  private renderWithPipeline(includeBloom: boolean): void {
    if (!this.renderer) {
      return;
    }

    const pipeline = this.ensureRenderPipeline(includeBloom);
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(canvasClearColor, 0);
    this.renderer.clear(true, true, true);
    pipeline?.renderPipeline.render();
  }

  private resolveGlowBloomStatus(): string {
    if (!this.renderer || !this.glowBloomEnabled || !this.tieController.hasGlowBloomSources()) {
      return this.glowBloomEnabled ? 'none' : 'off';
    }
    if (this.glowBloomRuntimeDisabled) {
      return 'failed';
    }
    if (!this.tieController.hasGlowBloomSourceNear(this.camera.position, this.glowBloomFalloffDistance)) {
      return 'source-range';
    }

    return 'rendered';
  }

  private frameObject(): void {
    const frame = createInitialSceneCameraFrame(this.resolveStartupCameraStart());
    this.camera.near = frame.near;
    this.camera.far = frame.far;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(frame.position);
    this.camera.lookAt(frame.target);
    this.controls?.setSceneRadius(frame.radius);
    this.controls?.syncFromCamera();
  }

  private resolveStartupCameraStart(): SceneCameraStart | null {
    return this.tieController.getStartupCameraStart() ?? this.tfragController.getStartupCameraStart();
  }

  private async prepareRenderPipeline(includeBloom: boolean, timingLabel: string): Promise<void> {
    if (!this.renderer) {
      return;
    }

    this.skyboxController.syncCamera(this.camera, this.skyCamera);
    if (includeBloom) {
      this.syncBloomFadeRange();
    }
    const pipelineLabel = includeBloom ? 'bloom' : 'base';
    let stepStartMs = this.startTiming(`${timingLabel} ${pipelineLabel} pipeline compile`);
    await this.compileRenderPipeline(includeBloom);
    this.logTimingEnd(`${timingLabel} ${pipelineLabel} pipeline compile`, stepStartMs);
    stepStartMs = this.startTiming(`${timingLabel} ${pipelineLabel} pipeline render`);
    this.renderWithPipeline(includeBloom);
    this.logTimingEnd(`${timingLabel} ${pipelineLabel} pipeline render`, stepStartMs);
  }

  private async compileRenderPipeline(includeBloom: boolean): Promise<void> {
    if (!this.renderer) {
      return;
    }

    const pipeline = this.ensureRenderPipeline(includeBloom);
    if (!pipeline) {
      return;
    }

    const bundleGroups = this.disableVisibleBundleGroupsForCompile();
    try {
      await pipeline.skyPass.compileAsync(this.renderer);
      await pipeline.scenePass.compileAsync(this.renderer);
    } finally {
      this.restoreBundleGroupsAfterCompile(bundleGroups);
    }
  }

  private disableVisibleBundleGroupsForCompile(): BundleFlaggedObject[] {
    const bundleGroups: BundleFlaggedObject[] = [];
    this.scene.traverseVisible((object) => {
      const bundleGroup = object as BundleFlaggedObject;
      if (bundleGroup.isBundleGroup === true) {
        bundleGroup.isBundleGroup = false;
        bundleGroups.push(bundleGroup);
      }
    });
    return bundleGroups;
  }

  private restoreBundleGroupsAfterCompile(bundleGroups: BundleFlaggedObject[]): void {
    for (const bundleGroup of bundleGroups) {
      bundleGroup.isBundleGroup = true;
    }
  }

  private shouldPrepareBloomPipeline(): boolean {
    return this.resolveGlowBloomStatus() === 'rendered';
  }

  private disableBloomAfterError(error: unknown): boolean {
    if (isKnownGpuDeviceLostError(error)) {
      return false;
    }

    console.warn('Disabling glow bloom after WebGPU bloom pipeline failure.', error);
    this.glowBloomRuntimeDisabled = true;
    this.lastBloomStatus = 'failed';
    this.disposeRenderPipeline(true);
    this.lastRenderSubmitTime = 0;
    return true;
  }

  private syncBloomFadeRange(): void {
    const bloomFar = Math.max(this.camera.near, this.glowBloomFalloffDistance);
    setTieBloomDistanceFadeRange(bloomFar * glowBloomFullStrengthRatio, bloomFar);
  }

  private disposeRenderPipelines(): void {
    this.disposeRenderPipeline(false);
    this.disposeRenderPipeline(true);
  }

  private disposeRenderPipeline(includeBloom: boolean): void {
    const pipeline = includeBloom ? this.bloomRenderPipeline : this.baseRenderPipeline;
    pipeline?.renderPipeline.dispose();
    pipeline?.skyPass.dispose();
    pipeline?.scenePass.dispose();
    for (const bloomNode of pipeline?.bloomNodes ?? []) {
      (bloomNode as BloomNode & { dispose?: () => void }).dispose?.();
    }
    if (includeBloom) {
      this.bloomRenderPipeline = null;
    } else {
      this.baseRenderPipeline = null;
    }
  }

  private handleDeviceLost(info: RendererDeviceLostInfo): void {
    this.reportRendererRuntimeError(createRendererDeviceLostError(info));
  }

  private reportRendererRuntimeError(error: unknown): Error {
    const rendererError = createRendererRuntimeError(error);
    if (this.disposed || this.rendererUnavailable) {
      return rendererError;
    }

    this.rendererUnavailable = true;
    this.animationRenderSuspended = true;
    this.renderer?.setAnimationLoop(null);
    this.onStatus(rendererError.message);
    this.onRuntimeError?.(rendererError.message);
    return rendererError;
  }

  private cleanupFailedPackageLoad(root: THREE.Object3D, mapPackage: LoadedMapPackage): void {
    this.terrainRoot = null;
    runRendererCleanup('shrub controller', () => this.shrubController.dispose());
    runRendererCleanup('tie controller', () => this.tieController.dispose());
    runRendererCleanup('skybox controller', () => this.skyboxController.dispose());
    runRendererCleanup('tfrag controller', () => this.tfragController.dispose());
    runRendererCleanup('moby simulation', () => this.mobySimulationController.dispose());
    runRendererCleanup('moby controller', () => this.mobyController.dispose());
    runRendererCleanup('partial scene root', () => disposeObject3D(root));
    if (this.currentPackage === mapPackage) {
      this.currentPackage = null;
      runRendererCleanup('asset package', () => mapPackage.assetPackage.dispose());
    }
  }

  private disposeCurrentRoot(): void {
    const currentPackage = this.currentPackage;
    this.currentPackage = null;
    this.terrainRoot = null;
    this.tfragController.dispose();
    this.skyboxController.dispose();
    this.tieController.dispose();
    this.shrubController.dispose();
    this.mobySimulationController.dispose();
    this.mobyController.dispose();
    currentPackage?.assetPackage.dispose();
    this.resetMobySimulationClock(performance.now());

    if (!this.currentRoot) {
      return;
    }

    this.scene.remove(this.currentRoot);
    disposeObject3D(this.currentRoot);
    this.currentRoot = null;
  }
}

function resolveGlowBloomFalloffDistance(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(0, value)
    : defaultGlowBloomFalloffDistance;
}

function resolveMapSceneDebugTuning(tuning: Partial<MapSceneDebugTuning> | undefined): MapSceneDebugTuning {
  const current = tuning ?? {};
  const merged = {
    ...defaultMapSceneDebugTuning,
    ...current
  };
  const legacy = current as Partial<Record<
    | 'frontLightIntensity'
    | 'backLightIntensity'
    | 'meshBrightness'
    | 'tfragBrightness'
    | 'tieBrightness'
    | 'tieAmbientIntensity'
    | 'shrubBrightness',
    number
  >>;
  return {
    directionalFrontScale: finiteNonNegative(current.directionalFrontScale ?? legacy.frontLightIntensity, defaultMapSceneDebugTuning.directionalFrontScale),
    directionalBackScale: finiteNonNegative(current.directionalBackScale ?? legacy.backLightIntensity, defaultMapSceneDebugTuning.directionalBackScale),
    directionalColorStrength: finiteNonNegative(merged.directionalColorStrength, defaultMapSceneDebugTuning.directionalColorStrength),
    sceneExposure: finiteNonNegative(current.sceneExposure ?? legacy.meshBrightness, defaultMapSceneDebugTuning.sceneExposure),
    tfragExposure: finiteNonNegative(current.tfragExposure ?? legacy.tfragBrightness, defaultMapSceneDebugTuning.tfragExposure),
    tieExposure: finiteNonNegative(current.tieExposure ?? legacy.tieBrightness, defaultMapSceneDebugTuning.tieExposure),
    tieAmbientScale: finiteNonNegative(current.tieAmbientScale ?? legacy.tieAmbientIntensity, defaultMapSceneDebugTuning.tieAmbientScale),
    shrubExposure: finiteNonNegative(current.shrubExposure ?? legacy.shrubBrightness, defaultMapSceneDebugTuning.shrubExposure),
    worldDisplayLift: finiteNonNegative(merged.worldDisplayLift, defaultMapSceneDebugTuning.worldDisplayLift),
    tfragUplift: finiteNonNegative(merged.tfragUplift, defaultMapSceneDebugTuning.tfragUplift),
    tieUplift: finiteNonNegative(merged.tieUplift, defaultMapSceneDebugTuning.tieUplift),
    shrubUplift: finiteNonNegative(merged.shrubUplift, defaultMapSceneDebugTuning.shrubUplift),
    tfragFogEnabled: merged.tfragFogEnabled !== false,
    tieFogEnabled: merged.tieFogEnabled !== false,
    shrubFogEnabled: merged.shrubFogEnabled !== false,
    sceneHazeStrength: finiteNonNegative(merged.sceneHazeStrength, defaultMapSceneDebugTuning.sceneHazeStrength),
    fogNearDistanceScale: finiteNonNegative(merged.fogNearDistanceScale, defaultMapSceneDebugTuning.fogNearDistanceScale),
    fogFarDistanceScale: finiteNonNegative(merged.fogFarDistanceScale, defaultMapSceneDebugTuning.fogFarDistanceScale),
    fogNearIntensityScale: finiteNonNegative(merged.fogNearIntensityScale, defaultMapSceneDebugTuning.fogNearIntensityScale),
    fogFarIntensityScale: finiteNonNegative(merged.fogFarIntensityScale, defaultMapSceneDebugTuning.fogFarIntensityScale),
    fogMeshColorStrength: finiteNonNegative(merged.fogMeshColorStrength, defaultMapSceneDebugTuning.fogMeshColorStrength),
    fogModulationMaxAmount: finiteNonNegative(merged.fogModulationMaxAmount, defaultMapSceneDebugTuning.fogModulationMaxAmount),
    waterUnderlayRingDebugEnabled: merged.waterUnderlayRingDebugEnabled === true,
    waterWaveDirectionOffsetDegrees: typeof merged.waterWaveDirectionOffsetDegrees === 'number' && Number.isFinite(merged.waterWaveDirectionOffsetDegrees)
      ? merged.waterWaveDirectionOffsetDegrees
      : defaultMapSceneDebugTuning.waterWaveDirectionOffsetDegrees,
    waterFogStrength: finiteNonNegative(merged.waterFogStrength, defaultMapSceneDebugTuning.waterFogStrength)
  };
}

function sameTfragBakeOptions(a: TfragMaterialOptions, b: TfragMaterialOptions): boolean {
  return a.diagnosticMode === b.diagnosticMode
    && a.lightIntensity === b.lightIntensity
    && a.directionalFrontIntensity === b.directionalFrontIntensity
    && a.directionalBackIntensity === b.directionalBackIntensity
    && a.exposure === b.exposure
    && a.cacheMix === b.cacheMix
    && a.postScaleEnabled === b.postScaleEnabled;
}

function getTfragGltfSources(mapPackage: LoadedMapPackage): TfragGltfSource[] {
  const sources: TfragGltfSource[] = [];
  if (mapPackage.tfragGltfUrl) {
    sources.push({
      url: mapPackage.tfragGltfUrl,
      name: 'level_tfrag_base',
      label: 'base terrain'
    });
  }

  for (const [index, url] of mapPackage.tfragChunkGltfUrls.entries()) {
    const chunkIndex = numberValue(mapPackage.tfragChunkEntries[index]?.ModelId) ?? index + 1;
    sources.push({
      url,
      name: `level_tfrag_chunk_${chunkIndex.toString().padStart(3, '0')}`,
      label: `chunk ${chunkIndex}`
    });
  }

  return sources;
}

function createSceneCompilePart(label: string, ...objects: Array<THREE.Object3D | null | undefined>): SceneCompilePart | null {
  const renderableObjects = objects.filter((object): object is THREE.Object3D => object?.visible === true && hasRenderableObject(object));
  return renderableObjects.length > 0 ? { label, objects: renderableObjects } : null;
}

function hasRenderableObject(object: THREE.Object3D): boolean {
  return (object as THREE.Mesh).isMesh === true || object.children.length > 0;
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
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

function resolveFrameRateLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 120;
  }

  if (value <= 30) {
    return 30;
  }

  if (value <= 60) {
    return 60;
  }

  if (value <= 120) {
    return 120;
  }

  return 240;
}

function frameIntervalForLimit(limit: number): number {
  return 1000 / limit;
}

function formatElapsedMs(startMs: number): string {
  return `${Math.round(performance.now() - startMs).toLocaleString()} ms`;
}

function createWorldLiftNode(sceneColor: PassTextureNode, lift: UniformNode<'float', number>) {
  const colorNode = sceneColor.rgb;
  const lumaNode = dot(colorNode, vec3(0.2126, 0.7152, 0.0722));
  const liftedLumaNode = lumaNode.mul(lift).clamp(0, 1);
  const ratioNode = liftedLumaNode.div(max(lumaNode, float(0.001)));
  return vec4(colorNode.mul(ratioNode).clamp(0, 1), sceneColor.a);
}

function createSubtleFoggedSceneNode(
  sceneColor: ReturnType<typeof createWorldLiftNode>,
  scenePass: PassNode,
  fog: MapSceneFog | null,
  hazeStrength: UniformNode<'float', number>
) {
  if (!fog) {
    return sceneColor;
  }

  const distanceMix = scenePass.getViewZNode().negate()
    .sub(float(fog.nearDistance))
    .div(float(fog.farDistance - fog.nearDistance))
    .clamp(0, 1);
  const fogAmount = mix(float(fog.nearIntensity), float(fog.farIntensity), distanceMix)
    .mul(hazeStrength)
    .clamp(0, 1);
  const fogColor = vec3(fog.color.r, fog.color.g, fog.color.b);
  return vec4(mix(sceneColor.rgb, fogColor, fogAmount), sceneColor.a);
}

function resolveMapSceneEnvironment(levelSettings: DlLevelSettings | null): MapSceneEnvironment {
  if (!levelSettings) {
    return {
      backgroundColor: new THREE.Color(canvasClearColor),
      fog: null
    };
  }

  return {
    backgroundColor: mapLinearColorFromRgb96(levelSettings.backgroundColor),
    fog: resolveMapSceneFog(levelSettings)
  };
}

function resolveMapSceneFog(levelSettings: DlLevelSettings): MapSceneFog | null {
  const rawNearDistance = finiteNumber(levelSettings.fogNearDistance);
  const rawFarDistance = finiteNumber(levelSettings.fogFarDistance);
  const nearIntensity = fogAmountFromDlIntensity(levelSettings.fogNearIntensity);
  const farIntensity = fogAmountFromDlIntensity(levelSettings.fogFarIntensity);
  if (
    rawNearDistance === null ||
    rawFarDistance === null ||
    rawFarDistance <= rawNearDistance ||
    Math.max(nearIntensity, farIntensity) <= 0
  ) {
    return null;
  }

  return {
    color: mapLinearColorFromRgb96(levelSettings.fogColor),
    nearDistance: rawNearDistance * dlFogDistanceScale,
    farDistance: rawFarDistance * dlFogDistanceScale,
    nearIntensity,
    farIntensity
  };
}

function fogAmountFromDlIntensity(value: number): number {
  return (255 - (finiteNumber(value) ?? 255)) / 255;
}

function finiteNumber(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
