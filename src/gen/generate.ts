/**
 * Level generator: sample a room lattice, keep what the discrete model calls unique, strip every element that is not
 * load-bearing, then tidy the outline (LEVEL-PRINCIPLES A1–A5, B7).
 *
 * Lattice: rooms on odd (x, y), connectors between neighbouring rooms, wall pillars on even (x, y). Rooms are walkable
 * in both dimensions; a connector is wall in both, or per dimension floor / door / chained door (A5: identical walls,
 * a chained door's flanks are pillars).
 */
import { BLOCK_BY_CHAR } from '../core/blocks';
import { EXIT_DIRS } from '../core/grid';
import { LEVEL_FORMAT, MONSTER_DEFAULTS, cellKey, getChar, nextMonsterId, parseCellKey, setCell, setProp, type DimIndex, type Level, type MonsterDef } from '../core/level';
import { segmentCells, validateLevel } from '../core/validate';
import { replay } from './replay';
import { Model, StateLimit, analyze, check, type Action, type Analysis, type Metrics } from './model';

export const CHAINED_CHANNEL = 9;

export interface GenOptions {
  /** Room lattice: rows × columns of rooms. The level is (2·cols + 1) × (2·rows + 1). */
  rows: number;
  cols: number;
  maxLevers: number;
  maxTrolls: number;
  maxGhosts: number;
  /** Chance a room is solid rock. */
  roomHole: number;
  /** Chance a connector is rock in both dimensions. */
  connWall: number;
  /** Chance a mutation adds a troll aimed down a passage (raised when takedowns are the goal). */
  addTroll: number;
  /** Chance a new monster patrols instead of standing still. */
  patrol: number;
  /** Chance a mutation adds a patrol across the current route (see patrolAcross). */
  routePatrol: number;
  /** Chained doors sampling and mutation may lay (minimizing a lever away can still chain its doors). */
  maxChained: number;
}

export const DEFAULT_OPTIONS: GenOptions = { rows: 3, cols: 3, maxLevers: 3, maxTrolls: 2, maxGhosts: 1, roomHole: 0.1, connWall: 0.2, patrol: 0.5, routePatrol: 0.1, maxChained: Infinity, addTroll: 0.1 };

export type Rng = () => number;

/** mulberry32: small, fast, seedable. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

/** Chained doors in the level. */
function chainedDoors(level: Level): number {
  return level.dimensions.reduce((n, d, di) => n + Object.entries(d.props).filter(([k, p]) => {
    const [x, y] = parseCellKey(k)!;
    return p.channel === CHAINED_CHANNEL && getChar(level, di as DimIndex, x, y) === 'D';
  }).length, 0);
}

/** A monster standing at (x, y). Its stats are the defaults: the generator never tunes them. */
function monster(id: string, x: number, y: number, facing: number): MonsterDef {
  return { id, path: [[x, y]], ...MONSTER_DEFAULTS, mode: 'pingpong', facing };
}

/** Cells a patrol may walk: open floor, a lever, the spawn, or a door a lever drives (it turns back while that is shut). */
const PATROL_FLOOR = ['.', 'L', 'S'];

/**
 * Turn the monster into a back-and-forth patrol from its cell along one straight line of open cells (at the default
 * speed and pause: one cell a tick, a turn a tick). A line may run through doors that
 * levers drive; such lines are preferred, since a patrol the levers confine or release is a puzzle piece where a free
 * one is mostly a timing gate. False when no line fits.
 */
function makePatrol(level: Level, d: DimIndex, m: MonsterDef, r: Rng): boolean {
  const [x, y] = m.path[0];
  const legs: [number, number, number][] = [];
  const throughDoor: [number, number, number][] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
    for (const n of [2, 4]) {
      const line = patrolLine(level, d, x, y, dx, dy, n);
      if (line) (line.door ? throughDoor : legs).push([dx, dy, n]);
    }
  if (throughDoor.length && (!legs.length || r() < 0.75)) legs.splice(0, legs.length, ...throughDoor);
  if (!legs.length) return false;
  const [dx, dy, n] = pick(r, legs);
  setPatrol(m, dx, dy, n);
  return true;
}

