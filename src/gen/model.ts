/**
 * Discrete model of a level for generation and uniqueness checks (LEVEL-PRINCIPLES B1/B2/B5).
 *
 * A state is (dimension, cell, lever switches, killed trolls). Monsters must stand still (one path point): a patrol has
 * no discrete model yet, so levels with one are reported as unsupported.
 *
 * Two readings of the same level:
 *  - strict: what the intended route may use. A monster's own cell is blocked, a cell counts as seen when any point
 *    the player's body can reach in it is seen, and a takedown is made from a 4-neighbouring cell only (A2).
 *  - loose: what a player could get away with in the engine. Monster cells are walkable (the engine has no body
 *    collision), a cell counts as seen only when all of it is, and a takedown may also come from a diagonal cell.
 *    Not from the troll's own cell: the engine allows it, but the player reached that cell from a neighbour where the
 *    same takedown was already open, so it is the same choice, not another way through. Alternatives are searched for
 *    in this reading, so any route it finds is a real risk.
 *
 * Hot paths run on typed arrays: a position is `d * w * h + y * w + x`, a state is `mask * 2wh + position` with
 * `mask = kills << switches | levers`.
 */
import { LevelGrid, angleDiff, castRay, type Cell } from '../core/grid';
import type { DimIndex, Level } from '../core/level';
import { TUNING } from '../core/sim';

export type Mode = 'strict' | 'loose';

export type Action =
  | { type: 'move'; dim: DimIndex; x: number; y: number }
  | { type: 'shift'; dim: DimIndex; x: number; y: number }
  | { type: 'lever'; dim: DimIndex; x: number; y: number; on: boolean }
  | { type: 'kill'; dim: DimIndex; x: number; y: number; monster: string };

interface Watcher {
  id: string;
  x: number;
  y: number;
  angle: number;
  radius: number;
  half: number;
}

/** A surface (A) monster: killable; dead, it watches from the same spot in the underside (B). */
interface Troll extends Watcher {
  cell: number;
}

const MOVE = 0;
const SHIFT = 1;
const LEVER = 2;
const KILL = 3;

export class Model {
  readonly grid: LevelGrid;
  readonly w: number;
  readonly h: number;
  /** Cells per dimension, and positions (both dimensions). */
  readonly wh: number;
  readonly P: number;
  readonly unsupported: string | null = null;
  /** Lever switches: a lever and its twin in the other dimension share one. */
  readonly switchOf = new Map<Cell, number>();
  readonly switchChannel: number[] = [];
  readonly trolls: Troll[] = [];
  readonly ghosts: Watcher[] = [];
  readonly spawn: Cell | null;
  readonly S: number;
  readonly K: number;
  private readonly exitAt: Uint8Array;
  /** Per position and direction (+x, -x, +y, -y): the step leaves the grid or goes through an exit's rock side. */
  private readonly stepShut: Uint8Array;
  /** Switch index of the lever on a position, -1 when none. */
  private readonly leverAt: Int8Array;
  private readonly ghostAt: Uint8Array;
  private readonly solidCache = new Map<number, Uint8Array>();
  private readonly seenCache = new Map<number, Uint8Array>();
  private readonly occCache = new Map<number, Uint8Array>();

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
    this.ghostAt = new Uint8Array(wh);
    level.dimensions.forEach((d, di) => {
      for (const m of d.monsters) {
        if (m.path.length !== 1) {
          (this as { unsupported: string | null }).unsupported = `怪物 ${m.id} 會巡邏，模型只支援站樁`;
          continue;
        }
        const [cx, cy] = m.path[0];
        const v: Watcher = {
          id: m.id, x: cx + 0.5, y: cy + 0.5, angle: (m.facing * Math.PI) / 180,
          radius: m.viewRadius * TUNING.sneakRadiusMul, half: ((m.viewAngle / 2) * Math.PI) / 180,
        };
        if (di === 0) this.trolls.push({ ...v, cell: cy * w + cx });
        else {
          this.ghosts.push(v);
          this.ghostAt[cy * w + cx] = 1;
        }
      }
    });
    this.S = this.switchChannel.length;
    this.K = this.trolls.length;
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

  get switches(): number {
    return this.S;
  }

  get stateCount(): number {
    return this.P << (this.S + this.K);
  }

  channelFn(lm: number): (ch: number) => boolean {
    return (ch) => this.switchChannel.some((c, i) => c === ch && (lm >> i) & 1);
  }

  /** Per position: solid under these lever settings. */
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

