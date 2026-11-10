/**
 * Keyboard + mouse → abstract SimInput (camera-relative; main converts to grid space).
 * Mouse movement while pointer-locked turns (X) and tilts (Y) the camera, ← / → also turn it; the wheel and + / − zoom it. Shift is dual-purpose (DESIGN §2):
 * held = sneak, tapped (< TAP_MS between press and release) = dimension shift.
 */
import type { SimInput } from '../core/sim';

const TAP_MS = 200;

export class Input {
  private readonly down = new Set<string>();
  private shiftDownAt = 0;
  private pending = { shift: false, interact: false, attack: false };
  readonly onKey = new Map<string, () => void>();
  private mouseDX = 0;
  private mouseDY = 0;
  private zoomNotches = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      if (e.key === 'Shift') this.shiftDownAt = performance.now();
      if (e.code === 'KeyE') this.pending.interact = true;
      if (e.code === 'Space' || e.code === 'KeyJ') this.pending.attack = true;
      if (e.code === 'Equal' || e.code === 'NumpadAdd') this.zoomNotches -= 1;
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.zoomNotches += 1;
      this.onKey.get(e.code)?.();
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      if (e.key === 'Shift') {
        this.down.delete('ShiftLeft');
        this.down.delete('ShiftRight');
        if (performance.now() - this.shiftDownAt < TAP_MS) this.pending.shift = true;
      }
    });
    target.addEventListener('blur', () => this.down.clear());
    target.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    target.addEventListener(
      'wheel',
      (e) => {
        // normalise to notches: pixel mode ≈ 100 px per notch, line mode ≈ 3 lines per notch
        const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
        this.zoomNotches += px / 100;
        e.preventDefault();
      },
      { passive: false },
    );
  }

  private any(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** Request pointer lock on click so the mouse turns the camera. */
  bindPointerLock(el: HTMLElement): void {
    el.addEventListener('click', () => {
      if (!document.pointerLockElement) void el.requestPointerLock();
    });
  }

  /** Camera yaw change this frame, in radians (positive = turn right). */
  takeTurn(dt: number, mouseSensitivity: number, keySpeed: number): number {
    const keys = (this.any('ArrowRight') ? 1 : 0) - (this.any('ArrowLeft') ? 1 : 0);
    const turn = this.mouseDX * mouseSensitivity + keys * keySpeed * dt;
    this.mouseDX = 0;
    return turn;
  }

  /** Camera pitch change this frame, in radians (positive = camera rises; mouse down). */
  takeTilt(mouseSensitivity: number): number {
    const tilt = this.mouseDY * mouseSensitivity;
    this.mouseDY = 0;
    return tilt;
  }

  /** Zoom notches since the last call (positive = zoom out). */
  takeZoom(): number {
    const z = this.zoomNotches;
    this.zoomNotches = 0;
    return z;
  }

  /** Read the current frame's input; edge-triggered actions are consumed. */
  take(): SimInput {
    const input: SimInput = {
      moveX: (this.any('KeyD') ? 1 : 0) - (this.any('KeyA') ? 1 : 0),
      moveY: (this.any('KeyS', 'ArrowDown') ? 1 : 0) - (this.any('KeyW', 'ArrowUp') ? 1 : 0),
      sneak: this.any('ShiftLeft', 'ShiftRight'),
      ...this.pending,
    };
    this.pending = { shift: false, interact: false, attack: false };
    return input;
  }
}
