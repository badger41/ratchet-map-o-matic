import { Alert, Box, Center, Checkbox, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { AlertCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  diffuseColor,
  emissive,
  float,
  mrt,
  output,
  pass,
  sRGBTransferEOTF,
  sRGBTransferOETF,
  step,
  vec4
} from 'three/tsl';
import type BloomNode from 'three/addons/tsl/display/BloomNode.js';
import type Node from 'three/src/nodes/core/Node.js';
import type PassNode from 'three/src/nodes/display/PassNode.js';
import {
  defaultSkyboxRenderOptions,
  type LoadedMapPackage
} from '../../../services/mapPackages/mapPackageTypes';
import type { DlLevelSettings } from '../../../services/wasm/ratchetPs2Wasm';
import {
  createRendererDeviceLostError,
  createRendererInitializationError,
  createRendererRuntimeError
} from '../renderer/RendererCompatibility';
import {
  ps2SkyBloom,
  ps2SkyBloomProfileForGame
} from '../renderer/TightBloomNode';
import { skyboxEncodedBackgroundColor } from '../renderer/skybox/SkyboxBackground';
import { SkyboxController } from '../renderer/skybox/SkyboxController';

interface SkyboxWindowProps {
  opened: boolean;
  mapPackage: LoadedMapPackage | null;
  levelSettings: DlLevelSettings | null;
  onClose: () => void;
}

interface SkyboxPreviewPipeline {
  renderPipeline: THREE.RenderPipeline;
  skyPass: PassNode;
  bloomNode: BloomNode | null;
}

export default function SkyboxWindow({
  opened,
  mapPackage,
  levelSettings,
  onClose
}: SkyboxWindowProps) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const skyboxRef = useRef<SkyboxController | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shells, setShells] = useState<number[]>([]);
  const [visibleShells, setVisibleShells] = useState<number[]>([]);
  const hasSkybox = Boolean(mapPackage?.skyboxGltfUrl);

  const toggleShell = (index: number, visible: boolean) => {
    skyboxRef.current?.setShellVisible(index, visible);
    setVisibleShells((current) => visible
      ? current.includes(index) ? current : [...current, index]
      : current.filter((candidate) => candidate !== index));
  };

  useEffect(() => {
    const container = viewport;
    if (!opened || !container || !mapPackage?.skyboxGltfUrl) {
      return;
    }
    const activeContainer = container;
    const activePackage = mapPackage;
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let pipeline: SkyboxPreviewPipeline | null = null;
    const scene = new THREE.Scene();
    const orbitCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 50000);
    const renderer = new WebGPURenderer({ antialias: false, alpha: false, forceWebGL: true });
    const controls = new OrbitControls(orbitCamera, renderer.domElement);
    const skybox = new SkyboxController();

    scene.background = skyboxEncodedBackgroundColor(levelSettings);
    orbitCamera.position.set(0, 0, 1);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    renderer.autoClear = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setPixelRatio(1);
    Object.assign(renderer.domElement.style, {
      display: 'block',
      width: '100%',
      height: '100%',
      touchAction: 'none'
    });
    const resize = () => {
      const width = Math.max(1, activeContainer.clientWidth);
      const height = Math.max(1, activeContainer.clientHeight);
      orbitCamera.aspect = width / height;
      orbitCamera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    activeContainer.replaceChildren(renderer.domElement);
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(activeContainer);
    resize();
    setLoading(true);
    setError(null);

    const fail = (cause: unknown) => {
      if (!disposed) {
        setError(createRendererRuntimeError(cause).message);
        setLoading(false);
        renderer.setAnimationLoop(null);
      }
    };

    async function initialize() {
      try {
        await renderer.init();
      } catch (cause) {
        throw createRendererInitializationError(cause);
      }
      if (disposed) {
        return;
      }

      const defaultOnDeviceLost = renderer.onDeviceLost.bind(renderer);
      renderer.onDeviceLost = (info) => {
        defaultOnDeviceLost(info);
        fail(createRendererDeviceLostError(info));
      };

      await skybox.load(scene, activePackage, new GLTFLoader(), defaultSkyboxRenderOptions);
      if (disposed) {
        return;
      }
      skyboxRef.current = skybox;
      const shellIndices = skybox.getShellIndices();
      setShells(shellIndices);
      setVisibleShells(shellIndices);
      frameSkybox(orbitCamera, controls, scene.getObjectByName('skybox') ?? scene);

      pipeline = createSkyboxPreviewPipeline(
        renderer,
        scene,
        orbitCamera,
        skybox,
        activePackage.rootManifest.Game
      );
      await pipeline.skyPass.compileAsync(renderer);

      const renderFrame = () => {
        try {
          controls.update();
          skybox.update();
          renderer.setRenderTarget(null);
          renderer.setClearColor(0x070a0d, 0);
          renderer.clear(true, true, true);
          pipeline?.renderPipeline.render();
        } catch (cause) {
          fail(cause);
        }
      };
      renderFrame();
      setLoading(false);
      await renderer.setAnimationLoop(renderFrame);
    }

    void initialize().catch(fail);

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      resizeObserver?.disconnect();
      controls.dispose();
      disposeSkyboxPreviewPipeline(pipeline);
      skybox.dispose();
      if (skyboxRef.current === skybox) {
        skyboxRef.current = null;
      }
      renderer.dispose();
      if (activeContainer.contains(renderer.domElement)) {
        activeContainer.replaceChildren();
      }
    };
  }, [levelSettings, mapPackage, opened, viewport]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Skybox"
      size="92vw"
      centered
      overlayProps={{ opacity: 0.45, blur: 2 }}
      styles={{
        content: { background: '#10161d' },
        header: { background: '#10161d' },
        title: { fontWeight: 700 }
      }}
    >
      {!hasSkybox ? (
        <Text size="sm" c="dimmed">No skybox found.</Text>
      ) : (
        <Stack gap="sm">
          {error ? (
            <Alert color="red" icon={<AlertCircle size={18} />} title="Skybox unavailable">
              {error}
            </Alert>
          ) : null}
          <Box
            pos="relative"
            h="min(74dvh, 740px)"
            mih={360}
            bg="#090d12"
            style={{ overflow: 'hidden', borderRadius: 6 }}
          >
            <Box
              ref={setViewport}
              pos="absolute"
              inset={0}
              role="img"
              aria-label="Skybox preview"
            />
            {loading ? (
              <Center pos="absolute" inset={0} style={{ pointerEvents: 'none' }}>
                <Stack gap="xs" align="center">
                  <Loader size="sm" />
                  <Text size="sm" c="dimmed">Loading skybox</Text>
                </Stack>
              </Center>
            ) : null}
          </Box>
          {shells.length > 0 ? (
            <Group gap="md" wrap="wrap">
              <Text size="xs" fw={700}>Shells</Text>
              {shells.map((index) => (
                <Checkbox
                  key={index}
                  size="xs"
                  label={`Shell ${index}`}
                  checked={visibleShells.includes(index)}
                  onChange={(event) => toggleShell(index, event.currentTarget.checked)}
                />
              ))}
            </Group>
          ) : null}
          <Text size="xs" c="dimmed">Drag to look around · scroll to zoom</Text>
        </Stack>
      )}
    </Modal>
  );
}

