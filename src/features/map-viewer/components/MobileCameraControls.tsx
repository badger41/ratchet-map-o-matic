import {
  ActionIcon,
  Box,
  Paper,
  SimpleGrid,
  Stack
} from '@mantine/core';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp
} from 'lucide-react';
import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react';
import type { CameraVirtualMoveInput } from '../renderer/FpsCameraController';

type MoveDirection = 'forward' | 'backward' | 'left' | 'right' | 'up' | 'down';

interface MobileCameraControlsProps {
  onMoveInputChange: (input: CameraVirtualMoveInput) => void;
}

const emptyMoveInput: CameraVirtualMoveInput = { x: 0, y: 0, z: 0 };

const directionInputs: Record<MoveDirection, CameraVirtualMoveInput> = {
  forward: { x: 0, y: 0, z: -1 },
  backward: { x: 0, y: 0, z: 1 },
  left: { x: -1, y: 0, z: 0 },
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  down: { x: 0, y: -1, z: 0 }
};

export function MobileCameraControls({ onMoveInputChange }: MobileCameraControlsProps) {
  const activeDirectionsRef = useRef(new Set<MoveDirection>());

  useEffect(() => {
    return () => onMoveInputChange(emptyMoveInput);
  }, [onMoveInputChange]);

  const pressDirection = (direction: MoveDirection) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    activeDirectionsRef.current.add(direction);
    event.currentTarget.setPointerCapture(event.pointerId);
    emitMoveInput(activeDirectionsRef.current, onMoveInputChange);
    event.preventDefault();
  };

  const releaseDirection = (direction: MoveDirection) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    activeDirectionsRef.current.delete(direction);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    emitMoveInput(activeDirectionsRef.current, onMoveInputChange);
    event.preventDefault();
  };

  return (
    <>
      <Paper
        pos="absolute"
        p={6}
        radius="md"
        bg="rgba(17, 24, 32, 0.78)"
        withBorder
        style={{
          bottom: 'max(10px, calc(env(safe-area-inset-bottom, 0px) + 10px))',
          left: 'max(10px, calc(env(safe-area-inset-left, 0px) + 10px))',
          zIndex: 3,
          borderColor: 'rgba(159, 174, 188, 0.22)',
          backdropFilter: 'blur(10px)',
          touchAction: 'none',
          userSelect: 'none'
        }}
      >
        <SimpleGrid cols={3} spacing={6} w={138}>
          <Box />
          <ControlButton
            label="Forward"
            onPress={pressDirection('forward')}
            onRelease={releaseDirection('forward')}
          >
            <ArrowUp size={22} />
          </ControlButton>
          <Box />
          <ControlButton
            label="Left"
            onPress={pressDirection('left')}
            onRelease={releaseDirection('left')}
          >
            <ArrowLeft size={22} />
          </ControlButton>
          <ControlButton
            label="Backward"
            onPress={pressDirection('backward')}
            onRelease={releaseDirection('backward')}
          >
            <ArrowDown size={22} />
          </ControlButton>
          <ControlButton
            label="Right"
            onPress={pressDirection('right')}
            onRelease={releaseDirection('right')}
          >
            <ArrowRight size={22} />
          </ControlButton>
        </SimpleGrid>
      </Paper>

      <Paper
        pos="absolute"
        p={6}
        radius="md"
        bg="rgba(17, 24, 32, 0.78)"
        withBorder
        style={{
          bottom: 'max(10px, calc(env(safe-area-inset-bottom, 0px) + 10px))',
          right: 'max(10px, calc(env(safe-area-inset-right, 0px) + 10px))',
          zIndex: 3,
          borderColor: 'rgba(159, 174, 188, 0.22)',
          backdropFilter: 'blur(10px)',
          touchAction: 'none',
          userSelect: 'none'
        }}
      >
        <Stack gap={6}>
          <ControlButton
            label="Up"
            onPress={pressDirection('up')}
            onRelease={releaseDirection('up')}
          >
            <ArrowUp size={22} />
          </ControlButton>
          <ControlButton
            label="Down"
            onPress={pressDirection('down')}
            onRelease={releaseDirection('down')}
          >
            <ArrowDown size={22} />
          </ControlButton>
        </Stack>
      </Paper>
    </>
  );
}

interface ControlButtonProps {
  children: ReactNode;
  label: string;
  onPress: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onRelease: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

function ControlButton({ children, label, onPress, onRelease }: ControlButtonProps) {
  return (
    <ActionIcon
      aria-label={label}
      color="gray"
      radius="md"
      size={40}
      variant="filled"
      onPointerDown={onPress}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onLostPointerCapture={onRelease}
      onContextMenu={(event) => event.preventDefault()}
      style={{ touchAction: 'none' }}
    >
      {children}
    </ActionIcon>
  );
}

function emitMoveInput(
  activeDirections: Set<MoveDirection>,
  onMoveInputChange: (input: CameraVirtualMoveInput) => void
): void {
  if (activeDirections.size === 0) {
    onMoveInputChange(emptyMoveInput);
    return;
  }

  const input = { ...emptyMoveInput };
  for (const direction of activeDirections) {
    const directionInput = directionInputs[direction];
    input.x += directionInput.x;
    input.y += directionInput.y;
    input.z += directionInput.z;
  }

  onMoveInputChange(input);
}
