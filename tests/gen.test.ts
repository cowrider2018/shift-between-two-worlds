import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEVEL_FORMAT, MONSTER_DEFAULTS, createEmptyLevel, parseLevel, setCell, setProp, type Level, type MonsterDef } from '../src/core/level';
import { NO_INPUT, Sim } from '../src/core/sim';
import { validateLevel } from '../src/core/validate';
import { DEFAULT_OPTIONS, canonicalKey, generateOne, rng, timingMatters, transform } from '../src/gen/generate';
import { Model, TICK, analyze, straightShifts, type Action } from '../src/gen/model';
import { replay } from '../src/gen/replay';

/** A one-row level: rows for A and B, props per dimension. */
function corridor(a: string, b: string, props: [Level['dimensions'][0]['props'], Level['dimensions'][0]['props']], monsters: [MonsterDef[], MonsterDef[]] = [[], []]): Level {
  const w = a.length;
  const wall = '#'.repeat(w);
  return {
    format: LEVEL_FORMAT, id: 't', name: 't', size: { w, h: 3 },
    dimensions: [
      { rows: [wall, a, wall], props: props[0], monsters: monsters[0] },
      { rows: [wall, b, wall], props: props[1], monsters: monsters[1] },
    ],
  };
}

const door = (channel: number) => ({ channel, inverted: false, vertical: true });

