import {
  Alert,
  Box,
  Center,
  Grid,
  Group,
  Loader,
  Modal,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text
} from '@mantine/core';
import { AlertCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { LoadedMapPackage } from '../../../services/mapPackages/mapPackageTypes';
import { disposeObject3D } from '../renderer/RendererDisposal';
import {
  configureModelMaterialTransparency,
  resolveModelMaterialInfo,
  syncModelAlphaOpaquePass
} from '../renderer/model-materials/ModelMaterialNodes';
import {
  loadTieClassSource,
  pruneToLod0
} from '../renderer/ties/TieClassSource';
import { buildTieOptions, type TieOption } from './tieWindowData';

interface TieWindowProps {
  opened: boolean;
  mapPackage: LoadedMapPackage | null;
  onClose: () => void;
}

type TiePreviewSideMode = 'game' | 'front' | 'double';

export default function TieWindow({
  opened,
  mapPackage,
  onClose
}: TieWindowProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const sideModeRef = useRef<TiePreviewSideMode>('game');
  const [selectedTieKey, setSelectedTieKey] = useState<string | null>(null);
  const [sideMode, setSideMode] = useState<TiePreviewSideMode>('game');
  const [thumbnails, setThumbnails] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ties = useMemo(() => buildTieOptions(mapPackage?.tieEntries ?? []), [mapPackage]);
  const activeTieKey = ties.some((tie) => tie.key === selectedTieKey)
    ? selectedTieKey
    : ties[0]?.key ?? null;
  const selectedTie = ties.find((tie) => tie.key === activeTieKey) ?? null;

  useEffect(() => {
    if (!opened || !mapPackage || ties.length === 0) {
      return;
    }

    let cancelled = false;
    setThumbnails({});
    void generateTieThumbnails(
      mapPackage,
      ties,
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
  }, [mapPackage, opened, ties]);

  useEffect(() => {
    const container = viewportRef.current;
    if (!opened || !container || !mapPackage || !selectedTie) {
      return;
    }
    const activePackage = mapPackage;
    const activeTie = selectedTie;

    let disposed = false;
    let modelRoot: THREE.Object3D | null = null;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    const controls = new OrbitControls(camera, renderer.domElement);
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
      controls.update();
      if (modelRoot) {
        setTiePreviewSideMode(modelRoot, sideModeRef.current);
      }
      renderer.render(scene, camera);
    });

    setLoading(true);
    setError(null);

    async function loadModel() {
      const root = await loadTieClassSource(new GLTFLoader(), activePackage, activeTie.entry);
      if (!root) {
        throw new Error(`Tie class ${activeTie.modelId} could not be loaded.`);
      }
      if (disposed) {
        disposeObject3D(root);
        return;
      }

      modelRoot = root;
      pruneToLod0(modelRoot);
      configureTiePreviewMaterials(modelRoot);
      scene.add(modelRoot);
      frameTie(camera, controls, modelRoot);
      setTiePreviewSideMode(modelRoot, sideModeRef.current);
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
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      controls.dispose();
      if (modelRoot) {
        scene.remove(modelRoot);
        disposeObject3D(modelRoot);
      }
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.replaceChildren();
      }
    };
  }, [mapPackage, opened, selectedTie?.key]);

  const chooseSide = (value: string) => {
    const nextMode = value as TiePreviewSideMode;
    sideModeRef.current = nextMode;
    setSideMode(nextMode);
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Ties"
      size="92vw"
      centered
      overlayProps={{ opacity: 0.45, blur: 2 }}
      styles={{
        content: { background: '#10161d' },
        header: { background: '#10161d' },
        title: { fontWeight: 700 }
      }}
    >
      {ties.length === 0 ? (
        <Text size="sm" c="dimmed">No tie models found.</Text>
      ) : (
        <Grid gap="sm" align="flex-start">
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Stack gap="xs">
              <Text size="sm" fw={700}>
                Choose a tie · {ties.length.toLocaleString()} classes
              </Text>
              <Box mah="min(74dvh, 740px)" p={2} style={{ overflowY: 'auto' }}>
                <SimpleGrid cols={4} spacing={6}>
                  {ties.map((tie) => {
                    const thumbnail = thumbnails[tie.key];
                    const selected = tie.key === activeTieKey;
                    return (
                      <Paper
                        component="button"
                        type="button"
                        key={tie.key}
                        p={4}
                        radius="sm"
                        withBorder
                        bg={selected ? '#1c3345' : '#151d25'}
                        aria-pressed={selected}
                        aria-label={tie.label}
                        onClick={() => setSelectedTieKey(tie.key)}
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
                          <Text size="xs" fw={700} truncate>{tie.modelId}</Text>
                          <Text size="xs" c="dimmed" truncate>
                            0x{tie.modelId.toString(16).padStart(4, '0')}
                          </Text>
                        </Stack>
                      </Paper>
                    );
                  })}
                </SimpleGrid>
              </Box>
            </Stack>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 8 }}>
            <Stack gap="sm">
              <Group justify="space-between" align="end" wrap="wrap">
                <Box>
                  <Text size="xs" c="dimmed">Selected tie</Text>
                  <Text size="sm" fw={700} truncate>{selectedTie?.label}</Text>
                </Box>
                <SegmentedControl
                  size="xs"
                  aria-label="Tie face rendering"
                  value={sideMode}
                  data={[
                    { value: 'game', label: 'Game distance' },
                    { value: 'front', label: 'Front only' },
                    { value: 'double', label: 'Double-sided' }
                  ]}
                  onChange={chooseSide}
                  disabled={loading}
                />
              </Group>

              {error ? (
                <Alert color="red" icon={<AlertCircle size={18} />} title="Tie unavailable">
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
                  aria-label={selectedTie?.label ?? 'Tie preview'}
                />
                {loading ? (
                  <Center pos="absolute" inset={0} style={{ pointerEvents: 'none' }}>
                    <Stack gap="xs" align="center">
                      <Loader size="sm" />
                      <Text size="sm" c="dimmed">Loading tie</Text>
                    </Stack>
                  </Center>
                ) : null}
              </Box>
              <Text size="xs" c="dimmed">Drag to orbit · scroll to zoom · right-drag to pan</Text>
            </Stack>
          </Grid.Col>
        </Grid>
      )}
    </Modal>
  );
}

