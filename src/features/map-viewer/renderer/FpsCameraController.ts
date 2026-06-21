import * as THREE from 'three/webgpu';

export interface CameraVirtualMoveInput {
  x: number;
  y: number;
  z: number;
}

interface FpsCameraControllerOptions {
  onActiveChange?: (active: boolean) => void;
}

const trackedKeys = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight'
]);

const maxPitch = Math.PI / 2 - 0.001;
const mouseLookSensitivity = 0.0022;
const touchLookSensitivity = 0.003;

export class FpsCameraController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly onActiveChange: ((active: boolean) => void) | null;
  private readonly pressedKeys = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private readonly input = new THREE.Vector3();
  private readonly virtualMoveInput = new THREE.Vector3();
  private readonly worldInput = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private yaw = 0;
  private pitch = 0;
  private sceneScale = 1;
  private active = false;
  private activeTouchPointerId: number | null = null;
  private lastTouchX = 0;
  private lastTouchY = 0;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement, options: FpsCameraControllerOptions = {}) {
    this.camera = camera;
    this.domElement = domElement;
    this.onActiveChange = options.onActiveChange ?? null;
    this.camera.rotation.order = 'YXZ';
    if (!this.domElement.hasAttribute('tabindex')) {
      this.domElement.tabIndex = -1;
    }
    this.syncFromCamera();

    this.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.domElement.addEventListener('pointerup', this.handlePointerUp);
    this.domElement.addEventListener('pointercancel', this.handlePointerUp);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.domElement.removeEventListener('pointercancel', this.handlePointerUp);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    document.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);

    if (document.pointerLockElement === this.domElement) {
      document.exitPointerLock();
    }
  }

  setVirtualMoveInput(input: CameraVirtualMoveInput): void {
    this.virtualMoveInput.set(
      sanitizeInputComponent(input.x),
      sanitizeInputComponent(input.y),
      sanitizeInputComponent(input.z)
    );
  }

  update(deltaSeconds: number): void {
    const dt = Math.min(Math.max(deltaSeconds, 0), 0.05);
    if (dt <= 0) {
      return;
    }

    const input = this.readInputVector();
    if (input.lengthSq() > 0) {
      input.normalize();
      const acceleration = this.resolveAcceleration();
      const maxSpeed = this.resolveMaxSpeed();
      const worldAcceleration = this.inputToWorldVector(input).multiplyScalar(acceleration);
      this.velocity.addScaledVector(worldAcceleration, dt);
      clampVectorLength(this.velocity, maxSpeed);
    } else {
      const damping = Math.exp(-9 * dt);
      this.velocity.multiplyScalar(damping);
      if (this.velocity.lengthSq() < 0.0001) {
        this.velocity.set(0, 0, 0);
      }
    }

    this.camera.position.addScaledVector(this.velocity, dt);
  }

  syncFromCamera(): void {
    this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.pitch = THREE.MathUtils.clamp(this.euler.x, -maxPitch, maxPitch);
    this.yaw = this.euler.y;
    this.applyRotation();
    this.velocity.set(0, 0, 0);
  }

  setSceneRadius(radius: number): void {
    const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 400;
    this.sceneScale = THREE.MathUtils.clamp(safeRadius / 450, 0.5, 8);
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      this.activeTouchPointerId = event.pointerId;
      this.lastTouchX = event.clientX;
      this.lastTouchY = event.clientY;
      this.domElement.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    if (event.button !== 0 || document.pointerLockElement === this.domElement) {
      return;
    }

    blurActiveEditableElement();
    this.domElement.focus({ preventScroll: true });
    this.domElement.requestPointerLock();
    event.preventDefault();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (this.activeTouchPointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - this.lastTouchX;
    const deltaY = event.clientY - this.lastTouchY;
    this.lastTouchX = event.clientX;
    this.lastTouchY = event.clientY;
    this.applyLookDelta(deltaX, deltaY, touchLookSensitivity);
    event.preventDefault();
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (this.activeTouchPointerId !== event.pointerId) {
      return;
    }

    this.activeTouchPointerId = null;
    if (this.domElement.hasPointerCapture(event.pointerId)) {
      this.domElement.releasePointerCapture(event.pointerId);
    }

    event.preventDefault();
  };

  private handlePointerLockChange = (): void => {
    const active = document.pointerLockElement === this.domElement;
    if (this.active === active) {
      return;
    }

    this.active = active;
    if (!active) {
      this.pressedKeys.clear();
      this.velocity.set(0, 0, 0);
    }

    this.onActiveChange?.(active);
  };

  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.active) {
      return;
    }

    this.applyLookDelta(event.movementX, event.movementY, mouseLookSensitivity);
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.active || !trackedKeys.has(event.code)) {
      return;
    }

    this.pressedKeys.add(event.code);
    event.preventDefault();
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    if (!trackedKeys.has(event.code)) {
      return;
    }

    this.pressedKeys.delete(event.code);
    if (this.active) {
      event.preventDefault();
    }
  };

  private handleBlur = (): void => {
    this.pressedKeys.clear();
    this.velocity.set(0, 0, 0);
    this.virtualMoveInput.set(0, 0, 0);
    this.activeTouchPointerId = null;
  };

  private readInputVector(): THREE.Vector3 {
    const input = this.input.set(0, 0, 0);

    if (this.pressedKeys.has('KeyD')) {
      input.x += 1;
    }
    if (this.pressedKeys.has('KeyA')) {
      input.x -= 1;
    }
    if (this.pressedKeys.has('KeyS')) {
      input.z += 1;
    }
    if (this.pressedKeys.has('KeyW')) {
      input.z -= 1;
    }
    if (this.pressedKeys.has('Space') || this.pressedKeys.has('KeyE')) {
      input.y += 1;
    }
    if (
      this.pressedKeys.has('KeyQ') ||
      this.pressedKeys.has('ControlLeft') ||
      this.pressedKeys.has('ControlRight')
    ) {
      input.y -= 1;
    }

    input.add(this.virtualMoveInput);
    return input;
  }

  private inputToWorldVector(input: THREE.Vector3): THREE.Vector3 {
    this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);

    return this.worldInput.set(0, 0, 0)
      .addScaledVector(this.right, input.x)
      .addScaledVector(this.up, input.y)
      .addScaledVector(this.forward, -input.z)
      .normalize();
  }

  private resolveAcceleration(): number {
    if (this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight')) {
      return 850 * this.sceneScale;
    }

    return 280 * this.sceneScale;
  }

  private resolveMaxSpeed(): number {
    if (this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight')) {
      return 900 * this.sceneScale;
    }

    return 310 * this.sceneScale;
  }

  private applyRotation(): void {
    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this.euler);
  }

  private applyLookDelta(deltaX: number, deltaY: number, sensitivity: number): void {
    this.yaw -= deltaX * sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - deltaY * sensitivity, -maxPitch, maxPitch);
    this.applyRotation();
  }
}

function sanitizeInputComponent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return THREE.MathUtils.clamp(value, -1, 1);
}

function clampVectorLength(vector: THREE.Vector3, maxLength: number): void {
  const lengthSq = vector.lengthSq();
  const maxLengthSq = maxLength * maxLength;
  if (lengthSq <= maxLengthSq || lengthSq <= 0) {
    return;
  }

  vector.multiplyScalar(maxLength / Math.sqrt(lengthSq));
}

function blurActiveEditableElement(): void {
  if (!(document.activeElement instanceof HTMLElement)) {
    return;
  }

  if (!isEditableElement(document.activeElement)) {
    return;
  }

  document.activeElement.blur();
}

function isEditableElement(element: HTMLElement): boolean {
  if (element.isContentEditable) {
    return true;
  }

  return ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(element.tagName);
}
