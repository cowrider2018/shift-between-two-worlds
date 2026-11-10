import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLOCKS } from '../src/core/blocks';
import { castRay } from '../src/core/grid';
import { createEmptyLevel, parseLevel, serializeLevel, setCell, setProp, type Level } from '../src/core/level';
import { NO_INPUT, Sim, type SimInput } from '../src/core/sim';
import { validateLevel } from '../src/core/validate';

const levelsDir = resolve(import.meta.dirname, '..', 'levels');
const levelFiles = readdirSync(levelsDir).filter((f) => f.endsWith('.json'));
const load = (f: string) => readFileSync(join(levelsDir, f), 'utf8').replace(/\r\n/g, '\n');
const level01 = () => parseLevel(JSON.parse(load('level01.json'))).level!;

/** Walk the player to a cell centre by stepping the sim (no pathfinding; straight line). */
function walkTo(sim: Sim, x: number, y: number, extra: Partial<SimInput> = {}) {
  for (let i = 0; i < 2000; i++) {
    const dx = x + 0.5 - sim.x;
    const dy = y + 0.5 - sim.y;
    if (Math.hypot(dx, dy) < 0.05 || sim.status !== 'playing') return;
    const d = Math.hypot(dx, dy);
    const s = Math.min(1, d / (3.2 / 60));
    sim.update({ ...NO_INPUT, moveX: (dx / d) * s, moveY: (dy / d) * s, ...extra }, 1 / 60);
  }
  throw new Error(`could not reach ${x},${y}; at ${sim.x.toFixed(2)},${sim.y.toFixed(2)}`);
}
const tap = (sim: Sim, key: 'shift' | 'interact' | 'attack') => sim.update({ ...NO_INPUT, [key]: true }, 1 / 60);

describe('block registry', () => {
  it('has unique ids and chars', () => {
    expect(new Set(BLOCKS.map((b) => b.id)).size).toBe(BLOCKS.length);
    expect(new Set(BLOCKS.map((b) => b.char)).size).toBe(BLOCKS.length);
  });
});

describe('level files', () => {
  for (const f of levelFiles) {
    it(`${f} is canonical, valid and solvable`, () => {
      const text = load(f);
      const { level, errors } = parseLevel(JSON.parse(text));
      expect(errors).toEqual([]);
      expect(serializeLevel(level!)).toBe(text);
      const report = validateLevel(level!);
      expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(report.solve?.status).toBe('solved');
    });
  }
});

describe('validator', () => {
  it('reports a door that no lever opens', () => {
    const l = createEmptyLevel('t');
    setCell(l, 0, 5, 5, 'E');
    setCell(l, 0, 3, 3, 'D');
    expect(validateLevel(l).issues.some((i) => i.severity === 'error' && i.message.includes('沒有任何拉桿'))).toBe(true);
  });

  it('detects an unsolvable level', () => {
    const l = createEmptyLevel('t', 7, 5);
    setCell(l, 0, 4, 1, '#'); setCell(l, 0, 4, 2, '#'); setCell(l, 0, 4, 3, '#');
    for (let y = 1; y < 4; y++) for (let x = 1; x < 6; x++) setCell(l, 1, x, y, '#');
    setCell(l, 0, 5, 2, 'E');
    const r = validateLevel(l);
    expect(r.solve?.status).toBe('unsolvable');
    expect(r.ok).toBe(false);
  });

  it('rejects monster paths through walls', () => {
    const l = createEmptyLevel('t');
    setCell(l, 0, 5, 5, 'E');
    setCell(l, 0, 4, 2, '#');
    l.dimensions[0].monsters.push({ id: 'm', path: [[2, 2], [6, 2]], mode: 'pingpong', speed: 1, pause: 0, viewRadius: 3, viewAngle: 60, facing: 0 });
    expect(validateLevel(l).issues.some((i) => i.message.includes('穿過'))).toBe(true);
  });
});

describe('ray cast', () => {
  it('stops at the first blocked cell', () => {
    const d = castRay(0.5, 0.5, 1, 0, 10, (x) => x === 3);
    expect(d).toBeCloseTo(2.5);
  });
});

