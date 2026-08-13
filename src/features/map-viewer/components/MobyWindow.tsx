import {
  Alert,
  Box,
  Button,
  Center,
  Checkbox,
  Grid,
  Group,
  Loader,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text
} from '@mantine/core';
import { AlertCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  dirnamePackagePath,
  joinPackagePath
} from '../../../services/mapAssets/mapAssetPackage';
import type {
  GltfExportEntry,
  LoadedMapPackage
} from '../../../services/mapPackages/mapPackageTypes';
import type { DlMobyInstances } from '../../../services/wasm/ratchetPs2Wasm';
import { disposeObject3D } from '../renderer/RendererDisposal';
import {
  configureModelMaterialTransparency,
  resolveModelMaterialInfo
} from '../renderer/model-materials/ModelMaterialNodes';
import {
  inspectMobyViewOptions,
  mobyPreviewAlphaScale,
  setMobyBangles,
  setMobyLod,
  setMobyMetalsVisible,
  type MobyLodName
} from '../renderer/mobys/MobyGltfSupport';

interface MobyWindowProps {
  opened: boolean;
  mapPackage: LoadedMapPackage | null;
  mobyInstances: DlMobyInstances | null;
  onClose: () => void;
}

interface MobyOption {
  key: string;
  label: string;
  modelId: number | null;
  instanceCount: number;
  entry: GltfExportEntry;
}

interface MobyDetails {
  animations: Array<{ value: string; label: string }>;
  lods: MobyLodName[];
  bangles: string[];
  hasMetals: boolean;
}

interface MobyPreview {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
}

const bindPoseValue = 'bind-pose';
const emptyDetails: MobyDetails = {
  animations: [],
  lods: [],
  bangles: [],
  hasMetals: false
};

