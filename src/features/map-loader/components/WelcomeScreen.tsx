import {
  ActionIcon,
  Badge,
  Button,
  Center,
  Group,
  Image,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
  UnstyledButton
} from '@mantine/core';
import { ArrowLeft, Play, X } from 'lucide-react';
import logoDlUrl from '../../../assets/logos/logo_dl.webp';
import logoHorizonUrl from '../../../assets/logos/logo_horizon.png';
import logoUyaUrl from '../../../assets/logos/logo_uya.webp';
import type { MapDefinition, RatchetGameId } from '../../../data/mapCatalog';
import type { CustomMapsStatus, MapSource } from '../mapLoaderState';

interface WelcomeScreenProps {
  gameOptions: Array<{ gameId: RatchetGameId; label: string }>;
  selectedGameId: RatchetGameId | null;
  selectedSource: MapSource;
  mapOptions: Array<{ value: string; label: string }>;
  selectedMap: MapDefinition;
  selectedMapId: string;
  customMapsStatus: CustomMapsStatus;
  customMapsError: string | null;
  canView: boolean;
  onGameSelect: (gameId: RatchetGameId) => void;
  onMapChange: (mapId: string | null) => void;
  onCustomMapsSelect: () => void;
  onVanillaMapsSelect: () => void;
  onBack: () => void;
  onView: () => void;
  onClose?: () => void;
}

const gameLogoUrls: Record<RatchetGameId, string> = {
  DL: logoDlUrl,
  UYA: logoUyaUrl
};

export function WelcomeScreen({
  gameOptions,
  selectedGameId,
  selectedSource,
  mapOptions,
  selectedMap,
  selectedMapId,
  customMapsStatus,
  customMapsError,
  canView,
  onGameSelect,
  onMapChange,
  onCustomMapsSelect,
  onVanillaMapsSelect,
  onBack,
  onView,
  onClose
}: WelcomeScreenProps) {
  const isCustomSource = selectedSource === 'custom';
  const selectedMapText = formatSelectedMapText(selectedMap, isCustomSource, customMapsStatus);

  return (
    <Center mih="calc(100vh - 56px)" p="sm">
      <Paper
        w="min(520px, 100%)"
        p="lg"
        radius="md"
        bg="#111820"
        withBorder
        style={{ borderColor: 'rgba(159, 174, 188, 0.22)' }}
      >
        <Stack gap="md">
          {selectedGameId ? (
            <>
              <Group justify="space-between" align="flex-start">
                <Group gap="sm" align="flex-start" wrap="nowrap">
                  <Button
                    variant="subtle"
                    color="gray"
                    size="xs"
                    leftSection={<ArrowLeft size={14} />}
                    onClick={onBack}
                  >
                    Back
                  </Button>
                  <Stack gap={8}>
                    <Image
                      src={gameLogoUrls[selectedGameId]}
                      alt={selectedGameId}
                      fit="contain"
                      h={58}
                      w="fit-content"
                      maw={220}
                    />
                    <Text size="sm" c="dimmed">{selectedMapText}</Text>
                  </Stack>
                </Group>
                <Stack gap={8} align="flex-end">
                  <Group gap="xs">
                    <Badge variant="outline" color="gray">
                      {formatSelectedMapBadge(selectedMap, isCustomSource)}
                    </Badge>
                    {onClose ? (
                      <ActionIcon variant="subtle" color="gray" aria-label="Close map picker" onClick={onClose}>
                        <X size={16} />
                      </ActionIcon>
                    ) : null}
                  </Group>
                  {selectedGameId === 'UYA' ? (
                    <>
                      <Tooltip label="View custom UYA maps provided by Horizon" withArrow>
                        <UnstyledButton
                          aria-label="View custom UYA maps provided by Horizon"
                          aria-pressed={isCustomSource}
                          onClick={onCustomMapsSelect}
                          style={{
                            width: 140,
                            height: 54,
                            border: `1px solid ${isCustomSource ? 'rgba(91, 173, 255, 0.55)' : 'rgba(159, 174, 188, 0.22)'}`,
                            borderRadius: 8,
                            background: isCustomSource ? 'rgba(91, 173, 255, 0.12)' : '#0b1118',
                            padding: '8px 12px'
                          }}
                        >
                          <Image src={logoHorizonUrl} alt="Horizon" fit="contain" h={36} maw="100%" />
                        </UnstyledButton>
                      </Tooltip>
                      {isCustomSource ? (
                        <Button variant="default" size="xs" w={140} onClick={onVanillaMapsSelect}>
                          Vanilla
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </Stack>
              </Group>

              <Select
                label={isCustomSource ? 'Horizon map' : 'Map'}
                data={mapOptions}
                value={selectedMapId}
                allowDeselect={false}
                disabled={isCustomSource && customMapsStatus !== 'ready'}
                placeholder={isCustomSource ? 'Select a Horizon map' : undefined}
                onChange={onMapChange}
              />
              {isCustomSource && customMapsStatus === 'error' && customMapsError ? (
                <Text size="xs" c="red.4">{customMapsError}</Text>
              ) : null}

              <Button size="sm" leftSection={<Play size={16} />} disabled={!canView} onClick={onView}>
                View Map
              </Button>
            </>
          ) : (
            <>
              <Stack gap={4}>
                <Title order={2}>Map-O-Matic</Title>
                <Text size="sm" c="dimmed">Choose a game</Text>
              </Stack>

              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                {gameOptions.map((game) => (
                  <UnstyledButton
                    key={game.gameId}
                    aria-label={game.label}
                    onClick={() => onGameSelect(game.gameId)}
                    style={{
                      minHeight: 150,
                      border: '1px solid rgba(159, 174, 188, 0.22)',
                      borderRadius: 8,
                      background: '#0b1118',
                      padding: 18
                    }}
                  >
                    <Stack gap="md" align="center" justify="center" h="100%">
                      <Image
                        src={gameLogoUrls[game.gameId]}
                        alt={game.label}
                        fit="contain"
                        h={86}
                        maw="100%"
                      />
                      <Text size="sm" fw={700}>{game.label}</Text>
                    </Stack>
                  </UnstyledButton>
                ))}
              </SimpleGrid>
            </>
          )}
        </Stack>
      </Paper>
    </Center>
  );
}

function formatSelectedMapText(
  selectedMap: MapDefinition,
  isCustomSource: boolean,
  customMapsStatus: CustomMapsStatus
): string {
  if (!isCustomSource) {
    return selectedMap.label;
  }

  if (customMapsStatus === 'loading') {
    return 'Loading Horizon maps...';
  }

  if (customMapsStatus === 'error') {
    return 'Horizon maps unavailable';
  }

  return selectedMap.sourceKind === 'customZip'
    ? selectedMap.label
    : 'Choose a Horizon map';
}

function formatSelectedMapBadge(selectedMap: MapDefinition, isCustomSource: boolean): string {
  return isCustomSource
    ? `${selectedMap.gameId} custom`
    : `${selectedMap.gameId} level ${selectedMap.level.toString().padStart(2, '0')}`;
}
