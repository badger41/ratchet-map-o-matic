// @ts-nocheck
// ponytail: Three exposes BloomNode, but not its mip-factor controls; keep the internal override isolated here.
import { NodeMaterial, Vector3 } from 'three/webgpu';
import {
  Fn,
  float,
  luminance,
  mix,
  smoothstep,
  uniformArray,
  vec4
} from 'three/tsl';
import BloomNode from 'three/addons/tsl/display/BloomNode.js';
import type Node from 'three/src/nodes/core/Node.js';

export const tightBloomVersion = '2026-06-24-dense-core-wide';

export function tightBloom(node: Node, strength = 1, radius = 0, threshold = 0): BloomNode {
  return new TightBloomNode(node, strength, radius, threshold);
}

class TightBloomNode extends BloomNode {
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
      _textureNodeBlur3: Node;
      _textureNodeBlur4: Node;
      _textureOutput: Node;
    };

    const luminosityHighPass = Fn(() => {
      const texel = this.inputNode;
      const value = luminance(texel.rgb);
      const alpha = smoothstep(this.threshold, this.threshold.add(this.smoothWidth), value);
      return mix(vec4(0), texel, alpha);
    });

    self._highPassFilterMaterial = self._highPassFilterMaterial || new NodeMaterial();
    self._highPassFilterMaterial.fragmentNode = luminosityHighPass().context(builder.getSharedContext());
    self._highPassFilterMaterial.name = 'TightBloom_highPass';
    self._highPassFilterMaterial.needsUpdate = true;

    const kernelSizeArray = [9, 13, 11, 9, 9];
    for (let index = 0; index < self._nMips; index += 1) {
      self._separableBlurMaterials.push(self._getSeparableBlurMaterial(builder, kernelSizeArray[index]));
    }

    const bloomFactors = uniformArray([1.0, 0.88, 0.075, 0.0, 0.0]);
    const bloomTintColors = uniformArray([
      new Vector3(1, 1, 1),
      new Vector3(1, 1, 1),
      new Vector3(1, 1, 1),
      new Vector3(1, 1, 1),
      new Vector3(1, 1, 1)
    ]);

    const lerpBloomFactor = Fn(([factor, radiusNode]) => {
      const mirrorFactor = float(1.2).sub(factor);
      return mix(factor, mirrorFactor, radiusNode);
    }).setLayout({
      name: 'lerpBloomFactor',
      type: 'float',
      inputs: [
        { name: 'factor', type: 'float' },
        { name: 'radius', type: 'float' }
      ]
    });

    const compositePass = Fn(() => {
      const color0 = lerpBloomFactor(bloomFactors.element(0), this.radius).mul(vec4(bloomTintColors.element(0), 1.0)).mul(self._textureNodeBlur0);
      const color1 = lerpBloomFactor(bloomFactors.element(1), this.radius).mul(vec4(bloomTintColors.element(1), 1.0)).mul(self._textureNodeBlur1);
      const color2 = lerpBloomFactor(bloomFactors.element(2), this.radius).mul(vec4(bloomTintColors.element(2), 1.0)).mul(self._textureNodeBlur2);
      const color3 = lerpBloomFactor(bloomFactors.element(3), this.radius).mul(vec4(bloomTintColors.element(3), 1.0)).mul(self._textureNodeBlur3);
      const color4 = lerpBloomFactor(bloomFactors.element(4), this.radius).mul(vec4(bloomTintColors.element(4), 1.0)).mul(self._textureNodeBlur4);
      return color0.add(color1).add(color2).add(color3).add(color4).mul(this.strength);
    });

    self._compositeMaterial = self._compositeMaterial || new NodeMaterial();
    self._compositeMaterial.fragmentNode = compositePass().context(builder.getSharedContext());
    self._compositeMaterial.name = 'TightBloom_comp';
    self._compositeMaterial.needsUpdate = true;

    return self._textureOutput;
  }
}
