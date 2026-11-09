/**
 * Solvability check (DESIGN §6.4). Ignores monsters and proves the exit can be reached.
 * Breadth-first search over (dimension, cell, lever states, collected cores).
 */
import type { Cell } from './grid';
import { LevelGrid } from './grid';
import type { DimIndex } from './level';

export interface SolveResult {
  status: 'solved' | 'unsolvable' | 'skipped';
  reason?: string;
  /** Shortest number of grid moves (+ shifts + lever pulls) to win. */
  steps?: number;
  /** Cores that can be collected in at least one reachable state. */
  reachableCores: Cell[];
  unreachableCores: Cell[];
  coresTotal: number;
}

const MAX_STATES = 1 << 24;

export function solve(grid: LevelGrid): SolveResult {
  const all = grid.all();
  const levers = all.filter((c) => c.def.behavior === 'lever');
  const cores = all.filter((c) => c.def.behavior === 'core');
  const spawn = all.find((c) => c.def.behavior === 'spawn');
  const base = { reachableCores: [] as Cell[], unreachableCores: cores, coresTotal: cores.length };
  if (!spawn) return { ...base, status: 'unsolvable', reason: '沒有出生點' };

  const W = grid.w;
  const H = grid.h;
  const L = levers.length;
  const C = cores.length;
  const total = 2 * W * H * 2 ** L * 2 ** C;
  if (L > 16 || C > 8 || total > MAX_STATES) {
    return { ...base, status: 'skipped', reason: `狀態空間過大（拉桿 ${L}、核心 ${C}），略過求解` };
  }

  const leverIndex = new Map<Cell, number>(levers.map((c, i) => [c, i]));
  const coreIndex = new Map<Cell, number>(cores.map((c, i) => [c, i]));
  const popcount = (n: number) => {
    let k = 0;
    for (; n; n &= n - 1) k++;
    return k;
  };

  const channelFn = (mask: number) => (ch: number) => levers.some((c, i) => (mask >> i) & 1 && c.props.channel === ch);

  const encode = (d: number, x: number, y: number, lm: number, cm: number) => (((cm * 2 ** L + lm) * 2 + d) * H + y) * W + x;
  const visited = new Uint8Array(total);
  let queue: number[] = [];
  let next: number[] = [];

  const coresSeen = new Set<number>();
  let initCores = 0;
  const s0 = coreIndex.get(spawn);
  if (s0 !== undefined) initCores |= 1 << s0;
  const start = encode(spawn.dim, spawn.x, spawn.y, 0, initCores);
  visited[start] = 1;
  queue.push(start);

  let solvedAt = -1;
  for (let depth = 0; queue.length && solvedAt < 0; depth++) {
    for (const s of queue) {
      let r = s;
      const x = r % W; r = (r - x) / W;
      const y = r % H; r = (r - y) / H;
      const d = (r % 2) as DimIndex; r = (r - d) / 2;
      const lm = r % 2 ** L; r = (r - lm) / 2 ** L;
      const cm = r;
      const ch = channelFn(lm);
      for (let i = 0; i < C; i++) if ((cm >> i) & 1) coresSeen.add(i);

      const here = grid.cell(d, x, y);
      if (here.def.behavior === 'exit') {
        const need = Number(here.props.coresRequired) || C;
        if (popcount(cm) >= need) {
          solvedAt = depth;
          break;
        }
      }

      const push = (nd: DimIndex, nx: number, ny: number, nlm: number) => {
        let ncm = cm;
        const target = grid.cell(nd, nx, ny);
        const ci = coreIndex.get(target);
        if (ci !== undefined) ncm |= 1 << ci;
        const k = encode(nd, nx, ny, nlm, ncm);
        if (!visited[k]) {
          visited[k] = 1;
          next.push(k);
        }
      };

      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + ox;
        const ny = y + oy;
        if (grid.inBounds(nx, ny) && !grid.solid(d, nx, ny, ch)) push(d, nx, ny, lm);
      }
      if (grid.isShiftPoint(x, y)) push((1 - d) as DimIndex, x, y, lm);
      const li = leverIndex.get(here);
      if (li !== undefined) push(d, x, y, lm ^ (1 << li));
    }
    queue = next;
    next = [];
  }

  const reachableCores = cores.filter((_, i) => coresSeen.has(i));
  const unreachableCores = cores.filter((_, i) => !coresSeen.has(i));
  if (solvedAt >= 0) return { status: 'solved', steps: solvedAt, reachableCores, unreachableCores, coresTotal: C };
  return { status: 'unsolvable', reason: '出口無法在集齊所需核心後抵達', reachableCores, unreachableCores, coresTotal: C };
}
