import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLOCKS } from '../src/core/blocks';
import { LevelGrid, angleDiff, castRay } from '../src/core/grid';
import { isOuterRock } from '../src/render/terrain';
import { createEmptyLevel, parseLevel, serializeLevel, setCell, setProp, type Level } from '../src/core/level';
import { NO_INPUT, Sim, TUNING, type MonsterState, type SimInput } from '../src/core/sim';
import { ORDER_FILE } from '../src/core/order';
import { validateLevel } from '../src/core/validate';

const levelsDir = resolve(import.meta.dirname, '..', 'levels');
const levelFiles = readdirSync(levelsDir).filter((f) => f.endsWith('.json') && f !== ORDER_FILE);
const load = (f: string) => readFileSync(join(levelsDir, f), 'utf8').replace(/\r\n/g, '\n');
/** The scripted walkthroughs below play frozen copies of early levels (tests/fixtures), so redesigning or renumbering
 *  the shipped levels does not break them. */
const fixturesDir = resolve(import.meta.dirname, 'fixtures');
const loadById = (id: string): Level => {
  const level = parseLevel(JSON.parse(readFileSync(join(fixturesDir, `${id}.json`), 'utf8'))).level;
  if (!level) throw new Error(`no fixture level with id ${id}`);
  return level;
};
const level01 = () => loadById('level01');

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
/** Space sends interact and attack together; the sim picks one. */
const space = (sim: Sim) => sim.update({ ...NO_INPUT, interact: true, attack: true }, 1 / 60);

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

describe('outermost rock', () => {
  const grid = (rows: string[]) => {
    const l = createEmptyLevel('t', rows[0].length, rows.length);
    for (const dim of [0, 1] as const) l.dimensions[dim].rows = rows;
    return new LevelGrid(l);
  };

  it('takes in rock filled in behind the rim, alone or as a block', () => {
    const g = grid(['######', '#...##', '#...##', '##...#', '######']);
    expect(isOuterRock(g, 0, 1, 3)).toBe(true); // a corner filled in
    expect(isOuterRock(g, 0, 4, 1)).toBe(true); // a two-cell block backing the rim
    expect(isOuterRock(g, 0, 4, 2)).toBe(true);
  });

  it('leaves out a wall with play on two opposite sides', () => {
    const g = grid(['#######', '#.....#', '#.###.#', '#.....#', '#######']);
    expect(isOuterRock(g, 0, 3, 2)).toBe(false); // open above and below
    const finger = grid(['#######', '#.##..#', '#.##..#', '#.....#', '#######']);
    expect(isOuterRock(finger, 0, 2, 1)).toBe(false); // a thick finger from the rim: open on its left and right
  });
});

describe('dug-out (void) cells', () => {
  /** An L-shaped level: the top-right corner is dug out. */
  const lShape = (): Level => {
    const l = createEmptyLevel('t', 7, 6);
    for (const dim of [0, 1] as const) {
      l.dimensions[dim].rows = ['####   ', '#..#   ', '#..####', '#.....#', '#.....#', '#######'];
    }
    setCell(l, 0, 1, 1, 'S');
    setCell(l, 0, 5, 4, 'E');
    return l;
  };

  it('are solid, and the outside carries on as void beyond a dug-out border', () => {
    const g = new LevelGrid(lShape());
    expect(g.solid(0, 5, 0, () => false)).toBe(true);
    expect(g.cell(0, 7, 0).def.id).toBe('void');
    expect(g.cell(0, 5, -1).def.id).toBe('void');
    expect(g.cell(0, -1, 3).def.id).toBe('wall');
  });

  it('raise the rock round them to the outer cliff', () => {
    const g = new LevelGrid(lShape());
    expect(isOuterRock(g, 0, 3, 1)).toBe(true); // beside the void
    expect(isOuterRock(g, 0, 3, 2)).toBe(true); // only a corner touches it
    expect(isOuterRock(g, 0, 5, 0)).toBe(false); // the void itself
  });

  it('is valid with a wall between the floor and the void, not without', () => {
    const l = lShape();
    expect(validateLevel(l).issues.filter((i) => i.severity === 'error')).toEqual([]);
    setCell(l, 1, 3, 1, '.');
    expect(validateLevel(l).issues.some((i) => i.severity === 'error' && i.message.includes('挖空'))).toBe(true);
  });

  it('survive a save round trip', () => {
    const l = lShape();
    expect(parseLevel(JSON.parse(serializeLevel(l))).level!.dimensions[0].rows[0]).toBe('####   ');
  });
});

