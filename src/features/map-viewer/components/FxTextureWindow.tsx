import {
  Alert,
  Box,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text
} from '@mantine/core';
import { AlertCircle } from 'lucide-react';

export interface FxTextureView {
  index: number;
  name: string;
  path: string;
  url: string;
  width: number | null;
  height: number | null;
}

interface FxTextureWindowProps {
  opened: boolean;
  textures: FxTextureView[];
  error: string | null;
  onClose: () => void;
}

export function FxTextureWindow({
  opened,
  textures,
  error,
  onClose
}: FxTextureWindowProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="FX textures"
      size="90vw"
      centered
      overlayProps={{ opacity: 0.45, blur: 2 }}
      styles={{
        content: { background: '#10161d' },
        header: { background: '#10161d' },
        title: { fontWeight: 700 }
      }}
    >
      <Stack gap="sm">
        {error ? (
          <Alert color="red" icon={<AlertCircle size={18} />} title="FX textures unavailable">
            {error}
          </Alert>
        ) : null}
        {!error && textures.length === 0 ? (
          <Text size="sm" c="dimmed">
            No FX textures found.
          </Text>
        ) : null}
        <SimpleGrid cols={{ base: 2, sm: 4, md: 6, lg: 8 }} spacing="xs">
          {textures.map((texture) => (
            <Paper
              key={`${texture.index}:${texture.path}`}
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
                    backgroundImage:
                      'linear-gradient(45deg, rgba(255,255,255,0.08) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.08) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.08) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.08) 75%)',
                    backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
                    backgroundSize: '16px 16px',
                    overflow: 'hidden'
                  }}
                >
                  <img
                    src={texture.url}
                    alt={texture.name}
                    loading="lazy"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                      imageRendering: 'pixelated'
                    }}
                  />
                </Box>
                <Text size="xs" fw={700} truncate>
                  {texture.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {texture.index} {texture.width && texture.height ? `${texture.width}x${texture.height}` : ''}
                </Text>
              </Stack>
            </Paper>
          ))}
        </SimpleGrid>
      </Stack>
    </Modal>
  );
}