/** Can a patrol walk n cells from (x, y) in direction (dx, dy)? Null if not; else whether it passes a lever door. */
function patrolLine(level: Level, d: DimIndex, x: number, y: number, dx: number, dy: number, n: number): { door: boolean } | null {
  let door = false;
  for (let k = 1; k <= n; k++) {
    const [cx, cy] = [x + dx * k, y + dy * k];
    const ch = getChar(level, d, cx, cy);
    if (ch === 'D' && getProp(level, d, cx, cy, 'channel') !== CHAINED_CHANNEL) door = true;
    else if (!PATROL_FLOOR.includes(ch)) return null;
  }
  return { door };
}

/** Walk n cells from the monster's cell in direction (dx, dy) and back. */
function setPatrol(m: MonsterDef, dx: number, dy: number, n: number): void {
  const [x, y] = m.path[0];
  m.path = [[x, y], [x + dx * n, y + dy * n]];
  m.facing = (Math.round((Math.atan2(dy, dx) * 180) / Math.PI) + 360) % 360;
}

/**
 * A new patrol whose line runs through a cell of the level's current (strict) route: from a free room in the same row
 * or column, across that cell. A patrol only stays after minimizing when the route has to time itself around it (it
 * never blocks a way for good: it always turns away at some point), so this is where patrols can be load-bearing.
 */
function patrolAcross(l: Level, r: Rng, o: GenOptions): boolean {
  let route: Action[] | null;
  try {
    const m = new Model(l);
    if (m.unsupported) return false;
    route = m.route('strict');
  } catch (e) {
    if (e instanceof StateLimit) return false;
    throw e;
  }
  if (!route) return false;
  const cells = route.filter((a) => a.type === 'move' || a.type === 'shift');
  const key = (d: number, x: number, y: number) => `${d},${x},${y}`;
  const spawn = l.dimensions.flatMap((dd, di) => dd.rows.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === 'S' ? [key(di, x, y)] : []))));
  const seq = [...spawn, ...cells.map((a) => key(a.dim, a.x, a.y))];
  // every way to lay a patrol across a route cell: from a free room k cells before it, n cells long (n ≥ k), never
  // along the route's steps into and out of that cell
  const through: [DimIndex, number, number, number, number, number][] = [];
  const turning: typeof through = [];
  cells.forEach(({ dim: d, x, y }, i) => {
    if (l.dimensions[d].monsters.length >= (d === 0 ? o.maxTrolls : o.maxGhosts)) return;
    const beside = new Set([seq[i], seq[i + 2]]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      for (let k = 1; k <= 4; k++) {
        const [sx, sy] = [x - dx * k, y - dy * k];
        if (sx % 2 !== 1 || sy % 2 !== 1 || getChar(l, d, sx, sy) !== '.') continue;
        if (l.dimensions.some((dd) => dd.monsters.some((mm) => mm.path[0][0] === sx && mm.path[0][1] === sy))) continue;
        for (const n of [2, 4]) {
          if (n < k || !patrolLine(l, d, sx, sy, dx, dy, n)) continue;
          let along = false;
          for (let j = 0; j <= n; j++) if (beside.has(key(d, sx + dx * j, sy + dy * j))) along = true;
          // walking through the cell leaves more moments to pass than turning about on it
          if (!along) (n > k ? through : turning).push([d, sx, sy, dx, dy, n]);
        }
      }
  });
  const ways = through.length && (!turning.length || r() < 0.7) ? through : turning;
  if (!ways.length) return false;
  const [d, sx, sy, dx, dy, n] = pick(r, ways);
  const m = monster(nextMonsterId(l), sx, sy, 0);
  setPatrol(m, dx, dy, n);
  l.dimensions[d].monsters.push(m);
  return true;
}

/** Back to standing still where the patrol starts, looking the way it set out. */
function standStill(m: MonsterDef): void {
  m.path = [m.path[0]];
}

