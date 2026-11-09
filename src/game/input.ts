/**
 * Keyboard → abstract SimInput. Shift is dual-purpose (DESIGN §2):
 * held = sneak, tapped (< TAP_MS between press and release) = dimension shift.
 */
import type { SimInput } from '../core/sim';

const TAP_MS = 200;

export class Input {
  private readonly down = new Set<string>();
  private shiftDownAt = 0;
  private pending = { shift: false, interact: false, attack: false };
  readonly onKey = new Map<string, () => void>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      if (e.key === 'Shift') this.shiftDownAt = performance.now();
      if (e.code === 'KeyE') this.pending.interact = true;
      if (e.code === 'Space' || e.code === 'KeyJ') this.pending.attack = true;
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
  }

  private any(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** Read the current frame's input; edge-triggered actions are consumed. */
  take(): SimInput {
    const input: SimInput = {
      moveX: (this.any('KeyD', 'ArrowRight') ? 1 : 0) - (this.any('KeyA', 'ArrowLeft') ? 1 : 0),
      moveY: (this.any('KeyS', 'ArrowDown') ? 1 : 0) - (this.any('KeyW', 'ArrowUp') ? 1 : 0),
      sneak: this.any('ShiftLeft', 'ShiftRight'),
      ...this.pending,
    };
    this.pending = { shift: false, interact: false, attack: false };
    return input;
  }
}
