/**
 * Discrete model of a level for generation and uniqueness checks (LEVEL-PRINCIPLES B1/B2/B4/B5).
 *
 * Time runs in units of TICK seconds, the time a monster at the default speed takes to walk one cell; monster stats are
 * the defaults (speed, pause), so a patrol walks one cell a unit and turns (pause and swing together) in one unit. The
 * player sneaks a step, waits, shifts or pulls in a unit, a takedown takes TAKEDOWN_TICKS. A state is (position, lever
 * switches, monster states, unit mod the level's period).
 *
 * A patrol is the engine's walk in whole cells: along its ring of cell centres, stopping to turn at corners, and turning
 * back at the centre of the cell before one it cannot enter. The engine's turns take a frame or two more or less than a
 * unit, so this is close, not exact; a generated route is replayed in the engine before it counts. A patrol that stays
 * clear of lever-driven doors comes back to its start after a fixed number of units; its pose is then a function of the
 * unit. One across a lever-driven door turns back at the door while it is shut, so where it is depends on when the
 * levers were pulled: such a patrol is a *mover*, its state at the start of each unit (cell, direction, mid-turn) part
 * of the monster states. A lever press acts at the start of the unit, before monsters move.
 *
 * Monster states: a surface (A) troll is alive or dead; a dead one watches from the underside (B) in the pose it died
 * in, so a patrolling troll's death is kept as its pose class (cell and facing to 45 degrees). Underside monsters are
 * ghosts: never killed.
 *
 * Two readings of the same level:
 *  - strict: what the intended route may use. Every action is checked over its own unit, on the cells the player is in
 *    during it (a step: both cells; a shift: the landing cell, as it happens at the unit's start; a pull or a wait: its
 *    cell): each must be out of sight at every sample of the unit and at every point the player's body can take in it,
 *    and no monster's body may pass through it; a takedown is made from a 4-neighbouring cell and the player must stay
 *    unseen through all of its units.
 *  - loose: what a player could get away with in the engine: sight checked only at the unit's start and only when all
 *    of the cell is in view, bodies walkable, running (two cells a unit), a shorter takedown, also from a diagonal cell.
 *    Alternatives are searched for in this reading, so any route it finds is a real risk.
 */
import { LevelGrid, angleDiff, castRay, type Cell } from '../core/grid';
import { MONSTER_DEFAULTS, type DimIndex, type Level, type MonsterDef } from '../core/level';
import { TUNING, patrolRing } from '../core/sim';
import { segmentCells } from '../core/validate';

export type Mode = 'strict' | 'loose';

/** Seconds per unit: one cell at the default monster speed (a sneaking step, 1.92 cells/s, fits in one). */
export const TICK = 1 / MONSTER_DEFAULTS.speed;
/** Sight samples per unit. */
const SUB = 4;
/** Reaching the troll, the takedown itself and stepping back. */
export const TAKEDOWN_TICKS = Math.ceil((TUNING.takedownTime + 0.25) / TICK);
const LOOSE_TAKEDOWN_TICKS = Math.floor(TUNING.takedownTime / TICK);
const MAX_PERIOD = 120;
/** Most unit-start states a mover may have. */
const MAX_MOVER_STATES = 2000;
/** Searches keep tables indexed by state number up to this many states; past it only the states reached. */
const MAX_DENSE = 1 << 22;
/** Most states a search may reach before the level counts as too big. */
const MAX_REACHED = 3_000_000;

const MONSTER_CACHE = new Map<string, Mon | string>();

/**
 * The dense search's tables, shared by every model (searches never overlap) and grown as needed: minimizing builds
 * hundreds of models of one level, and fresh tables for each (tens of megabytes when the states multiply up) were
 * most of the memory traffic. A state counts as seen when its stamp is the current search's number.
 */
let TABLES: { parent: Int32Array; stamp: Uint32Array; gen: number; queue: Int32Array; via: Uint8Array; viaArg: Int32Array } | null = null;

function searchTables(n: number) {
  if (!TABLES || TABLES.parent.length < n) {
    const size = Math.min(MAX_DENSE, Math.max(n, Math.ceil((TABLES?.parent.length ?? 0) * 1.5)));
    TABLES = { parent: new Int32Array(size), stamp: new Uint32Array(size), gen: TABLES?.gen ?? 0, queue: new Int32Array(size), via: new Uint8Array(size), viaArg: new Int32Array(size) };
  }
  TABLES.gen++;
  return TABLES;
}

/** A search ran past MAX_REACHED states. */
export class StateLimit extends Error {
  constructor() {
    super('狀態空間過大');
  }
}

interface Search {
  goal: number;
  parent: (s: number) => number;
  via: (s: number) => number;
  viaArg: (s: number) => number;
}

export type Action = (
  | { type: 'move'; dim: DimIndex; x: number; y: number }
  | { type: 'wait'; dim: DimIndex; x: number; y: number }
  | { type: 'shift'; dim: DimIndex; x: number; y: number }
  | { type: 'lever'; dim: DimIndex; x: number; y: number; on: boolean }
  | { type: 'kill'; dim: DimIndex; x: number; y: number; monster: string }
) & {
  /** Ticks since the start once this action is done, and the state it leaves (see Model.state). */
  tick?: number;
  state?: number;
};

interface Pose {
  x: number;
  y: number;
  angle: number;
}

interface Mon {
  id: string;
  home: DimIndex;
  radius: number;
  half: number;
  /** Units per round of its patrol; 1 when it stands still or is a mover. */
  period: number;
  /** Pose at every sub-step of one period. */
  poses: Pose[];
  /** A patrol across lever-driven doors (see the header), else null. */
  mover: Mover | null;
  /** Surface trolls: the poses it can die in (one when standing), which one each tick of the period (a mover: each of
   *  its states) gives. */
  deadPoses: Pose[];
  deadAt: number[];
  /** Its digit in the monster-state number: values below `alive` are alive (a mover's state), the rest its death
   *  poses. Standing, periodic and ghost-without-door monsters have one alive value. */
  base: number;
  alive: number;
  size: number;
}

interface Mover {
  /** Door settings it can meet (distinct patterns of its doors over all lever settings), and which one each gives. */
  V: number;
  variantOf: Int32Array;
  /** State q under door setting v: the state a unit later at next[q * V + v], its poses through the unit (SUB + 1,
   *  the last being the next state's) at poses[(q * V + v) * (SUB + 1) + sub]. */
  next: Int32Array;
  poses: Pose[];
}

/** The player's sample points in a cell (x, y pairs): centre, corners and edge middles of the body. */
const SAMPLES = (() => {
  const r = TUNING.playerHalfSize;
  return Float64Array.of(0.5, 0.5, r, r, 1 - r, r, r, 1 - r, 1 - r, 1 - r, 0.5, r, 0.5, 1 - r, r, 0.5, 1 - r, 0.5);
})();