/** One random lattice level. Not checked. */
export function sample(r: Rng, o: GenOptions): Level {
  const W = 2 * o.cols + 1;
  const H = 2 * o.rows + 1;
  const wall = '#'.repeat(W);
  const level: Level = {
    format: LEVEL_FORMAT, id: 'gen', name: 'gen', size: { w: W, h: H },
    dimensions: [0, 1].map(() => ({ rows: Array.from({ length: H }, () => wall), props: {}, monsters: [] })) as unknown as Level['dimensions'],
  };
  const set = (d: DimIndex, x: number, y: number, ch: string) => setCell(level, d, x, y, ch);

  const rooms: [number, number][] = [];
  for (let ry = 0; ry < o.rows; ry++) for (let rx = 0; rx < o.cols; rx++) rooms.push([2 * rx + 1, 2 * ry + 1]);
  const present = rooms.filter(() => r() >= o.roomHole);
  if (present.length < 2) return level;
  for (const [x, y] of present) for (const d of [0, 1] as DimIndex[]) set(d, x, y, '.');
  const has = (x: number, y: number) => present.some(([px, py]) => px === x && py === y);

  const L = int(r, 1, o.maxLevers);
  let chained = 0;
  const door = (d: DimIndex, x: number, y: number, vertical: boolean) => {
    set(d, x, y, 'D');
    if (r() < 0.25 && chained < o.maxChained) {
      setProp(level, d, x, y, 'channel', CHAINED_CHANNEL);
      chained++;
    }
    else setProp(level, d, x, y, 'channel', int(r, 1, L));
    setProp(level, d, x, y, 'inverted', getProp(level, d, x, y, 'channel') !== CHAINED_CHANNEL && r() < 0.35);
    setProp(level, d, x, y, 'vertical', vertical);
  };
  for (const [x, y] of present)
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      if (!has(x + 2 * dx, y + 2 * dy) || r() < o.connWall) continue;
      const cx = x + dx;
      const cy = y + dy;
      for (const d of [0, 1] as DimIndex[]) {
        if (r() < 0.4) set(d, cx, cy, '.');
        else door(d, cx, cy, dx === 1);
      }
    }

  // spawn, levers (one per channel, A3), monsters: each on its own room
  const free = [...present];
  const take = () => free.splice(Math.floor(r() * free.length), 1)[0];
  const [sx, sy] = take();
  set(0, sx, sy, 'S');
  for (let ch = 1; ch <= L && free.length; ch++) {
    const [x, y] = take();
    const d = (r() < 0.5 ? 0 : 1) as DimIndex;
    set(d, x, y, 'L');
    setProp(level, d, x, y, 'channel', ch);
  }
  let n = 0;
  const add = (d: DimIndex) => {
    const [x, y] = take();
    const m = monster(`m${++n}`, x, y, aim(level, d, x, y, r));
    if (r() < o.patrol) makePatrol(level, d, m, r);
    level.dimensions[d].monsters.push(m);
  };
  for (let i = int(r, 0, o.maxTrolls); i > 0 && free.length; i--) add(0);
  for (let i = int(r, 0, o.maxGhosts); i > 0 && free.length; i--) add(1);

  // exit: a border cell next to a room, rock in the other dimension
  const mouths: [number, number, number][] = [];
  for (const [x, y] of present) {
    if (y === 1) mouths.push([x, 0, 2]);
    if (y === H - 2) mouths.push([x, H - 1, 0]);
    if (x === 1) mouths.push([0, y, 1]);
    if (x === W - 2) mouths.push([W - 1, y, 3]);
  }
  const [ex, ey, dir] = pick(r, mouths);
  const ed = (r() < 0.5 ? 0 : 1) as DimIndex;
  set(ed, ex, ey, 'E');
  setProp(level, ed, ex, ey, 'dir', dir);
  return level;
}

/**
 * A facing for a monster at (x, y): toward an open neighbour when there is one. The engine has no body collision, so
 * a monster staring at a wall blocks nothing and its kill is never forced; only a gaze down a passage the player must
 * take can make a takedown the one way through.
 */
function aim(level: Level, d: DimIndex, x: number, y: number, r: Rng): number {
  const open = ([[0, 1, 0], [90, 0, 1], [180, -1, 0], [270, 0, -1]] as const)
    .filter(([, dx, dy]) => !['#', ' ', 'E'].includes(getChar(level, d, x + dx, y + dy)))
    .map(([f]) => f);
  return pick(r, open.length ? open : [0, 90, 180, 270]);
}

function getProp(level: Level, d: DimIndex, x: number, y: number, key: string) {
  return level.dimensions[d].props[cellKey(x, y)]?.[key];
}

/** A deep copy (levels are plain data; much faster than structuredClone in the hot loop). */
const clone = (l: Level): Level => ({
  ...l,
  size: { ...l.size },
  dimensions: l.dimensions.map((d) => ({
    rows: [...d.rows],
    props: Object.fromEntries(Object.entries(d.props).map(([k, p]) => [k, { ...p }])),
    monsters: d.monsters.map((m) => ({ ...m, path: m.path.map(([x, y]): [number, number] => [x, y]) })),
  })) as unknown as Level['dimensions'],
});

