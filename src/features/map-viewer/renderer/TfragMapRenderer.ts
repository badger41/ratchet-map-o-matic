import * as THREE from 'three/webgpu';
import { WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  defaultTfragMaterialOptions,
  type LoadedMapPackage,
  type MapSceneLoadStageUpdate,
  type TfragMaterialOptions,
  type TfragStats
} from '../../../services/mapPackages/mapPackageTypes';
import { DlTfragMaterialController } from './DlTfragMaterial';
import { FpsCameraController } from './FpsCameraController';

interface TfragMapRendererOptions {
  container: HTMLElement;
  materialOptions?: TfragMaterialOptions;
  frameRateLimit?: number;
  onLoadProgress: (update: MapSceneLoadStageUpdate) => void;
  onStatus: (status: string) => void;
  onTfragStats: (stats: TfragStats) => void;
  onFrameStats?: (stats: TfragFrameStats) => void;
}

const canvasClearColor = 0x070a0d;
const canvasClearAlpha = 1;
const statsUpdateIntervalMs = 500;

export interface TfragFrameStats {
  fps: number;
  frameMs: number;
  frameRateLimit: number;
}

export class TfragMapRenderer {
  private readonly container: HTMLElement;
  private readonly onLoadProgress: (update: MapSceneLoadStageUpdate) => void;
  private readonly onStatus: (status: string) => void;
  private readonly onTfragStats: (stats: TfragStats) => void;
  private readonly onFrameStats?: (stats: TfragFrameStats) => void;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 50000);
  private readonly loader = new GLTFLoader();
  private readonly tfragController = new DlTfragMaterialController();
  private readonly materialOptions: TfragMaterialOptions;
  private renderer: WebGPURenderer | null = null;
  private controls: FpsCameraController | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private currentRoot: THREE.Object3D | null = null;
  private currentPackage: LoadedMapPackage | null = null;
  private frameRateLimit: number;
  private minRenderIntervalMs: number;
  private lastRenderSubmitTime = 0;
  private lastFrameTime = performance.now();
  private lastStatsUpdateTime = this.lastFrameTime;
  private frameSampleTotalMs = 0;
  private frameSampleCount = 0;

  constructor(options: TfragMapRendererOptions) {
    this.container = options.container;
    this.onLoadProgress = options.onLoadProgress;
    this.onStatus = options.onStatus;
    this.onTfragStats = options.onTfragStats;
    this.onFrameStats = options.onFrameStats;
    this.materialOptions = options.materialOptions ?? defaultTfragMaterialOptions;
    this.frameRateLimit = resolveFrameRateLimit(options.frameRateLimit ?? 120);
    this.minRenderIntervalMs = frameIntervalForLimit(this.frameRateLimit);
  }

  async initialize(): Promise<void> {
    if (!('gpu' in navigator)) {
      throw new Error('WebGPU is not available in this browser');
    }

    this.scene.background = new THREE.Color(canvasClearColor);

    const renderer = new WebGPURenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance'
    });

    await renderer.init();
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(canvasClearColor, canvasClearAlpha);
    renderer.setPixelRatio(1);
    renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    Object.assign(renderer.domElement.style, {
      display: 'block',
      width: '100%',
      height: '100%',
      outline: 'none'
    });

    this.renderer = renderer;
    this.container.replaceChildren(renderer.domElement);
    this.controls = new FpsCameraController(this.camera, renderer.domElement);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.start();
    this.onStatus('WebGPU renderer initialized');
  }

  async loadPackage(mapPackage: LoadedMapPackage): Promise<TfragStats> {
    if (!this.renderer) {
      throw new Error('Renderer has not initialized');
    }

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
      const stats = this.tfragController.prepare(tfragRoot, mapPackage.directionalLights, this.materialOptions);
      this.onTfragStats(stats);
      this.onLoadProgress({
        id: 'tfrag',
        status: 'done',
        detail: `${stats.triangles.toLocaleString()} triangles`
      });

      this.onLoadProgress({
        id: 'compile',
        status: 'active',
        detail: 'Attaching scene',
        loaded: 1,
        total: 3
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
        total: 3
      });
      this.onStatus('Framing camera');
      await yieldToBrowser();
      this.frameObject(root);

      this.onLoadProgress({
        id: 'compile',
        status: 'active',
        detail: 'Submitting first frame',
        loaded: 3,
        total: 3
      });
      await yieldToBrowser();
      this.renderFrame(performance.now());
      this.onLoadProgress({
        id: 'compile',
        status: 'done',
        detail: 'Ready'
      });
      this.onStatus('Tfrag loaded');
      return stats;
    } catch (error: unknown) {
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
    this.controls?.dispose();
    this.disposeCurrentRoot();
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

  private start(): void {
    this.lastFrameTime = performance.now();
    this.lastStatsUpdateTime = this.lastFrameTime;
    this.renderer?.setAnimationLoop((time) => this.handleAnimationFrame(time));
  }

  private handleAnimationFrame(time: DOMHighResTimeStamp): void {
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
    this.renderer.render(this.scene, this.camera);

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
    this.renderer.setSize(width, height, false);
  }

  private frameObject(root: THREE.Object3D): void {
    const bounds = new THREE.Box3().setFromObject(root);
    if (bounds.isEmpty()) {
      this.camera.position.set(0, 150, 300);
      this.camera.lookAt(0, 0, 0);
      this.controls?.setSceneRadius(400);
      this.controls?.syncFromCamera();
      return;
    }

    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5;
    const distance = Math.max(radius * 1.8, 120);
    this.camera.near = Math.max(0.1, distance / 1000);
    this.camera.far = Math.max(5000, distance * 20);
    this.camera.updateProjectionMatrix();
    this.camera.position.set(center.x + distance * 0.75, center.y + distance * 0.55, center.z + distance * 0.75);
    this.camera.lookAt(center);
    this.controls?.setSceneRadius(radius);
    this.controls?.syncFromCamera();
  }

  private disposeCurrentRoot(): void {
    const currentPackage = this.currentPackage;
    this.currentPackage = null;
    this.tfragController.dispose();
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
