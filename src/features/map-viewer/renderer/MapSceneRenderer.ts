import * as THREE from 'three/webgpu';
import { WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  dot,
  emissive,
  float,
  max,
  mix,
  mrt,
  output,
  pass,
  uniform,
  vec3,
  vec4
} from 'three/tsl';
import type BloomNode from 'three/addons/tsl/display/BloomNode.js';
import type PassNode from 'three/src/nodes/display/PassNode.js';
import type UniformNode from 'three/src/nodes/core/UniformNode.js';
import {
  defaultShrubRenderOptions,
  defaultSkyboxRenderOptions,
  defaultTieRenderOptions,
  defaultTfragMaterialOptions,
  type LoadedMapPackage,
  type MapSceneLoadStageUpdate,
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
  DlLevelSettings,
  DlRgb96
} from '../../../services/wasm/ratchetPs2Wasm';
import {
  createInitialSceneCameraFrame
} from './camera/SceneCameraFraming';
import { TfragMaterialController } from './TfragMaterialController';
import {
  FpsCameraController,
  type CameraVirtualMoveInput
} from './FpsCameraController';
import {
  assertWebGpuAvailable,
  createRendererDeviceLostError,
  createRendererInitializationError,
  createRendererRuntimeError,
  type RendererDeviceLostInfo,
  shouldSkipGpuPipelineWarmup
} from './RendererCompatibility';
import {
  disposeObject3D,
  runRendererCleanup
} from './RendererDisposal';
import { yieldToBrowser } from './RendererTiming';
import { SkyboxController } from './skybox/SkyboxController';
import { ShrubInstanceController } from './shrubs/ShrubInstanceController';
import { TieInstanceController } from './ties/TieInstanceController';
import { setTieBloomDistanceFadeRange } from './ties/TieMaterials';
import {
  defaultModelFogDebugOptions,
  setModelFog,
  setModelFogDebugOptions,
  setModelFamilyDisplayOptions,
  type ModelFogDebugOptions
} from './ModelFog';
import type { TieMaterialMode } from './ties/TieTypes';
import {
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
  glowBloomEnabled?: boolean;
  glowBloomFalloffDistance?: number;
  frameRateLimit?: number;
  debugTuning?: Partial<MapSceneDebugTuning>;
  onLoadProgress: (update: MapSceneLoadStageUpdate) => void;
  onStatus: (status: string) => void;
  onTfragStats: (stats: TfragStats) => void;
  onSkyboxStats: (stats: SkyboxStats) => void;
  onTieStats: (stats: TieStats) => void;
  onShrubStats: (stats: ShrubStats) => void;
  onFrameStats?: (stats: MapSceneFrameStats) => void;
  onRuntimeError?: (message: string) => void;
}

const canvasClearColor = 0x070a0d;
const canvasClearAlpha = 1;
const statsUpdateIntervalMs = 500;
const firstFrameSetupStepCount = 7;
const defaultWorldDisplayLift = 2.4;
const dlWorldPositionScale = 1 / 1024;
const dlFogDistanceScale = dlWorldPositionScale;
const subtleSceneFogStrength = 0.3;
export const defaultGlowBloomFalloffDistance = 100;
const glowBloomFullStrengthRatio = 0.25;

export interface MapSceneDebugTuning extends ModelFogDebugOptions {
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
  bloomNode: BloomNode | null;
  bloomVersion: string;
};