async function generateTieThumbnails(
  mapPackage: LoadedMapPackage,
  ties: TieOption[],
  onThumbnail: (key: string, thumbnail: string | null) => void,
  cancelled: () => boolean
): Promise<void> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.01, 1000);
  const loader = new GLTFLoader();
  const keyLight = new THREE.DirectionalLight(0xffffff, 3);
  keyLight.position.set(4, 6, 5);
  scene.background = new THREE.Color(0x090d12);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x253446, 2), keyLight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(1);
  renderer.setSize(192, 144, false);

  try {
    for (const tie of ties) {
      if (cancelled()) {
        break;
      }

      let root: THREE.Object3D | null = null;
      try {
        root = await loadTieClassSource(loader, mapPackage, tie.entry);
        if (!root) {
          throw new Error(`Tie class ${tie.modelId} could not be loaded.`);
        }
        if (cancelled()) {
          break;
        }

        pruneToLod0(root);
        configureTiePreviewMaterials(root);
        scene.add(root);
        camera.lookAt(frameTieCamera(camera, root));
        setTiePreviewSideMode(root, 'game');
        renderer.render(scene, camera);
        onThumbnail(tie.key, renderer.domElement.toDataURL('image/webp', 0.82));
      } catch (thumbnailError) {
        console.warn(`Failed to render thumbnail for ${tie.label}.`, thumbnailError);
        onThumbnail(tie.key, null);
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

function configureTiePreviewMaterials(root: THREE.Object3D): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) {
      return;
    }

    meshes.push(mesh);
    const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const materials = sourceMaterials.map((material) => material.clone());
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
    for (const material of materials) {
      const sourceSide = material.side;
      const info = resolveModelMaterialInfo(material, 'tie');
      configureModelMaterialTransparency(material, info);
      material.userData.mapOmaticTiePreviewSourceSide = sourceSide;
      const map = (material as THREE.MeshStandardMaterial).map;
      if (!map) {
        continue;
      }

      map.colorSpace = THREE.SRGBColorSpace;
      if (!info.usesOpacityAlpha) {
        continue;
      }

      const alphaScale = 1 / THREE.MathUtils.clamp(info.fullOpacityAlpha, 1 / 255, 1);
      const previousCompile = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        previousCompile(shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `#include <map_fragment>\ndiffuseColor.a = min(diffuseColor.a * ${alphaScale.toFixed(8)}, 1.0);`
        );
      };
      material.customProgramCacheKey = () => `tie-preview-alpha-${alphaScale.toFixed(8)}`;
      material.needsUpdate = true;
    }
  });
  for (const mesh of meshes) {
    syncModelAlphaOpaquePass(mesh);
  }
}

function setTiePreviewSideMode(
  root: THREE.Object3D,
  mode: TiePreviewSideMode
): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) {
      return;
    }

    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const side = mode === 'double'
        ? THREE.DoubleSide
        : mode === 'front'
          ? THREE.FrontSide
          : material.userData.mapOmaticTiePreviewSourceSide ?? THREE.FrontSide;
      if (material.side !== side) {
        material.side = side;
        material.needsUpdate = true;
      }
    }
  });
}

function frameTie(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  root: THREE.Object3D
): void {
  controls.target.copy(frameTieCamera(camera, root));
  controls.update();
}

function frameTieCamera(camera: THREE.PerspectiveCamera, root: THREE.Object3D): THREE.Vector3 {
  const sphere = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere());
  const radius = Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 1;
  camera.near = Math.max(radius / 100, 0.001);
  camera.far = Math.max(radius * 100, 100);
  camera.position.copy(sphere.center).add(new THREE.Vector3(radius * 1.6, radius * 0.8, radius * 1.6));
  camera.updateProjectionMatrix();
  return sphere.center;
}