export default function MobyWindow({
  opened,
  mapPackage,
  mobyInstances,
  onClose
}: MobyWindowProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<MobyPreview | null>(null);
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null);
  const [selectedAnimation, setSelectedAnimation] = useState(bindPoseValue);
  const [selectedLod, setSelectedLod] = useState<MobyLodName | null>(null);
  const [visibleBangles, setVisibleBangles] = useState<string[]>([]);
  const [metalsVisible, setMetalsVisible] = useState(true);
  const [details, setDetails] = useState<MobyDetails>(emptyDetails);
  const [thumbnails, setThumbnails] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const models = useMemo(
    () => buildMobyOptions(mapPackage, mobyInstances),
    [mapPackage, mobyInstances]
  );
  const activeModelKey = models.some((model) => model.key === selectedModelKey)
    ? selectedModelKey
    : models[0]?.key ?? null;
  const selectedModel = models.find((model) => model.key === activeModelKey) ?? null;

  useEffect(() => {
    if (!opened || !mapPackage || models.length === 0) {
      return;
    }

    let cancelled = false;
    setThumbnails({});
    void generateMobyThumbnails(
      mapPackage,
      models,
      (key, thumbnail) => {
        if (!cancelled) {
          setThumbnails((current) => ({ ...current, [key]: thumbnail }));
        }
      },
      () => cancelled
    );
    return () => {
      cancelled = true;
    };
  }, [mapPackage, models, opened]);

  useEffect(() => {
    const container = viewportRef.current;
    if (!opened || !container || !mapPackage || !selectedModel) {
      return;
    }
    const activePackage = mapPackage;
    const activeModel = selectedModel;

    let disposed = false;
    let modelRoot: THREE.Object3D | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    const controls = new OrbitControls(camera, renderer.domElement);
    const clock = new THREE.Clock();
    const keyLight = new THREE.DirectionalLight(0xffffff, 3);
    keyLight.position.set(4, 6, 5);
    scene.background = new THREE.Color(0x090d12);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x253446, 2), keyLight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    Object.assign(renderer.domElement.style, {
      display: 'block',
      width: '100%',
      height: '100%'
    });
    container.replaceChildren(renderer.domElement);
    controls.enableDamping = true;

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();
    renderer.setAnimationLoop(() => {
      mixer?.update(Math.min(clock.getDelta(), 0.1));
      controls.update();
      renderer.render(scene, camera);
    });

    setLoading(true);
    setError(null);
    setDetails(emptyDetails);
    setSelectedAnimation(bindPoseValue);
    setSelectedLod(null);
    setVisibleBangles([]);
    setMetalsVisible(true);
    previewRef.current = null;

    async function loadModel() {
      const url = await resolveMobyModelUrl(activePackage, activeModel);
      const gltf = await new GLTFLoader().loadAsync(url);
      if (disposed) {
        disposeObject3D(gltf.scene);
        return;
      }

      modelRoot = gltf.scene;
      configureMobyPreviewMaterials(modelRoot);
      scene.add(modelRoot);
      mixer = new THREE.AnimationMixer(modelRoot);
      const viewOptions = inspectMobyViewOptions(modelRoot);
      const defaultLod = viewOptions.lods.includes('high_lod')
        ? 'high_lod'
        : viewOptions.lods[0] ?? null;
      const bangleSet = new Set(viewOptions.bangles);
      if (defaultLod) {
        setMobyLod(modelRoot, defaultLod);
      }
      setMobyBangles(modelRoot, bangleSet);
      setMobyMetalsVisible(modelRoot, true);
      frameMoby(camera, controls, modelRoot);

      previewRef.current = { root: modelRoot, mixer, clips: gltf.animations };
      setSelectedAnimation(bindPoseValue);
      setSelectedLod(defaultLod);
      setVisibleBangles(viewOptions.bangles);
      setMetalsVisible(true);
      setDetails({
        ...viewOptions,
        animations: gltf.animations.map((clip, index) => ({
          value: String(index),
          label: `${clip.name || `Animation ${index}`} · ${clip.duration.toFixed(2)}s`
        }))
      });
      setLoading(false);
    }

    void loadModel().catch((loadError: unknown) => {
      if (!disposed) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setLoading(false);
      }
    });

    return () => {
      disposed = true;
      previewRef.current = null;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      controls.dispose();
      mixer?.stopAllAction();
      if (modelRoot) {
        scene.remove(modelRoot);
        disposeObject3D(modelRoot);
      }
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.replaceChildren();
      }
    };
  }, [mapPackage, opened, selectedModel?.key]);

  const chooseAnimation = (value: string | null) => {
    const next = value ?? bindPoseValue;
    setSelectedAnimation(next);
    const preview = previewRef.current;
    if (!preview) {
      return;
    }

    preview.mixer.stopAllAction();
    const clip = next === bindPoseValue ? null : preview.clips[Number(next)];
    if (clip) {
      preview.mixer.clipAction(clip).reset().play();
    }
  };

  const chooseLod = (value: string | null) => {
    const next = details.lods.find((lod) => lod === value) ?? null;
    setSelectedLod(next);
    if (next && previewRef.current) {
      setMobyLod(previewRef.current.root, next);
    }
  };

  const toggleBangle = (name: string, visible: boolean) => {
    setVisibleBangles((current) => {
      const next = visible
        ? [...current, name]
        : current.filter((candidate) => candidate !== name);
      if (previewRef.current) {
        setMobyBangles(previewRef.current.root, new Set(next));
      }
      return next;
    });
  };

  const setAllBanglesVisible = (visible: boolean) => {
    const next = visible ? details.bangles : [];
    setVisibleBangles(next);
    if (previewRef.current) {
      setMobyBangles(previewRef.current.root, new Set(next));
    }
  };

  const toggleMetals = (visible: boolean) => {
    setMetalsVisible(visible);
    if (previewRef.current) {
      setMobyMetalsVisible(previewRef.current.root, visible);
    }
  };

  const allBanglesVisible = details.bangles.length > 0
    && details.bangles.every((name) => visibleBangles.includes(name));

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Mobys"
      size="92vw"
      centered
      overlayProps={{ opacity: 0.45, blur: 2 }}
      styles={{
        content: { background: '#10161d' },
        header: { background: '#10161d' },
        title: { fontWeight: 700 }
      }}
    >
      <Stack gap="sm">
        {models.length === 0 ? (
          <Text size="sm" c="dimmed">No moby models found.</Text>
        ) : (
          <Grid gap="sm" align="flex-start">
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="sm" fw={700}>Choose a moby</Text>
                  <Text size="xs" c="dimmed">{models.length.toLocaleString()} classes</Text>
                </Group>
                <Box mah="min(74dvh, 740px)" p={2} style={{ overflowY: 'auto' }}>
                  <SimpleGrid cols={4} spacing={6}>
                    {models.map((model) => {
                      const thumbnail = thumbnails[model.key];
                      const selected = model.key === activeModelKey;
                      return (
                        <Paper
                          component="button"
                          type="button"
                          key={model.key}
                          p={4}
                          radius="sm"
                          withBorder
                          bg={selected ? '#1c3345' : '#151d25'}
                          aria-pressed={selected}
                          onClick={() => setSelectedModelKey(model.key)}
                          style={{
                            borderColor: selected ? '#339af0' : 'rgba(159, 174, 188, 0.18)',
                            cursor: 'pointer',
                            textAlign: 'left'
                          }}
                        >
                          <Stack gap={3}>
                            <Center
                              bg="#090d12"
                              style={{ aspectRatio: '4 / 3', overflow: 'hidden', borderRadius: 3 }}
                            >
                              {typeof thumbnail === 'string' ? (
                                <img
                                  src={thumbnail}
                                  alt=""
                                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                />
                              ) : thumbnail === null ? (
                                <Text size="xs" c="dimmed">N/A</Text>
                              ) : (
                                <Loader size="xs" />
                              )}
                            </Center>
                            <Text size="xs" fw={700} truncate>
                              {model.modelId === null ? 'Unknown' : model.modelId}
                            </Text>
                            <Text size="xs" c="dimmed" truncate>
                              {model.modelId === null
                                ? model.entry.GltfPath
                                : `0x${model.modelId.toString(16).padStart(4, '0')}`}
                            </Text>
                          </Stack>
                        </Paper>
                      );
                    })}
                  </SimpleGrid>
                </Box>
              </Stack>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 'content' }}>
              <Stack gap="xs" w={110}>
                <Text size="sm" fw={700}>Bangles</Text>
                <Button
                  size="compact-xs"
                  variant="default"
                  disabled={loading || details.bangles.length === 0}
                  onClick={() => setAllBanglesVisible(!allBanglesVisible)}
                >
                  {allBanglesVisible ? 'Disable all' : 'Enable all'}
                </Button>
                <Stack gap="xs" mah="min(68dvh, 680px)" p={2} style={{ overflowY: 'auto' }}>
                  {details.bangles.length > 0 ? details.bangles.map((name) => (
                    <Checkbox
                      key={name}
                      size="xs"
                      label={formatGroupName(name)}
                      checked={visibleBangles.includes(name)}
                      onChange={(event) => toggleBangle(name, event.currentTarget.checked)}
                    />
                  )) : (
                    <Text size="xs" c="dimmed">None</Text>
                  )}
                </Stack>
              </Stack>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 'auto' }}>
              <Stack gap="sm">
                <Group align="end" wrap="wrap">
                  <Box flex="1 1 260px" miw={220}>
                    <Text size="xs" c="dimmed">Selected moby</Text>
                    <Text size="sm" fw={700} truncate>{selectedModel?.label}</Text>
                  </Box>
                  <Select
                    label="Animation"
                    searchable
                    data={[
                      { value: bindPoseValue, label: 'Bind pose' },
                      ...details.animations
                    ]}
                    value={selectedAnimation}
                    onChange={chooseAnimation}
                    allowDeselect={false}
                    disabled={loading}
                    flex="1 1 240px"
                    miw={220}
                  />
                  <Select
                    label="LOD"
                    data={details.lods.map((lod) => ({
                      value: lod,
                      label: formatGroupName(lod)
                    }))}
                    value={selectedLod}
                    onChange={chooseLod}
                    allowDeselect={false}
                    disabled={loading || details.lods.length < 2}
                    w={130}
                  />
                  {details.hasMetals ? (
                    <Checkbox
                      mb={9}
                      label="Metals"
                      checked={metalsVisible}
                      onChange={(event) => toggleMetals(event.currentTarget.checked)}
                    />
                  ) : null}
                </Group>

                {error ? (
                  <Alert color="red" icon={<AlertCircle size={18} />} title="Moby unavailable">
                    {error}
                  </Alert>
                ) : null}

                <Box
                  pos="relative"
                  h="min(68dvh, 680px)"
                  mih={360}
                  bg="#090d12"
                  style={{ overflow: 'hidden', borderRadius: 6 }}
                >
                  <Box
                    ref={viewportRef}
                    pos="absolute"
                    inset={0}
                    role="img"
                    aria-label={selectedModel?.label ?? 'Moby preview'}
                  />
                  {loading ? (
                    <Center pos="absolute" inset={0} style={{ pointerEvents: 'none' }}>
                      <Stack gap="xs" align="center">
                        <Loader size="sm" />
                        <Text size="sm" c="dimmed">Loading moby</Text>
                      </Stack>
                    </Center>
                  ) : null}
                </Box>
                <Text size="xs" c="dimmed">Drag to orbit · scroll to zoom · right-drag to pan</Text>
              </Stack>
            </Grid.Col>
          </Grid>
        )}
      </Stack>
    </Modal>
  );
}