describe('validator', () => {
  it('accepts a door that no lever opens: it is chained shut', () => {
    const l = createEmptyLevel('t');
    setCell(l, 0, 5, 5, 'E');
    setCell(l, 0, 3, 3, 'D');
    expect(validateLevel(l).issues.some((i) => i.severity === 'error')).toBe(false);
    const grid = new LevelGrid(l);
    expect(grid.chained(grid.cell(0, 3, 3))).toBe(true);
    setCell(l, 1, 1, 1, 'L');
    const levered = new LevelGrid(l);
    expect(levered.chained(levered.cell(0, 3, 3))).toBe(false);
  });

  it('detects an unsolvable level', () => {
    const l = createEmptyLevel('t', 7, 5);
    setCell(l, 0, 4, 1, '#'); setCell(l, 0, 4, 2, '#'); setCell(l, 0, 4, 3, '#');
    for (let y = 1; y < 4; y++) for (let x = 1; x < 6; x++) setCell(l, 1, x, y, '#');
    setCell(l, 0, 5, 1, 'E'); setProp(l, 0, 5, 1, 'dir', 2); // a cave in the top-right corner, open only downwards
    const r = validateLevel(l);
    expect(r.solve?.status).toBe('unsolvable');
    expect(r.ok).toBe(false);
  });

  it('requires the exit to open onto a cell that can be walked into', () => {
    const l = createEmptyLevel('t', 7, 5);
    setCell(l, 0, 3, 1, 'E'); // in the open, its mouth up into the border wall
    const bad = (r: ReturnType<typeof validateLevel>) => r.issues.some((i) => i.severity === 'error' && i.message.includes('開口'));
    expect(bad(validateLevel(l))).toBe(true);
    setProp(l, 0, 3, 1, 'dir', 2); // turned to face down into the room, with no walls round it
    expect(bad(validateLevel(l))).toBe(false);
  });

  it('lets monster paths run into walls and doors, warning only about walls; never through the exit', () => {
    const l = createEmptyLevel('t');
    setCell(l, 0, 5, 5, 'E');
    setCell(l, 0, 4, 2, '#');
    setCell(l, 0, 4, 3, 'D');
    setCell(l, 1, 4, 3, 'L');
    const m = (path: [number, number][]) => ({ id: 'm', path, mode: 'pingpong' as const, speed: 1, pause: 0, viewRadius: 3, viewAngle: 60, facing: 0 });
    l.dimensions[0].monsters = [m([[2, 2], [6, 2]])];
    let issues = validateLevel(l).issues.filter((i) => i.message.includes('怪物 m'));
    expect(issues.map((i) => i.severity)).toEqual(['warning']);
    l.dimensions[0].monsters = [m([[2, 3], [6, 3]])];
    expect(validateLevel(l).issues.filter((i) => i.message.includes('怪物 m'))).toEqual([]);
    l.dimensions[0].monsters = [m([[2, 5], [6, 5]])];
    issues = validateLevel(l).issues.filter((i) => i.message.includes('怪物 m'));
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('出口'))).toBe(true);
  });
});