function createSkyboxPreviewPipeline(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  skybox: SkyboxController,
  game: unknown
): SkyboxPreviewPipeline {
  const skyPass = pass(scene, camera);
  const profile = ps2SkyBloomProfileForGame(game);
  if (skybox.hasBloomLayers() && profile === 'uya') {
    const frameAlpha = diffuseColor.a.mul(128).floor().div(128);
    const alphaWrite = step(float(8 / 128), frameAlpha);
    const skyMrt = mrt({ output, frameAlpha: vec4(frameAlpha, 0, 0, alphaWrite) });
    const alphaBlend = new THREE.BlendMode(THREE.CustomBlending);
    alphaBlend.blendSrc = THREE.SrcAlphaFactor;
    alphaBlend.blendDst = THREE.OneMinusSrcAlphaFactor;
    alphaBlend.blendEquation = THREE.AddEquation;
    skyMrt.setBlendMode('frameAlpha', alphaBlend);
    skyPass.setMRT(skyMrt);
  } else if (skybox.hasBloomLayers()) {
    const skyMrt = mrt({ output, bloomSource: vec4(emissive, diffuseColor.a) });
    skyMrt.setBlendMode('bloomSource', new THREE.BlendMode(THREE.MaterialBlending));
    skyPass.setMRT(skyMrt);
  }

  const skyColor = skyPass.getTextureNode('output');
  const linearSky = vec4(sRGBTransferEOTF(skyColor.rgb) as Node<'vec3'>, skyColor.a);
  let bloomNode: BloomNode | null = null;
  let previewOutput: Node = linearSky;
  if (skybox.hasBloomLayers()) {
    const bloomSource = profile === 'uya'
      ? vec4(skyColor.rgb, skyPass.getTextureNode('frameAlpha').r)
      : skyPass.getTextureNode('bloomSource');
    const bloom = ps2SkyBloom(
      vec4(bloomSource.rgb, profile === 'uya' ? bloomSource.a : linearSky.a),
      profile
    );
    bloomNode = bloom;
    const encodedSky = sRGBTransferOETF(linearSky.rgb) as Node<'vec3'>;
    previewOutput = vec4(
      sRGBTransferEOTF(encodedSky.add(bloom.rgb)) as Node<'vec3'>,
      linearSky.a
    );
  }

  return {
    renderPipeline: new THREE.RenderPipeline(renderer, previewOutput),
    skyPass,
    bloomNode
  };
}

function disposeSkyboxPreviewPipeline(pipeline: SkyboxPreviewPipeline | null): void {
  pipeline?.renderPipeline.dispose();
  pipeline?.skyPass.dispose();
  (pipeline?.bloomNode as (BloomNode & { dispose?: () => void }) | undefined)?.dispose?.();
}

function frameSkybox(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  root: THREE.Object3D
): void {
  const sphere = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere());
  const radius = Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 1;
  camera.near = Math.max(radius / 100, 0.001);
  camera.far = Math.max(radius * 100, 100);
  camera.position.copy(sphere.center).add(new THREE.Vector3(radius * 1.6, radius * 0.8, radius * 1.6));
  camera.updateProjectionMatrix();
  controls.target.copy(sphere.center);
  controls.update();
}