  /** Per position: a monster body stands there under these kills. */
  private occupied(km: number): Uint8Array {
    let o = this.occCache.get(km);
    if (o) return o;
    o = new Uint8Array(this.P);
    for (let c = 0; c < this.wh; c++) if (this.ghostAt[c]) o[this.wh + c] = 1;
    this.trolls.forEach((t, i) => {
      o![((km >> i) & 1 ? this.wh : 0) + t.cell] = 1;
    });
    this.occCache.set(km, o);
    return o;
  }

  /**
   * Per (levers, kills): for every position, bit 1 = every point the player's centre can take in it is seen, bit 2 =
   * some point is.
   */
  seen(lm: number, km: number): Uint8Array {
    const key = (km << this.S) | lm;
    const hit = this.seenCache.get(key);
    if (hit) return hit;
    const { w, h, wh, grid } = this;
    const ch = this.channelFn(lm);
    const solid = this.solid(lm);
    const out = new Uint8Array(this.P);
    const watchers: [DimIndex, Watcher][] = [
      ...this.trolls.map((t, i): [DimIndex, Watcher] => [(km >> i) & 1 ? 1 : 0, t]),
      ...this.ghosts.map((g): [DimIndex, Watcher] => [1, g]),
    ];
    const r = TUNING.playerHalfSize;
    const samples: [number, number][] = [[0.5, 0.5], [r, r], [1 - r, r], [r, 1 - r], [1 - r, 1 - r], [0.5, r], [0.5, 1 - r], [r, 0.5], [1 - r, 0.5]];
    const ALL = (1 << samples.length) - 1;
    // which sample points of each position some watcher sees
    const hits = new Uint16Array(this.P);
    for (const [d, m] of watchers) {
      const opaque = (cx: number, cy: number) => grid.opaque(d, cx, cy, ch);
      const walled = (ax: number, ay: number, bx: number, by: number) => grid.walled(d, ax, ay, bx, by);
      const sees = (px: number, py: number) => {
        const dx = px - m.x;
        const dy = py - m.y;
        const dist = Math.hypot(dx, dy);
        if (dist > m.radius) return false;
        const a = Math.atan2(dy, dx);
        if (Math.abs(angleDiff(a, m.angle)) > m.half) return false;
        return castRay(m.x, m.y, Math.cos(a), Math.sin(a), dist, opaque, walled) >= dist - 1e-6;
      };
      const reach = m.radius + 1.5;
      for (let y = Math.max(0, Math.floor(m.y - reach)); y < Math.min(h, m.y + reach); y++)
        for (let x = Math.max(0, Math.floor(m.x - reach)); x < Math.min(w, m.x + reach); x++) {
          const k = d * wh + y * w + x;
          if (solid[k] || hits[k] === ALL) continue;
          samples.forEach(([sx, sy], i) => {
            if (!(hits[k] & (1 << i)) && sees(x + sx, y + sy)) hits[k] |= 1 << i;
          });
        }
    }
    // loose: blocked only when nowhere in the cell is out of sight (the engine's own cell of a monster is not: its
    // centre may count as seen, the rest of the cell beside it does not). strict: blocked when anywhere is in sight.
    for (let k = 0; k < this.P; k++) if (hits[k]) out[k] = hits[k] === ALL ? 3 : 2;
    this.seenCache.set(key, out);
    return out;
  }

  isExit(d: DimIndex, x: number, y: number): boolean {
    return this.exitAt[d * this.wh + y * this.w + x] === 1;
  }

  startState(mode: Mode): number {
    const s = this.spawn;
    if (!s) return -1;
    const p = s.dim * this.wh + s.y * this.w + s.x;
    if (this.seen(0, 0)[p] & (mode === 'strict' ? 2 : 1)) return -1;
    return p;
  }

