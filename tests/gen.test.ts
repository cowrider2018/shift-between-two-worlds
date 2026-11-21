import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEVEL_FORMAT, parseLevel, type Level, type MonsterDef } from '../src/core/level';
import { validateLevel } from '../src/core/validate';
import { DEFAULT_OPTIONS, canonicalKey, generateOne, rng, timingMatters, transform } from '../src/gen/generate';
import { analyze } from '../src/gen/model';
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
    // the route shifts into, so the player waits three ticks first
    const level = parseLevel(JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', 'gen-patrol-gate.json'), 'utf8'))).level!;
    const a = analyze(level);
    expect(a.status).toBe('unique');
    expect(a.metrics!.patrolling).toBe(1);
    expect(a.route!.slice(0, 4).map((s) => s.type)).toEqual(['wait', 'wait', 'wait', 'shift']);
    expect(replay(level, a.route!).ok).toBe(true);
    // shifting straight away walks into its sweep: the waiting is real, not the model being careful
    expect(timingMatters(level, a.route!)).toBe(true);
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