export class MapSceneRenderer {
  private readonly container: HTMLElement;
  private readonly onLoadProgress: (update: MapSceneLoadStageUpdate) => void;
  private readonly onStatus: (status: string) => void;
  private readonly onTfragStats: (stats: TfragStats) => void;
  private readonly onSkyboxStats: (stats: SkyboxStats) => void;
  private readonly onTieStats: (stats: TieStats) => void;
  private readonly onShrubStats: (stats: ShrubStats) => void;
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
  private readonly materialOptions: TfragMaterialOptions;
  private skyboxRenderOptions: SkyboxRenderOptions;
  private tieRenderOptions: TieRenderOptions;
  private shrubRenderOptions: ShrubRenderOptions;
  private readonly sceneEnvironment: MapSceneEnvironment;
  private debugTuning: MapSceneDebugTuning;
  private renderer: WebGPURenderer | null = null;
  private baseRenderPipeline: MapRenderPipeline | null = null;
  private bloomRenderPipeline: MapRenderPipeline | null = null;
  private controls: FpsCameraController | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private pendingResizeFrame: number | null = null;
  private currentRoot: THREE.Object3D | null = null;
  private terrainRoot: THREE.Object3D | null = null;
  private sceneBoundsSphere: THREE.Sphere | null = null;
  private currentPackage: LoadedMapPackage | null = null;
  private readonly worldDisplayLift = uniform(defaultWorldDisplayLift);
  private readonly sceneHazeStrength = uniform(subtleSceneFogStrength);
  private frameRateLimit: number;
  private minRenderIntervalMs: number;
  private glowBloomEnabled: boolean;
  private glowBloomFalloffDistance: number;
  private instanceBundleEnabled = true;
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
    this.onFrameStats = options.onFrameStats;
    this.onRuntimeError = options.onRuntimeError;
    this.materialOptions = options.materialOptions ?? defaultTfragMaterialOptions;
    this.skyboxRenderOptions = options.skyboxRenderOptions ?? defaultSkyboxRenderOptions;
    this.tieRenderOptions = options.tieRenderOptions ?? defaultTieRenderOptions;
    this.shrubRenderOptions = options.shrubRenderOptions ?? defaultShrubRenderOptions;
    this.sceneEnvironment = resolveMapSceneEnvironment(options.levelSettings ?? null);
    this.debugTuning = resolveMapSceneDebugTuning(options.debugTuning);
    setModelFog(this.sceneEnvironment.fog);
    this.applyDebugTuning();
    this.glowBloomEnabled = options.glowBloomEnabled ?? true;
    this.glowBloomFalloffDistance = resolveGlowBloomFalloffDistance(options.glowBloomFalloffDistance);
    this.frameRateLimit = resolveFrameRateLimit(options.frameRateLimit ?? 120);
    this.minRenderIntervalMs = frameIntervalForLimit(this.frameRateLimit);
  }

  async initialize(): Promise<void> {
    await assertWebGpuAvailable();

    this.scene.background = null;
    this.skyScene.background = this.sceneEnvironment.backgroundColor;

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

    this.animationRenderSuspended = true;
    this.disposeCurrentRoot();
    this.currentPackage = mapPackage;

    const root = new THREE.Group();
    root.name = 'map_package';

    try {
      const tfragStats = await this.loadTerrain(root, mapPackage);
      const skyboxStats = await this.loadSkybox(mapPackage);
      const tieStats = await this.loadTies(root, mapPackage);
      const shrubStats = await this.loadShrubs(root, mapPackage);

      await this.prepareFirstFrame(root);
      this.onLoadProgress({
        id: 'compile',
        status: 'done',
        detail: 'Ready'
      });
      this.onStatus([
        `${tfragStats.triangles.toLocaleString()} terrain triangles`,
        skyboxStats.loaded ? `${skyboxStats.shells.toLocaleString()} skybox shells` : null,
        tieStats.renderedInstances > 0 ? `${tieStats.renderedInstances.toLocaleString()} tie instances` : null,
        shrubStats.renderedInstances > 0 ? `${shrubStats.renderedInstances.toLocaleString()} shrub instances` : null
      ].filter(Boolean).join(', '));
      return tfragStats;
    } catch (error: unknown) {
      const loadError = createRendererRuntimeError(error);
      this.animationRenderSuspended = false;
      this.cleanupFailedPackageLoad(root, mapPackage);
      throw loadError;
    }
  }

  private async loadTerrain(root: THREE.Object3D, mapPackage: LoadedMapPackage): Promise<TfragStats> {
    this.onLoadProgress({ id: 'tfrag', status: 'active', detail: 'Loading glTF' });
    this.onStatus('Loading tfrag glTF');
    const gltf = await this.loader.loadAsync(mapPackage.tfragGltfUrl);
    const tfragRoot = gltf.scene;
    tfragRoot.name = 'level_tfrag_lod0';
    root.add(tfragRoot);
    this.terrainRoot = tfragRoot;

    this.onLoadProgress({ id: 'tfrag', status: 'active', detail: 'Preparing materials' });
    await yieldToBrowser();
    const tfragStats = this.tfragController.prepare(tfragRoot, mapPackage.directionalLights, this.resolveTfragMaterialOptions());
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
      this.skyboxRenderOptions,
      this.renderer.getMaxAnisotropy()
    );
    this.onSkyboxStats(skyboxStats);
    this.onLoadProgress({
      id: 'skybox',
      status: 'done',
      detail: skyboxStats.loaded ? `${skyboxStats.shells.toLocaleString()} shells` : 'No skybox'
    });
    return skyboxStats;
  }

  private async loadTies(root: THREE.Object3D, mapPackage: LoadedMapPackage): Promise<TieStats> {
    this.onLoadProgress({ id: 'ties', status: 'active', detail: 'Preparing instances' });
    this.onStatus('Loading tie instances');
    const tieStats = await this.tieController.load(
      root,
      mapPackage,
      this.loader,
      this.resolveTieRenderOptions(),
      this.skyboxController.getReflectionTexture(),
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

  private async loadShrubs(root: THREE.Object3D, mapPackage: LoadedMapPackage): Promise<ShrubStats> {
    this.onLoadProgress({ id: 'shrubs', status: 'active', detail: 'Preparing instances' });
    this.onStatus('Loading shrub instances');
    const shrubStats = await this.shrubController.load(
      root,
      mapPackage,
      this.loader,
      this.resolveShrubRenderOptions(),
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

  private async prepareFirstFrame(root: THREE.Object3D): Promise<void> {
    this.reportFirstFrameProgress('Attaching scene', 1);
    await yieldToBrowser();
    this.scene.add(root);
    this.currentRoot = root;

    this.reportFirstFrameProgress('Framing camera', 2);
    await yieldToBrowser();
    this.frameObject(root);

    this.reportFirstFrameProgress('Drawing preview frame', 3);
    await yieldToBrowser();
    this.renderWithPipeline(false);
    await yieldToBrowser();

    const skipPipelineWarmup = shouldSkipGpuPipelineWarmup();
    if (!skipPipelineWarmup) {
      await this.warmupScenePipelines();
    } else {
      this.reportFirstFrameProgress('Skipping GPU warmup', 6);
      await yieldToBrowser();
    }

    this.reportFirstFrameProgress('Submitting first frame', 7);
    await yieldToBrowser();
    this.renderFrame(performance.now());
    this.animationRenderSuspended = false;
    this.lastRenderSubmitTime = 0;
  }

  private reportFirstFrameProgress(detail: string, loaded: number): void {
    this.onLoadProgress({
      id: 'compile',
      status: 'active',
      detail,
      loaded,
      total: firstFrameSetupStepCount
    });
    this.onStatus(detail);
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

  setTieMaterialMode(mode: TieMaterialMode): void {
    this.tieController.setMaterialMode(mode);
  }

  setTieBundleEnabled(enabled: boolean): void {
    this.instanceBundleEnabled = enabled;
    this.tieController.setBundleEnabled(enabled);
    this.shrubController.setBundleEnabled(enabled);
  }

  setGlowBloomEnabled(enabled: boolean): void {
    this.glowBloomEnabled = enabled;
    this.lastRenderSubmitTime = 0;
  }

  setGlowBloomFalloffDistance(distance: number): void {
    this.glowBloomFalloffDistance = resolveGlowBloomFalloffDistance(distance);
    this.lastRenderSubmitTime = 0;
  }

  setDebugTuning(tuning: Partial<MapSceneDebugTuning>): void {
    const previousTfragOptions = this.resolveTfragMaterialOptions();
    this.debugTuning = resolveMapSceneDebugTuning(tuning);
    this.applyDebugTuning();

    const nextTfragOptions = this.resolveTfragMaterialOptions();
    if (this.currentPackage && this.terrainRoot && !sameTfragBakeOptions(previousTfragOptions, nextTfragOptions)) {
      this.onTfragStats(this.tfragController.update(this.currentPackage.directionalLights, nextTfragOptions));
    }

    this.tieController.updateLightingOptions(this.resolveTieRenderOptions());
    this.shrubController.updateLightingOptions(this.resolveShrubRenderOptions());

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
    if (stats) {
      this.onShrubStats(stats);
    }

    return stats;
  }

  private applyDebugTuning(): void {
    setModelFogDebugOptions(this.debugTuning);
    setModelFamilyDisplayOptions(this.debugTuning);
    this.worldDisplayLift.value = finiteNonNegative(this.debugTuning.worldDisplayLift, defaultWorldDisplayLift);
    this.sceneHazeStrength.value = finiteNonNegative(this.debugTuning.sceneHazeStrength, subtleSceneFogStrength);
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
    if (this.animationRenderSuspended || this.rendererUnavailable) {
      return;
    }

    if (this.minRenderIntervalMs > 0 && this.lastRenderSubmitTime > 0) {
      const elapsedMs = time - this.lastRenderSubmitTime;
      if (elapsedMs < this.minRenderIntervalMs - 0.35) {
        return;
      }
    }

    this.lastRenderSubmitTime = time;
    try {
      this.renderFrame(time);
    } catch (error: unknown) {
      this.reportRendererRuntimeError(error);
    }
  }

  private renderFrame(time: DOMHighResTimeStamp): void {
    if (!this.renderer || this.rendererUnavailable) {
      return;
    }

    const submitStartMs = performance.now();
    const frameMs = time - this.lastFrameTime;
    this.lastFrameTime = time;
    if (frameMs > 0 && frameMs < 250) {
      this.frameSampleTotalMs += frameMs;
      this.frameSampleCount += 1;
    }

    this.controls?.update(frameMs / 1000);
    this.skyboxController.update(time / 1000);
    this.skyboxController.syncCamera(this.camera, this.skyCamera);
    const bloomStartMs = performance.now();
    this.lastBloomStatus = this.resolveGlowBloomStatus();
    const includeBloom = this.lastBloomStatus === 'rendered';
    if (includeBloom) {
      this.syncBloomFadeRange();
    }
    this.renderWithPipeline(includeBloom);
    this.bloomSampleTotalMs += performance.now() - bloomStartMs;

    this.submitSampleTotalMs += performance.now() - submitStartMs;

    if (this.onFrameStats && time - this.lastStatsUpdateTime >= statsUpdateIntervalMs) {
      const averageFrameMs = this.frameSampleTotalMs / Math.max(1, this.frameSampleCount);
      const averageSubmitMs = this.submitSampleTotalMs / Math.max(1, this.frameSampleCount);
      const renderInfo = this.renderer.info.render as RendererRenderInfo;
      this.onFrameStats({
        fps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
        frameMs: averageFrameMs,
        submitMs: averageSubmitMs,
        frameRateLimit: this.frameRateLimit,
        renderPasses: renderInfo.frameCalls ?? 0,
        drawCalls: renderInfo.drawCalls ?? 0,
        triangles: renderInfo.triangles ?? 0,
        bloomStatus: this.lastBloomStatus,
        bloomMs: this.bloomSampleTotalMs / Math.max(1, this.frameSampleCount),
        bloomSources: this.tieController.getGlowBloomSourceCount()
      });
      this.lastStatsUpdateTime = time;
      this.frameSampleTotalMs = 0;
      this.submitSampleTotalMs = 0;
      this.bloomSampleTotalMs = 0;
      this.frameSampleCount = 0;
    }
  }

  private resize(): void {
    if (!this.renderer || this.rendererUnavailable) {
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
      this.renderFrame(performance.now());
    } catch (error: unknown) {
      this.reportRendererRuntimeError(error);
    }
  }

  private ensureRenderPipeline(includeBloom: boolean): MapRenderPipeline | null {
    if (!this.renderer) {
      return null;
    }

    const currentPipeline = includeBloom ? this.bloomRenderPipeline : this.baseRenderPipeline;
    if (currentPipeline && (!includeBloom || currentPipeline.bloomVersion === tightBloomVersion)) {
      return currentPipeline;
    }
    this.disposeRenderPipeline(includeBloom);

    const skyPass = pass(this.skyScene, this.skyCamera);
    const scenePass = pass(this.scene, this.camera);
    if (includeBloom) {
      scenePass.setMRT(mrt({
        output,
        emissive
      }));
    }

    const sceneColor = scenePass.getTextureNode('output');
    const skyColor = skyPass.getTextureNode('output');
    const sceneWithLift = createWorldLiftNode(sceneColor, this.worldDisplayLift);
    const sceneWithAtmosphere = createSubtleFoggedSceneNode(sceneWithLift, scenePass, this.sceneEnvironment.fog, this.sceneHazeStrength);
    const sceneOverSky = mix(skyColor, sceneWithAtmosphere, sceneColor.a);
    const bloomPass = includeBloom
      ? tightBloom(scenePass.getTextureNode('emissive'), 0.45, 0, 0)
      : null;
    const binding: MapRenderPipeline = {
      renderPipeline: new THREE.RenderPipeline(this.renderer, bloomPass ? sceneOverSky.add(bloomPass) : sceneOverSky),
      skyPass,
      scenePass,
      bloomNode: bloomPass,
      bloomVersion: includeBloom ? tightBloomVersion : ''
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

    if (!this.cameraCanReachSceneBloom()) {
      return 'scene-range';
    }
    if (!this.tieController.hasGlowBloomSourceNear(this.camera.position, this.glowBloomFalloffDistance)) {
      return 'source-range';
    }

    return 'rendered';
  }

  private frameObject(root: THREE.Object3D): void {
    const frame = createInitialSceneCameraFrame(root);
    this.sceneBoundsSphere = frame.bounds.getBoundingSphere(new THREE.Sphere());
    this.camera.near = frame.near;
    this.camera.far = frame.far;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(frame.position);
    this.camera.lookAt(frame.target);
    this.controls?.setSceneRadius(frame.radius);
    this.controls?.syncFromCamera();
  }

  private async warmupScenePipelines(): Promise<void> {
    if (!this.renderer) {
      return;
    }

    this.skyboxController.syncCamera(this.camera, this.skyCamera);
    if (this.skyboxController.isVisible()) {
      this.reportFirstFrameProgress('Compiling skybox materials', 4);
      await yieldToBrowser();
      await this.renderer.compileAsync(this.skyScene, this.skyCamera);
      await yieldToBrowser();
    } else {
      this.reportFirstFrameProgress('Skipping skybox materials', 4);
      await yieldToBrowser();
    }

    this.reportFirstFrameProgress('Compiling scene materials', 5);
    await yieldToBrowser();
    await this.renderer.compileAsync(this.scene, this.camera);
    await yieldToBrowser();
    await this.warmupBloomRenderPipeline();
  }

  private async warmupBloomRenderPipeline(): Promise<void> {
    if (!this.glowBloomEnabled || !this.tieController.hasGlowBloomSources()) {
      this.reportFirstFrameProgress('Skipping bloom pipeline', 6);
      await yieldToBrowser();
      return;
    }

    this.reportFirstFrameProgress('Preparing bloom pipeline', 6);
    await yieldToBrowser();
    this.syncBloomFadeRange();
    this.renderWithPipeline(true);
    await yieldToBrowser();
  }

  private syncBloomFadeRange(): void {
    const bloomFar = Math.max(this.camera.near, this.glowBloomFalloffDistance);
    setTieBloomDistanceFadeRange(bloomFar * glowBloomFullStrengthRatio, bloomFar);
  }

  private cameraCanReachSceneBloom(): boolean {
    if (!this.sceneBoundsSphere) {
      return true;
    }

    const distanceToScene = Math.max(0, this.camera.position.distanceTo(this.sceneBoundsSphere.center) - this.sceneBoundsSphere.radius);
    return distanceToScene <= this.glowBloomFalloffDistance;
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
    (pipeline?.bloomNode as (BloomNode & { dispose?: () => void }) | null)?.dispose?.();
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
    this.sceneBoundsSphere = null;
    runRendererCleanup('shrub controller', () => this.shrubController.dispose());
    runRendererCleanup('tie controller', () => this.tieController.dispose());
    runRendererCleanup('skybox controller', () => this.skyboxController.dispose());
    runRendererCleanup('tfrag controller', () => this.tfragController.dispose());
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
    this.sceneBoundsSphere = null;
    this.tfragController.dispose();
    this.skyboxController.dispose();
    this.tieController.dispose();
    this.shrubController.dispose();
    currentPackage?.assetPackage.dispose();

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
    fogModulationMaxAmount: finiteNonNegative(merged.fogModulationMaxAmount, defaultMapSceneDebugTuning.fogModulationMaxAmount)
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

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
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
    backgroundColor: colorFromDlRgb96(levelSettings.backgroundColor),
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
    color: colorFromDlRgb96(levelSettings.fogColor),
    nearDistance: rawNearDistance * dlFogDistanceScale,
    farDistance: rawFarDistance * dlFogDistanceScale,
    nearIntensity,
    farIntensity
  };
}

function colorFromDlRgb96(color: DlRgb96): THREE.Color {
  return new THREE.Color().setRGB(
    normalizeColorChannel(color.red),
    normalizeColorChannel(color.green),
    normalizeColorChannel(color.blue),
    THREE.SRGBColorSpace
  );
}

function normalizeColorChannel(value: number): number {
  const numeric = finiteNumber(value) ?? 0;
  return clamp01(numeric > 1 ? numeric / 255 : numeric);
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