/**
 * Simplifications of a level: each removes one element or one cell (A1: nothing idle). Each edits a clone in place and
 * returns false when it no longer applies (an earlier edit already took its target away).
 */
function simplifications(level: Level): ((l: Level) => boolean)[] {
  const out: ((l: Level) => boolean)[] = [];
  const { w, h } = level.size;
  // a monster's cells: where it stands, or every cell its patrol walks through
  const monsterAt = (l: Level, x: number, y: number) => l.dimensions.some((d) => d.monsters.some((m) =>
    m.path.length < 2 ? m.path[0][0] === x && m.path[0][1] === y : m.path.slice(1).some((b, i) => segmentCells(m.path[i], b).some(([px, py]) => px === x && py === y))));
  level.dimensions.forEach((dim, di) => {
    for (const { id, path } of dim.monsters) {
      out.push((l) => {
        const before = l.dimensions[di].monsters.length;
        l.dimensions[di].monsters = l.dimensions[di].monsters.filter((m) => m.id !== id);
        return l.dimensions[di].monsters.length < before;
      });
      // a patrol whose walking changes nothing stands still
      if (path.length > 1)
        out.push((l) => {
          const m = l.dimensions[di].monsters.find((mm) => mm.id === id);
          if (!m || m.path.length < 2) return false;
          standStill(m);
          return true;
        });
    }
  });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (const d of [0, 1] as DimIndex[]) {
        const ch = getChar(level, d, x, y);
        if (ch === 'D')
          // a door (or chained door) that never matters is just floor
          out.push((l) => {
            if (getChar(l, d, x, y) !== 'D') return false;
            setCell(l, d, x, y, '.');
            return true;
          });
        else if (ch === 'L')
          // without its lever a channel stays off: its doors become chained, its inverted doors stand open
          out.push((l) => {
            if (getChar(l, d, x, y) !== 'L') return false;
            const channel = getProp(l, d, x, y, 'channel');
            setCell(l, d, x, y, '.');
            for (const dd of [0, 1] as DimIndex[])
              for (const [k, p] of Object.entries(l.dimensions[dd].props)) {
                const [px, py] = parseCellKey(k)!;
                if (getChar(l, dd, px, py) !== 'D' || p.channel !== channel) continue;
                if (p.inverted) setCell(l, dd, px, py, '.');
                else setProp(l, dd, px, py, 'channel', CHAINED_CHANNEL);
              }
            return true;
          });
      }
  // a whole cell (both dimensions) back to rock
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      out.push((l) => {
        const a = getChar(l, 0, x, y);
        const b = getChar(l, 1, x, y);
        if (!['.', 'D'].includes(a) || !['.', 'D'].includes(b) || monsterAt(l, x, y)) return false;
        setCell(l, 0, x, y, '#');
        setCell(l, 1, x, y, '#');
        return true;
      });
  return out;
}

/**
 * Strip idle elements until every remaining one is load-bearing. Idle means: without it the level is still unique and
 * the route is exactly the same. Anything whose removal changes the route was part of the puzzle and stays.
 */
export function minimize(level: Level, r: Rng): { level: Level; analysis: Analysis } {
  let cur = level;
  let best = analyze(cur);
  // what the player does and when, not how the model numbers its states (that changes with every lever or monster)
  const routeKey = (route: Action[] | null | undefined) => JSON.stringify(route?.map(({ state: _s, ...a }) => a));
  const want = routeKey(best.route);
  for (let changed = true; changed;) {
    changed = false;
    const ops = simplifications(cur);
    for (let i = ops.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [ops[i], ops[j]] = [ops[j], ops[i]];
    }
    for (const op of ops) {
      const l = clone(cur);
      if (!op(l)) continue;
      // one search tells whether the route survived; only then pay for the full uniqueness check
      const m = new Model(l);
      if (m.unsupported) continue;
      let a: Analysis;
      try {
        const route = m.route('strict');
        if (routeKey(route) !== want) continue;
        a = check(m, route!);
      } catch (e) {
        if (e instanceof StateLimit) continue;
        throw e;
      }
      if (a.status !== 'unique') continue;
      cur = l;
      best = a;
      changed = true;
    }
  }
  return { level: cur, analysis: best };
}

