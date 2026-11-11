/**
 * Solvability check (DESIGN §6.4). Ignores monsters and proves the exit can be reached.
 * Breadth-first search over (dimension, cell, lever states).
 */
import type { Cell } from './grid';
import { LevelGrid } from './grid';
import type { DimIndex } from './level';

export interface SolveResult {
  status: 'solved' | 'unsolvable' | 'skipped';
  reason?: string;
  /** Shortest number of grid moves (+ shifts + lever pulls) to win. */
  steps?: number;
}

const MAX_STATES = 1 << 24;

export function solve(grid: LevelGrid): SolveResult {
  const all = grid.all();
  const levers = all.filter((c) => c.def.behavior === 'lever');
  const spawn = all.find((c) => c.def.behavior === 'spawn');
  if (!spawn) return { status: 'unsolvable', reason: '沒有出生點' };

  // one switch per lever, except that a lever and its twin in the other dimension share one
  const leverIndex = new Map<Cell, number>();
  let L = 0;
  for (const c of levers) {
    if (leverIndex.has(c)) continue;
    leverIndex.set(c, L);
    const twin = grid.leverTwin(c);
    if (twin) leverIndex.set(twin, L);
    L++;
  }

  const W = grid.w;
  const H = grid.h;
  const total = 2 * W * H * 2 ** L;
  if (L > 16 || total > MAX_STATES) {
    return { status: 'skipped', reason: `狀態空間過大（拉桿 ${L}），略過求解` };
  }

  const channelFn = (mask: number) => (ch: number) => levers.some((c) => (mask >> leverIndex.get(c)!) & 1 && c.props.channel === ch);

  const encode = (d: number, x: number, y: number, lm: number) => ((lm * 2 + d) * H + y) * W + x;
  const visited = new Uint8Array(total);
  let queue: number[] = [];
  let next: number[] = [];

  const start = encode(spawn.dim, spawn.x, spawn.y, 0);
  visited[start] = 1;
  queue.push(start);

  let solvedAt = -1;
  for (let depth = 0; queue.length && solvedAt < 0; depth++) {
    for (const s of queue) {
      let r = s;
      const x = r % W; r = (r - x) / W;
      const y = r % H; r = (r - y) / H;
      const d = (r % 2) as DimIndex; r = (r - d) / 2;
      const lm = r;
      const ch = channelFn(lm);

      const here = grid.cell(d, x, y);
      if (here.def.behavior === 'exit') {
        solvedAt = depth;
        break;
      }

      const push = (nd: DimIndex, nx: number, ny: number, nlm: number) => {
        const k = encode(nd, nx, ny, nlm);
        if (!visited[k]) {
          visited[k] = 1;
          next.push(k);
        }
      };

      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + ox;
        const ny = y + oy;
        if (grid.inBounds(nx, ny) && !grid.solid(d, nx, ny, ch) && !grid.walled(d, x, y, nx, ny)) push(d, nx, ny, lm);
      }
      // shifting is allowed anywhere; landing inside a solid cell or an exit's rock is a dead end, so skip it
      const od = (1 - d) as DimIndex;
      if (!grid.solid(od, x, y, ch) && grid.cell(od, x, y).def.behavior !== 'exit') push(od, x, y, lm);
      const li = leverIndex.get(here);
      if (li !== undefined) push(d, x, y, lm ^ (1 << li));
    }
    queue = next;
    next = [];
  }

  if (solvedAt >= 0) return { status: 'solved', steps: solvedAt };
  return { status: 'unsolvable', reason: '出口無法抵達' };
}