describe('generator model', () => {
  it('calls a level with one way through unique and replays it in the engine', () => {
    // shift onto the lever, pull it, shift back, walk through the door: the chained doors leave no other shift
    const level = corridor('#S.DE', '#LDD#', [{ '3,1': door(1), '4,1': { dir: 3 } }, { '1,1': { channel: 1 }, '2,1': door(9), '3,1': door(9) }]);
    const a = analyze(level);
    expect(a.status).toBe('unique');
    expect(a.route!.map((s) => s.type)).toEqual(['shift', 'lever', 'shift', 'move', 'move', 'move']);
    expect(replay(level, a.route!).ok).toBe(true);
  });

  it('calls a level with two places to shift back ambiguous', () => {
    const level = corridor('#S.DE', '#L.D#', [{ '3,1': door(1), '4,1': { dir: 3 } }, { '1,1': { channel: 1 }, '3,1': door(9) }]);
    expect(analyze(level).status).toBe('ambiguous');
  });

  it('sees through the engine quirk of standing on a monster', () => {
    // a troll facing the wall: the intended route cuts its throat from beside it, but the engine also lets the player
    // walk through its body, so killing is not forced (A1: never "kill or go round")
    const troll: MonsterDef = { id: 'm1', path: [[2, 1]], mode: 'pingpong', speed: 1.6, pause: 0.6, viewRadius: 10, viewAngle: 70, facing: 270 };
    const level = corridor('#S.DE', '#L.D#', [{ '3,1': { channel: 9, inverted: true, vertical: true }, '4,1': { dir: 3 } }, { '1,1': { channel: 1 }, '3,1': door(9) }], [[troll], []]);
    const a = analyze(level);
    expect(a.route!.some((s) => s.type === 'kill')).toBe(true);
    expect(a.status).toBe('ambiguous');
  });

  it('forces a takedown when the troll looks down the only way on', () => {
    // the troll faces the exit; the player comes up behind it, cuts its throat from the next cell and walks on.
    // Stepping onto its cell first is the same takedown, not a second way (B is chained shut past the spawn)
    const troll: MonsterDef = { id: 'm1', path: [[3, 1]], mode: 'pingpong', speed: 1.6, pause: 0.6, viewRadius: 14, viewAngle: 70, facing: 0 };
    const chained = Object.fromEntries([2, 3, 4, 5, 6].map((x) => [`${x},1`, door(9)]));
    const level = corridor('#S.....E', '#.DDDDD#', [{ '7,1': { dir: 3 } }, chained], [[troll], []]);
    const a = analyze(level);
    expect(a.status).toBe('unique');
    expect(a.route!.find((s) => s.type === 'kill')).toMatchObject({ x: 2, y: 1, monster: 'm1' });
    expect(replay(level, a.route!).ok).toBe(true);
  });

  it('times a route around a patrol and replays it on the same clock', () => {
    // a generated level: the ghost walks B's bottom corridor and, turning about at its east end, sweeps up the shaft
    // the route shifts into, so the player waits a tick first
    const level = parseLevel(JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', 'gen-patrol-gate.json'), 'utf8'))).level!;
    const a = analyze(level);
    expect(a.status).toBe('unique');
    expect(a.metrics!.patrolling).toBe(1);
    expect(a.route!.slice(0, 2).map((s) => s.type)).toEqual(['wait', 'shift']);
    expect(replay(level, a.route!).ok).toBe(true);
    // shifting straight away walks into its sweep: the waiting is real, not the model being careful
    expect(timingMatters(level, a.route!)).toBe(true);
  });

  it('follows a patrol through a lever door tick by tick, close to how the engine moves it', () => {
    // corridor y=2, door at (5, 2) on channel 1 (lever in B), patrol 2 <-> 8 at the default stats; the player is out
    // of the way
    const l = createEmptyLevel('t', 11, 5);
    setCell(l, 0, 5, 2, 'D');
    setProp(l, 0, 5, 2, 'vertical', true);
    setCell(l, 1, 5, 2, 'L');
    setProp(l, 1, 5, 2, 'channel', 1);
    l.dimensions[0].monsters.push({ id: 'm', path: [[2, 2], [8, 2]], ...MONSTER_DEFAULTS, viewRadius: 1, viewAngle: 10 });
    const model = new Model(l);
    expect(model.unsupported).toBeNull();
    expect(model.movingThroughDoors).toBe(1);
    const sim = new Sim(l);
    sim.x = 1.5;
    sim.y = 4.5;
    const channels = (sim as unknown as { channels: Map<number, boolean> }).channels;
    // shut for 7 ticks (it paces 2 <-> 4), open for 12, shut again: the pull lands on a tick's first frame
    const open = (t: number) => t >= 7 && t < 19;
    const frameOf = (t: number) => Math.round(t * TICK * 60);
    let mc = 0;
    for (let t = 0; t < 30; t++) {
      const [m] = model.monstersAt(mc, t);
      // the engine's turns run a frame or two off a tick
      expect(Math.abs(m.x - sim.monsters[0].x)).toBeLessThan(0.1);
      expect(Math.abs(m.y - sim.monsters[0].y)).toBeLessThan(0.1);
      const lm = open(t) ? 1 : 0;
      channels.set(1, !!lm);
      for (let f = frameOf(t); f < frameOf(t + 1); f++) sim.update(NO_INPUT, 1 / 60);
      mc = model.advance(mc, lm);
    }
  });

  it('generates levels that validate, are unique and win in the engine', () => {
    const r = rng(1);
    const made = [];
    for (let i = 0; i < 400 && made.length < 3; i++) {
      const c = generateOne(r, DEFAULT_OPTIONS);
      if (c) made.push(c);
    }
    expect(made.length).toBe(3);
    for (const c of made) {
      expect(validateLevel(c.level).ok).toBe(true);
      expect(analyze(c.level).status).toBe('unique');
      expect(replay(c.level, c.analysis.route!).ok).toBe(true);
    }
  });

  it('counts shifts down a straight run of alternating doors, not the first or one after a turn', () => {
    const mv = (dim: 0 | 1, x: number, y: number): Action => ({ type: 'move', dim, x, y });
    const sh = (dim: 0 | 1, x: number, y: number): Action => ({ type: 'shift', dim, x, y });
    // east, shift, east, shift, east, shift, east: the first shift starts the run, the next two carry it on
    const straight = [mv(0, 2, 1), sh(1, 2, 1), mv(1, 3, 1), sh(0, 3, 1), mv(0, 4, 1), mv(0, 5, 1), sh(1, 5, 1), mv(1, 6, 1)];
    expect(straightShifts(straight, { x: 1, y: 1 })).toBe(2);
    // the second shift leads into a turn south, the third comes three steps later: neither carries a run on
    const turning = [mv(0, 2, 1), sh(1, 2, 1), mv(1, 3, 1), sh(0, 3, 1), mv(0, 3, 2), mv(0, 3, 3), mv(0, 3, 4), sh(1, 3, 4), mv(1, 3, 5)];
    expect(straightShifts(turning, { x: 1, y: 1 })).toBe(0);
  });

  it('gives mirror images and rotations one key', () => {
    const r = rng(2);
    let c = null;
    for (let i = 0; i < 400 && !c; i++) c = generateOne(r, DEFAULT_OPTIONS);
    const key = canonicalKey(c!.level);
    for (const t of [{ swap: true, fx: false, fy: false }, { swap: false, fx: true, fy: false }, { swap: true, fx: true, fy: true }]) {
      const moved = transform(c!.level, t);
      expect(canonicalKey(moved)).toBe(key);
      expect(analyze(moved).status).toBe('unique');
    }
  });
});
