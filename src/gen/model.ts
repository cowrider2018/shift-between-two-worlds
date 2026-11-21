/**
 * Discrete model of a level for generation and uniqueness checks (LEVEL-PRINCIPLES B1/B2/B4/B5).
 *
 * Time runs in ticks of TICK seconds: one sneaking step, a wait, a shift or a pull per tick, a takedown over
 * TAKEDOWN_TICKS. A state is (position, lever switches, monster states, tick mod the level's period). Monster motion is
 * the engine's own (MonsterState stepped at the simulation's frame rate) sampled SUB times per tick, so a patrol here is
 * exactly the patrol in the game. A patrol must come back to its start in a whole number of ticks and must not cross a
 * lever-driven door; otherwise the level is unsupported.
 *
 * Monster states: a surface (A) troll is alive or dead; a dead one watches from the underside (B) in the pose it died
 * in, so a patrolling troll's death is kept as its pose class (cell and facing to 45°). Underside monsters are ghosts:
 * never killed.
 *
 * Two readings of the same level:
 *  - strict: what the intended route may use. A cell must be out of sight at every sub-step of the tick and at every
 *    point the player's body can take in it; cells a monster's body passes through are blocked; a takedown is made from
 *    a 4-neighbouring cell and the player must stay unseen for its whole length.
 *  - loose: what a player could get away with in the engine: sight checked only at the tick itself and only when all of
 *    the cell is in view, bodies walkable, running (two cells a tick), a shorter takedown, also from a diagonal cell.
 *    Alternatives are searched for in this reading, so any route it finds is a real risk.
 */
import { LevelGrid, angleDiff, castRay, type Cell } from '../core/grid';
import type { DimIndex, Level, MonsterDef } from '../core/level';
import { MonsterState, TUNING, patrolRing } from '../core/sim';
import { segmentCells } from '../core/validate';

export type Mode = 'strict' | 'loose';

