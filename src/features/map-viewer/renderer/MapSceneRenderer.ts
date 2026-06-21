import * as THREE from 'three/webgpu';
import { WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  dot,
  float,
  max,
  texture,
  uniform,
  uv,
  vec3
} from 'three/tsl';
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
import {
  createInitialSceneCameraFrame
} from './camera/SceneCameraFraming';
import { DlTfragMaterialController } from './DlTfragMaterial';
import {
  FpsCameraController,
  type CameraVirtualMoveInput
} from './FpsCameraController';
import { SkyboxController } from './skybox/SkyboxController';
import { ShrubInstanceController } from './shrubs/ShrubInstanceController';
import { TieInstanceController } from './ties/TieInstanceController';

interface MapSceneRendererOptions {
  container: HTMLElement;
  materialOptions?: TfragMaterialOptions;
  skyboxRenderOptions?: SkyboxRenderOptions;
  tieRenderOptions?: TieRenderOptions;
  shrubRenderOptions?: ShrubRenderOptions;
  worldDisplayLift?: number;
  frameRateLimit?: number;
  onLoadProgress: (update: MapSceneLoadStageUpdate) => void;
  onStatus: (status: string) => void;
  onTfragStats: (stats: TfragStats) => void;
  onSkyboxStats: (stats: SkyboxStats) => void;
  onTieStats: (stats: TieStats) => void;
  onShrubStats: (stats: ShrubStats) => void;
  onFrameStats?: (stats: MapSceneFrameStats) => void;
}

const canvasClearColor = 0x070a0d;
const canvasClearAlpha = 1;
const worldTargetClearColor = 0x000000;
const worldTargetClearAlpha = 0;
const defaultWorldDisplayLift = 2.5;
const statsUpdateIntervalMs = 500;
const webGpuUnavailableMessage = 'WebGPU is not available on this browser/device. Try a current desktop Chrome/Edge browser, or a mobile browser/device with WebGPU support enabled.';

type WebGpuAdapterOptions = GPURequestAdapterOptions & {
  featureLevel?: 'core' | 'compatibility';
};

const webGpuAdapterOptions: WebGpuAdapterOptions = {
  featureLevel: 'compatibility'
};

export interface MapSceneFrameStats {
  fps: number;
  frameMs: number;
  frameRateLimit: number;
}