/** Crop to the walkable area plus one ring of wall, and dig out rock that touches nothing walkable (A4). */
export function tidy(level: Level): Level {
  const { w, h } = level.size;
  const walk = (x: number, y: number) => [0, 1].some((d) => {
    const ch = getChar(level, d as DimIndex, x, y);
    return ch !== '#' && ch !== ' ' && ch !== 'E';
  });
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (walk(x, y)) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  x0--;
  y0--;
  x1++;
  y1++;
  const out = clone(level);
  out.size = { w: x1 - x0 + 1, h: y1 - y0 + 1 };
  out.dimensions.forEach((d, di) => {
    const src = level.dimensions[di];
    d.rows = src.rows.slice(y0, y1 + 1).map((row) => row.slice(x0, x1 + 1));
    d.props = {};
    for (const [k, p] of Object.entries(src.props)) {
      const [px, py] = parseCellKey(k)!;
      if (px >= x0 && px <= x1 && py >= y0 && py <= y1) d.props[cellKey(px - x0, py - y0)] = p;
    }
    d.monsters = src.monsters.map((m) => ({ ...m, path: m.path.map(([px, py]): [number, number] => [px - x0, py - y0]) }));
  });
  // rock with nothing walkable (or an exit) among its eight neighbours is outside the level: nothing is drawn there
  const near = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const d of [0, 1] as DimIndex[]) {
          const ch = getChar(out, d, x + dx, y + dy);
          if (ch !== '#' && ch !== ' ' && out.dimensions[d].rows[y + dy]?.[x + dx] !== undefined) return true;
        }
    return false;
  };
  const dig: [number, number][] = [];
  for (let y = 0; y < out.size.h; y++) for (let x = 0; x < out.size.w; x++) if (getChar(out, 0, x, y) === '#' && getChar(out, 1, x, y) === '#' && !near(x, y)) dig.push([x, y]);
  for (const [x, y] of dig) for (const d of [0, 1] as DimIndex[]) setCell(out, d, x, y, ' ');
  return out;
}

// ---------------------------------------------------------------------------
// Symmetry: two levels that are mirror images or rotations of each other are one level.

export type Xf = { swap: boolean; fx: boolean; fy: boolean };
const XFS: Xf[] = [false, true].flatMap((swap) => [false, true].flatMap((fx) => [false, true].map((fy) => ({ swap, fx, fy }))));

export function transform(level: Level, t: Xf): Level {
  const { w, h } = level.size;
  const W = t.swap ? h : w;
  const H = t.swap ? w : h;
  const pt = (x: number, y: number): [number, number] => {
    const [a, b] = t.swap ? [y, x] : [x, y];
    return [t.fx ? W - 1 - a : a, t.fy ? H - 1 - b : b];
  };
  const vec = (dx: number, dy: number): [number, number] => {
    const [a, b] = t.swap ? [dy, dx] : [dx, dy];
    return [t.fx ? -a : a, t.fy ? -b : b];
  };
  const out: Level = { ...level, size: { w: W, h: H }, dimensions: level.dimensions.map(() => ({ rows: [], props: {}, monsters: [] })) as unknown as Level['dimensions'] };
  level.dimensions.forEach((d, di) => {
    const grid: string[][] = Array.from({ length: H }, () => Array(W).fill(' '));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [nx, ny] = pt(x, y);
      grid[ny][nx] = d.rows[y][x];
    }
    const nd = out.dimensions[di];
    nd.rows = grid.map((row) => row.join(''));
    for (const [k, p] of Object.entries(d.props)) {
      const [x, y] = parseCellKey(k)!;
      const q = { ...p };
      if (typeof q.vertical === 'boolean' && t.swap) q.vertical = !q.vertical;
      if (typeof q.dir === 'number') {
        const [vx, vy] = vec(...EXIT_DIRS[q.dir]);
        q.dir = EXIT_DIRS.findIndex(([ex, ey]) => ex === vx && ey === vy);
      }
      nd.props[cellKey(...pt(x, y))] = q;
    }
    nd.monsters = d.monsters.map((m) => {
      const [vx, vy] = vec(Math.round(Math.cos((m.facing * Math.PI) / 180)), Math.round(Math.sin((m.facing * Math.PI) / 180)));
      return { ...m, path: m.path.map(([x, y]) => pt(x, y)), facing: (Math.round((Math.atan2(vy, vx) * 180) / Math.PI) + 360) % 360 };
    });
  });
  return out;
}

