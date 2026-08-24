import * as THREE from 'three/webgpu';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  defaultSkyboxRenderOptions,
  type LoadedMapPackage,
  type SkyboxRenderOptions,
  type SkyboxStats
} from '../../../../services/mapPackages/mapPackageTypes';
import {
  buildSkyboxAnimations,
  updateSkyboxAnimations,
  type SkyboxShellAnimation
} from './SkyboxAnimation';
import { disposeObject3D } from './skyboxDisposal';
import { skyboxInsideCameraEye } from './SkyboxGeometry';
import {
  cloneSkyboxMaterial,
  configureSkyboxMaterial,
  getSkyboxDrawOrder,
  isSkyboxBloomLayer,
  isSkyboxReflectionTextureClone,
  selectSkyboxReflectionTexture
} from './SkyboxMaterials';
import {
  buildSkyboxStats,
  emptySkyboxStats
} from './SkyboxStats';
import { setSkyboxShellVisible, skyboxShellIndices } from './skyboxMetadata';
import {
  buildSkyboxNightStars,
  updateSkyboxNightStars,
  type SkyboxNightStars
} from './SkyboxNightStars';

export class SkyboxController {
  private parent: THREE.Object3D | null = null;
  private root: THREE.Object3D | null = null;
  private cameraEye = new THREE.Vector3();
  private positionOffset = new THREE.Vector3();
  private animations: SkyboxShellAnimation[] = [];
  private nightStars: SkyboxNightStars | null = null;
  private reflectionTexture: THREE.Texture | null = null;
  private hasBloom = false;
  private animationStartSeconds = performance.now() / 1000;
  private options: SkyboxRenderOptions = { ...defaultSkyboxRenderOptions };
  private stats: SkyboxStats = { ...emptySkyboxStats };

  async load(
    parent: THREE.Object3D,
    mapPackage: LoadedMapPackage,
    loader: GLTFLoader,
    options: SkyboxRenderOptions
  ): Promise<SkyboxStats> {
    this.dispose();
    this.parent = parent;
    this.options = { ...options };

    if (!mapPackage.skyboxGltfUrl) {
      this.stats = { ...emptySkyboxStats };
      return this.stats;
    }

    const gltf = await loader.loadAsync(mapPackage.skyboxGltfUrl);
    const root = gltf.scene;
    root.name = 'skybox';
    this.root = root;
    this.configureSkyboxShell(root);
    this.nightStars = await buildSkyboxNightStars(root, gltf, this.cameraEye);
    root.visible = this.options.visible;
    parent.add(root);
    this.stats = buildSkyboxStats(root, this.animations);
    return this.stats;
  }

  setOptions(options: SkyboxRenderOptions): SkyboxStats | null {
    const wasStopped = !this.options.animationEnabled || this.options.animationSpeed <= 0;
    const oldBlendMode = this.options.blendMode;
    const oldAlphaFalloff = this.options.alphaFalloff;
    this.options = { ...options };
    const isStopped = !this.options.animationEnabled || this.options.animationSpeed <= 0;

    if (this.root) {
      this.root.visible = this.options.visible;
      if (oldBlendMode !== this.options.blendMode || oldAlphaFalloff !== this.options.alphaFalloff) {
        this.configureSkyboxMaterials(this.root);
        this.stats = buildSkyboxStats(this.root, this.animations);
      }

      if (wasStopped && !isStopped) {
        this.animationStartSeconds = performance.now() / 1000;
      }
    }

    return this.root ? this.stats : null;
  }

  syncCamera(sourceCamera: THREE.PerspectiveCamera, skyCamera: THREE.PerspectiveCamera): void {
    skyCamera.fov = sourceCamera.fov;
    skyCamera.aspect = sourceCamera.aspect;
    skyCamera.zoom = sourceCamera.zoom;
    skyCamera.near = sourceCamera.near;
    skyCamera.far = sourceCamera.far;
    skyCamera.quaternion.copy(sourceCamera.quaternion);

    if (this.root?.visible) {
      skyCamera.position.copy(this.cameraEye);
      this.root.position.copy(this.positionOffset);
    } else {
      skyCamera.position.set(0, 0, 0);
    }

    skyCamera.updateProjectionMatrix();
    skyCamera.updateMatrixWorld(true);
  }

  update(nowSeconds = performance.now() / 1000): void {
    updateSkyboxAnimations(this.animations, this.animationStartSeconds, this.options, nowSeconds);
    updateSkyboxNightStars(this.nightStars, this.animationStartSeconds, this.options, nowSeconds);
  }

  isVisible(): boolean {
    return this.root?.visible === true;
  }

  getReflectionTexture(): THREE.Texture | null {
    return this.reflectionTexture;
  }

  hasBloomLayers(): boolean {
    return this.hasBloom;
  }

  getShellIndices(): number[] {
    return this.root ? skyboxShellIndices(this.root) : [];
  }

  setShellVisible(index: number, visible: boolean): void {
    if (this.root) {
      setSkyboxShellVisible(this.root, index, visible);
    }
  }

  dispose(): void {
    if (this.root) {
      this.parent?.remove(this.root);
      disposeObject3D(this.root);
    }

    this.parent = null;
    this.root = null;
    this.cameraEye.set(0, 0, 0);
    this.positionOffset.set(0, 0, 0);
    this.animations = [];
    for (const texture of this.nightStars?.textures ?? []) {
      texture.dispose();
    }
    this.nightStars = null;
    if (this.reflectionTexture && isSkyboxReflectionTextureClone(this.reflectionTexture)) {
      this.reflectionTexture.dispose();
    }
    this.reflectionTexture = null;
    this.hasBloom = false;
    this.stats = { ...emptySkyboxStats };
  }

  private configureSkyboxShell(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (!box.isEmpty()) {
      root.position.set(0, 0, 0);
      this.cameraEye.copy(skyboxInsideCameraEye(box));
    } else {
      this.cameraEye.set(0, 0, 0);
    }

    this.positionOffset.copy(root.position);
    root.userData = {
      ...root.userData,
      mapOmaticSkybox: true
    };

    root.traverse((object) => {
      object.frustumCulled = false;

      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.mapOmaticSkyboxNightStars === true) {
        return;
      }

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      this.hasBloom ||= materials.some((material) => isSkyboxBloomLayer(material, mesh));
      mesh.material = cloneSkyboxMaterial(mesh.material, mesh);
    });

    this.configureSkyboxMaterials(root);
    this.reflectionTexture = selectSkyboxReflectionTexture(root);

    this.rebuildAnimations(root);
  }

  private configureSkyboxMaterials(root: THREE.Object3D): void {
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.mapOmaticSkyboxNightStars === true) {
        return;
      }

      mesh.renderOrder = getSkyboxDrawOrder(mesh);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        configureSkyboxMaterial(material, mesh, this.options);
      }
    });
  }

  private rebuildAnimations(root: THREE.Object3D): void {
    this.animations = buildSkyboxAnimations(root);
    this.animationStartSeconds = performance.now() / 1000;
    updateSkyboxAnimations(this.animations, this.animationStartSeconds, this.options, this.animationStartSeconds);
  }
}
