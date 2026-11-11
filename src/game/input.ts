/**
 * Keyboard + mouse → abstract SimInput (camera-relative; main converts to grid space).
 * Mouse movement while pointer-locked turns (X) and tilts (Y) the camera, ← / → also turn it; the wheel and + / − zoom it. Shift is dual-purpose (DESIGN §2):
 * held = sneak, tapped (< TAP_MS between press and release) = dimension shift.
 *
 * Fake mouse jumps: while the pointer is locked, browsers (Chrome on Windows especially) now and then report one
 * huge bogus movementX, which would spin the camera round in a single frame. So the lock asks for raw input
 * (unadjustedMovement, falling back to a plain lock where unsupported), and a lone large movement is dropped
 * (isSpike): a real flick builds up move by move, a fake one appears right after a small one or out of stillness.
 */
import type { SimInput } from '../core/sim';

const TAP_MS = 200;

/** A movement only counts as possibly fake above `spike` pixels, and only when it is more than `jump` times the
 *  previous one; a previous one older than `calm` ms means the hand was still (it counts as 0). */
export const MOUSE_SPIKE = { spike: 300, jump: 6, calm: 100 };

/** Is a movement of `size` px a lone fake jump, given the previous one was `prev` px, `gap` ms ago? */
export const isSpike = (size: number, prev: number, gap: number): boolean =>
  size > MOUSE_SPIKE.spike && size > MOUSE_SPIKE.jump * (gap < MOUSE_SPIKE.calm ? prev : 0);

export class Input {
  private readonly down = new Set<string>();
  private shiftDownAt = 0;
  private pending = { shift: false, interact: false, attack: false };
  readonly onKey = new Map<string, () => void>();
  private mouseDX = 0;
  private mouseDY = 0;
  /** Size and time of the previous mouse movement (for isSpike). */
  private prevMove = 0;
  private prevMoveAt = -Infinity;
  /** Dropped fake movements: how many, and the largest (px), so a real session can confirm the cause. */
  readonly spikes = { n: 0, max: 0 };
  /** Whether to ask for raw (unadjusted) movement when locking; turned off if the browser refuses it. */
  private raw = true;
  private zoomNotches = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      if (e.key === 'Shift') this.shiftDownAt = performance.now();
      // Space is the one action key: the sim pulls a lever in reach, otherwise tries a takedown
      if (e.code === 'Space') this.pending.interact = this.pending.attack = true;
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
      const size = Math.hypot(e.movementX, e.movementY);
      const now = performance.now();
      const fake = isSpike(size, this.prevMove, now - this.prevMoveAt);
      // a dropped one still counts as the previous move: if the hand really is that fast, the next one passes
      this.prevMove = size;
      this.prevMoveAt = now;
      if (fake) {
        this.spikes.n++;
        this.spikes.max = Math.max(this.spikes.max, size);
        return;
      }
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
    el.addEventListener('click', () => this.lock(el));
  }

  private lock(el: HTMLElement): void {
    if (document.pointerLockElement === el) return;
    // older browsers return undefined; without raw-input support, lock again without it
    const req = el.requestPointerLock(this.raw ? { unadjustedMovement: true } : undefined) as Promise<void> | undefined;
    req?.catch?.((e: unknown) => {
      if ((e as { name?: string })?.name !== 'NotSupportedError' || !this.raw) return;
      this.raw = false;
      this.lock(el);
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
      moveY: (this.any('KeyS') ? 1 : 0) - (this.any('KeyW') ? 1 : 0),
      sneak: this.any('ShiftLeft', 'ShiftRight'),
      ...this.pending,
    };
    this.pending = { shift: false, interact: false, attack: false };
    return input;
  }
}
