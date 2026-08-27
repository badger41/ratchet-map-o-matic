import {
  Alert,
  Box,
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
import { useEffect, useState } from 'react';
import { dirnamePackagePath, joinPackagePath } from '../../../services/mapAssets/mapAssetPackage';
import type { LoadedMapPackage } from '../../../services/mapPackages/mapPackageTypes';
import { formatByteSize } from '../../../shared/format';
import { readHudBankSlots, type HudBankSlot } from './hudBankData';

interface HudBanksWindowProps {
  opened: boolean;
  mapPackage: LoadedMapPackage | null;
  onClose: () => void;
}

export default function HudBanksWindow({
  opened,
  mapPackage,
  onClose
}: HudBanksWindowProps) {
  const [banks, setBanks] = useState<HudBankSlot[]>([]);
  const [selectedBank, setSelectedBank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeBank = banks.find((bank) => bank.index === selectedBank) ?? banks[0] ?? null;

  useEffect(() => {
    if (!opened || !mapPackage) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadHudBankSlots(mapPackage)
      .then((loadedBanks) => {
        if (!cancelled) {
          setBanks(loadedBanks);
          setSelectedBank(loadedBanks[0]?.index ?? null);
          setLoading(false);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mapPackage, opened]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="HUD banks"
      size="90vw"
      centered
      overlayProps={{ opacity: 0.45, blur: 2 }}
      styles={{
        content: { background: '#10161d', height: '80dvh' },
        body: { height: 'calc(80dvh - 60px)', overflowY: 'auto' },
        header: { background: '#10161d' },
        title: { fontWeight: 700 }
      }}
    >
      {loading ? (
        <Group justify="center" p="xl">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">Loading HUD banks</Text>
        </Group>
      ) : error ? (
        <Alert color="red" icon={<AlertCircle size={18} />} title="HUD banks unavailable">
          {error}
        </Alert>
      ) : !activeBank ? (
        <Text size="sm" c="dimmed">No exported HUD banks found.</Text>
      ) : (
        <Stack gap="sm">
          <Group justify="space-between" align="center" wrap="wrap">
            <Group gap="sm" wrap="nowrap">
              <Text size="sm" fw={700}>Bank slot</Text>
              <SegmentedControl
                size="xs"
                value={String(activeBank.index)}
                data={banks.map((bank) => ({
                  value: String(bank.index),
                  label: String(bank.index)
                }))}
                onChange={(value) => setSelectedBank(Number(value))}
              />
            </Group>
            <Text size="xs" c="dimmed">
              {activeBank.textures.length.toLocaleString()} frames · {formatByteSize(activeBank.length)}
            </Text>
          </Group>

          {activeBank.textures.length === 0 ? (
            <Text size="sm" c="dimmed">This HUD bank slot is empty.</Text>
          ) : (
            <SimpleGrid cols={{ base: 2, sm: 4, md: 6, lg: 7 }} spacing="xs">
              {activeBank.textures.map((texture) => (
                <Paper
                  key={`${activeBank.index}:${texture.frameIndex}`}
                  p="xs"
                  radius="sm"
                  withBorder
                  bg="#151d25"
                  style={{ borderColor: 'rgba(159, 174, 188, 0.18)' }}
                >
                  <Stack gap={6}>
                    <Box
                      style={{
                        aspectRatio: '1 / 1',
                        display: 'grid',
                        placeItems: 'center',
                        backgroundColor: '#0b0f14',
                        overflow: 'hidden'
                      }}
                    >
                      <img
                        src={texture.url ?? undefined}
                        alt={`HUD frame ${texture.frameIndex}`}
                        loading="lazy"
                        style={{
                          maxWidth: '100%',
                          maxHeight: '100%',
                          objectFit: 'contain',
                          imageRendering: 'pixelated',
                          transform: 'scale(2)'
                        }}
                      />
                    </Box>
                    <Text size="xs" fw={700}>Frame {texture.frameIndex}</Text>
                    <Text size="xs" c="dimmed">
                      Texture {texture.textureIndex ?? '-'} · Palette {texture.paletteIndex ?? '-'}
                    </Text>
                    {texture.width && texture.height ? (
                      <Text size="xs" c="dimmed">{texture.width}x{texture.height}</Text>
                    ) : null}
                  </Stack>
                </Paper>
              ))}
            </SimpleGrid>
          )}
        </Stack>
      )}
    </Modal>
  );
}

async function loadHudBankSlots(mapPackage: LoadedMapPackage): Promise<HudBankSlot[]> {
  const mapRoot = dirnamePackagePath(mapPackage.manifestPath);
  const manifestPath = joinPackagePath(mapRoot, 'hud/manifest.json');
  const manifest = mapPackage.rootManifest.Hud
    ?? await mapPackage.assetPackage.readOptionalJson<unknown>(manifestPath);
  const hudRoot = dirnamePackagePath(manifestPath);

  return Promise.all(readHudBankSlots(manifest).map(async (bank) => ({
    ...bank,
    textures: await Promise.all(bank.textures.map(async (texture) => ({
      ...texture,
      url: await mapPackage.assetPackage.resolveUrl(joinPackagePath(hudRoot, texture.path))
    })))
  })));
}