/** Seconds per tick: a sneaking step (1.92 cells/s) fits in one. */
export const TICK = 0.6;
/** Sight samples per tick. */
const SUB = 4;
const FRAME = 1 / 60;
const FRAMES_PER_SUB = Math.round(TICK / SUB / FRAME);
/** Reaching the troll, the takedown itself and stepping back. */
export const TAKEDOWN_TICKS = Math.ceil((TUNING.takedownTime + 0.25) / TICK);
const LOOSE_TAKEDOWN_TICKS = Math.floor(TUNING.takedownTime / TICK);
const MAX_PERIOD = 120;

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
  /** Ticks per round of its patrol; 1 when it stands still. */
  period: number;
  /** Pose at every sub-step of one period. */
  poses: Pose[];
  /** Surface trolls: the poses it can die in (one when standing), which one each tick of the period gives, and where
   *  its state sits in the monster-state number. */
  deadPoses: Pose[];
  deadAt: number[];
  base: number;
}

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
  /** Number of monster-state values (product over trolls of 1 + their death poses). */
  readonly M: number;
  /** The level's period in ticks. */
  readonly L: number;
  private readonly LM: number;
  private readonly exitAt: Uint8Array;
  private readonly stepShut: Uint8Array;
  private readonly leverAt: Int8Array;
  private readonly solidCache = new Map<number, Uint8Array>();
  private readonly doorKeyCache = new Map<number, string[]>();
  private readonly maskCache = new Map<string, Uint16Array>();
  private readonly viewCache = new Map<number, Uint8Array>();
  private buf: { parent: Int32Array; stamp: Uint32Array; gen: number; queue: Int32Array; via: Uint8Array; viaArg: Int32Array } | null = null;

  constructor(readonly level: Level) {
    const grid = (this.grid = new LevelGrid(level));
    const w = (this.w = grid.w);
    const h = (this.h = grid.h);
    const wh = (this.wh = w * h);
    this.P = 2 * wh;
    const all = grid.all();
    this.spawn = all.find((c) => c.def.behavior === 'spawn') ?? null;
    this.leverAt = new Int8Array(this.P).fill(-1);
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
        if (di === 0) {
          mon.base = base;
          base *= 1 + mon.deadPoses.length;
          this.trolls.push(mon);
        } else this.ghosts.push(mon);
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
  private monster(def: MonsterDef, home: DimIndex): Mon | string {
    const grid = this.grid;
    const off = this.channelFn(0);
    const radius = def.viewRadius * TUNING.sneakRadiusMul;
    const half = ((def.viewAngle / 2) * Math.PI) / 180;
    const ring = patrolRing(def);
    // a door a lever drives would make the patrol depend on the levers
    for (let i = 0; i < ring.length && ring.length > 1; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      for (const [x, y] of segmentCells([a[0] - 0.5, a[1] - 0.5], [b[0] - 0.5, b[1] - 0.5])) {
        const c = grid.cell(home, x, y);
        if (c.def.behavior === 'door' && !grid.chained(c) && !(c.props.inverted && !this.switchChannel.includes(Number(c.props.channel))))
          return `怪物 ${def.id} 的巡邏穿過拉桿控制的門`;
      }
    }
    const ms = new MonsterState(def, home, [this.w / 2, this.h / 2]);
    const blocked = (cx: number, cy: number) => grid.solid(home, cx, cy, off);
    const poses: Pose[] = [];
    const total = (ring.length > 1 ? 2 * MAX_PERIOD : 1) * SUB;
    for (let i = 0; i <= total; i++) {
      poses.push({ x: ms.x, y: ms.y, angle: ms.angle });
      for (let f = 0; f < FRAMES_PER_SUB; f++) ms.update(FRAME, blocked);
    }
    let period = 1;
    if (ring.length > 1) {
      const same = (a: Pose, b: Pose) => Math.hypot(a.x - b.x, a.y - b.y) < 0.02 && Math.abs(angleDiff(a.angle, b.angle)) < 0.05;
      period = 0;
      for (let T = 1; T <= MAX_PERIOD && !period; T++) {
        let ok = true;
        for (let i = 0; i + T * SUB < poses.length && ok; i++) ok = same(poses[i], poses[i + T * SUB]);
        if (ok) period = T;
      }
      if (!period) return `怪物 ${def.id} 的巡邏週期對不上 ${TICK} 秒的時間格`;
    }
    const one = poses.slice(0, period * SUB);
    const deadPoses: Pose[] = [];
    const deadAt: number[] = [];
    const classKey = new Map<string, number>();
    for (let t = 0; t < period; t++) {
      const p = one[t * SUB];
      const key = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.round(p.angle / (Math.PI / 4)) & 7}`;
      let c = classKey.get(key);
      if (c === undefined) {
        c = deadPoses.length;
        classKey.set(key, c);
        deadPoses.push(p);
      }
      deadAt.push(c);
    }
    return { id: def.id, home, radius, half, period, poses: one, deadPoses, deadAt, base: 0 };
  }

  get switches(): number {
    return this.S;
  }

  get stateCount(): number {
    return this.L * this.M * this.LM * this.P;
  }

  get patrolling(): number {
    return [...this.trolls, ...this.ghosts].filter((m) => m.period > 1).length;
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
    return (Math.floor(mc / t.base) % (1 + t.deadPoses.length)) - 1;
  }

  /** Where every monster is at tick t (and sub-step), as the gallery draws them. */
  monstersAt(mc: number, t: number, sub = 0): { id: string; dim: DimIndex; x: number; y: number; angle: number; dead: boolean }[] {
    const out: { id: string; dim: DimIndex; x: number; y: number; angle: number; dead: boolean }[] = [];
    this.trolls.forEach((m, i) => {
      const c = this.deadClass(mc, i);
      const p = c < 0 ? this.pose(m, t, sub) : m.deadPoses[c];
      out.push({ id: m.id, dim: c < 0 ? 0 : 1, ...p, dead: c >= 0 });
    });
    for (const g of this.ghosts) out.push({ id: g.id, dim: 1, ...this.pose(g, t, sub), dead: false });
    return out;
  }

  private pose(m: Mon, t: number, sub: number): Pose {
    return m.poses[((t % m.period) * SUB + sub) % m.poses.length];
  }

  private solid(lm: number): Uint8Array {
    let s = this.solidCache.get(lm);
    if (s) return s;
    s = new Uint8Array(this.P);
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
    out = new Uint16Array(wh);
    const opaque = (cx: number, cy: number) => grid.opaque(d, cx, cy, ch);
    const walled = (ax: number, ay: number, bx: number, by: number) => grid.walled(d, ax, ay, bx, by);
    const r = TUNING.playerHalfSize;
    const samples: [number, number][] = [[0.5, 0.5], [r, r], [1 - r, r], [r, 1 - r], [1 - r, 1 - r], [0.5, r], [0.5, 1 - r], [r, 0.5], [1 - r, 0.5]];
    const reach = m.radius + 1.5;
    for (let y = Math.max(0, Math.floor(p.y - reach)); y < Math.min(h, p.y + reach); y++)
      for (let x = Math.max(0, Math.floor(p.x - reach)); x < Math.min(w, p.x + reach); x++) {
        if (solid[d * wh + y * w + x]) continue;
        let bits = 0;
        samples.forEach(([sx, sy], i) => {
          const dx = x + sx - p.x;
          const dy = y + sy - p.y;
          const dist = Math.hypot(dx, dy);
          if (dist > m.radius) return;
          const a = Math.atan2(dy, dx);
          if (Math.abs(angleDiff(a, p.angle)) > m.half) return;
          if (castRay(p.x, p.y, Math.cos(a), Math.sin(a), dist, opaque, walled) >= dist - 1e-6) bits |= 1 << i;
        });
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
    const out = new Uint8Array(this.P);
    const loose = new Uint16Array(this.P);
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
          const ph = ((t % m.period) * SUB + sub) % m.poses.length;
          watch(`${m.id}|${ph}`, 0, m.poses[ph], m, sub);
          body(0, m.poses[ph]);
        }
      });
      for (const g of this.ghosts) {
        const ph = ((t % g.period) * SUB + sub) % g.poses.length;
        watch(`${g.id}|${ph}`, 1, g.poses[ph], g, sub);
        body(1, g.poses[ph]);
      }
    }
    for (let k = 0; k < this.P; k++) if (loose[k] === ALL) out[k] |= 1;
    this.viewCache.set(key, out);
    return out;
  }

  isExit(d: DimIndex, x: number, y: number): boolean {
    return this.exitAt[d * this.wh + y * this.w + x] === 1;
  }

  /** The player may be on pos through tick t (strict: also through the tick before, which they are coming in from). */
  private ok(pos: number, lm: number, mc: number, t: number, strict: boolean, banned: Uint8Array | null, from = -1): boolean {
    if (this.solid(lm)[pos] || (banned && banned[pos])) return false;
    const bad = strict ? 6 : 1;
    if (this.view(lm, mc, t)[pos] & bad) return false;
    return !(strict && from >= 0 && this.view(lm, mc, from)[pos] & bad);
  }

  startState(mode: Mode): number {
    const s = this.spawn;
    if (!s) return -1;
    const pos = s.dim * this.wh + s.y * this.w + s.x;
    return this.ok(pos, 0, 0, 0, mode === 'strict', null) ? this.state(pos, 0, 0, 0) : -1;
  }

  /** Successors of s into the out arrays; returns how many. `banned` marks positions the player may not enter. */
  expand(s: number, strict: boolean, banned: Uint8Array | null, to: Int32Array, kind: Uint8Array, arg: Int32Array): number {
    const { pos, d, x, y, lm, mc, t } = this.parts(s);
    if (this.exitAt[pos]) return 0;
    const { wh, w, L } = this;
    const t1 = (t + 1) % L;
    let n = 0;
    const push = (np: number, nlm: number, nmc: number, nt: number, k: number, a = 0) => {
      to[n] = this.state(np, nlm, nmc, nt);
      kind[n] = k;
      arg[n] = a;
      n++;
    };
    const dirs = [1, -1, w, -w];
    if (this.ok(pos, lm, mc, t1, strict, banned)) push(pos, lm, mc, t1, WAIT);
    for (let k = 0; k < 4; k++) {
      if (this.stepShut[pos * 4 + k]) continue;
      const np = pos + dirs[k];
      if (this.ok(np, lm, mc, t1, strict, banned, t)) push(np, lm, mc, t1, MOVE);
      // loose: running covers two cells in a tick
      if (!strict && !this.solid(lm)[np] && !(banned && banned[np]) && !(this.view(lm, mc, t1)[np] & 1))
        for (let k2 = 0; k2 < 4; k2++) {
          if (this.stepShut[np * 4 + k2]) continue;
          const np2 = np + dirs[k2];
          if (np2 !== pos && this.ok(np2, lm, mc, t1, false, banned)) push(np2, lm, mc, t1, RUN);
        }
    }
    const op = d ? pos - wh : pos + wh;
    if (!this.exitAt[op] && this.ok(op, lm, mc, t1, strict, banned, t)) push(op, lm, mc, t1, SHIFT);
    const sw = this.leverAt[pos];
    if (sw >= 0) {
      const nlm = lm ^ (1 << sw);
      // pulling can open a door onto a watcher
      if (this.ok(pos, nlm, mc, t1, strict, banned, t)) push(pos, nlm, mc, t1, LEVER);
    }
    if (d === 0)
      this.trolls.forEach((m, i) => {
        if (this.deadClass(mc, i) >= 0) return;
        const p = this.pose(m, t, 0);
        const ax = Math.abs(Math.floor(p.x) - x);
        const ay = Math.abs(Math.floor(p.y) - y);
        if (strict ? ax + ay !== 1 : ax > 1 || ay > 1 || ax + ay === 0) return;
        const nmc = mc + (m.deadAt[t % m.period] + 1) * m.base;
        const ticks = strict ? TAKEDOWN_TICKS : LOOSE_TAKEDOWN_TICKS;
        // the player stays where they are, and must stay unseen, until the takedown is over
        for (let k = 1; k <= ticks; k++) if (!this.ok(pos, lm, nmc, (t + k) % L, strict, banned)) return;
        push(pos, lm, nmc, (t + ticks) % L, KILL, i);
      });
    return n;
  }

  private buffers() {
    const m = 32 + this.trolls.length;
    return { to: new Int32Array(m), kind: new Uint8Array(m), arg: new Int32Array(m) };
  }

  private bfsBuffers() {
    const N = this.stateCount;
    if (!this.buf) this.buf = { parent: new Int32Array(N), stamp: new Uint32Array(N), gen: 0, queue: new Int32Array(N), via: new Uint8Array(N), viaArg: new Int32Array(N) };
    this.buf.gen++;
    return this.buf;
  }

  /** Breadth-first search from the start; the exit state reached first, or -1. */
  private bfs(strict: boolean, banned: Uint8Array | null) {
    const b = this.bfsBuffers();
    const start = this.startState(strict ? 'strict' : 'loose');
    if (start < 0) return { goal: -1, b };
    const { to, kind, arg } = this.buffers();
    let head = 0;
    let tail = 0;
    b.queue[tail++] = start;
    b.stamp[start] = b.gen;
    b.parent[start] = start;
    while (head < tail) {
      const s = b.queue[head++];
      if (this.exitAt[s % this.P]) return { goal: s, b };
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
    return { goal: -1, b };
  }

  /** Shortest route (in ticks), as the actions taken, or null when the exit cannot be reached. */
  route(mode: Mode, banned?: Uint8Array): Action[] | null {
    const { goal, b } = this.bfs(mode === 'strict', banned ?? null);
    if (goal < 0) return null;
    const acts: Action[] = [];
    for (let s = goal; b.parent[s] !== s; s = b.parent[s]) {
      const { d: dim, x, y, lm } = this.parts(s);
      const k = b.via[s];
      let a: Action;
      if (k === MOVE || k === RUN) a = { type: 'move', dim, x, y };
      else if (k === WAIT) a = { type: 'wait', dim, x, y };
      else if (k === SHIFT) a = { type: 'shift', dim, x, y };
      else if (k === LEVER) a = { type: 'lever', dim, x, y, on: !!((lm >> this.leverAt[s % this.P]) & 1) };
      else a = { type: 'kill', dim, x, y, monster: this.trolls[b.viaArg[s]].id };
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
   * Every reachable state, which of them can still reach the exit (alive), and the kill edges [from, to, troll].
   */
  explore(mode: Mode): { reached: number[]; alive: Set<number>; kills: [number, number, number][] } {
    const strict = mode === 'strict';
    const reached: number[] = [];
    const kills: [number, number, number][] = [];
    const alive = new Set<number>();
    const start = this.startState(mode);
    if (start < 0) return { reached, alive, kills };
    const index = new Map<number, number>([[start, 0]]);
    const { to, kind, arg } = this.buffers();
    const back: number[][] = [[]];
    const stack = [start];
    reached.push(start);
    while (stack.length) {
      const s = stack.pop()!;
      const si = index.get(s)!;
      const n = this.expand(s, strict, null, to, kind, arg);
      for (let i = 0; i < n; i++) {
        const t = to[i];
        if (kind[i] === KILL) kills.push([s, t, arg[i]]);
        let ti = index.get(t);
        if (ti === undefined) {
          ti = reached.length;
          index.set(t, ti);
          reached.push(t);
          back.push([]);
          stack.push(t);
        }
        back[ti].push(si);
      }
    }
    const q: number[] = [];
    reached.forEach((s, i) => {
      if (this.exitAt[s % this.P]) {
        alive.add(s);
        q.push(i);
      }
    });
    while (q.length) for (const p of back[q.pop()!]) if (!alive.has(reached[p])) {
      alive.add(reached[p]);
      q.push(p);
    }
    return { reached, alive, kills };
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
  shifts: number;
  pulls: number;
  kills: number;
  /** Distinct lever settings the route passes through. */
  leverStates: number;
  /** Steps that come back to a (dimension, cell) the route has already stood on. */
  revisits: number;
  /** Reachable states (loose reading) from which the exit can no longer be reached: the traps. */
  traps: number;
  /** Reachable states in all (loose reading). */
  states: number;
  chained: number;
  /** Monsters standing still and monsters on patrol. */
  standing: number;
  patrolling: number;
  /** Doors per lever, averaged over the levers (1 when there are none). */
  doorsPerLever: number;
  /** Walkable cells in both dimensions. */
  cells: number;
}

/** States above this are not searched (memory and time). */
const MAX_STATES = 1 << 22;

/** A1 + A2 in the discrete model: one way to win, and no kill on a shared cell. */
export function analyze(level: Level): Analysis {
  const m = new Model(level);
  if (m.unsupported) return { status: 'unsupported', reason: m.unsupported };
  if (m.switches > 12 || m.stateCount > MAX_STATES) return { status: 'unsupported', reason: '狀態空間過大' };
  const route = m.route('strict');
  if (!route) return { status: 'unsolvable', reason: m.solvable('loose') ? '只有靠引擎漏洞（同格、擦邊、跑步）才過得去' : '出口無法抵達' };
  return check(m, route);
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
  const { reached, alive, kills } = m.explore('loose');
  for (const [s, t, i] of kills) {
    if (!alive.has(s) || !alive.has(t)) continue;
    const { x, y } = m.parts(s);
    const id = m.trolls[i].id;
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
      pulls: route.filter((a) => a.type === 'lever').length,
      kills: routeKills.size,
      leverStates: masks.size,
      revisits,
      traps: reached.filter((s) => !alive.has(s)).length,
      states: reached.length,
      chained: all.filter((c) => m.grid.chained(c)).length,
      standing: monsters - m.patrolling,
      patrolling: m.patrolling,
      doorsPerLever: m.switches
        ? m.switchChannel.reduce((s, ch) => s + all.filter((c) => c.def.behavior === 'door' && Number(c.props.channel) === ch).length, 0) / m.switches
        : 1,
      cells: all.filter((c) => c.def.solid !== 'always' || c.def.behavior === 'door').length,
    },
  };
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
