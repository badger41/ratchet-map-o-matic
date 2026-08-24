// @ts-nocheck
// ponytail: Three exposes BloomNode, but not its mip-factor controls; keep the internal override isolated here.
import { NodeMaterial } from 'three/webgpu';
import { Fn, step, textureSize, uv, vec2, vec4 } from 'three/tsl';
import BloomNode from 'three/addons/tsl/display/BloomNode.js';
import type Node from 'three/src/nodes/core/Node.js';

export const tightBloomVersion = '2026-08-24-tie-bloom-framebuffer-space';

export type Ps2SkyBloomProfile = 'uya' | 'dl';

export function tightBloom(node: Node, strength = 1, radius = 0, threshold = 0): BloomNode {
  return new TightBloomNode(node, strength, radius, threshold);
}

export function ps2SkyBloom(node: Node, profile: Ps2SkyBloomProfile): BloomNode {
  const strength = profile === 'uya' ? 1 : 2.25;
  return new TightBloomNode(node, strength, 0, 0, profile);
}

export function ps2SkyBloomProfileForGame(game: unknown): Ps2SkyBloomProfile {
  return typeof game === 'string' && game.toUpperCase() === 'UYA' ? 'uya' : 'dl';
}

class TightBloomNode extends BloomNode {
  private readonly ps2Sky: Ps2SkyBloomProfile | false;

  constructor(
    node: Node,
    strength = 1,
    radius = 0,
    threshold = 0,
    ps2Sky: Ps2SkyBloomProfile | false = false
  ) {
    super(node, strength, radius, threshold);
    this.ps2Sky = ps2Sky;
  }

  setup(builder: { getSharedContext: () => unknown }) {
    const self = this as unknown as {
      _highPassFilterMaterial: NodeMaterial | null;
      _compositeMaterial: NodeMaterial | null;
      _separableBlurMaterials: NodeMaterial[];
      _getSeparableBlurMaterial: (builder: unknown, kernelRadius: number) => NodeMaterial;
      _nMips: number;
      _textureNodeBlur0: Node;
      _textureNodeBlur1: Node;
      _textureNodeBlur2: Node;
      _textureOutput: Node;
    };

    const luminosityHighPass = Fn(() => {
      if (this.ps2Sky !== 'uya') {
        return this.inputNode;
      }

      const framebufferAlpha = this.inputNode.a;
      const modulatedAlpha = framebufferAlpha.mul(64).floor().div(128);
      const extractedRgb = this.inputNode.rgb
        .mul(modulatedAlpha)
        .mul(step(65 / 128, modulatedAlpha));
      return vec4(extractedRgb, 1);
    });

    self._highPassFilterMaterial = self._highPassFilterMaterial || new NodeMaterial();
    self._highPassFilterMaterial.fragmentNode = luminosityHighPass().context(builder.getSharedContext());
    self._highPassFilterMaterial.name = 'TightBloom_highPass';
    self._highPassFilterMaterial.needsUpdate = true;

    self._nMips = this.ps2Sky === 'uya' ? 3 : this.ps2Sky ? 2 : 1;
    self._separableBlurMaterials.length = 0;
    self._separableBlurMaterials.push(self._getSeparableBlurMaterial(builder, this.ps2Sky === 'uya' ? 2 : 6));
    if (this.ps2Sky) {
      self._separableBlurMaterials.push(self._getSeparableBlurMaterial(builder, this.ps2Sky === 'uya' ? 2 : 10));
    }
    if (this.ps2Sky === 'uya') {
      self._separableBlurMaterials.push(self._getSeparableBlurMaterial(builder, 4));
    }

    const compositePass = Fn(() => {
      if (this.ps2Sky === 'uya') {
        const source = self._textureNodeBlur2;
        const sampleUv = uv();
        const sampleStep = vec2(1).div(textureSize(source));
        return source.sample(sampleUv).mul(4)
          .add(source.sample(sampleUv.add(vec2(sampleStep.x, 0))).mul(2))
          .add(source.sample(sampleUv.sub(vec2(sampleStep.x, 0))).mul(2))
          .add(source.sample(sampleUv.add(vec2(0, sampleStep.y))).mul(2))
          .add(source.sample(sampleUv.sub(vec2(0, sampleStep.y))).mul(2))
          .add(source.sample(sampleUv.add(sampleStep)))
          .add(source.sample(sampleUv.sub(sampleStep)))
          .add(source.sample(sampleUv.add(vec2(sampleStep.x, sampleStep.y.negate()))))
          .add(source.sample(sampleUv.add(vec2(sampleStep.x.negate(), sampleStep.y))))
          .mul(0.152587890625)
          .clamp(0, 1)
          .mul(this.strength);
      }

      const bloom = this.ps2Sky === 'dl'
        ? self._textureNodeBlur0.mul(0.7).add(self._textureNodeBlur1.mul(0.3))
        : self._textureNodeBlur0;
      return bloom.mul(this.strength);
    });

    self._compositeMaterial = self._compositeMaterial || new NodeMaterial();
    self._compositeMaterial.fragmentNode = compositePass().context(builder.getSharedContext());
    self._compositeMaterial.name = 'TightBloom_comp';
    self._compositeMaterial.needsUpdate = true;

    return self._textureOutput;
  }
}