async function generateMobyThumbnails(
  mapPackage: LoadedMapPackage,
  models: MobyOption[],
  onThumbnail: (key: string, thumbnail: string | null) => void,
  cancelled: () => boolean
): Promise<void> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.01, 1000);
  const keyLight = new THREE.DirectionalLight(0xffffff, 3);
  keyLight.position.set(4, 6, 5);
  scene.background = new THREE.Color(0x090d12);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x253446, 2), keyLight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(1);
  renderer.setSize(192, 144, false);

  try {
    for (const model of models) {
      if (cancelled()) {
        break;
      }

      let root: THREE.Object3D | null = null;
      try {
        const gltf = await new GLTFLoader().loadAsync(await resolveMobyModelUrl(mapPackage, model));
        root = gltf.scene;
        if (cancelled()) {
          break;
        }

        configureMobyPreviewMaterials(root);
        const viewOptions = inspectMobyViewOptions(root);
        const lod = viewOptions.lods.includes('high_lod') ? 'high_lod' : viewOptions.lods[0];
        if (lod) {
          setMobyLod(root, lod);
        }
        setMobyBangles(root, new Set(viewOptions.bangles));
        setMobyMetalsVisible(root, true);
        scene.add(root);
        camera.lookAt(frameMobyCamera(camera, root));
        renderer.render(scene, camera);
        onThumbnail(model.key, renderer.domElement.toDataURL('image/webp', 0.82));
      } catch (thumbnailError) {
        console.warn(`Failed to render thumbnail for ${model.label}.`, thumbnailError);
        onThumbnail(model.key, null);
      } finally {
        if (root) {
          scene.remove(root);
          disposeObject3D(root);
        }
      }

      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  } finally {
    renderer.dispose();
  }
}