describe('patrol blocked by a closed door', () => {
  /** Corridor y=2 from x=1..9, door at (5, 2) on channel 1; lever in the underside. Monster patrols 2 ↔ 8. */
  const corridor = (mode: 'pingpong' | 'loop', path: [number, number][]) => {
    const l = createEmptyLevel('t', 11, 5);
    setCell(l, 0, 5, 2, 'D');
    setProp(l, 0, 5, 2, 'vertical', true);
    setCell(l, 1, 5, 2, 'L');
    setCell(l, 0, 9, 3, 'E');
    l.dimensions[0].monsters.push({ id: 'm', path, mode, speed: 2, pause: 0, viewRadius: 1, viewAngle: 10, facing: 0 });
    return l;
  };
  const run = (sim: Sim, seconds: number, track: (x: number) => void) => {
    for (let i = 0; i < seconds * 60; i++) {
      sim.update(NO_INPUT, 1 / 60);
      track(sim.monsters[0].x);
    }
  };

  it('turns back at the closed door and walks only the reachable part, to and fro', () => {
    const sim = new Sim(corridor('pingpong', [[2, 2], [8, 2]]));
    sim.x = 1.5; sim.y = 4.5; // out of the way
    let max = 0, min = 99, turns = 0, last = sim.monsters[0].x, dir = 1;
    run(sim, 12, (x) => {
      max = Math.max(max, x); min = Math.min(min, x);
      const d = Math.sign(x - last);
      if (d && d !== dir) { turns++; dir = d; }
      last = x;
    });
    expect(max).toBeLessThan(5);
    expect(max).toBeGreaterThan(4.6);
    expect(min).toBeCloseTo(2.5, 5);
    expect(turns).toBeGreaterThanOrEqual(4);
  });

  it('walks straight through once the door opens', () => {
    for (const mode of ['pingpong', 'loop'] as const) {
      const sim = new Sim(corridor(mode, [[2, 2], [8, 2]]));
      sim.x = 1.5; sim.y = 4.5;
      run(sim, 3, () => {});
      (sim as unknown as { channels: Map<number, boolean> }).channels.set(1, true);
      let max = 0;
      run(sim, 12, (x) => (max = Math.max(max, x)));
      expect(max).toBeCloseTo(8.5, 5);
    }
  });
});

describe('patrol as one continuous ring', () => {
  /** An open 11×9 field; the hero waits far away in the other dimension. */
  const field = (mode: 'pingpong' | 'loop', path: [number, number][], pause = 0.5) => {
    const l = createEmptyLevel('t', 11, 9);
    l.dimensions[0].monsters.push({ id: 'm', path, mode, speed: 2, pause, viewRadius: 1, viewAngle: 10, facing: 0 });
    const sim = new Sim(l);
    sim.dim = 1;
    return sim;
  };
  const steps = (sim: Sim, seconds: number, each: (m: MonsterState) => void) => {
    for (let i = 0; i < seconds * 60; i++) {
      sim.update(NO_INPUT, 1 / 60);
      each(sim.monsters[0]);
    }
  };

  it('walks straight through nodes that do not change direction, without stopping or turning', () => {
    const sim = field('pingpong', [[1, 4], [3, 4], [5, 4], [8, 4]]);
    let still = 0;
    let last = sim.monsters[0].x;
    steps(sim, 3.5, (m) => {
      if (m.x === last) still++;
      last = m.x;
      expect(Math.abs(angleDiff(m.angle, 0))).toBeLessThan(1e-9);
    });
    expect(still).toBe(0);
    expect(sim.monsters[0].x).toBeCloseTo(8.5, 5);
  });

  it('stops once where a loop ends on the node it began on, not twice', () => {
    const sim = field('loop', [[2, 2], [6, 2], [6, 6], [2, 6], [2, 2]], 0.5);
    const lap = (4 * 4) / 2 + 4 * 0.5; // each corner's quarter turn fits inside its pause
    steps(sim, lap + 0.3, () => {});
    expect(sim.monsters[0].x).toBeGreaterThan(2.7); // already on its way along the top again (a second stop would hold it at 2.5)
    expect(sim.monsters[0].y).toBeCloseTo(2.5, 5);
  });

  it('turns corners the short way and about-faces through the side that faces the map centre', () => {
    for (const [y, sign] of [[1, 1], [7, -1]] as const) {
      // along the top edge the centre lies to +y (clockwise on screen), along the bottom edge to -y
      const sim = field('pingpong', [[2, y], [8, y]], 0);
      let swept = 0;
      let prev = sim.monsters[0].angle;
      steps(sim, 3.8, (m) => {
        const d = angleDiff(m.angle, prev);
        if (Math.abs(d) > 1e-9) {
          expect(Math.sign(d)).toBe(sign);
          swept += Math.abs(d);
        }
        prev = m.angle;
      });
      expect(swept).toBeCloseTo(Math.PI, 5);
    }
    const sim = field('loop', [[2, 2], [6, 2], [6, 6]], 0);
    let prev = sim.monsters[0].angle;
    steps(sim, 2.5, (m) => {
      expect(Math.abs(angleDiff(m.angle, prev))).toBeLessThanOrEqual(TUNING.monsterTurnSpeed / 60 + 1e-9);
      prev = m.angle;
    });
    expect(sim.monsters[0].angle).toBeCloseTo(Math.PI / 2, 5); // a quarter turn right, not three quarters left
  });
});