const MOVE = 0;
const SHIFT = 1;
const LEVER = 2;
const KILL = 3;
const WAIT = 4;
const RUN = 5;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export class Model {
  readonly grid: LevelGrid;
  readonly w: number;
  readonly h: number;
  readonly wh: number;
  readonly P: number;
  readonly unsupported: string | null = null;
  /** Lever switches: a lever and its twin in the other dimension share one. */
  readonly switchOf = new Map<Cell, number>();
  readonly switchChannel: number[] = [];
  /** Surface trolls (killable) and underside ghosts. */
  readonly trolls: Mon[] = [];
  readonly ghosts: Mon[] = [];
  readonly spawn: Cell | null;
  readonly S: number;
  /** Number of monster-state values (product over monsters of their digit sizes). */
  readonly M: number;
  /** Monsters whose state moves on with the ticks (movers). */
  private readonly movers: Mon[] = [];
  /** The level's period in ticks. */
  readonly L: number;
  private readonly LM: number;
  private readonly exitAt: Uint8Array;
  private readonly stepShut: Uint8Array;
  private readonly leverAt: Int8Array;
  /** Position steps east, west, south, north. */
  private readonly dirs: Int32Array;
  private readonly solidCache = new Map<number, Uint8Array>();
  private readonly doorKeyCache = new Map<number, string[]>();
  private readonly maskCache = new Map<string, Uint16Array>();
  private readonly viewCache = new Map<number, Uint8Array>();
  /** Views and masks are cut from big blocks: a small typed array of its own costs a trip to the system allocator, which
   *  worker threads queue up for. */
  private readonly bytes = new Slab(Uint8Array);
  private readonly words = new Slab(Uint16Array);
  private looseScratch: Uint16Array | null = null;

  constructor(readonly level: Level) {
    const grid = (this.grid = new LevelGrid(level));
    const w = (this.w = grid.w);
    const h = (this.h = grid.h);
    const wh = (this.wh = w * h);
    this.P = 2 * wh;
    const all = grid.all();
    this.spawn = all.find((c) => c.def.behavior === 'spawn') ?? null;
    this.leverAt = new Int8Array(this.P).fill(-1);
    this.dirs = Int32Array.of(1, -1, w, -w);
    for (const c of all) {
      if (c.def.behavior !== 'lever' || this.switchOf.has(c)) continue;
      const i = this.switchChannel.length;
      this.switchChannel.push(Number(c.props.channel));
      this.switchOf.set(c, i);
      const twin = grid.leverTwin(c);
      if (twin) this.switchOf.set(twin, i);
    }
    for (const [c, i] of this.switchOf) this.leverAt[c.dim * wh + c.y * w + c.x] = i;
    this.S = this.switchChannel.length;
    this.LM = 1 << this.S;

    let base = 1;
    let L = 1;
    const fail = (why: string) => ((this as { unsupported: string | null }).unsupported ??= why);
    level.dimensions.forEach((d, di) => {
      for (const def of d.monsters) {
        const mon = this.monster(def, di as DimIndex);
        if (typeof mon === 'string') {
          fail(mon);
          continue;
        }
        L = (L / gcd(L, mon.period)) * mon.period;
        mon.size = mon.alive + (di === 0 ? mon.deadPoses.length : 0);
        mon.base = base;
        base *= mon.size;
        if (mon.mover) this.movers.push(mon);
        (di === 0 ? this.trolls : this.ghosts).push(mon);
      }
    });
    this.M = base;
    this.L = L;
    if (L > MAX_PERIOD) fail(`巡邏週期合起來 ${L} 拍，太長`);

    this.exitAt = new Uint8Array(this.P);
    this.stepShut = new Uint8Array(this.P * 4);
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let d = 0; d < 2; d++)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const p = d * wh + y * w + x;
          if (grid.cell(d as DimIndex, x, y).def.behavior === 'exit') this.exitAt[p] = 1;
          DIRS.forEach(([ox, oy], k) => {
            const nx = x + ox;
            const ny = y + oy;
            if (!grid.inBounds(nx, ny) || grid.walled(d as DimIndex, x, y, nx, ny)) this.stepShut[p * 4 + k] = 1;
          });
        }
  }

  /** A monster's motion over one period, from the engine's own patrol code; a string says why it cannot be modelled. */
  /**
   * A monster's motion, cached across models: it depends only on its definition, the level's size (an about-face
   * swings past the centre) and, per lever setting, which cells of its walk are shut. Minimizing builds many models of
   * nearly the same level, and simulating a patrol is most of what building one costs.
   */
  private monster(def: MonsterDef, home: DimIndex): Mon | string {
    const ring = patrolRing(def);
    const cells: [number, number][] = [];
    for (let i = 0; i < ring.length && ring.length > 1; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      cells.push(...segmentCells([a[0] - 0.5, a[1] - 0.5], [b[0] - 0.5, b[1] - 0.5]));
    }
    const shut: string[] = [];
    for (let lm = 0; lm < this.LM; lm++) {
      const ch = this.channelFn(lm);
      shut.push(cells.map(([x, y]) => (this.grid.solid(home, x, y, ch) ? 1 : 0)).join(''));
    }
    const key = `${JSON.stringify(def)}|${home}|${this.w}x${this.h}|${shut.join(',')}`;
    let hit = MONSTER_CACHE.get(key);
    if (hit === undefined) {
      hit = this.buildMonster(def, home);
      if (MONSTER_CACHE.size > 20000) MONSTER_CACHE.clear();
      MONSTER_CACHE.set(key, hit);
    }
    return typeof hit === 'string' ? hit : { ...hit };
  }

  private buildMonster(def: MonsterDef, home: DimIndex): Mon | string {
    const grid = this.grid;
    const radius = def.viewRadius * TUNING.sneakRadiusMul;
    const half = ((def.viewAngle / 2) * Math.PI) / 180;
    const ring = patrolRing(def);
    if (ring.length < 2) {
      const p = { x: def.path[0][0] + 0.5, y: def.path[0][1] + 0.5, angle: (def.facing * Math.PI) / 180 };
      return { id: def.id, home, radius, half, period: 1, poses: Array<Pose>(SUB).fill(p), mover: null, ...deathClasses([p]), base: 0, alive: 1, size: 1 };
    }
    if (def.speed !== MONSTER_DEFAULTS.speed || def.pause !== MONSTER_DEFAULTS.pause) return `怪物 ${def.id} 的速度或停頓不是預設值`;
    const walk = new Walk(ring, [this.w / 2, this.h / 2]);
    if (!walk.ok) return `怪物 ${def.id} 的巡邏路線不是橫平豎直的整格`;
    // the lever-driven doors on its walk make it a mover
    const doors: Cell[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      for (const [x, y] of segmentCells([a[0] - 0.5, a[1] - 0.5], [b[0] - 0.5, b[1] - 0.5])) {
        const c = grid.cell(home, x, y);
        if (c.def.behavior === 'door' && this.switchChannel.includes(Number(c.props.channel)) && !doors.includes(c)) doors.push(c);
      }
    }
    if (doors.length) return this.mover(def, home, radius, half, doors, walk);
    const off = this.channelFn(0);
    const blocked = (cx: number, cy: number) => grid.solid(home, cx, cy, off);
    const start = walk.start();
    const poses: Pose[] = [];
    const starts: Pose[] = [];
    let s = start;
    for (let t = 0; t <= MAX_PERIOD; t++) {
      if (t && walk.key(s) === walk.key(start))
        return { id: def.id, home, radius, half, period: t, poses, mover: null, ...deathClasses(starts), base: 0, alive: 1, size: 1 };
      const step = walk.step(s, blocked);
      starts.push(step.poses[0]);
      poses.push(...step.poses.slice(0, SUB));
      s = step.next;
    }
    return `怪物 ${def.id} 的巡邏回不到起點`;
  }

  /** A patrol across lever-driven doors: every state it can be in at a unit's start, under every setting of its doors. */
  private mover(def: MonsterDef, home: DimIndex, radius: number, half: number, doors: Cell[], walk: Walk): Mon | string {
    const grid = this.grid;
    // door settings: which of its doors are shut, for each lever setting
    const variantOf = new Int32Array(this.LM);
    const reps: number[] = [];
    const seen = new Map<string, number>();
    for (let lm = 0; lm < this.LM; lm++) {
      const ch = this.channelFn(lm);
      const k = doors.map((c) => (grid.solid(home, c.x, c.y, ch) ? 1 : 0)).join('');
      let v = seen.get(k);
      if (v === undefined) {
        v = reps.length;
        seen.set(k, v);
        reps.push(lm);
      }
      variantOf[lm] = v;
    }
    const V = reps.length;
    const blocked = reps.map((lm) => {
      const ch = this.channelFn(lm);
      return (cx: number, cy: number) => grid.solid(home, cx, cy, ch);
    });
    const states = [walk.start()];
    const index = new Map([[walk.key(states[0]), 0]]);
    const next: number[] = [];
    const poses: Pose[] = [];
    for (let q = 0; q < states.length; q++)
      for (let v = 0; v < V; v++) {
        const step = walk.step(states[q], blocked[v]);
        poses.push(...step.poses);
        const k = walk.key(step.next);
        let nq = index.get(k);
        if (nq === undefined) {
          if (states.length >= MAX_MOVER_STATES) return `怪物 ${def.id} 的巡邏狀態超過 ${MAX_MOVER_STATES} 個`;
          nq = states.length;
          index.set(k, nq);
          states.push(step.next);
        }
        next.push(nq);
      }
    return {
      id: def.id, home, radius, half, period: 1, poses: [],
      mover: { V, variantOf, next: Int32Array.from(next), poses },
      ...deathClasses(states.map((q) => walk.pose(q))), base: 0, alive: states.length, size: 1,
    };
  }

  get switches(): number {
    return this.S;
  }

  get stateCount(): number {
    return this.L * this.M * this.LM * this.P;
  }

  get patrolling(): number {
    return [...this.trolls, ...this.ghosts].filter((m) => m.period > 1 || m.mover).length;
  }

  /** How many of the patrols cross a lever-driven door. */
  get movingThroughDoors(): number {
    return this.movers.length;
  }

  channelFn(lm: number): (ch: number) => boolean {
    return (ch) => this.switchChannel.some((c, i) => c === ch && (lm >> i) & 1);
  }

  /** A state from its parts, and back. */
  state(pos: number, lm: number, mc: number, t: number): number {
    return ((t * this.M + mc) * this.LM + lm) * this.P + pos;
  }

  parts(s: number): { pos: number; d: DimIndex; x: number; y: number; lm: number; mc: number; t: number } {
    const pos = s % this.P;
    let r = (s - pos) / this.P;
    const lm = r % this.LM;
    r = (r - lm) / this.LM;
    const mc = r % this.M;
    const t = (r - mc) / this.M;
    const d = (pos >= this.wh ? 1 : 0) as DimIndex;
    const cell = pos - d * this.wh;
    return { pos, d, x: cell % this.w, y: Math.floor(cell / this.w), lm, mc, t };
  }

  /** Troll i's state in mc: -1 alive, else the pose class it died in. */
  deadClass(mc: number, i: number): number {
    const t = this.trolls[i];
    const v = this.digit(mc, t);
    return v < t.alive ? -1 : v - t.alive;
  }

  private digit(mc: number, m: Mon): number {
    return Math.floor(mc / m.base) % m.size;
  }

  /** Where every monster is at tick t (and sub-step, under lever setting lm), as the gallery draws them. */
  monstersAt(mc: number, t: number, sub = 0, lm = 0): { id: string; dim: DimIndex; x: number; y: number; angle: number; dead: boolean }[] {
    const out: { id: string; dim: DimIndex; x: number; y: number; angle: number; dead: boolean }[] = [];
    this.trolls.forEach((m, i) => {
      const c = this.deadClass(mc, i);
      const p = c < 0 ? this.pose(m, mc, lm, t, sub) : m.deadPoses[c];
      out.push({ id: m.id, dim: c < 0 ? 0 : 1, ...p, dead: c >= 0 });
    });
    for (const g of this.ghosts) out.push({ id: g.id, dim: 1, ...this.pose(g, mc, lm, t, sub), dead: false });
    return out;
  }

  /** A live monster's pose at sub-step `sub` of tick t. */
  private pose(m: Mon, mc: number, lm: number, t: number, sub: number): Pose {
    const mv = m.mover;
    if (mv) return mv.poses[(this.digit(mc, m) * mv.V + mv.variantOf[lm]) * (SUB + 1) + sub];
    return m.poses[((t % m.period) * SUB + sub) % m.poses.length];
  }

  /** Watcher key of a live monster's pose (for the sight-mask cache). */
  private poseKey(m: Mon, mc: number, lm: number, t: number, sub: number): string {
    const mv = m.mover;
    if (mv) return `${m.id}|q${this.digit(mc, m)}v${mv.variantOf[lm]}s${sub}`;
    return `${m.id}|${((t % m.period) * SUB + sub) % m.poses.length}`;
  }

  /** The monster states a tick later, the tick running under lever setting lm: the living movers walk on. */
  advance(mc: number, lm: number): number {
    let out = mc;
    for (const m of this.movers) {
      const q = this.digit(mc, m);
      if (q >= m.alive) continue;
      const mv = m.mover!;
      out += (mv.next[q * mv.V + mv.variantOf[lm]] - q) * m.base;
    }
    return out;
  }

  private solid(lm: number): Uint8Array {
    let s = this.solidCache.get(lm);
    if (s) return s;
    s = this.bytes.take(this.P);
    const ch = this.channelFn(lm);
    for (let d = 0; d < 2; d++)
      for (let y = 0; y < this.h; y++)
        for (let x = 0; x < this.w; x++) if (this.grid.solid(d as DimIndex, x, y, ch)) s[d * this.wh + y * this.w + x] = 1;
    this.solidCache.set(lm, s);
    return s;
  }

  /** Per dimension, which doors stand open under lm: sight only changes with these. */
  private doorKey(lm: number): string[] {
    let k = this.doorKeyCache.get(lm);
    if (k) return k;
    const solid = this.solid(lm);
    k = [0, 1].map((d) => this.grid.all(d as DimIndex).filter((c) => c.def.behavior === 'door').map((c) => solid[d * this.wh + c.y * this.w + c.x]).join(''));
    this.doorKeyCache.set(lm, k);
    return k;
  }

  /** For one watcher pose: per cell of its dimension, which of the player's sample points it sees. */
  private mask(key: string, d: DimIndex, p: Pose, m: Mon, lm: number): Uint16Array {
    const k = `${key}|${this.doorKey(lm)[d]}`;
    let out = this.maskCache.get(k);
    if (out) return out;
    const { w, h, wh, grid } = this;
    const ch = this.channelFn(lm);
    const solid = this.solid(lm);
    out = this.words.take(wh);
    const opaque = (cx: number, cy: number) => grid.opaque(d, cx, cy, ch);
    const walled = (ax: number, ay: number, bx: number, by: number) => grid.walled(d, ax, ay, bx, by);
    const reach = m.radius + 1.5;
    const r2 = m.radius * m.radius;
    for (let y = Math.max(0, Math.floor(p.y - reach)); y < Math.min(h, p.y + reach); y++)
      for (let x = Math.max(0, Math.floor(p.x - reach)); x < Math.min(w, p.x + reach); x++) {
        if (solid[d * wh + y * w + x]) continue;
        let bits = 0;
        for (let i = 0; i < SAMPLES.length; i += 2) {
          const dx = x + SAMPLES[i] - p.x;
          const dy = y + SAMPLES[i + 1] - p.y;
          if (dx * dx + dy * dy > r2) continue;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const a = Math.atan2(dy, dx);
          if (Math.abs(angleDiff(a, p.angle)) > m.half) continue;
          if (castRay(p.x, p.y, Math.cos(a), Math.sin(a), dist, opaque, walled) >= dist - 1e-6) bits |= 1 << (i >> 1);
        }
        out[y * w + x] = bits;
      }
    this.maskCache.set(k, out);
    return out;
  }

  /**
   * Per position at tick t: bit 1 = blocked for the loose reading (all of the cell in sight at the tick), bit 2 = seen
   * at some point of the tick for the strict reading, bit 4 = a monster body passes through it during the tick.
   */
  view(lm: number, mc: number, t: number): Uint8Array {
    t %= this.L;
    const key = (t * this.M + mc) * this.LM + lm;
    const hit = this.viewCache.get(key);
    if (hit) return hit;
    const { wh, w } = this;
    const out = this.bytes.take(this.P);
    const loose = (this.looseScratch ??= new Uint16Array(this.P)).fill(0);
    const ALL = (1 << 9) - 1;
    const watch = (key: string, d: DimIndex, p: Pose, m: Mon, sub: number) => {
      const mk = this.mask(key, d, p, m, lm);
      const o = d * wh;
      for (let c = 0; c < wh; c++) {
        if (!mk[c]) continue;
        if (sub === 0) loose[o + c] |= mk[c];
        out[o + c] |= 2;
      }
    };
    const body = (d: DimIndex, p: Pose) => {
      out[d * wh + Math.floor(p.y) * w + Math.floor(p.x)] |= 4;
    };
    for (let sub = 0; sub <= SUB; sub++) {
      this.trolls.forEach((m, i) => {
        const c = this.deadClass(mc, i);
        if (c >= 0) {
          watch(`${m.id}|d${c}`, 1, m.deadPoses[c], m, sub);
          body(1, m.deadPoses[c]);
        } else {
          const p = this.pose(m, mc, lm, t, sub);
          watch(this.poseKey(m, mc, lm, t, sub), 0, p, m, sub);
          body(0, p);
        }
      });
      for (const g of this.ghosts) {
        const p = this.pose(g, mc, lm, t, sub);
        watch(this.poseKey(g, mc, lm, t, sub), 1, p, g, sub);
        body(1, p);
      }
    }
    for (let k = 0; k < this.P; k++) if (loose[k] === ALL) out[k] |= 1;
    this.viewCache.set(key, out);
    return out;
  }

  isExit(d: DimIndex, x: number, y: number): boolean {
    return this.exitAt[d * this.wh + y * this.w + x] === 1;
  }

  /**
   * The player may be on pos in tick t: loose, not all of the cell in sight at the tick's start; strict, nothing of it
   * in sight and no monster body in it at any point of the tick.
   */
  private ok(pos: number, lm: number, mc: number, t: number, strict: boolean, banned: Uint8Array | null): boolean {
    if (this.solid(lm)[pos] || (banned && banned[pos])) return false;
    return !(this.view(lm, mc, t)[pos] & (strict ? 6 : 1));
  }

  startState(mode: Mode): number {
    const s = this.spawn;
    if (!s) return -1;
    const pos = s.dim * this.wh + s.y * this.w + s.x;
    return this.ok(pos, 0, 0, 0, mode === 'strict', null) ? this.state(pos, 0, 0, 0) : -1;
  }

  /** Successors of s into the out arrays; returns how many. `banned` marks positions the player may not enter. */
  expand(s: number, strict: boolean, banned: Uint8Array | null, to: Float64Array, kind: Uint8Array, arg: Int32Array): number {
    const P = this.P;
    const pos = s % P;
    if (this.exitAt[pos]) return 0;
    const { wh, w, L, LM, M } = this;
    let r = (s - pos) / P;
    const lm = r % LM;
    r = (r - lm) / LM;
    const mc = r % M;
    const t = (r - mc) / M;
    const d = pos >= wh ? 1 : 0;
    const t1 = (t + 1) % L;
    const dirs = this.dirs;
    const stepShut = this.stepShut;
    let n = 0;
    const emit = (np: number, nlm: number, nmc: number, nt: number, k: number, a: number) => {
      to[n] = ((nt * M + nmc) * LM + nlm) * P + np;
      kind[n] = k;
      arg[n] = a;
      n++;
    };
    // the monster states once this tick is over (a pull changes the doors for the whole tick)
    const nmc = this.advance(mc, lm);
    const sw = this.leverAt[pos];
    const op = d ? pos - wh : pos + wh;
    const solid = this.solid(lm);
    if (strict) {
      // every action is checked over its own tick, on the cells the player is in during it: a step's both cells, a
      // shift's landing cell (it happens on the tick's first frame), a pull's or a wait's own cell
      const view = this.view(lm, mc, t);
      const safe = (p: number) => !solid[p] && !(banned && banned[p]) && !(view[p] & 6);
      if (safe(pos)) {
        emit(pos, lm, nmc, t1, WAIT, 0);
        for (let k = 0; k < 4; k++) {
          if (stepShut[pos * 4 + k]) continue;
          const np = pos + dirs[k];
          if (safe(np)) emit(np, lm, nmc, t1, MOVE, 0);
        }
      }
      if (!this.exitAt[op] && safe(op)) emit(op, lm, nmc, t1, SHIFT, 0);
      if (sw >= 0) {
        const nlm = lm ^ (1 << sw);
        // pulling can open a door onto a watcher
        if (!this.solid(nlm)[pos] && !(banned && banned[pos]) && !(this.view(nlm, mc, t)[pos] & 6)) emit(pos, nlm, this.advance(mc, nlm), t1, LEVER, 0);
      }
    } else {
      const view = this.view(lm, nmc, t1);
      const open = (p: number) => !solid[p] && !(banned && banned[p]) && !(view[p] & 1);
      if (open(pos)) emit(pos, lm, nmc, t1, WAIT, 0);
      for (let k = 0; k < 4; k++) {
        if (stepShut[pos * 4 + k]) continue;
        const np = pos + dirs[k];
        if (!open(np)) continue;
        emit(np, lm, nmc, t1, MOVE, 0);
        // running covers two cells in a tick
        for (let k2 = 0; k2 < 4; k2++) {
          if (stepShut[np * 4 + k2]) continue;
          const np2 = np + dirs[k2];
          if (np2 !== pos && open(np2)) emit(np2, lm, nmc, t1, RUN, 0);
        }
      }
      if (!this.exitAt[op] && open(op)) emit(op, lm, nmc, t1, SHIFT, 0);
      if (sw >= 0) {
        const nlm = lm ^ (1 << sw);
        const pmc = this.advance(mc, nlm);
        if (this.ok(pos, nlm, pmc, t1, false, banned)) emit(pos, nlm, pmc, t1, LEVER, 0);
      }
    }
    if (d === 0 && this.trolls.length) {
      const cell = pos;
      const x = cell % w;
      const y = (cell - x) / w;
      for (let i = 0; i < this.trolls.length; i++) {
        const m = this.trolls[i];
        const q = this.digit(mc, m);
        if (q >= m.alive) continue;
        const p = this.pose(m, mc, lm, t, 0);
        const ax = Math.abs(Math.floor(p.x) - x);
        const ay = Math.abs(Math.floor(p.y) - y);
        if (strict ? ax + ay !== 1 : ax > 1 || ay > 1 || ax + ay === 0) continue;
        const cls = m.mover ? m.deadAt[q] : m.deadAt[t % m.period];
        let kmc = mc + (m.alive + cls - q) * m.base;
        const ticks = strict ? TAKEDOWN_TICKS : LOOSE_TAKEDOWN_TICKS;
        // the player stays where they are, and must stay unseen, until the takedown is over (strict: through each of
        // its ticks; loose: at each tick that follows)
        let seen = false;
        for (let k = strict ? 0 : 1; k <= (strict ? ticks - 1 : ticks) && !seen; k++) {
          if (!strict) kmc = this.advance(kmc, lm);
          if (!this.ok(pos, lm, kmc, (t + k) % L, strict, banned)) seen = true;
          if (strict) kmc = this.advance(kmc, lm);
        }
        if (!seen) emit(pos, lm, kmc, (t + ticks) % L, KILL, i);
      }
    }
    return n;
  }

  private buffers() {
    const m = 32 + this.trolls.length;
    // state numbers can pass 2^31 when the monster states multiply up
    return { to: new Float64Array(m), kind: new Uint8Array(m), arg: new Int32Array(m) };
  }

  private bfsBuffers() {
    return searchTables(this.stateCount);
  }

  /**
   * Breadth-first search from the start: the exit state reached first (or -1) and how each state was reached. Tables
   * indexed by state number while they fit (MAX_DENSE); beyond that only the states reached are kept, up to MAX_REACHED.
   */
  private bfs(strict: boolean, banned: Uint8Array | null): Search {
    const start = this.startState(strict ? 'strict' : 'loose');
    const { to, kind, arg } = this.buffers();
    if (this.stateCount <= MAX_DENSE) {
      const b = this.bfsBuffers();
      const found: Search = { goal: -1, parent: (s) => b.parent[s], via: (s) => b.via[s], viaArg: (s) => b.viaArg[s] };
      if (start < 0) return found;
      let head = 0;
      let tail = 0;
      b.queue[tail++] = start;
      b.stamp[start] = b.gen;
      b.parent[start] = start;
      while (head < tail) {
        const s = b.queue[head++];
        if (this.exitAt[s % this.P]) {
          found.goal = s;
          return found;
        }
        const n = this.expand(s, strict, banned, to, kind, arg);
        for (let i = 0; i < n; i++) {
          const t = to[i];
          if (b.stamp[t] === b.gen) continue;
          b.stamp[t] = b.gen;
          b.parent[t] = s;
          b.via[t] = kind[i];
          b.viaArg[t] = arg[i];
          b.queue[tail++] = t;
        }
      }
      return found;
    }
    const slot = new Map<number, number>();
    const states: number[] = [];
    const parent: number[] = [];
    const via: number[] = [];
    const viaArg: number[] = [];
    const found: Search = {
      goal: -1,
      parent: (s) => states[parent[slot.get(s)!]],
      via: (s) => via[slot.get(s)!],
      viaArg: (s) => viaArg[slot.get(s)!],
    };
    if (start < 0) return found;
    slot.set(start, 0);
    states.push(start);
    parent.push(0);
    via.push(0);
    viaArg.push(0);
    for (let head = 0; head < states.length; head++) {
      const s = states[head];
      if (this.exitAt[s % this.P]) {
        found.goal = s;
        return found;
      }
      if (states.length > MAX_REACHED) throw new StateLimit();
      const n = this.expand(s, strict, banned, to, kind, arg);
      for (let i = 0; i < n; i++) {
        const t = to[i];
        if (slot.has(t)) continue;
        slot.set(t, states.length);
        states.push(t);
        parent.push(head);
        via.push(kind[i]);
        viaArg.push(arg[i]);
      }
    }
    return found;
  }

  /** Shortest route (in ticks), as the actions taken, or null when the exit cannot be reached. */
  route(mode: Mode, banned?: Uint8Array): Action[] | null {
    const b = this.bfs(mode === 'strict', banned ?? null);
    if (b.goal < 0) return null;
    const acts: Action[] = [];
    for (let s = b.goal; b.parent(s) !== s; s = b.parent(s)) {
      const { d: dim, x, y, lm } = this.parts(s);
      const k = b.via(s);
      let a: Action;
      if (k === MOVE || k === RUN) a = { type: 'move', dim, x, y };
      else if (k === WAIT) a = { type: 'wait', dim, x, y };
      else if (k === SHIFT) a = { type: 'shift', dim, x, y };
      else if (k === LEVER) a = { type: 'lever', dim, x, y, on: !!((lm >> this.leverAt[s % this.P]) & 1) };
      else a = { type: 'kill', dim, x, y, monster: this.trolls[b.viaArg(s)].id };
      a.state = s;
      acts.push(a);
    }
    acts.reverse();
    let tick = 0;
    for (const a of acts) a.tick = tick += a.type === 'kill' ? (mode === 'strict' ? TAKEDOWN_TICKS : LOOSE_TAKEDOWN_TICKS) : 1;
    return acts;
  }

  solvable(mode: Mode, banned?: Uint8Array): boolean {
    return this.bfs(mode === 'strict', banned ?? null).goal >= 0;
  }

  /**
   * Every reachable state: how many, how many can no longer reach the exit (traps), the ways into them (trap
   * entrances: a step from a state that can still win to one that cannot, told apart by where and with which levers it
   * starts and ends, not by the clock or the monsters), and the kill edges with the troll killed and whether the exit
   * can still be reached after it (from both ends).
   */
  explore(mode: Mode): { states: number; traps: number; trapEntrances: number; kills: { s: number; troll: number; alive: boolean }[] } {
    const strict = mode === 'strict';
    const start = this.startState(mode);
    if (start < 0) return { states: 0, traps: 0, trapEntrances: 0, kills: [] };
    // state number → index among the reached: in the shared tables while they fit, else a map
    const dense = this.stateCount <= MAX_DENSE;
    const tb = dense ? this.bfsBuffers() : null;
    const map = dense ? null : new Map<number, number>();
    const indexOf = (s: number) => (tb ? (tb.stamp[s] === tb.gen ? tb.parent[s] : -1) : (map!.get(s) ?? -1));
    const reached = new Grow(Float64Array);
    const edges = new Grow(Int32Array);
    const killEdges: number[] = [];
    const add = (s: number) => {
      const i = reached.length;
      if (i > MAX_REACHED) throw new StateLimit();
      if (tb) {
        tb.stamp[s] = tb.gen;
        tb.parent[s] = i;
      } else map!.set(s, i);
      reached.push(s);
      return i;
    };
    const { to, kind, arg } = this.buffers();
    add(start);
    const stack = new Grow(Int32Array);
    stack.push(0);
    while (stack.length) {
      const si = stack.pop();
      const n = this.expand(reached.at(si), strict, null, to, kind, arg);
      for (let i = 0; i < n; i++) {
        let ti = indexOf(to[i]);
        if (ti < 0) {
          ti = add(to[i]);
          stack.push(ti);
        }
        edges.push(si);
        edges.push(ti);
        if (kind[i] === KILL) killEdges.push(si, ti, arg[i]);
      }
    }
    // alive: can reach the exit; walk the edges backwards from the exits
    const N = reached.length;
    const E = edges.length / 2;
    const start2 = new Int32Array(N + 1);
    for (let e = 0; e < E; e++) start2[edges.at(2 * e + 1) + 1]++;
    for (let i = 0; i < N; i++) start2[i + 1] += start2[i];
    const fill = start2.slice(0, N);
    const from = new Int32Array(E);
    for (let e = 0; e < E; e++) from[fill[edges.at(2 * e + 1)]++] = edges.at(2 * e);
    const alive = new Uint8Array(N);
    const q = new Int32Array(N);
    let qn = 0;
    for (let i = 0; i < N; i++) if (this.exitAt[reached.at(i) % this.P]) {
      alive[i] = 1;
      q[qn++] = i;
    }
    while (qn) {
      const i = q[--qn];
      for (let e = start2[i]; e < start2[i + 1]; e++) if (!alive[from[e]]) {
        alive[from[e]] = 1;
        q[qn++] = from[e];
      }
    }
    let traps = 0;
    for (let i = 0; i < N; i++) if (!alive[i]) traps++;
    const PL = this.P * this.LM;
    const place = (s: number) => (Math.floor(s / this.P) % this.LM) * this.P + (s % this.P);
    const entrances = new Set<number>();
    for (let e = 0; e < E; e++) {
      const a = edges.at(2 * e);
      const b = edges.at(2 * e + 1);
      if (alive[a] && !alive[b]) entrances.add(place(reached.at(a)) * PL + place(reached.at(b)));
    }
    const kills: { s: number; troll: number; alive: boolean }[] = [];
    for (let k = 0; k < killEdges.length; k += 3)
      kills.push({ s: reached.at(killEdges[k]), troll: killEdges[k + 2], alive: !!(alive[killEdges[k]] && alive[killEdges[k + 1]]) });
    return { states: N, traps, trapEntrances: entrances.size, kills };
  }
}