function fingerprint(level: Level): string {
  return level.dimensions
    .map((d) => {
      const props = Object.entries(d.props).filter(([k]) => {
        const [x, y] = parseCellKey(k)!;
        return (BLOCK_BY_CHAR.get(d.rows[y][x])?.params.length ?? 0) > 0;
      }).map(([k, p]) => `${k}:${JSON.stringify(p, Object.keys(p).sort())}`).sort();
      const ms = d.monsters.map((m) => `${m.path.join(';')}@${m.facing}`).sort();
      return [d.rows.join('/'), props.join(','), ms.join(',')].join('|');
    })
    .join('||');
}

/** The same key for a level and all its mirror images and rotations. */
export function canonicalKey(level: Level): string {
  return XFS.map((t) => fingerprint(transform(level, t))).sort()[0];
}

// ---------------------------------------------------------------------------

/** A rough "worth playing" number; the metrics themselves are in the index for sorting by hand. */
export function score(m: Metrics): number {
  // shifts score with diminishing returns (1 → 2, 4 → 4, 9 → 6): stacking them is not a puzzle. One down a straight
  // run of them is no decision: it scores nothing and costs STRAIGHT_SHIFT_COST
  const base = 3 * m.pulls + 2 * Math.sqrt(m.shifts - m.straightShifts) - STRAIGHT_SHIFT_COST * m.straightShifts + KILL_POINTS * m.kills + INTERLEAVE_POINTS * m.interleaves + 2 * (m.leverStates - 1) + 2 * m.revisits + TRAP_POINTS * Math.min(m.trapEntrances, TRAP_CAP)
    - 2 * m.chained - 0.1 * m.cells
    // every monster left after minimizing is load-bearing; one on patrol counts PATROL_BONUS times one standing still
    + MONSTER_POINTS * (m.standing + PATROL_BONUS * m.patrolling)
    + (m.timed ? TIMING_POINTS : 0);
  // a lever that drives fewer doors is clearer: divide by 1 + DOOR_DIVISOR per door beyond the first
  const f = 1 + DOOR_DIVISOR * Math.max(0, m.doorsPerLever - 1);
  return base > 0 ? base / f : base * f;
}

export const MONSTER_POINTS = 2;
/** A takedown is the tensest thing the game asks for and the hardest to generate: twice a pull. */
export const KILL_POINTS = 6;
/** The route has to time itself around a patrol: without its waits it does not win. */
export const TIMING_POINTS = 4;
/** Per way into a trap (a wrong move that loses the level), up to TRAP_CAP of them. */
export const TRAP_POINTS = 2;
export const TRAP_CAP = 5;
export const STRAIGHT_SHIFT_COST = 1;
/** Per change of decision kind along the route (shift → pull, pull → takedown, ...): the route asks for different things. */
export const INTERLEAVE_POINTS = 2;
export const PATROL_BONUS = 1.75;
/** 2 doors per lever → score ÷ 1.5, 3 → ÷ 2, 4 → ÷ 2.5. */
export const DOOR_DIVISOR = 0.5;

export interface Candidate {
  /** Tidied: cropped and dug out, ready to save. */
  level: Level;
  /** The level as sampled or mutated, before minimizing, still on its full lattice: mutation continues from here. */
  lattice: Level;
  analysis: Analysis;
  key: string;
  score: number;
}

/** Unique? → minimize → tidy → validate → wins in the engine. Null when the level does not make a candidate. */
export function finish(raw: Level, r: Rng): Candidate | null {
  if (analyze(raw).status !== 'unique') return null;
  const { level } = minimize(raw, r);
  const tidied = tidy(level);
  const a = analyze(tidied);
  if (a.status !== 'unique' || !a.metrics) return null;
  if (!validateLevel(tidied).ok) return null;
  if (!replay(tidied, a.route!).ok) return null;
  // the strict reading waits more than the game needs: when the route waits but also wins without waiting, patrols
  // that only time the route decorate (A1: idle), so they stand still and the level is made again. A patrol the doors
  // confine needs no waiting to matter: minimizing already showed that standing still changes the level
  a.metrics.timed = timingMatters(tidied, a.route!);
  const waits = a.route!.some((s) => s.type === 'wait');
  if (a.metrics.patrolling > a.metrics.throughDoors && waits && !a.metrics.timed) {
    const still = clone(raw);
    let stood = 0;
    for (const d of still.dimensions) for (const m of d.monsters) if (m.path.length > 1 && !crossesDoor(still, d, m)) {
      standStill(m);
      stood++;
    }
    // the door it crossed was minimized away: no patrol here is confined, so none stays
    if (!stood) for (const d of still.dimensions) for (const m of d.monsters) if (m.path.length > 1) standStill(m);
    return finish(still, r);
  }
  return { level: tidied, lattice: raw, analysis: a, key: canonicalKey(tidied), score: score(a.metrics) };
}

