import * as THREE from 'three/webgpu';
import { WebGPURenderer } from 'three/webgpu';
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

const worldTargetClearColor = 0x000000;
const worldTargetClearAlpha = 0;

export class WorldCompositeController {
  private renderTargetValue: THREE.RenderTarget | null = null;
  private material: THREE.MeshBasicNodeMaterial | null = null;
  private quadValue: THREE.QuadMesh | null = null;
  private liftUniform: UniformNode<'float', number> | null = null;
  private lift = 1;

  get renderTarget(): THREE.RenderTarget | null {
    return this.renderTargetValue;
  }

  setLift(value: number): void {
    this.lift = value;
    if (this.liftUniform) {
      this.liftUniform.value = value;
    }
  }

  ensure(renderer: WebGPURenderer, width: number, height: number): void {
    this.resize(renderer, width, height);
  }

  resize(renderer: WebGPURenderer, width: number, height: number): void {
    const pixelRatio = renderer.getPixelRatio();
    const targetWidth = Math.max(1, Math.floor(width * pixelRatio));
    const targetHeight = Math.max(1, Math.floor(height * pixelRatio));
    if (
      this.renderTargetValue &&
      (this.renderTargetValue.width !== targetWidth || this.renderTargetValue.height !== targetHeight)
    ) {
      this.dispose();
    }

    if (!this.renderTargetValue) {
      this.renderTargetValue = new THREE.RenderTarget(targetWidth, targetHeight, {
        depthBuffer: true,
        stencilBuffer: false,
        samples: 0,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
        colorSpace: THREE.SRGBColorSpace,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter
      });
      this.renderTargetValue.texture.name = 'map_omatic_world_display_layer';
      this.createMaterial();
      return;
    }

    if (!this.quadValue) {
      this.createMaterial();
    }
  }

  prepareWorldTarget(renderer: WebGPURenderer): boolean {
    if (!this.renderTargetValue || !this.quadValue) {
      return false;
    }

    renderer.setRenderTarget(this.renderTargetValue);
    renderer.setClearColor(worldTargetClearColor, worldTargetClearAlpha);
    renderer.clear(true, true, true);
    return true;
  }

  renderComposite(renderer: WebGPURenderer): void {
    this.quadValue?.render(renderer);
  }

  async compile(renderer: WebGPURenderer): Promise<void> {
    if (this.quadValue) {
      await renderer.compileAsync(this.quadValue, this.quadValue.camera);
    }
  }

  dispose(): void {
    this.material?.dispose();
    this.renderTargetValue?.dispose();
    this.material = null;
    this.quadValue = null;
    this.liftUniform = null;
    this.renderTargetValue = null;
  }

  private createMaterial(): void {
    if (!this.renderTargetValue) {
      return;
    }

    this.material?.dispose();
    const lift = uniform(this.lift);
    const sampleNode = texture(this.renderTargetValue.texture, uv());
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
    this.liftUniform = lift;
    this.material = material;
    this.quadValue = new THREE.QuadMesh(material);
  }
}
