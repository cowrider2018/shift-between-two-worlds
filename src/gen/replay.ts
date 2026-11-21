/**
 * Play a model route in the real simulation, on the model's clock: every action starts on a tick boundary (TICK
 * seconds apart) and the player idles out the rest of its ticks, so patrols are where the model expects them. A
 * generated level only counts when this wins without anyone spotting the player.
 */
import type { Level } from '../core/level';
import { NO_INPUT, Sim, TUNING, type SimInput } from '../core/sim';
import { TAKEDOWN_TICKS, TICK, type Action } from './model';

const DT = 1 / 60;
/** The frame tick t starts on (a tick is not a whole number of frames). */
const frameOf = (t: number) => Math.round((t * TICK) / DT);

export function replay(level: Level, route: Action[]): { ok: boolean; reason?: string } {
  const sim = new Sim(level);
  let frame = 0;
  const step = (input: Partial<SimInput>) => {
    sim.update({ ...NO_INPUT, sneak: true, ...input }, DT);
    sim.drainEvents();
    frame++;
  };
  const spotted = () => sim.status === 'caught' || !!sim.hunter;
  /** Walk (sneaking unless told to run) toward (tx, ty) until within `stop`, or until frame `until`. */
  const walkTo = (tx: number, ty: number, until: number, stop = 0.02, run = false) => {
    while (frame < until && !spotted() && sim.status === 'playing') {
      const dx = tx - sim.x;
      const dy = ty - sim.y;
      const d = Math.hypot(dx, dy);
      if (d <= stop) return true;
      const v = TUNING.playerSpeed * (run ? 1 : TUNING.sneakSpeedMul) * DT;
      const k = d < v ? d / v : 1;
      step({ moveX: (dx / d) * k, moveY: (dy / d) * k, sneak: !run });
    }
    return Math.hypot(tx - sim.x, ty - sim.y) <= stop;
  };
  const idleUntil = (until: number) => {
    while (frame < until && sim.status === 'playing') step({});
  };

  let tick = 0;
  for (const a of route) {
    if (spotted()) return { ok: false, reason: `第 ${tick} 拍被發現` };
    const ticks = a.type === 'kill' ? TAKEDOWN_TICKS : 1;
    const end = frameOf(tick + ticks);
    if (a.type === 'move') walkTo(a.x + 0.5, a.y + 0.5, end);
    else if (a.type === 'shift') step({ shift: true });
    else if (a.type === 'lever') step({ interact: true });
    else if (a.type === 'kill') {
      const m = sim.monsters.find((mm) => mm.def.id === a.monster);
      if (!m) return { ok: false, reason: `找不到 ${a.monster}` };
      // close in (running: a patrolling troll walks nearly as fast as a sneak), cut, then back to the cell's centre
      const reached = (() => {
        while (frame < frameOf(tick + 1) && !spotted()) {
          if (Math.hypot(m.x - sim.x, m.y - sim.y) <= TUNING.attackRange - 0.05) return true;
          walkTo(m.x, m.y, frame + 1, TUNING.attackRange - 0.05, true);
        }
        return false;
      })();
      if (!reached) return { ok: false, reason: `第 ${tick} 拍搆不到 ${a.monster}` };
      step({ attack: true });
      if (m.alive) return { ok: false, reason: `沒殺到 ${a.monster}` };
      idleUntil(frame + Math.ceil(TUNING.takedownTime / DT) + 1);
      walkTo(a.x + 0.5, a.y + 0.5, end);
    }
    idleUntil(end);
    tick += ticks;
    if (sim.status === 'won') break;
  }
  for (let i = 0; i < 30 && sim.status === 'playing'; i++) step({});
  if (spotted()) return { ok: false, reason: `第 ${tick} 拍被發現` };
  return sim.status === 'won' ? { ok: true } : { ok: false, reason: '沒走到出口' };
}