describe('paired levers', () => {
  /** A lever at (1, 1) in both dimensions on different channels; door (3, 1) in A answers channel 2 only. */
  const paired = () => {
    const l = createEmptyLevel('t', 7, 3);
    for (let x = 0; x < 7; x++) { setCell(l, 0, x, 0, '#'); setCell(l, 0, x, 2, '#'); setCell(l, 1, x, 0, '#'); setCell(l, 1, x, 2, '#'); }
    setCell(l, 0, 1, 1, 'L'); l.dimensions[0].props['1,1'] = { channel: 1 };
    setCell(l, 1, 1, 1, 'L'); l.dimensions[1].props['1,1'] = { channel: 2 };
    setCell(l, 0, 3, 1, 'D'); l.dimensions[0].props['3,1'] = { channel: 2, inverted: false };
    setCell(l, 1, 3, 1, '#');
    setCell(l, 0, 2, 1, 'S');
    setCell(l, 0, 6, 1, 'E'); l.dimensions[0].props['6,1'] = { dir: 3 };
    setCell(l, 1, 6, 1, '#');
    for (let x = 4; x < 6; x++) setCell(l, 1, x, 1, '#');
    return l;
  };

  it('move together: pulling one throws its twin and switches both channels', () => {
    const sim = new Sim(paired());
    const a = sim.grid.cell(0, 1, 1);
    const b = sim.grid.cell(1, 1, 1);
    walkTo(sim, 1, 1); // onto the lever: it is pulled from within half a cell of its centre
    tap(sim, 'interact');
    expect([sim.leverOn(a), sim.leverOn(b)]).toEqual([true, true]);
    expect([sim.channelOn(1), sim.channelOn(2)]).toEqual([true, true]);
    tap(sim, 'shift');
    tap(sim, 'interact'); // from the other side, back off together
    expect([sim.leverOn(a), sim.leverOn(b), sim.channelOn(2)]).toEqual([false, false, false]);
  });

  it('count as one switch for the solver', () => {
    // a second door on channel 1 (opened by the surface twin) blocks the hall too: both doors open needs one lever on and
    // the other off, which a pair can never be
    const l = paired();
    setCell(l, 0, 4, 1, 'D'); l.dimensions[0].props['4,1'] = { channel: 1, inverted: true };
    expect(validateLevel(l).solve?.status).toBe('unsolvable');
    // the same layout with the twins on separate cells (no longer a pair) is solvable
    setCell(l, 1, 1, 1, '.'); setCell(l, 1, 2, 1, 'L'); l.dimensions[1].props['2,1'] = { channel: 2 };
    expect(validateLevel(l).solve?.status).toBe('solved');
  });
});

describe('ray cast', () => {
  it('stops at the first blocked cell', () => {
    const d = castRay(0.5, 0.5, 1, 0, 10, (x) => x === 3);
    expect(d).toBeCloseTo(2.5);
  });
});