function configureMobyPreviewMaterials(root: THREE.Object3D): void {
  const configuredMaterials = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) {
      return;
    }

    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (configuredMaterials.has(material)) {
        continue;
      }
      configuredMaterials.add(material);
      const info = resolveModelMaterialInfo(material, 'moby');
      configureModelMaterialTransparency(material, info, { alphaBlendDepthWrite: true });
      const map = (material as THREE.MeshStandardMaterial).map;
      if (!map || !info.usesOpacityAlpha) {
        continue;
      }

      map.colorSpace = THREE.SRGBColorSpace;
      const alphaScale = mobyPreviewAlphaScale(info.fullOpacityAlpha);
      const previousCompile = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        previousCompile(shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `#include <map_fragment>\ndiffuseColor.a = min(diffuseColor.a * ${alphaScale.toFixed(8)}, 1.0);`
        );
      };
      material.customProgramCacheKey = () => `moby-preview-alpha-${alphaScale.toFixed(8)}`;
      material.needsUpdate = true;
    }
  });
}

async function resolveMobyModelUrl(
  mapPackage: LoadedMapPackage,
  model: MobyOption
): Promise<string> {
  if (!model.entry.GltfPath) {
    throw new Error('This moby has no glTF asset.');
  }

  const path = joinPackagePath(dirnamePackagePath(mapPackage.assetManifestPath), model.entry.GltfPath);
  return mapPackage.assetPackage.resolveUrl(path);
}

function buildMobyOptions(
  mapPackage: LoadedMapPackage | null,
  mobyInstances: DlMobyInstances | null
): MobyOption[] {
  const instanceCounts = new Map<number, number>();
  for (const instance of mobyInstances?.instances ?? []) {
    instanceCounts.set(instance.classId, (instanceCounts.get(instance.classId) ?? 0) + 1);
  }

  return (mapPackage?.mobyEntries ?? [])
    .filter((entry) => Boolean(entry.GltfPath))
    .map((entry, index) => {
      const modelId = finiteModelId(entry.ModelId);
      const count = modelId === null ? 0 : instanceCounts.get(modelId) ?? 0;
      return {
        key: `${String(entry.ModelId ?? index)}:${entry.GltfPath}`,
        label: modelId === null
          ? entry.GltfPath!
          : `Class ${modelId} (0x${modelId.toString(16).padStart(4, '0')}) · ${count} ${count === 1 ? 'instance' : 'instances'}`,
        modelId,
        instanceCount: count,
        entry
      };
    })
    .sort((left, right) => (left.modelId ?? Number.MAX_SAFE_INTEGER) - (right.modelId ?? Number.MAX_SAFE_INTEGER)
      || left.label.localeCompare(right.label));
}

function finiteModelId(value: GltfExportEntry['ModelId']): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function frameMoby(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  root: THREE.Object3D
): void {
  controls.target.copy(frameMobyCamera(camera, root));
  controls.update();
}

function frameMobyCamera(camera: THREE.PerspectiveCamera, root: THREE.Object3D): THREE.Vector3 {
  const sphere = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere());
  const radius = Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 1;
  camera.near = Math.max(radius / 100, 0.001);
  camera.far = Math.max(radius * 100, 100);
  camera.position.copy(sphere.center).add(new THREE.Vector3(radius * 1.6, radius * 0.8, radius * 1.6));
  camera.updateProjectionMatrix();
  return sphere.center;
}

function formatGroupName(name: string): string {
  return name
    .replace(/^bangle_/, 'Bangle ')
    .replace(/_lod$/, '')
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}