export class MapSceneRenderer {
  private readonly container: HTMLElement;
  private readonly onLoadProgress: (update: MapSceneLoadStageUpdate) => void;
  private readonly onStatus: (status: string) => void;
  private readonly onTfragStats: (stats: TfragStats) => void;
  private readonly onSkyboxStats: (stats: SkyboxStats) => void;
  private readonly onTieStats: (stats: TieStats) => void;
  private readonly onShrubStats: (stats: ShrubStats) => void;
  private readonly onFrameStats?: (stats: MapSceneFrameStats) => void;
  private readonly scene = new THREE.Scene();
  private readonly skyScene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 50000);
  private readonly skyCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 50000);
  private readonly loader = new GLTFLoader();
  private readonly tfragController = new DlTfragMaterialController();
  private readonly skyboxController = new SkyboxController();
  private readonly tieController = new TieInstanceController();
  private readonly shrubController = new ShrubInstanceController();
  private readonly materialOptions: TfragMaterialOptions;
  private skyboxRenderOptions: SkyboxRenderOptions;
  private tieRenderOptions: TieRenderOptions;
  private shrubRenderOptions: ShrubRenderOptions;
  private renderer: WebGPURenderer | null = null;
  private controls: FpsCameraController | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private pendingResizeFrame: number | null = null;
  private worldRenderTarget: THREE.RenderTarget | null = null;
  private worldCompositeMaterial: THREE.MeshBasicNodeMaterial | null = null;
  private worldCompositeQuad: THREE.QuadMesh | null = null;
  private worldCompositeLift: UniformNode<'float', number> | null = null;
  private currentRoot: THREE.Object3D | null = null;
  private currentPackage: LoadedMapPackage | null = null;
  private worldDisplayLift: number;
  private frameRateLimit: number;
  private minRenderIntervalMs: number;
  private animationRenderSuspended = false;
  private lastRenderSubmitTime = 0;
  private lastFrameTime = performance.now();
  private lastStatsUpdateTime = this.lastFrameTime;
  private frameSampleTotalMs = 0;
  private frameSampleCount = 0;

  constructor(options: MapSceneRendererOptions) {
    this.container = options.container;
    this.onLoadProgress = options.onLoadProgress;
    this.onStatus = options.onStatus;
    this.onTfragStats = options.onTfragStats;
    this.onSkyboxStats = options.onSkyboxStats;
    this.onTieStats = options.onTieStats;
    this.onShrubStats = options.onShrubStats;
    this.onFrameStats = options.onFrameStats;
    this.materialOptions = options.materialOptions ?? defaultTfragMaterialOptions;
    this.skyboxRenderOptions = options.skyboxRenderOptions ?? defaultSkyboxRenderOptions;
    this.tieRenderOptions = options.tieRenderOptions ?? defaultTieRenderOptions;
    this.shrubRenderOptions = options.shrubRenderOptions ?? defaultShrubRenderOptions;
    this.worldDisplayLift = resolveWorldDisplayLift(options.worldDisplayLift ?? defaultWorldDisplayLift);
    this.frameRateLimit = resolveFrameRateLimit(options.frameRateLimit ?? 120);
    this.minRenderIntervalMs = frameIntervalForLimit(this.frameRateLimit);
  }

  async initialize(): Promise<void> {
    await assertWebGpuAvailable();

    this.scene.background = null;

    const renderer = new WebGPURenderer({
      antialias: false,
      alpha: false
    });

    try {
      await renderer.init();
    } catch (error) {
      renderer.dispose();
      throw createRendererInitializationError(error);
    }

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
      this.onLoadProgress({ id: 'tfrag', status: 'active', detail: 'Loading glTF' });
      this.onStatus('Loading tfrag glTF');
      const gltf = await this.loader.loadAsync(mapPackage.tfragGltfUrl);
      const tfragRoot = gltf.scene;
      tfragRoot.name = 'level_tfrag_lod0';
      root.add(tfragRoot);

      this.onLoadProgress({ id: 'tfrag', status: 'active', detail: 'Preparing materials' });
      await yieldToBrowser();
      const tfragStats = this.tfragController.prepare(tfragRoot, mapPackage.directionalLights, this.materialOptions);
      this.onTfragStats(tfragStats);
      this.onLoadProgress({
        id: 'tfrag',
        status: 'done',
        detail: `${tfragStats.triangles.toLocaleString()} triangles`
      });

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

      this.onLoadProgress({ id: 'ties', status: 'active', detail: 'Preparing instances' });
      this.onStatus('Loading tie instances');
      const tieStats = await this.tieController.load(
        root,
        mapPackage,
        this.loader,
        this.tieRenderOptions,
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
      this.onTieStats(tieStats);
      this.onLoadProgress({
        id: 'ties',
        status: 'done',
        detail: tieStats.renderedInstances > 0
          ? `${tieStats.renderedInstances.toLocaleString()} instances`
          : 'No ties'
      });

      this.onLoadProgress({ id: 'shrubs', status: 'active', detail: 'Preparing instances' });
      this.onStatus('Loading shrub instances');
      const shrubStats = await this.shrubController.load(
        root,
        mapPackage,
        this.loader,
        this.shrubRenderOptions,
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
      this.onShrubStats(shrubStats);
      this.onLoadProgress({
        id: 'shrubs',
        status: 'done',
        detail: shrubStats.renderedInstances > 0
          ? `${shrubStats.renderedInstances.toLocaleString()} instances`
          : 'No shrubs'
      });

      this.onLoadProgress({
        id: 'compile',
        status: 'active',
        detail: 'Attaching scene',
        loaded: 1,
        total: 4
      });
      this.onStatus('Attaching scene');
      await yieldToBrowser();
      this.scene.add(root);
      this.currentRoot = root;

      this.onLoadProgress({
        id: 'compile',
        status: 'active',
        detail: 'Framing camera',
        loaded: 2,
        total: 4
      });
      this.onStatus('Framing camera');
      await yieldToBrowser();
      this.frameObject(root);

      this.onLoadProgress({
        id: 'compile',
        status: 'active',
        detail: 'Warming GPU pipelines',
        loaded: 3,
        total: 4
      });
      this.onStatus('Warming GPU pipelines');
      await yieldToBrowser();
      await this.warmupScenePipelines();

      this.onLoadProgress({
        id: 'compile',
        status: 'active',
        detail: 'Submitting first frame',
        loaded: 4,
        total: 4
      });
      await yieldToBrowser();
      this.renderFrame(performance.now());
      this.animationRenderSuspended = false;
      this.lastRenderSubmitTime = 0;
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
      this.animationRenderSuspended = false;
      this.shrubController.dispose();
      this.tieController.dispose();
      this.skyboxController.dispose();
      this.tfragController.dispose();
      disposeObject3D(root);
      if (this.currentPackage === mapPackage) {
        this.currentPackage = null;
        mapPackage.assetPackage.dispose();
      }
      throw error;
    }
  }

  dispose(): void {
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
    this.disposeWorldComposite();
    this.renderer?.dispose();
    this.container.replaceChildren();
  }

  setFrameRateLimit(limit: number): void {
    this.frameRateLimit = resolveFrameRateLimit(limit);
    this.minRenderIntervalMs = frameIntervalForLimit(this.frameRateLimit);
    this.lastRenderSubmitTime = 0;
    this.frameSampleTotalMs = 0;
    this.frameSampleCount = 0;
    this.onFrameStats?.({
      fps: 0,
      frameMs: 0,
      frameRateLimit: this.frameRateLimit
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

  setWorldDisplayLift(value: number): void {
    this.worldDisplayLift = resolveWorldDisplayLift(value);
    if (this.worldCompositeLift) {
      this.worldCompositeLift.value = this.worldDisplayLift;
    }
  }

  setTieRenderOptions(options: TieRenderOptions): TieStats | null {
    this.tieRenderOptions = options;
    const stats = this.tieController.setOptions(options);
    if (stats) {
      this.onTieStats(stats);
    }

    return stats;
  }

  setShrubRenderOptions(options: ShrubRenderOptions): ShrubStats | null {
    this.shrubRenderOptions = options;
    const stats = this.shrubController.setOptions(options);
    if (stats) {
      this.onShrubStats(stats);
    }

    return stats;
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
    if (this.animationRenderSuspended) {
      return;
    }

    if (this.minRenderIntervalMs > 0 && this.lastRenderSubmitTime > 0) {
      const elapsedMs = time - this.lastRenderSubmitTime;
      if (elapsedMs < this.minRenderIntervalMs - 0.35) {
        return;
      }
    }

    this.lastRenderSubmitTime = time;
    this.renderFrame(time);
  }

  private renderFrame(time: DOMHighResTimeStamp): void {
    if (!this.renderer) {
      return;
    }

    const frameMs = time - this.lastFrameTime;
    this.lastFrameTime = time;
    if (frameMs > 0 && frameMs < 250) {
      this.frameSampleTotalMs += frameMs;
      this.frameSampleCount += 1;
    }

    this.controls?.update(frameMs / 1000);
    this.skyboxController.update(time / 1000);
    this.skyboxController.syncCamera(this.camera, this.skyCamera);
    const useWorldComposite = shouldUseWorldComposite(this.worldDisplayLift);
    if (useWorldComposite) {
      this.ensureWorldComposite();
    }

    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(canvasClearColor, canvasClearAlpha);
    this.renderer.clear(true, true, true);
    if (this.skyboxController.isVisible()) {
      this.renderer.render(this.skyScene, this.skyCamera);
      this.renderer.clearDepth();
    }

    const worldRenderTarget = this.worldRenderTarget;
    const worldCompositeQuad = this.worldCompositeQuad;
    if (useWorldComposite && worldRenderTarget && worldCompositeQuad) {
      this.renderer.setRenderTarget(worldRenderTarget);
      this.renderer.setClearColor(worldTargetClearColor, worldTargetClearAlpha);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      this.renderer.setClearColor(canvasClearColor, canvasClearAlpha);
      this.renderer.clearDepth();
      worldCompositeQuad.render(this.renderer);
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    if (this.onFrameStats && time - this.lastStatsUpdateTime >= statsUpdateIntervalMs) {
      const averageFrameMs = this.frameSampleTotalMs / Math.max(1, this.frameSampleCount);
      this.onFrameStats({
        fps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
        frameMs: averageFrameMs,
        frameRateLimit: this.frameRateLimit
      });
      this.lastStatsUpdateTime = time;
      this.frameSampleTotalMs = 0;
      this.frameSampleCount = 0;
    }
  }

  private resize(): void {
    if (!this.renderer) {
      return;
    }

    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.skyCamera.aspect = width / height;
    this.skyCamera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    if (shouldUseWorldComposite(this.worldDisplayLift)) {
      this.resizeWorldRenderTarget(width, height);
    }

    this.lastRenderSubmitTime = 0;
    this.renderFrame(performance.now());
  }

  private ensureWorldComposite(): void {
    if (!this.renderer) {
      return;
    }

    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.resizeWorldRenderTarget(width, height);
  }

  private resizeWorldRenderTarget(width: number, height: number): void {
    if (!this.renderer) {
      return;
    }

    const pixelRatio = this.renderer.getPixelRatio();
    const targetWidth = Math.max(1, Math.floor(width * pixelRatio));
    const targetHeight = Math.max(1, Math.floor(height * pixelRatio));
    if (
      this.worldRenderTarget &&
      (this.worldRenderTarget.width !== targetWidth || this.worldRenderTarget.height !== targetHeight)
    ) {
      this.disposeWorldComposite();
    }

    if (!this.worldRenderTarget) {
      this.worldRenderTarget = new THREE.RenderTarget(targetWidth, targetHeight, {
        depthBuffer: true,
        stencilBuffer: false,
        samples: 0,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
        colorSpace: THREE.SRGBColorSpace,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter
      });
      this.worldRenderTarget.texture.name = 'map_omatic_world_display_layer';
      this.createWorldCompositeMaterial();
      return;
    }

    if (!this.worldCompositeQuad) {
      this.createWorldCompositeMaterial();
    }
  }

  private createWorldCompositeMaterial(): void {
    if (!this.worldRenderTarget) {
      return;
    }

    this.worldCompositeMaterial?.dispose();
    const lift = uniform(this.worldDisplayLift);
    const sampleNode = texture(this.worldRenderTarget.texture, uv());
    const colorNode = sampleNode.rgb;
    const lumaNode = dot(colorNode, vec3(0.2126, 0.7152, 0.0722));
    const liftedLumaNode = lumaNode.mul(lift).clamp(0, 1);
    const ratioNode = liftedLumaNode.div(max(lumaNode, float(0.001)));
    const liftedColorNode = colorNode.mul(ratioNode).clamp(0, 1);
    const material = new THREE.MeshBasicNodeMaterial({
      name: 'world_display_lift_composite',
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    material.colorNode = liftedColorNode;
    material.opacityNode = sampleNode.a;
    material.blending = THREE.NormalBlending;
    material.forceSinglePass = true;
    this.worldCompositeLift = lift;
    this.worldCompositeMaterial = material;
    this.worldCompositeQuad = new THREE.QuadMesh(material);
  }

  private disposeWorldComposite(): void {
    this.worldCompositeMaterial?.dispose();
    this.worldRenderTarget?.dispose();
    this.worldCompositeMaterial = null;
    this.worldCompositeQuad = null;
    this.worldCompositeLift = null;
    this.worldRenderTarget = null;
  }

  private frameObject(root: THREE.Object3D): void {
    const frame = createInitialSceneCameraFrame(root);
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
      await this.renderer.compileAsync(this.skyScene, this.skyCamera);
    }

    if (shouldUseWorldComposite(this.worldDisplayLift)) {
      this.ensureWorldComposite();
      const previousRenderTarget = this.renderer.getRenderTarget();
      try {
        if (this.worldRenderTarget) {
          this.renderer.setRenderTarget(this.worldRenderTarget);
        }
        await this.renderer.compileAsync(this.scene, this.camera);
      } finally {
        this.renderer.setRenderTarget(previousRenderTarget);
      }

      if (this.worldCompositeQuad) {
        await this.renderer.compileAsync(this.worldCompositeQuad, this.worldCompositeQuad.camera);
      }
      return;
    }

    await this.renderer.compileAsync(this.scene, this.camera);
  }

  private disposeCurrentRoot(): void {
    const currentPackage = this.currentPackage;
    this.currentPackage = null;
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

function resolveWorldDisplayLift(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 1;
}

function shouldUseWorldComposite(value: number): boolean {
  return Math.abs(value - 1) > 0.001;
}

async function assertWebGpuAvailable(): Promise<void> {
  if (!('gpu' in navigator)) {
    throw new Error(webGpuUnavailableMessage);
  }

  const adapter = await navigator.gpu.requestAdapter(webGpuAdapterOptions);
  if (!adapter) {
    throw new Error(webGpuUnavailableMessage);
  }
}

function createRendererInitializationError(error: unknown): Error {
  const originalMessage = error instanceof Error ? error.message : String(error);
  const message = originalMessage.includes('this.gl is null') || originalMessage.includes('WebGPUBackend')
    ? webGpuUnavailableMessage
    : `WebGPU renderer failed to initialize: ${originalMessage}`;
  const nextError = new Error(message);
  if (error instanceof Error && error.stack) {
    nextError.stack = error.stack;
  }

  return nextError;
}

function frameIntervalForLimit(limit: number): number {
  return 1000 / limit;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    mesh.geometry?.dispose();
    disposeMaterial(mesh.material);
  });
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const item of material) {
      item.dispose();
    }
    return;
  }

  material.dispose();
}