describe('simulation on level01', () => {
  it('sees only along its cone: right behind it, however close, the player goes unnoticed', () => {
    const sim = new Sim(level01());
    const m = sim.monsters[0];
    sim.dim = m.dim;
    const behind = m.angle + Math.PI;
    sim.x = m.x + Math.cos(behind) * 0.3;
    sim.y = m.y + Math.sin(behind) * 0.3;
    expect(sim.monsterSeesPlayer(m)).toBe(false);
    sim.x = m.x + Math.cos(m.angle) * 0.3;
    sim.y = m.y + Math.sin(m.angle) * 0.3;
    expect(sim.monsterSeesPlayer(m)).toBe(true);
  });

  it('shifts on any cell, including non-floor ones', () => {
    const sim = new Sim(level01());
    expect(sim.currentCell().def.id).toBe('spawn');
    tap(sim, 'shift');
    expect(sim.dim).toBe(1);
  });

  it('the lever at the bottom of the west corridor opens the door beside the spawn', () => {
    const sim = new Sim(level01());
    const door = sim.grid.cell(0, 2, 1);
    expect(sim.doorOpen(door)).toBe(false);
    walkTo(sim, 1, 7, { sneak: true }); // sneaking keeps the hero out of m1's light
    tap(sim, 'interact');
    expect(sim.doorOpen(door)).toBe(true);
    expect(sim.status).toBe('playing');
  });

  /** A lone monster at (6, 2) facing west (180°) in dimension `dim`, the player spawning beside it at (spawnX, 2). */
  const ambushLevel = (spawnX: number, facing = 180, dim: 0 | 1 = 0) => {
    const l: Level = createEmptyLevel('t', 12, 5);
    setCell(l, 0, 10, 3, 'E');
    setCell(l, 0, 1, 1, '.');
    setCell(l, dim, spawnX, 2, 'S');
    l.dimensions[dim].monsters.push({ id: 'm', path: [[6, 2]], mode: 'pingpong', speed: 1, pause: 0, viewRadius: 4, viewAngle: 90, facing });
    return l;
  };
  /** Step up to within the takedown reach, right behind the monster's back (it faces west, the hero is east of it). */
  const closeIn = (sim: Sim) => { sim.x = sim.monsters[0].x + TUNING.attackRange - 0.05; };

  it('takes a monster down from behind in its own dimension, locking the hero for the whole takedown', () => {
    const sim = new Sim(ambushLevel(7));
    const m = sim.monsters[0];
    closeIn(sim);
    sim.update(NO_INPUT, 1 / 60);
    expect(sim.attackTarget()).toBe(m);
    space(sim); // no lever in reach, so the action key is a takedown
    expect(m.alive).toBe(false);
    expect(sim.drainEvents()).toContainEqual({ type: 'kill', monster: m });
    expect(sim.facing).toBeCloseTo(Math.PI); // turned to face its target
    const x0 = sim.x;
    const busy = Math.round(TUNING.takedownTime * 60) - 2;
    for (let i = 0; i < busy; i++) sim.update({ ...NO_INPUT, moveX: 1, shift: true }, 1 / 60);
    expect(sim.x).toBe(x0); // no moving or shifting while on the monster's head
    expect(sim.dim).toBe(0);
    for (let i = 0; i < 10; i++) sim.update({ ...NO_INPUT, moveX: 1 }, 1 / 60);
    expect(sim.x).toBeGreaterThan(x0);
    expect(sim.status).toBe('playing');
    expect(sim.hunter).toBeNull();
  });

  it('pulls a lever only within interactRange and takes a monster down only within attackRange, centre to centre', () => {
    const sim = new Sim(ambushLevel(7));
    const m = sim.monsters[0];
    sim.x = m.x + TUNING.attackRange + 0.05;
    sim.update(NO_INPUT, 1 / 60);
    expect(sim.attackTarget()).toBeNull();
    sim.x = m.x + TUNING.attackRange - 0.05;
    expect(sim.attackTarget()).toBe(m);
    setCell(sim.level, 0, 8, 2, 'L');
    const lever = new Sim(sim.level);
    lever.x = 8.5 + TUNING.interactRange + 0.05; lever.y = 2.5;
    expect(lever.nearestLever()).toBeNull();
    lever.x = 8.5 + TUNING.interactRange - 0.05;
    expect(lever.nearestLever()).not.toBeNull();
  });

  it('cannot take down a monster that sees the hero, nor one in the other dimension', () => {
    const facing = new Sim(ambushLevel(7, 0)); // the monster faces the hero
    closeIn(facing);
    facing.update(NO_INPUT, 1 / 60);
    expect(facing.monsters[0].seeing).toBe(true);
    expect(facing.attackTarget()).toBeNull();
    tap(facing, 'attack');
    expect(facing.monsters[0].alive).toBe(true);

    const other = new Sim(ambushLevel(7));
    closeIn(other);
    tap(other, 'shift');
    expect(other.dim).toBe(1);
    expect(other.attackTarget()).toBeNull();
    tap(other, 'attack');
    expect(other.monsters[0].alive).toBe(true);
    expect(other.takedownT).toBe(0);
  });

  it('cannot take down an underside monster, even from behind: they are ghosts', () => {
    const sim = new Sim(ambushLevel(7, 180, 1));
    const m = sim.monsters[0];
    closeIn(sim);
    expect(sim.dim).toBe(1);
    sim.update(NO_INPUT, 1 / 60);
    expect(m.seeing).toBe(false);
    expect(sim.attackTarget()).toBeNull();
    tap(sim, 'attack');
    expect(m.alive).toBe(true);
    expect(sim.takedownT).toBe(0);
  });

  it('a slain surface monster rises as a ghost in the underside that watches from where it fell', () => {
    const sim = new Sim(ambushLevel(7));
    const m = sim.monsters[0];
    closeIn(sim);
    sim.update(NO_INPUT, 1 / 60);
    const [x, y, angle] = [m.x, m.y, m.angle];
    tap(sim, 'attack');
    expect(m.alive).toBe(false);
    expect(m.corpse).toEqual({ x, y, angle });
    expect(m.risen).toBe(true);
    expect(m.dim).toBe(1);
    for (let i = 0; i < 150; i++) sim.update(NO_INPUT, 1 / 60); // takedown over; the ghost is unseen from A
    expect(m.detect).toBe(0);
    tap(sim, 'shift');
    expect(sim.dim).toBe(1);
    expect(sim.attackTarget()).toBeNull(); // right behind it, but ghosts cannot be killed
    for (let i = 0; i < 60; i++) sim.update(NO_INPUT, 1 / 60);
    expect([m.x, m.y, m.angle]).toEqual([x, y, angle]); // it stands watch instead of patrolling
    expect(sim.hunter).toBeNull();
    walkTo(sim, 4, 2); // round in front of it, into its light
    expect(sim.hunter).toBe(m);
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

  it('reaches the exit only once the hero has walked all the way into the cave', () => {
    const sim = new Sim(level01());
    sim.monsters.length = 0;
    const exit = sim.grid.all().find((c) => c.dim === 0 && c.def.behavior === 'exit')!;
    const [dx, dy] = sim.grid.exitMouth(exit);
    // stand two cells out in front of the mouth, then walk straight in
    sim.x = exit.x + 0.5 + dx * 2;
    sim.y = exit.y + 0.5 + dy * 2;
    for (let i = 0; i < 600 && sim.status === 'playing' && sim.caveDepthOf(exit) < TUNING.caveDepth / 2 - 0.06; i++) {
      sim.update({ ...NO_INPUT, moveX: -dx * 0.3, moveY: -dy * 0.3 }, 1 / 60);
    }
    expect(sim.currentCell()).toBe(exit); // inside the exit cell, but not yet past the middle of the cave
    expect(sim.status).toBe('playing');
    for (let i = 0; i < 60 && sim.status === 'playing'; i++) sim.update({ ...NO_INPUT, moveX: -dx * 0.3, moveY: -dy * 0.3 }, 1 / 60);
    expect(sim.status).toBe('won');
    expect(sim.caveDepthOf(exit)).toBeGreaterThanOrEqual(TUNING.caveDepth / 2);
  });

  it('can be completed along the intended route with monsters active', () => {
    const sim = new Sim(level01());
    const step = (extra: Partial<SimInput> = {}) => sim.update({ ...NO_INPUT, ...extra }, 1 / 60);
    const m2 = sim.monsters.find((m) => m.def.id === 'm2')!;

    walkTo(sim, 1, 7, { sneak: true });     // past m1's light, down to the lever
    space(sim);                             // lever ch1 → the door beside the spawn opens
    expect(sim.drainEvents().some((e) => e.type === 'lever')).toBe(true);
    walkTo(sim, 1, 1, { sneak: true });
    // wait, sneaking, for m2 to turn at the west end of its beat and walk off east
    let px = m2.x;
    for (let i = 0; i < 2000; i++) {
      step({ sneak: true });
      if (m2.x > 4.6 && m2.x > px) break;
      px = m2.x;
    }
    expect(sim.status).toBe('playing');
    // run up behind it and cut its throat before it turns round
    for (let i = 0; i < 600 && Math.hypot(m2.x - sim.x, m2.y - sim.y) > TUNING.attackRange - 0.1; i++) {
      const dx = m2.x - sim.x, dy = m2.y - sim.y, d = Math.hypot(dx, dy);
      step({ moveX: dx / d, moveY: dy / d });
    }
    tap(sim, 'attack');
    expect(m2.alive).toBe(false);
    expect(m2.dim).toBe(1);                 // its ghost now stands watch in B; the hero stays in A
    for (let i = 0; i < Math.ceil(TUNING.takedownTime * 60); i++) step();
    walkTo(sim, 7, 1); walkTo(sim, 7, 2); walkTo(sim, 7, 3); // into the cave
    expect(sim.status).toBe('won');
  });

});

describe('level02: the troll guards the lever with its ghost', () => {
  const level02 = () => loadById('level02');
  const walkX = (sim: Sim, x: number, extra: Partial<SimInput> = {}) => walkTo(sim, x - 0.5, 1, extra);
  /** Stand behind the troll (in A) until the B ghost has walked west past us and turned its back. */
  const waitForGhostWest = (sim: Sim) => {
    const g = sim.monsters.find((m) => m.def.id === 'g1')!;
    let px = g.x;
    for (let i = 0; i < 6000; i++) {
      sim.update(NO_INPUT, 1 / 60);
      if (g.x < 4.5 && g.x < px) return;
      px = g.x;
    }
  };

  it('wins by pulling the lever in B first and only then cutting the troll down', () => {
    const sim = new Sim(level02());
    walkX(sim, 5.8);                        // right behind the troll's back
    waitForGhostWest(sim);
    tap(sim, 'shift'); walkX(sim, 8.2); tap(sim, 'interact');
    walkX(sim, 5.8); tap(sim, 'shift');     // back behind the troll before the ghost turns round
    tap(sim, 'attack');
    expect(sim.monsters[0].alive).toBe(false);
    for (let i = 0; i < Math.ceil(TUNING.takedownTime * 60); i++) sim.update(NO_INPUT, 1 / 60);
    walkX(sim, 10.8);
    expect(sim.status).toBe('won');
  });

  it('a kill before the lever leaves the troll\'s ghost staring at the lever', () => {
    const sim = new Sim(level02());
    walkX(sim, 5.8);
    tap(sim, 'attack');
    for (let i = 0; i < Math.ceil(TUNING.takedownTime * 60); i++) sim.update(NO_INPUT, 1 / 60);
    waitForGhostWest(sim);
    tap(sim, 'shift');
    walkX(sim, 7.6, { sneak: true });
    expect(sim.status).toBe('caught');
    expect(sim.hunter?.def.id).toBe('t1');
  });

  it('the living troll lights the exit even for a sneaking hero', () => {
    const sim = new Sim(level02());
    walkX(sim, 5.8);
    waitForGhostWest(sim);
    tap(sim, 'shift'); walkX(sim, 8.2); tap(sim, 'interact');
    walkX(sim, 8.6); tap(sim, 'shift');
    walkX(sim, 10.8, { sneak: true });
    expect(sim.status).toBe('caught');
  });
});

describe('level03: one lever decides which half of the ring is lit', () => {
  const level03 = () => loadById('level03');
  /** Is a sneaking hero at (x, y) in `dim` seen by anyone? */
  const lit = (sim: Sim, dim: 0 | 1, x: number, y: number) => {
    const [px, py, pd, ps] = [sim.x, sim.y, sim.dim, sim.sneaking];
    sim.dim = dim; sim.x = x + 0.5; sim.y = y + 0.5; sim.sneaking = true;
    const seen = sim.monsters.some((m) => m.dim === dim && sim.monsterSeesPlayer(m));
    sim.x = px; sim.y = py; sim.dim = pd; sim.sneaking = ps;
    return seen;
  };

  it('before the lever the bottom arc is lit in both dimensions and the top arc only in the underside', () => {
    const sim = new Sim(level03());
    expect([lit(sim, 0, 3, 7), lit(sim, 1, 3, 7)]).toEqual([true, true]);
    expect([lit(sim, 0, 3, 1), lit(sim, 1, 3, 1)]).toEqual([false, true]);
  });

  it('after the lever the top arc is lit in both dimensions and the bottom arc only on the surface', () => {
    const sim = new Sim(level03());
    sim.x = 5.5; sim.y = 4.5; // on the lever
    tap(sim, 'interact');
    expect([lit(sim, 0, 3, 1), lit(sim, 1, 3, 1)]).toEqual([true, true]);
    expect([lit(sim, 0, 3, 7), lit(sim, 1, 3, 7)]).toEqual([true, false]);
  });

  it('is won by going round the top on the surface, pulling the lever, and coming back round the bottom in the underside', () => {
    const sim = new Sim(level03());
    for (const [x, y] of [[1, 1], [5, 1], [5, 4]]) walkTo(sim, x, y);
    tap(sim, 'interact');
    tap(sim, 'shift');
    expect(sim.dim).toBe(1);
    for (const [x, y] of [[5, 7], [1, 7], [1, 4], [3, 4]]) walkTo(sim, x, y);
    expect(sim.status).toBe('won');
  });
});

describe('exit cave', () => {
  /** An exit standing in the middle of an open room, its mouth facing left (dir 3). */
  const room = () => {
    const l = createEmptyLevel('t', 9, 7);
    setCell(l, 0, 4, 3, 'E'); setProp(l, 0, 4, 3, 'dir', 3);
    return l;
  };

  it('is rock on its three closed sides: walking into them stops at the cell edge', () => {
    for (const [sx, sy, mx, my] of [[4.5, 1.5, 0, 1], [6.5, 3.5, -1, 0], [4.5, 5.5, 0, -1]]) {
      const sim = new Sim(room());
      sim.x = sx; sim.y = sy;
      for (let i = 0; i < 120; i++) sim.update({ ...NO_INPUT, moveX: mx, moveY: my }, 1 / 60);
      expect(sim.currentCell().def.id).not.toBe('exit');
      expect(sim.status).toBe('playing');
    }
  });

  it('is walked into through its mouth, and from inside only the mouth leads out', () => {
    const sim = new Sim(room());
    sim.x = 3.5; sim.y = 3.5;
    for (let i = 0; i < 13; i++) sim.update({ ...NO_INPUT, moveX: 1 }, 1 / 60); // just inside, not yet won
    expect(sim.currentCell().def.id).toBe('exit');
    expect(sim.status).toBe('playing');
    for (let i = 0; i < 60; i++) sim.update({ ...NO_INPUT, moveY: 1 }, 1 / 60); // the side wall holds
    expect(Math.floor(sim.y)).toBe(3);
    for (let i = 0; i < 60; i++) sim.update({ ...NO_INPUT, moveX: 1 }, 1 / 60);
    expect(sim.status).toBe('won');
  });

  it('blocks sight through its rock sides but not through its mouth', () => {
    const l = room();
    l.dimensions[0].monsters.push({ id: 'm', path: [[4, 1]], mode: 'pingpong', speed: 1, pause: 0, viewRadius: 6, viewAngle: 40, facing: 90 });
    const sim = new Sim(l);
    sim.x = 4.5; sim.y = 5.5; // straight below, behind the cave
    expect(sim.monsterSeesPlayer(sim.monsters[0])).toBe(false);
    sim.x = 4.5; sim.y = 2.5; // in front of the rock: seen
    expect(sim.monsterSeesPlayer(sim.monsters[0])).toBe(true);
  });

  it('shifting into it from the other dimension does not count as walking in', () => {
    const l = room();
    setCell(l, 1, 4, 3, '.');
    const sim = new Sim(l);
    sim.dim = 1; sim.x = 4.5; sim.y = 3.5;
    tap(sim, 'shift');
    expect(sim.dim).toBe(0);
    expect(sim.status).toBe('playing');
    for (let i = 0; i < 60; i++) sim.update({ ...NO_INPUT, moveX: -1 }, 1 / 60); // out through the mouth
    for (let i = 0; i < 60; i++) sim.update({ ...NO_INPUT, moveX: 1 }, 1 / 60); // and back in
    expect(sim.status).toBe('won');
  });
});