  /**
   * Successors of state s into the out arrays; returns how many. kind: 0 move, 1 shift, 2 lever, 3 kill (arg = troll).
   * `banned` marks positions the player may not enter. Unsafe successors (seen, blocked) are left out.
   */
  expand(s: number, strict: boolean, banned: Uint8Array | null, to: Int32Array, kind: Uint8Array, arg: Int32Array): number {
    const { P, wh, w } = this;
    const pos = s % P;
    const mask = (s - pos) / P;
    if (this.exitAt[pos]) return 0;
    const lm = mask & ((1 << this.S) - 1);
    const km = mask >> this.S;
    const bit = strict ? 2 : 1;
    const solid = this.solid(lm);
    const seen = this.seen(lm, km);
    const occ = strict ? this.occupied(km) : null;
    const base = mask * P;
    let n = 0;
    const d = pos >= wh ? 1 : 0;
    const cell = pos - d * wh;
    const x = cell % w;

    for (let k = 0; k < 4; k++) {
      if (this.stepShut[pos * 4 + k]) continue;
      const np = pos + (k === 0 ? 1 : k === 1 ? -1 : k === 2 ? w : -w);
      if (solid[np] || seen[np] & bit || (occ && occ[np]) || (banned && banned[np])) continue;
      to[n] = base + np;
      kind[n] = MOVE;
      n++;
    }
    const op = d ? pos - wh : pos + wh;
    if (!solid[op] && !this.exitAt[op] && !(seen[op] & bit) && !(occ && occ[op]) && !(banned && banned[op])) {
      to[n] = base + op;
      kind[n] = SHIFT;
      n++;
    }
    const sw = this.leverAt[pos];
    if (sw >= 0) {
      const nlm = lm ^ (1 << sw);
      // pulling can open a door onto a watcher
      if (!(this.seen(nlm, km)[pos] & bit)) {
        to[n] = ((km << this.S) | nlm) * P + pos;
        kind[n] = LEVER;
        n++;
      }
    }
    if (d === 0) {
      const y = (cell - x) / w;
      for (let i = 0; i < this.K; i++) {
        if ((km >> i) & 1) continue;
        const tc = this.trolls[i].cell;
        const tx = tc % w;
        const ty = (tc - tx) / w;
        const dx = tx - x;
        const dy = ty - y;
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        if (strict ? ax + ay !== 1 : ax > 1 || ay > 1 || ax + ay === 0) continue;
        // a diagonal reach needs the corner between the two cells to be open
        if (ax === 1 && ay === 1 && solid[y * w + x + dx] && solid[(y + dy) * w + x]) continue;
        const nkm = km | (1 << i);
        to[n] = ((nkm << this.S) | lm) * P + pos;
        kind[n] = KILL;
        arg[n] = i;
        n++;
      }
    }
    return n;
  }

  private buffers() {
    const m = 6 + this.K;
    return { to: new Int32Array(m), kind: new Uint8Array(m), arg: new Int32Array(m) };
  }

  /**
   * Breadth-first search from the start. Returns the exit state reached first (or -1), and the parent links when asked.
   */
  private bfs(strict: boolean, banned: Uint8Array | null, keepParents: boolean) {
    const start = this.startState(strict ? 'strict' : 'loose');
    const N = this.stateCount;
    const parent = new Int32Array(N).fill(-1);
    const via = keepParents ? new Uint8Array(N) : null;
    const viaArg = keepParents ? new Int32Array(N) : null;
    if (start < 0) return { goal: -1, parent, via, viaArg };
    const { to, kind, arg } = this.buffers();
    const queue = new Int32Array(N);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    parent[start] = start;
    while (head < tail) {
      const s = queue[head++];
      if (this.exitAt[s % this.P]) return { goal: s, parent, via, viaArg };
      const n = this.expand(s, strict, banned, to, kind, arg);
      for (let i = 0; i < n; i++) {
        const t = to[i];
        if (parent[t] >= 0) continue;
        parent[t] = s;
        if (via) {
          via[t] = kind[i];
          viaArg![t] = arg[i];
        }
        queue[tail++] = t;
      }
    }
    return { goal: -1, parent, via, viaArg };
  }

  /** Shortest route, as the actions taken, or null when the exit cannot be reached. */
  route(mode: Mode, banned?: Uint8Array): Action[] | null {
    const { goal, parent, via, viaArg } = this.bfs(mode === 'strict', banned ?? null, true);
    if (goal < 0) return null;
    const acts: Action[] = [];
    for (let s = goal; parent[s] !== s; s = parent[s]) {
      const pos = s % this.P;
      const mask = (s - pos) / this.P;
      const dim = (pos >= this.wh ? 1 : 0) as DimIndex;
      const cell = pos - dim * this.wh;
      const x = cell % this.w;
      const y = (cell - x) / this.w;
      const k = via![s];
      if (k === MOVE || k === SHIFT) acts.push({ type: k === MOVE ? 'move' : 'shift', dim, x, y });
      else if (k === LEVER) {
        const sw = this.leverAt[pos];
        acts.push({ type: 'lever', dim, x, y, on: !!((mask >> sw) & 1) });
      } else acts.push({ type: 'kill', dim, x, y, monster: this.trolls[viaArg![s]].id });
    }
    return acts.reverse();
  }

  solvable(mode: Mode, banned?: Uint8Array): boolean {
    return this.bfs(mode === 'strict', banned ?? null, false).goal >= 0;
  }