/** The patrol walks through a door a lever drives. */
function crossesDoor(level: Level, d: Level['dimensions'][0], m: MonsterDef): boolean {
  const di = level.dimensions.indexOf(d) as DimIndex;
  return m.path.slice(1).some((b, i) => segmentCells(m.path[i], b).some(([x, y]) =>
    getChar(level, di, x, y) === 'D' && getProp(level, di, x, y, 'channel') !== CHAINED_CHANNEL));
}

/** The route has to wait for a patrol: without its waits it does not win in the engine. */
export function timingMatters(level: Level, route: Action[]): boolean {
  return route.some((s) => s.type === 'wait') && !replay(level, route.filter((s) => s.type !== 'wait')).ok;
}

export function generateOne(r: Rng, o: GenOptions): Candidate | null {
  return finish(sample(r, o), r);
}

/** One random edit on a lattice level: re-open or change a connector, a room, a lever, a monster or the exit. */
export function mutate(level: Level, r: Rng, o: GenOptions): Level {
  const l = clone(level);
  const { w: W, h: H } = l.size;
  const channels = [...new Set(l.dimensions.flatMap((d, di) => Object.entries(d.props)
    .filter(([k]) => { const [x, y] = parseCellKey(k)!; return getChar(l, di as DimIndex, x, y) === 'L'; })
    .map(([, p]) => Number(p.channel))))];
  const monsterAt = (x: number, y: number) => l.dimensions.some((d) => d.monsters.some((m) => m.path[0][0] === x && m.path[0][1] === y));
  const roomFree = (x: number, y: number) => ['.'].includes(getChar(l, 0, x, y)) && getChar(l, 1, x, y) === '.' && !monsterAt(x, y);
  const rx = () => 2 * int(r, 0, o.cols - 1) + 1;
  const ry = () => 2 * int(r, 0, o.rows - 1) + 1;
  if (r() < o.routePatrol && patrolAcross(l, r, o)) return l;
  if (r() < o.addTroll && l.dimensions[0].monsters.length < o.maxTrolls) {
    // try a few rooms: a troll needs a free one
    for (let k = 0; k < 6; k++) {
      const x = rx();
      const y = ry();
      if (!roomFree(x, y)) continue;
      const m = monster(nextMonsterId(l), x, y, aim(l, 0, x, y, r));
      if (r() < o.patrol) makePatrol(l, 0, m, r);
      l.dimensions[0].monsters.push(m);
      return l;
    }
  }
  const kind = r();
  if (kind < 0.45) {
    // a connector: per dimension floor / door / chained, or rock in both
    const horiz = r() < 0.5;
    const x = horiz ? 2 * int(r, 1, o.cols - 1) : rx();
    const y = horiz ? ry() : 2 * int(r, 1, o.rows - 1);
    if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return l;
    if (r() < 0.15) {
      for (const d of [0, 1] as DimIndex[]) setCell(l, d, x, y, '#');
      return l;
    }
    for (const d of [0, 1] as DimIndex[]) {
      if (getChar(l, d, x, y) === '#') setCell(l, d, x, y, '.');
    }
    const d = (r() < 0.5 ? 0 : 1) as DimIndex;
    const c = r();
    const chain = c < 0.5 || !channels.length;
    // at the limit (counting the door it may replace) a chained door becomes floor
    const wasChained = getChar(l, d, x, y) === 'D' && getProp(l, d, x, y, 'channel') === CHAINED_CHANNEL;
    if (c < 0.3 || (chain && chainedDoors(l) - (wasChained ? 1 : 0) >= o.maxChained)) setCell(l, d, x, y, '.');
    else {
      setCell(l, d, x, y, 'D');
      const ch = chain ? CHAINED_CHANNEL : pick(r, channels);
      setProp(l, d, x, y, 'channel', ch);
      setProp(l, d, x, y, 'inverted', ch !== CHAINED_CHANNEL && r() < 0.4);
      setProp(l, d, x, y, 'vertical', x % 2 === 0);
    }
  } else if (kind < 0.6) {
    // a room: rock ↔ floor
    const x = rx();
    const y = ry();
    const a = getChar(l, 0, x, y);
    if (a === '#') for (const d of [0, 1] as DimIndex[]) setCell(l, d, x, y, '.');
    else if (roomFree(x, y)) for (const d of [0, 1] as DimIndex[]) setCell(l, d, x, y, '#');
  } else if (kind < 0.72) {
    // a new lever on a new channel
    if (channels.length >= o.maxLevers) return l;
    const x = rx();
    const y = ry();
    if (!roomFree(x, y)) return l;
    const d = (r() < 0.5 ? 0 : 1) as DimIndex;
    setCell(l, d, x, y, 'L');
    setProp(l, d, x, y, 'channel', Math.max(0, ...channels) + 1);
  } else if (kind < 0.9) {
    // a monster: turn, set walking or standing, remove, or add
    const all = l.dimensions.flatMap((d, di) => d.monsters.map((m) => [di, m] as const));
    const c = r();
    if (c < 0.25 && all.length) {
      const [di, m] = pick(r, all);
      if (m.path.length > 1) makePatrol(l, di as DimIndex, m, r);
      else m.facing = r() < 0.8 ? aim(l, di as DimIndex, m.path[0][0], m.path[0][1], r) : pick(r, [0, 90, 180, 270]);
    } else if (c < 0.45 && all.length) {
      const [di, m] = pick(r, all);
      if (m.path.length > 1) standStill(m);
      else makePatrol(l, di as DimIndex, m, r);
    } else if (c < 0.6 && all.length) {
      const [di, m] = pick(r, all);
      l.dimensions[di].monsters = l.dimensions[di].monsters.filter((mm) => mm !== m);
    } else {
      const di = r() < 0.65 ? 0 : 1;
      const count = l.dimensions[di].monsters.length;
      if (count >= (di === 0 ? o.maxTrolls : o.maxGhosts)) return l;
      const x = rx();
      const y = ry();
      if (!roomFree(x, y)) return l;
      const m = monster(nextMonsterId(l), x, y, aim(l, di as DimIndex, x, y, r));
      if (r() < o.patrol) makePatrol(l, di as DimIndex, m, r);
      l.dimensions[di].monsters.push(m);
    }
  } else {
    // the exit: to another border cell next to a room, in either dimension
    for (const d of [0, 1] as DimIndex[])
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (getChar(l, d, x, y) === 'E') setCell(l, d, x, y, '#');
    const opts: [number, number, number][] = [];
    for (let x = 1; x < W; x += 2) opts.push([x, 0, 2], [x, H - 1, 0]);
    for (let y = 1; y < H; y += 2) opts.push([0, y, 1], [W - 1, y, 3]);
    const [ex, ey, dir] = pick(r, opts);
    const ed = (r() < 0.5 ? 0 : 1) as DimIndex;
    setCell(l, ed, ex, ey, 'E');
    setProp(l, ed, ex, ey, 'dir', dir);
  }
  return l;
}

/**
 * Hill-climb from the given candidates: mutate a few times, keep the child when it is a unique level scoring no lower
 * than its parent (neutral steps let unused structure pile up for later steps to use). Every unique child found on the way is reported, not only the improvements.
 */
export function evolve(
  seeds: Candidate[], r: Rng, o: GenOptions, iterations: number, onFound: (c: Candidate) => void,
  /** Ranking (negative: a before b). A child replaces its parent when it ranks no lower, so a goal ranked ahead of the
   *  score (e.g. takedowns toward a target) is climbed one step at a time and never given up. */
  rank: (a: Candidate, b: Candidate) => number = (a, b) => b.score - a.score,
): void {
  const pool = [...seeds];
  if (!pool.length) return;
  for (let i = 0; i < iterations; i++) {
    const pi = Math.floor(r() * pool.length);
    let child = pool[pi].lattice;
    for (let k = int(r, 1, 3); k > 0; k--) child = mutate(child, r, o);
    const c = finish(child, r);
    if (!c) continue;
    onFound(c);
    if (rank(c, pool[pi]) <= 0) pool[pi] = c;
  }
}
