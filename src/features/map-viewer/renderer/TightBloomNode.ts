// @ts-nocheck
// ponytail: Three exposes BloomNode, but not its mip-factor controls; keep the internal override isolated here.
import { NodeMaterial } from 'three/webgpu';
import { Fn } from 'three/tsl';
import BloomNode from 'three/addons/tsl/display/BloomNode.js';
import type Node from 'three/src/nodes/core/Node.js';

export const tightBloomVersion = '2026-07-13-glow-layer-one-mip';

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
      return this.inputNode;
    });

    self._highPassFilterMaterial = self._highPassFilterMaterial || new NodeMaterial();
    self._highPassFilterMaterial.fragmentNode = luminosityHighPass().context(builder.getSharedContext());
    self._highPassFilterMaterial.name = 'TightBloom_highPass';
    self._highPassFilterMaterial.needsUpdate = true;

    self._nMips = 1;
    self._separableBlurMaterials.length = 0;
    self._separableBlurMaterials.push(self._getSeparableBlurMaterial(builder, 6));

    const compositePass = Fn(() => {
      return self._textureNodeBlur0.mul(this.strength);
    });

    self._compositeMaterial = self._compositeMaterial || new NodeMaterial();
    self._compositeMaterial.fragmentNode = compositePass().context(builder.getSharedContext());
    self._compositeMaterial.name = 'TightBloom_comp';
    self._compositeMaterial.needsUpdate = true;

    return self._textureOutput;
  }
}
