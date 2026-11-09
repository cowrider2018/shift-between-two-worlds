/**
 * Level validator (DESIGN §6.4). Used by `npm run validate`, the test suite and the editor.
 */
import { BLOCKS, BLOCK_BY_CHAR, neverSolid } from './blocks';
import { LevelGrid } from './grid';
import { DIM_IDS, cellKey, parseCellKey, type DimIndex, type Level } from './level';
import { solve, type SolveResult } from './solver';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  message: string;
  dim?: DimIndex;
  x?: number;
  y?: number;
  monsterId?: string;
}

export interface ValidationReport {
  issues: Issue[];
  solve?: SolveResult;
  ok: boolean;
}

export function validateLevel(level: Level): ValidationReport {
  const issues: Issue[] = [];
  const err = (message: string, at: Partial<Issue> = {}) => issues.push({ severity: 'error', message, ...at });
  const warn = (message: string, at: Partial<Issue> = {}) => issues.push({ severity: 'warning', message, ...at });
  const where = (d: DimIndex, x: number, y: number) => `${DIM_IDS[d]}(${x},${y})`;
  const { w, h } = level.size;

  if (!/^[a-z0-9_-]+$/i.test(level.id)) err(`id「${level.id}」只能用英數、底線、連字號`);

  // --- structure
  level.dimensions.forEach((d, di) => {
    const dim = di as DimIndex;
    if (d.rows.length !== h) err(`次元 ${DIM_IDS[dim]}：有 ${d.rows.length} 列，應為 ${h}`, { dim });
    d.rows.forEach((row, y) => {
      if (row.length !== w) err(`次元 ${DIM_IDS[dim]} 第 ${y} 列長度 ${row.length}，應為 ${w}`, { dim, y });
      [...row].forEach((ch, x) => {
        if (!BLOCK_BY_CHAR.has(ch)) err(`${where(dim, x, y)} 未知方塊字元「${ch}」`, { dim, x, y });
      });
    });
    for (const [k, props] of Object.entries(d.props)) {
      const p = parseCellKey(k);
      if (!p) {
        err(`次元 ${DIM_IDS[dim]} props 鍵「${k}」格式錯誤`, { dim });
        continue;
      }
      const [x, y] = p;
      const def = BLOCK_BY_CHAR.get(d.rows[y]?.[x] ?? '');
      if (!def || def.params.length === 0) {
        warn(`${where(dim, x, y)} 有參數但方塊沒有參數欄位，存檔時會被丟棄`, { dim, x, y });
        continue;
      }
      for (const [key, v] of Object.entries(props)) {
        const schema = def.params.find((s) => s.key === key);
        if (!schema) warn(`${where(dim, x, y)} ${def.label} 沒有參數「${key}」`, { dim, x, y });
        else if (schema.type === 'int' && (typeof v !== 'number' || !Number.isInteger(v) || v < schema.min || v > schema.max))
          err(`${where(dim, x, y)} ${schema.label} 必須是 ${schema.min}~${schema.max} 的整數`, { dim, x, y });
        else if (schema.type === 'bool' && typeof v !== 'boolean') err(`${where(dim, x, y)} ${schema.label} 必須是布林值`, { dim, x, y });
      }
    }
  });
  if (issues.some((i) => i.severity === 'error')) return { issues, ok: false };

  const grid = new LevelGrid(level);
  const cells = grid.all();

  // --- per-block counts
  for (const def of BLOCKS) {
    if (!def.count) continue;
    const n = cells.filter((c) => c.def === def).length;
    if (def.count.min !== undefined && n < def.count.min) err(`${def.label} 至少需要 ${def.count.min} 個（目前 ${n}）`);
    if (def.count.max !== undefined && n > def.count.max) err(`${def.label} 最多 ${def.count.max} 個（目前 ${n}）`);
  }

  // --- channels
  const levers = cells.filter((c) => c.def.behavior === 'lever');
  const doors = cells.filter((c) => c.def.behavior === 'door');
  for (const door of doors) {
    const src = levers.filter((l) => l.props.channel === door.props.channel);
    const at = { dim: door.dim, x: door.x, y: door.y };
    if (src.length === 0) {
      if (door.props.inverted) warn(`${where(door.dim, door.x, door.y)} 反相門沒有拉桿，永遠開著`, at);
      else err(`${where(door.dim, door.x, door.y)} 門（頻道 ${door.props.channel}）沒有任何拉桿，永遠打不開`, at);
    } else if (src.every((l) => l.dim === door.dim)) {
      warn(`${where(door.dim, door.x, door.y)} 門的拉桿都在同一次元（原則上應跨次元）`, at);
    }
  }
  for (const l of levers) {
    if (!doors.some((d) => d.props.channel === l.props.channel))
      warn(`${where(l.dim, l.x, l.y)} 拉桿（頻道 ${l.props.channel}）沒有控制任何門`, { dim: l.dim, x: l.x, y: l.y });
  }

  // --- monsters
  const ids = new Set<string>();
  level.dimensions.forEach((d, di) => {
    const dim = di as DimIndex;
    for (const m of d.monsters) {
      const at = { dim, monsterId: m.id };
      if (ids.has(m.id)) err(`怪物 id「${m.id}」重複`, at);
      ids.add(m.id);
      if (m.path.length === 0) {
        err(`怪物 ${m.id} 沒有任何路徑點`, at);
        continue;
      }
      if (!(m.speed > 0)) err(`怪物 ${m.id} 速度必須 > 0`, at);
      if (!(m.viewRadius > 0)) err(`怪物 ${m.id} 視野半徑必須 > 0`, at);
      if (!(m.viewAngle > 0 && m.viewAngle <= 360)) err(`怪物 ${m.id} 視野角度必須在 (0, 360]`, at);
      m.path.forEach(([x, y], i) => {
        if (!grid.inBounds(x, y)) err(`怪物 ${m.id} 第 ${i} 個路徑點 (${x},${y}) 超出範圍`, at);
        else if (!neverSolid(grid.cell(dim, x, y).def)) err(`怪物 ${m.id} 路徑點 ${where(dim, x, y)} 不在可走格上`, { ...at, x, y });
      });
      const segs = m.path.map((p, i) => [p, m.path[i + 1]] as const).slice(0, -1);
      if (m.mode === 'loop' && m.path.length > 2) segs.push([m.path[m.path.length - 1], m.path[0]]);
      for (const [a, b] of segs) {
        const blocked = segmentCells(a, b).find(([x, y]) => !neverSolid(grid.cell(dim, x, y).def));
        if (blocked) err(`怪物 ${m.id} 的路徑 (${a}) → (${b}) 穿過 ${where(dim, blocked[0], blocked[1])}`, { ...at, x: blocked[0], y: blocked[1] });
      }
    }
  });

  // --- shifting
  let shiftPoints = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grid.isShiftPoint(x, y)) shiftPoints++;
  if (shiftPoints === 0) warn('沒有任何兩側皆為錨點的格子，玩家無法轉移次元');

  // --- exit requirement
  const coreCount = cells.filter((c) => c.def.behavior === 'core').length;
  for (const e of cells.filter((c) => c.def.behavior === 'exit')) {
    if (Number(e.props.coresRequired) > coreCount)
      err(`${where(e.dim, e.x, e.y)} 出口需要 ${e.props.coresRequired} 顆核心，但全關只有 ${coreCount} 顆`, { dim: e.dim, x: e.x, y: e.y });
  }

  if (issues.some((i) => i.severity === 'error')) return { issues, ok: false };

  // --- solvability
  const result = solve(grid);
  if (result.status === 'unsolvable') err(`無解：${result.reason}`);
  else if (result.status === 'skipped') warn(result.reason ?? '略過求解');
  else issues.push({ severity: 'info', message: `可解（最短 ${result.steps} 步，不計怪物）` });
  for (const c of result.unreachableCores) warn(`${where(c.dim, c.x, c.y)} 核心無法取得`, { dim: c.dim, x: c.x, y: c.y });

  return { issues, solve: result, ok: !issues.some((i) => i.severity === 'error') };
}

/** Cells touched by the segment between two cell centres (supersampled). */
export function segmentCells(a: readonly [number, number], b: readonly [number, number]): [number, number][] {
  const out = new Map<string, [number, number]>();
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 8));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.floor(a[0] + 0.5 + (b[0] - a[0]) * t);
    const y = Math.floor(a[1] + 0.5 + (b[1] - a[1]) * t);
    out.set(cellKey(x, y), [x, y]);
  }
  return [...out.values()];
}