/** Hands out zeroed pieces of big blocks. */
class Slab<A extends Uint8Array | Uint16Array> {
  private block: A | null = null;
  private used = 0;

  constructor(private readonly make: new (n: number) => A) {}

  take(n: number): A {
    if (!this.block || this.used + n > this.block.length) {
      this.block = new this.make(Math.max(n, 1 << 15));
      this.used = 0;
    }
    const piece = this.block.subarray(this.used, this.used + n) as A;
    this.used += n;
    return piece;
  }
}

/** A growable typed array. */
class Grow<A extends Int32Array | Float64Array> {
  private data: A;
  length = 0;

  constructor(private readonly make: new (n: number) => A) {
    this.data = new make(1024);
  }

  push(v: number): void {
    if (this.length === this.data.length) {
      const bigger = new this.make(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    this.data[this.length++] = v;
  }

  pop(): number {
    return this.data[--this.length];
  }

  at(i: number): number {
    return this.data[i];
  }
}

/** The poses a troll can die in, to 45 degrees per cell, and which one each given pose falls in. */
function deathClasses(at: Pose[]): { deadPoses: Pose[]; deadAt: number[] } {
  const deadPoses: Pose[] = [];
  const deadAt: number[] = [];
  const classKey = new Map<string, number>();
  for (const p of at) {
    const key = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.round(p.angle / (Math.PI / 4)) & 7}`;
    let c = classKey.get(key);
    if (c === undefined) {
      c = deadPoses.length;
      classKey.set(key, c);
      deadPoses.push(p);
    }
    deadAt.push(c);
  }
  return { deadPoses, deadAt };
}

/** A patrol's state at the start of a unit: on segment `seg` at whole cell `t` from its start, walking with (+1) or
 *  against it, facing `angle`; `stopped`: it spends this unit turning to its heading, the way `sign` says. */
interface WalkState {
  seg: number;
  t: number;
  dir: number;
  stopped: boolean;
  angle: number;
  sign: number;
}

/**
 * The engine's patrol (MonsterState.update) in whole cells and whole units, at the default speed and pause: a unit
 * walks one cell or makes one turn. A corner of the ring, or the cell before one it cannot enter, makes it stop and
 * turn; an about-face swings the way that passes the map centre, as the engine's does.
 */
class Walk {
  readonly ok: boolean;
  private readonly len: number[] = [];
  private readonly ux: number[] = [];
  private readonly uy: number[] = [];
  private readonly corner: boolean[] = [];

  constructor(private readonly ring: [number, number][], private readonly centre: [number, number]) {
    const n = ring.length;
    let ok = true;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % n];
      const len = Math.abs(bx - ax) + Math.abs(by - ay);
      if (ax !== bx && ay !== by) ok = false;
      this.len.push(len);
      this.ux.push(Math.sign(bx - ax));
      this.uy.push(Math.sign(by - ay));
    }
    for (let i = 0; i < n; i++) {
      const j = (i - 1 + n) % n;
      this.corner.push(this.ux[i] !== this.ux[j] || this.uy[i] !== this.uy[j]);
    }
    this.ok = ok;
  }

  private heading(seg: number, dir: number): number {
    return Math.atan2(this.uy[seg] * dir, this.ux[seg] * dir);
  }

  private at(seg: number, t: number): [number, number] {
    return [this.ring[seg][0] + this.ux[seg] * t, this.ring[seg][1] + this.uy[seg] * t];
  }

  pose(s: WalkState): Pose {
    const [x, y] = this.at(s.seg, s.t);
    return { x, y, angle: s.angle };
  }

  start(): WalkState {
    return { seg: 0, t: 0, dir: 1, stopped: false, angle: this.heading(0, 1), sign: 1 };
  }

  key(s: WalkState): string {
    const a = Math.round(Math.atan2(Math.sin(s.angle), Math.cos(s.angle)) * 1000);
    // the swing's way only matters while it turns
    return `${s.seg},${s.t},${s.dir},${a},${s.stopped ? s.sign : 0}`;
  }

  /** Stop to turn towards the heading: the shorter way, or for an about-face the way that sweeps past the map centre. */
  private stop(s: WalkState): WalkState {
    const d = angleDiff(this.heading(s.seg, s.dir), s.angle);
    let sign = Math.sign(d) || 1;
    if (Math.abs(d) >= Math.PI - 1e-3) {
      const [x, y] = this.at(s.seg, s.t);
      const cross = Math.cos(s.angle) * (this.centre[1] - y) - Math.sin(s.angle) * (this.centre[0] - x);
      sign = cross < 0 ? -1 : 1;
    }
    return { ...s, stopped: true, sign };
  }

  /** At the end of its segment, facing out of it: onto the next segment (walking against the ring, the previous one),
   *  stopping when the node there is a corner. */
  private across(s: WalkState): WalkState {
    const n = this.ring.length;
    let v: number;
    let r: WalkState;
    if (s.dir > 0 && s.t === this.len[s.seg]) {
      v = (s.seg + 1) % n;
      r = { ...s, seg: v, t: 0 };
    } else if (s.dir < 0 && s.t === 0) {
      v = s.seg;
      const seg = (s.seg - 1 + n) % n;
      r = { ...s, seg, t: this.len[seg] };
    } else return s;
    return this.corner[v] ? this.stop(r) : r;
  }

  /** One unit from s, `blocked` saying which cells it cannot enter: the state after it and its poses (SUB + 1). */
  step(s: WalkState, blocked: (cx: number, cy: number) => boolean): { next: WalkState; poses: Pose[] } {
    if (!s.stopped) {
      // turned back on a node: it goes on along the segment there, which may be a turn of its own
      const a = this.across(s);
      if (a.stopped) return this.step(a, blocked);
      s = a;
    }
    const [x, y] = this.at(s.seg, s.t);
    const poses: Pose[] = [];
    if (s.stopped) {
      const h = this.heading(s.seg, s.dir);
      let d = angleDiff(h, s.angle);
      if (Math.abs(d) >= Math.PI - 1e-3) d = s.sign * Math.abs(d);
      for (let k = 0; k <= SUB; k++) {
        const swing = Math.min(Math.abs(d), (TUNING.monsterTurnSpeed * TICK * k) / SUB);
        poses.push({ x, y, angle: s.angle + Math.sign(d) * swing });
      }
      return { next: { ...s, stopped: false, angle: h }, poses };
    }
    const ux = this.ux[s.seg] * s.dir;
    const uy = this.uy[s.seg] * s.dir;
    // the next cell is shut: turn back here, the turn taking this unit
    if (blocked(Math.floor(x + ux), Math.floor(y + uy))) return this.step(this.stop({ ...s, dir: -s.dir }), blocked);
    const angle = this.heading(s.seg, s.dir);
    for (let k = 0; k <= SUB; k++) poses.push({ x: x + (ux * k) / SUB, y: y + (uy * k) / SUB, angle });
    return { next: this.across({ ...s, t: s.t + s.dir, angle }), poses };
  }
}

export interface Analysis {
  status: 'unique' | 'ambiguous' | 'unsolvable' | 'unsupported';
  reason?: string;
  /** The intended (strict, shortest) route. */
  route?: Action[];
  metrics?: Metrics;
}

export interface Metrics {
  moves: number;
  /** Ticks spent waiting for a monster to pass. */
  waits: number;
  /** The route only wins in the engine with its waits (set by the generator, which replays; the model leaves it unset). */
  timed?: boolean;
  shifts: number;
  /** Shifts that only carry on down a straight run of them (see straightShifts). */
  straightShifts: number;
  pulls: number;
  kills: number;
  /** Decisions (shift, pull, takedown) followed by one of another kind: the route mixes them rather than repeating one. */
  interleaves: number;
  /** Distinct lever settings the route passes through. */
  leverStates: number;
  /** Steps that come back to a (dimension, cell) the route has already stood on. */
  revisits: number;
  /** Reachable states (loose reading) from which the exit can no longer be reached: the traps. */
  traps: number;
  /** Ways into the traps (see Model.explore): the wrong moves a player can make, not the states they lead to. */
  trapEntrances: number;
  /** Reachable states in all (loose reading). */
  states: number;
  chained: number;
  /** Monsters standing still and monsters on patrol. */
  standing: number;
  patrolling: number;
  /** Patrols that walk through a door a lever drives (they turn back while it is shut). */
  throughDoors: number;
  /** Doors per lever, averaged over the levers (1 when there are none). */
  doorsPerLever: number;
  /** Walkable cells in both dimensions. */
  cells: number;
}


/** A1 + A2 in the discrete model: one way to win, and no kill on a shared cell. */
export function analyze(level: Level): Analysis {
  const m = new Model(level);
  if (m.unsupported) return { status: 'unsupported', reason: m.unsupported };
  if (m.switches > 12) return { status: 'unsupported', reason: '狀態空間過大' };
  try {
    const route = m.route('strict');
    if (!route) return { status: 'unsolvable', reason: m.solvable('loose') ? '只有靠引擎漏洞（同格、擦邊、跑步）才過得去' : '出口無法抵達' };
    return check(m, route);
  } catch (e) {
    if (e instanceof StateLimit) return { status: 'unsupported', reason: e.message };
    throw e;
  }
}

/** The uniqueness checks and metrics for a level whose strict route is already known. */
export function check(m: Model, route: Action[]): Analysis {
  const { w, h, wh } = m;
  const spawn = m.spawn!;
  const onRoute: [DimIndex, number, number][] = [[spawn.dim, spawn.x, spawn.y]];
  for (const a of route) if (a.type === 'move' || a.type === 'shift') onRoute.push([a.dim, a.x, a.y]);
  const keys = new Set(onRoute.map(([d, x, y]) => d * wh + y * w + x));
  // every cell the route stands on is a cut: banned, nothing (not even the loose reading) wins, whatever the timing
  const banned = new Uint8Array(2 * wh);
  for (const k of keys) {
    const x = k % w;
    const y = Math.floor(k / w) % h;
    const d = Math.floor(k / wh) as DimIndex;
    if ((d === spawn.dim && x === spawn.x && y === spawn.y) || m.isExit(d, x, y)) continue;
    banned[k] = 1;
    const ok = m.solvable('loose', banned);
    banned[k] = 0;
    if (ok) return { status: 'ambiguous', reason: `不經過 ${'AB'[d]}(${x},${y}) 也能贏`, route };
  }
  // every kill that still lets you win is the route's kill, made from the route's cell (at any moment)
  const routeKills = new Set(route.filter((a) => a.type === 'kill').map((a) => `${a.monster}@${a.x},${a.y}`));
  const { states, traps, trapEntrances, kills } = m.explore('loose');
  for (const { s, troll, alive } of kills) {
    if (!alive) continue;
    const { x, y } = m.parts(s);
    const id = m.trolls[troll].id;
    if (!routeKills.has(`${id}@${x},${y}`)) return { status: 'ambiguous', reason: `在 A(${x},${y}) 殺 ${id} 也能贏`, route };
  }

  const visited = new Set<string>();
  let revisits = 0;
  for (const [d, x, y] of onRoute) {
    const k = `${d},${x},${y}`;
    if (visited.has(k)) revisits++;
    visited.add(k);
  }
  const masks = new Set<number>([0]);
  let lm = 0;
  for (const a of route) if (a.type === 'lever') {
    lm ^= 1 << m.switchOf.get(m.grid.cell(a.dim, a.x, a.y))!;
    masks.add(lm);
  }
  const all = m.grid.all();
  const monsters = m.trolls.length + m.ghosts.length;
  return {
    status: 'unique',
    route,
    metrics: {
      moves: route.filter((a) => a.type === 'move').length,
      waits: route.filter((a) => a.type === 'wait').length,
      shifts: route.filter((a) => a.type === 'shift').length,
      straightShifts: straightShifts(route, spawn),
      pulls: route.filter((a) => a.type === 'lever').length,
      kills: routeKills.size,
      interleaves: interleaves(route),
      leverStates: masks.size,
      revisits,
      traps,
      trapEntrances,
      states,
      chained: all.filter((c) => m.grid.chained(c)).length,
      standing: monsters - m.patrolling,
      patrolling: m.patrolling,
      throughDoors: m.movingThroughDoors,
      doorsPerLever: m.switches
        ? m.switchChannel.reduce((s, ch) => s + all.filter((c) => c.def.behavior === 'door' && Number(c.props.channel) === ch).length, 0) / m.switches
        : 1,
      cells: all.filter((c) => c.def.solid !== 'always' || c.def.behavior === 'door').length,
    },
  };
}

/** Consecutive decisions (shift, pull, takedown; steps and waits between them do not count) of different kinds. */
export function interleaves(route: Action[]): number {
  const kinds = route.filter((a) => a.type === 'shift' || a.type === 'lever' || a.type === 'kill').map((a) => a.type);
  return kinds.filter((k, i) => i > 0 && k !== kinds[i - 1]).length;
}

/**
 * Shifts that only carry on a straight run: one or two steps after the last shift, every step between them and the
 * step after it going the same way, with no pull, wait or takedown in between. Doors alternating down one corridor
 * make such a run; its first shift counts as a shift, the rest are these.
 */
export function straightShifts(route: Action[], spawn: { x: number; y: number }): number {
  // the way each action moved the player (0, 0 for anything but a step)
  const way: [number, number][] = [];
  let x = spawn.x;
  let y = spawn.y;
  for (const a of route) {
    way.push(a.type === 'move' ? [a.x - x, a.y - y] : [0, 0]);
    x = a.x;
    y = a.y;
  }
  let n = 0;
  let last = -1;
  route.forEach((a, i) => {
    if (a.type !== 'shift') return;
    const between = route.slice(last + 1, i);
    const next = route[i + 1];
    const [dx, dy] = way[i - 1] ?? [0, 0];
    if (last >= 0 && between.length >= 1 && between.length <= 2 && (dx || dy) && next?.type === 'move'
      && between.every((b, k) => b.type === 'move' && way[last + 1 + k][0] === dx && way[last + 1 + k][1] === dy)
      && way[i + 1][0] === dx && way[i + 1][1] === dy) n++;
    last = i;
  });
  return n;
}

/** One line per action group, e.g. "走 A(2,1) A(3,1)", "等 3 拍", "拉 B(5,1) 開". */
export function describeRoute(route: Action[]): string {
  const parts: string[] = [];
  let run: string[] = [];
  let waits = 0;
  const flush = () => {
    if (run.length) parts.push(`走 ${run.join(' ')}`);
    if (waits) parts.push(`等 ${waits} 拍`);
    run = [];
    waits = 0;
  };
  for (const a of route) {
    const at = `${'AB'[a.dim]}(${a.x},${a.y})`;
    if (a.type === 'move' && !waits) {
      run.push(at);
      continue;
    }
    if (a.type === 'wait' && !run.length) {
      waits++;
      continue;
    }
    flush();
    if (a.type === 'move') run.push(at);
    else if (a.type === 'wait') waits++;
    else if (a.type === 'shift') parts.push(`轉移→${at}`);
    else if (a.type === 'lever') parts.push(`拉 ${at} ${a.on ? '開' : '關'}`);
    else parts.push(`在 ${at} 殺 ${a.monster}`);
  }
  flush();
  return parts.join('\n');
}
