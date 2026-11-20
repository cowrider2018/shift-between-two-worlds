/**
 * Play a model route in the real simulation: walk cell centre to cell centre (sneaking), shift, pull, cut throats.
 * A generated level only counts when this wins without anyone spotting the player, so the discrete model never
 * promises a route the engine does not allow.
 */
import type { Level } from '../core/level';
import { NO_INPUT, Sim, TUNING, type SimInput } from '../core/sim';
import type { Action } from './model';

const DT = 1 / 60;

export function replay(level: Level, route: Action[]): { ok: boolean; reason?: string } {
  const sim = new Sim(level);
  let frames = 0;
  const step = (input: Partial<SimInput>) => {
    sim.update({ ...NO_INPUT, sneak: true, ...input }, DT);
    sim.drainEvents();
    frames++;
  };
  const fail = () => (sim.status === 'caught' || sim.hunter ? '被發現' : frames > 60 * 600 ? '逾時' : null);
  /** Walk until the centre is within `stop` of (tx, ty). */
  const walkTo = (tx: number, ty: number, stop = 0.02) => {
    for (let guard = 0; guard < 60 * 10; guard++) {
      if (fail() || sim.status === 'won') return;
      const dx = tx - sim.x;
      const dy = ty - sim.y;
      const d = Math.hypot(dx, dy);
      if (d <= stop) return;
      const v = TUNING.playerSpeed * TUNING.sneakSpeedMul * DT;
      const k = d < v ? d / v : 1;
      step({ moveX: (dx / d) * k, moveY: (dy / d) * k });
    }
  };
  const idle = (seconds: number) => {
    for (let i = 0; i < seconds / DT; i++) step({});
  };

  for (const a of route) {
    const err = fail();
    if (err) return { ok: false, reason: err };
    if (a.type === 'move') walkTo(a.x + 0.5, a.y + 0.5);
    else if (a.type === 'shift') {
      step({ shift: true });
      idle(TUNING.shiftCooldown + DT);
    } else if (a.type === 'lever') step({ interact: true });
    else {
      const m = sim.monsters.find((mm) => mm.def.id === a.monster);
      if (!m) return { ok: false, reason: `找不到 ${a.monster}` };
      const hx = sim.x;
      const hy = sim.y;
      walkTo(m.x, m.y, TUNING.attackRange - 0.05);
      step({ attack: true });
      if (m.alive) return { ok: false, reason: `沒殺到 ${a.monster}` };
      idle(TUNING.takedownTime + DT);
      walkTo(hx, hy);
    }
  }
  // the last move ends in the exit cell; carry on into the cave if that did not already win
  for (let i = 0; i < 30 && sim.status === 'playing'; i++) step({});
  const err = fail();
  if (err) return { ok: false, reason: err };
  return sim.status === 'won' ? { ok: true } : { ok: false, reason: '沒走到出口' };
}