  /**
   * Every reachable state, plus which of them can still reach the exit (alive). Kill edges are returned for the
   * uniqueness check: [from, to, troll].
   */
  explore(mode: Mode): { reached: number[]; alive: Uint8Array; kills: [number, number, number][] } {
    const strict = mode === 'strict';
    const N = this.stateCount;
    const seenS = new Uint8Array(N);
    const alive = new Uint8Array(N);
    const reached: number[] = [];
    const kills: [number, number, number][] = [];
    const start = this.startState(mode);
    if (start < 0) return { reached, alive, kills };
    const { to, kind, arg } = this.buffers();
    const efrom: number[] = [];
    const eto: number[] = [];
    const stack = [start];
    seenS[start] = 1;
    while (stack.length) {
      const s = stack.pop()!;
      reached.push(s);
      const n = this.expand(s, strict, null, to, kind, arg);
      for (let i = 0; i < n; i++) {
        efrom.push(s);
        eto.push(to[i]);
        if (kind[i] === KILL) kills.push([s, to[i], arg[i]]);
        if (!seenS[to[i]]) {
          seenS[to[i]] = 1;
          stack.push(to[i]);
        }
      }
    }
    // reverse adjacency (CSR) and a backward sweep from the exits
    const deg = new Int32Array(N + 1);
    for (const t of eto) deg[t + 1]++;
    for (let i = 0; i < N; i++) deg[i + 1] += deg[i];
    const fill = deg.slice();
    const back = new Int32Array(eto.length);
    for (let i = 0; i < eto.length; i++) back[fill[eto[i]]++] = efrom[i];
    const q: number[] = [];
    for (const s of reached) if (this.exitAt[s % this.P]) {
      alive[s] = 1;
      q.push(s);
    }
    while (q.length) {
      const t = q.pop()!;
      for (let i = deg[t]; i < deg[t + 1]; i++) {
        const p = back[i];
        if (!alive[p]) {
          alive[p] = 1;
          q.push(p);
        }
      }
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
  /** Walkable cells in both dimensions. */
  cells: number;
}

/** A1 + A2 in the discrete model: one way to win, and no kill on a shared cell. */
export function analyze(level: Level): Analysis {
  const m = new Model(level);
  if (m.unsupported) return { status: 'unsupported', reason: m.unsupported };
  if (m.switches > 12 || m.stateCount > 1 << 22) return { status: 'unsupported', reason: '狀態空間過大' };
  const route = m.route('strict');
  if (!route) return { status: 'unsolvable', reason: m.solvable('loose') ? '只有靠引擎漏洞（同格、擦邊）才過得去' : '出口無法抵達' };
  return check(m, route);
}

/** The uniqueness checks and metrics for a level whose strict route is already known. */
export function check(m: Model, route: Action[]): Analysis {
  const { w, h, wh } = m;
  const spawn = m.spawn!;
  const onRoute: [DimIndex, number, number][] = [[spawn.dim, spawn.x, spawn.y]];
  for (const a of route) if (a.type === 'move' || a.type === 'shift') onRoute.push([a.dim, a.x, a.y]);
  const keys = new Set(onRoute.map(([d, x, y]) => d * wh + y * w + x));
  // every cell the route stands on is a cut: banned, nothing (not even the loose reading) wins
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
  // every kill that still lets you win is the route's kill, made from the route's cell
  const routeKills = new Set(route.filter((a) => a.type === 'kill').map((a) => `${a.monster}@${a.x},${a.y}`));
  const { reached, alive, kills } = m.explore('loose');
  for (const [s, t, i] of kills) {
    if (!alive[s] || !alive[t]) continue;
    const pos = s % m.P;
    const x = pos % w;
    const y = Math.floor(pos / w) % h;
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
  return {
    status: 'unique',
    route,
    metrics: {
      moves: route.filter((a) => a.type === 'move').length,
      shifts: route.filter((a) => a.type === 'shift').length,
      pulls: route.filter((a) => a.type === 'lever').length,
      kills: routeKills.size,
      leverStates: masks.size,
      revisits,
      traps: reached.filter((s) => !alive[s]).length,
      states: reached.length,
      chained: all.filter((c) => m.grid.chained(c)).length,
      cells: all.filter((c) => c.def.solid !== 'always' || c.def.behavior === 'door').length,
    },
  };
}

/** One line per action group, e.g. "走 A(2,1) A(3,1)", "拉 B(5,1) 開". */
export function describeRoute(route: Action[]): string {
  const parts: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) parts.push(`走 ${run.join(' ')}`);
    run = [];
  };
  for (const a of route) {
    const at = `${'AB'[a.dim]}(${a.x},${a.y})`;
    if (a.type === 'move') {
      run.push(at);
      continue;
    }
    flush();
    if (a.type === 'shift') parts.push(`轉移→${at}`);
    else if (a.type === 'lever') parts.push(`拉 ${at} ${a.on ? '開' : '關'}`);
    else parts.push(`在 ${at} 殺 ${a.monster}`);
  }
  flush();
  return parts.join('\n');
}