describe('simulation on level01', () => {
  it('notices the player inside the one-cell circle at its feet, even behind it', () => {
    const sim = new Sim(level01());
    const m = sim.monsters[0];
    sim.dim = m.dim;
    const behind = m.angle + Math.PI;
    sim.x = m.x + Math.cos(behind) * 0.45;
    sim.y = m.y + Math.sin(behind) * 0.45;
    expect(sim.monsterSeesPlayer(m)).toBe(true);
    sim.x = m.x + Math.cos(behind) * 0.55;
    sim.y = m.y + Math.sin(behind) * 0.55;
    expect(sim.monsterSeesPlayer(m)).toBe(false);
  });

  it('shifts on any cell, including non-floor ones', () => {
    const sim = new Sim(level01());
    walkTo(sim, 2, 5); // reward in A
    tap(sim, 'shift');
    expect(sim.dim).toBe(1);
  });

  it('a lever in B opens the door in A, and souls die to one swing', () => {
    const sim = new Sim(level01());
    const doorA = sim.grid.cell(0, 6, 3);
    expect(sim.doorOpen(doorA)).toBe(false);
    // kill the B keeper's soul from A
    const keeper = sim.monsters.find((m) => m.def.id === 'keeper')!;
    for (let i = 0; i < 600 && Math.hypot(keeper.x - sim.x, keeper.y - sim.y) > 1.2; i++) {
      const dx = keeper.x - sim.x, dy = keeper.y - sim.y, d = Math.hypot(dx, dy);
      sim.update({ ...NO_INPUT, moveX: dx / d, moveY: dy / d }, 1 / 60);
    }
    tap(sim, 'attack');
    expect(keeper.alive).toBe(false);
    walkTo(sim, 1, 2);
    tap(sim, 'shift');
    expect(sim.dim).toBe(1);
    walkTo(sim, 2, 2);
    tap(sim, 'interact');
    expect(sim.doorOpen(doorA)).toBe(true);
    expect(sim.status).toBe('playing');
  });

  it('is caught when standing in a cone, but not while sneaking at the edge', () => {
    const l: Level = createEmptyLevel('t', 12, 5);
    setCell(l, 0, 10, 3, 'E');
    l.dimensions[0].monsters.push({ id: 'm', path: [[6, 2]], mode: 'pingpong', speed: 1, pause: 0, viewRadius: 4, viewAngle: 90, facing: 180 });
    // player at (2.5, 2.5): 4 tiles away → not seen (edge); move to x=3.5 → 3 tiles → seen unless sneaking (r=2)
    setCell(l, 0, 1, 1, '.');
    setCell(l, 0, 3, 2, 'S');
    const sneaking = new Sim(l);
    for (let i = 0; i < 120; i++) sneaking.update({ ...NO_INPUT, sneak: true }, 1 / 60);
    expect(sneaking.status).toBe('playing');
    expect(sneaking.hunter).toBeNull();
    const open = new Sim(l);
    for (let i = 0; i < 120; i++) open.update(NO_INPUT, 1 / 60);
    expect(open.status).toBe('caught');
  });

  it('once spotted, the player can still run but cannot shift, and the faster monster catches up', () => {
    const l: Level = createEmptyLevel('t', 24, 5);
    setCell(l, 0, 22, 3, 'E');
    l.dimensions[0].monsters.push({ id: 'm', path: [[4, 2]], mode: 'pingpong', speed: 1, pause: 0, viewRadius: 4, viewAngle: 90, facing: 0 });
    setCell(l, 0, 1, 1, '.');
    setCell(l, 0, 7, 2, 'S');
    const sim = new Sim(l);
    for (let i = 0; i < 30 && !sim.hunter; i++) sim.update(NO_INPUT, 1 / 60);
    expect(sim.hunter?.def.id).toBe('m');
    expect(sim.status).toBe('playing');
    const x0 = sim.x;
    sim.update({ ...NO_INPUT, moveX: 1 }, 1 / 60);
    expect(sim.x).toBeGreaterThan(x0); // still in control
    sim.update({ ...NO_INPUT, moveX: 1, shift: true }, 1 / 60);
    expect(sim.dim).toBe(0); // no escaping into the other dimension
    // flee east along the corridor; the hunter runs faster and gets there first
    for (let i = 0; i < 600 && sim.status === 'playing'; i++) sim.update({ ...NO_INPUT, moveX: 1 }, 1 / 60);
    expect(sim.status).toBe('caught');
    expect(sim.x).toBeLessThan(20); // caught in the open, well before the dead end
  });

  it('a hunter follows the player round corners', () => {
    const l: Level = createEmptyLevel('t', 9, 7);
    // a wall splits the room from the top; the only way round is along the bottom row
    for (let y = 1; y <= 4; y++) setCell(l, 0, 4, y, '#');
    setCell(l, 0, 1, 1, '.');
    setCell(l, 0, 7, 1, 'E');
    l.dimensions[0].monsters.push({ id: 'm', path: [[2, 2]], mode: 'pingpong', speed: 1, pause: 0, viewRadius: 5, viewAngle: 360, facing: 0 });
    setCell(l, 0, 3, 5, 'S');
    const sim = new Sim(l);
    for (let i = 0; i < 30 && !sim.hunter; i++) sim.update(NO_INPUT, 1 / 60);
    expect(sim.hunter).not.toBeNull();
    // run round the wall end and up the far side; a hunter heading straight at the hero would pin itself on the wall
    walkTo(sim, 7, 5);
    walkTo(sim, 7, 1);
    expect(sim.status).toBe('caught');
    expect(sim.hunter!.x).toBeGreaterThan(5);
  });

  it('can be completed along the intended route with monsters active', () => {
    const sim = new Sim(level01());
    const step = (extra: Partial<SimInput> = {}) => sim.update({ ...NO_INPUT, ...extra }, 1 / 60);
    const chase = (id: string) => {
      const m = sim.monsters.find((mm) => mm.def.id === id)!;
      for (let i = 0; i < 1200 && Math.hypot(m.x - sim.x, m.y - sim.y) > 1.1; i++) {
        const dx = m.x - sim.x, dy = m.y - sim.y, d = Math.hypot(dx, dy);
        step({ moveX: dx / d, moveY: dy / d });
      }
      tap(sim, 'attack');
      expect(m.alive).toBe(false);
    };
    const guard = sim.monsters.find((m) => m.def.id === 'guard')!;
    const waitGuardEast = (minX: number, sneak = false) => {
      let px = guard.x;
      for (let i = 0; i < 2000; i++) {
        step({ sneak });
        if (guard.x > minX && guard.x > px) return;
        px = guard.x;
      }
      throw new Error(`guard never came by: status=${sim.status} p=${sim.x.toFixed(2)},${sim.y.toFixed(2)} g=${guard.x.toFixed(2)},${guard.y.toFixed(2)} ${guard.detect}`);
    };

    chase('keeper');                // soul kill (B's keeper is a soul in A)
    walkTo(sim, 1, 2); tap(sim, 'shift'); expect(sim.dim).toBe(1);
    walkTo(sim, 2, 2); tap(sim, 'interact');      // lever ch1 → A door opens
    walkTo(sim, 1, 2); tap(sim, 'shift'); expect(sim.dim).toBe(0);
    walkTo(sim, 5, 1);
    waitGuardEast(10);
    walkTo(sim, 5, 3); walkTo(sim, 7, 3);   // through the door behind the guard's back
    tap(sim, 'shift'); expect(sim.dim).toBe(1); // shifting works anywhere: slip into B's closed-off room
    chase('guard');                 // A's guard is a soul in B
    walkTo(sim, 11, 6);             // core B
    tap(sim, 'shift'); expect(sim.dim).toBe(0);
    walkTo(sim, 12, 2);             // core A
    expect(sim.cores).toBe(2);
    walkTo(sim, 7, 3); walkTo(sim, 5, 3); walkTo(sim, 3, 4);
    expect(sim.status).toBe('won');
  });

  it('requires both cores to win', () => {
    const l = createEmptyLevel('t', 8, 3);
    setCell(l, 0, 3, 1, 'C');
    setCell(l, 1, 5, 1, 'C');
    setCell(l, 0, 6, 1, 'E');
    setProp(l, 0, 6, 1, 'coresRequired', 0);
    const sim = new Sim(l);
    walkTo(sim, 6, 1);
    expect(sim.status).toBe('playing');
    walkTo(sim, 4, 1);
    tap(sim, 'shift');
    walkTo(sim, 5, 1);
    walkTo(sim, 4, 1);
    tap(sim, 'shift');
    walkTo(sim, 6, 1);
    expect(sim.cores).toBe(2);
    expect(sim.status).toBe('won');
  });
});
