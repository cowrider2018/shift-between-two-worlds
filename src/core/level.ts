/**
 * Level data model, (de)serialisation and editing helpers.
 * The on-disk format is human-readable JSON with one row per line so that diffs stay legible.
 */
import { BLOCK_BY_CHAR, FLOOR, WALL, type Props, type ParamValue } from './blocks';

export const LEVEL_FORMAT = 1;
export const DIM_IDS = ['A', 'B'] as const;
export const DIM_NAMES = ['表', '裏'] as const;
export type DimIndex = 0 | 1;

export type PatrolMode = 'pingpong' | 'loop';

export interface MonsterDef {
  id: string;
  /** Waypoints as cell coordinates. The monster starts on path[0]. */
  path: [number, number][];
  mode: PatrolMode;
  /** Tiles per second. */
  speed: number;
  /** Seconds to wait at each waypoint. */
  pause: number;
  /** Tiles. */
  viewRadius: number;
  /** Full cone angle in degrees. */
  viewAngle: number;
  /** Initial facing in degrees (0 = +x, 90 = +y); used when the path has a single point. */
  facing: number;
}

export const MONSTER_DEFAULTS: Omit<MonsterDef, 'id' | 'path'> = {
  mode: 'pingpong',
  speed: 1.6,
  pause: 0.6,
  viewRadius: 5,
  viewAngle: 70,
  facing: 0,
};

/** Editor-facing schema of monster numeric fields. */
export const MONSTER_FIELDS: { key: keyof MonsterDef; label: string; min: number; max: number; step: number }[] = [
  { key: 'speed', label: '速度（格/秒）', min: 0.2, max: 8, step: 0.1 },
  { key: 'pause', label: '停留（秒）', min: 0, max: 10, step: 0.1 },
  { key: 'viewRadius', label: '視野半徑（格）', min: 1, max: 15, step: 0.5 },
  { key: 'viewAngle', label: '視野角度（度）', min: 10, max: 360, step: 5 },
  { key: 'facing', label: '初始朝向（度）', min: 0, max: 359, step: 15 },
];

export interface DimensionData {
  rows: string[];
  /** Keyed by "x,y". Only cells whose block has params keep entries. */
  props: Record<string, Props>;
  monsters: MonsterDef[];
}

export interface Level {
  format: number;
  id: string;
  name: string;
  size: { w: number; h: number };
  dimensions: [DimensionData, DimensionData];
}

export const cellKey = (x: number, y: number): string => `${x},${y}`;

export function parseCellKey(key: string): [number, number] | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(key);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

// ---------------------------------------------------------------------------
// Construction

export function createEmptyLevel(id = 'new_level', w = 15, h = 9): Level {
  const dim = (): DimensionData => ({ rows: borderedRows(w, h), props: {}, monsters: [] });
  const level: Level = { format: LEVEL_FORMAT, id, name: '新關卡', size: { w, h }, dimensions: [dim(), dim()] };
  setCell(level, 0, 1, 1, 'S');
  return level;
}

function borderedRows(w: number, h: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) r += x === 0 || y === 0 || x === w - 1 || y === h - 1 ? WALL.char : FLOOR.char;
    rows.push(r);
  }
  return rows;
}

export function cloneLevel(level: Level): Level {
  return structuredClone(level);
}

// ---------------------------------------------------------------------------
// Editing helpers (mutate in place)

export function getChar(level: Level, dim: DimIndex, x: number, y: number): string {
  return level.dimensions[dim].rows[y]?.[x] ?? WALL.char;
}

export function setCell(level: Level, dim: DimIndex, x: number, y: number, char: string): void {
  const d = level.dimensions[dim];
  const row = d.rows[y];
  if (row === undefined || x < 0 || x >= row.length) return;
  d.rows[y] = row.slice(0, x) + char + row.slice(x + 1);
  const def = BLOCK_BY_CHAR.get(char);
  if (!def || def.params.length === 0) delete d.props[cellKey(x, y)];
}

export function setProp(level: Level, dim: DimIndex, x: number, y: number, key: string, value: ParamValue): void {
  const d = level.dimensions[dim];
  const k = cellKey(x, y);
  d.props[k] = { ...(d.props[k] ?? {}), [key]: value };
}

/** Resize keeping the top-left content; new cells become floor, outer ring is not forced. */
export function resizeLevel(level: Level, w: number, h: number): void {
  for (const d of level.dimensions) {
    const rows: string[] = [];
    for (let y = 0; y < h; y++) {
      const old = d.rows[y] ?? '';
      rows.push((old + FLOOR.char.repeat(w)).slice(0, w));
    }
    d.rows = rows;
    for (const k of Object.keys(d.props)) {
      const p = parseCellKey(k);
      if (!p || p[0] >= w || p[1] >= h) delete d.props[k];
    }
    for (const m of d.monsters) m.path = m.path.filter(([x, y]) => x < w && y < h);
    d.monsters = d.monsters.filter((m) => m.path.length > 0);
  }
  level.size = { w, h };
}

export function nextMonsterId(level: Level): string {
  const used = new Set(level.dimensions.flatMap((d) => d.monsters.map((m) => m.id)));
  for (let i = 1; ; i++) if (!used.has(`m${i}`)) return `m${i}`;
}

// ---------------------------------------------------------------------------
// Parsing (shape only — semantic checks live in validate.ts)

export interface ParseResult {
  level: Level | null;
  errors: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function parseLevel(raw: unknown): ParseResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { level: null, errors: ['關卡不是 JSON 物件'] };
  if (raw.format !== LEVEL_FORMAT) errors.push(`不支援的 format：${String(raw.format)}（需要 ${LEVEL_FORMAT}）`);
  const size = isObj(raw.size) ? raw.size : {};
  const w = num(size.w, 0);
  const h = num(size.h, 0);
  if (!(w > 0 && h > 0 && Number.isInteger(w) && Number.isInteger(h))) errors.push('size.w / size.h 必須是正整數');
  const dims = Array.isArray(raw.dimensions) ? raw.dimensions : [];
  if (dims.length !== 2) errors.push('dimensions 必須恰好有 2 個（A、B）');
  if (errors.length) return { level: null, errors };

  const parsedDims = dims.map((d, i): DimensionData => {
    const o = isObj(d) ? d : {};
    const rows = Array.isArray(o.rows) ? o.rows.map((r) => (typeof r === 'string' ? r : '')) : [];
    if (!Array.isArray(o.rows)) errors.push(`次元 ${DIM_IDS[i]}：缺少 rows`);
    const props: Record<string, Props> = {};
    if (isObj(o.props)) {
      for (const [k, v] of Object.entries(o.props)) {
        if (!isObj(v)) continue;
        const p: Props = {};
        for (const [pk, pv] of Object.entries(v)) if (typeof pv === 'number' || typeof pv === 'boolean') p[pk] = pv;
        props[k] = p;
      }
    }
    const monsters: MonsterDef[] = (Array.isArray(o.monsters) ? o.monsters : []).filter(isObj).map((m, mi) => ({
      id: typeof m.id === 'string' && m.id ? m.id : `m_${i}_${mi}`,
      path: (Array.isArray(m.path) ? m.path : [])
        .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isInteger(n)))
        .map(([x, y]) => [x, y] as [number, number]),
      mode: m.mode === 'loop' ? 'loop' : 'pingpong',
      speed: num(m.speed, MONSTER_DEFAULTS.speed),
      pause: num(m.pause, MONSTER_DEFAULTS.pause),
      viewRadius: num(m.viewRadius, MONSTER_DEFAULTS.viewRadius),
      viewAngle: num(m.viewAngle, MONSTER_DEFAULTS.viewAngle),
      facing: num(m.facing, MONSTER_DEFAULTS.facing),
    }));
    return { rows, props, monsters };
  });

  return {
    level: {
      format: LEVEL_FORMAT,
      id: typeof raw.id === 'string' ? raw.id : 'unnamed',
      name: typeof raw.name === 'string' ? raw.name : '',
      size: { w, h },
      dimensions: [parsedDims[0], parsedDims[1]],
    },
    errors,
  };
}

// ---------------------------------------------------------------------------
// Serialisation: stable key order, one row / prop / monster per line.

export function serializeLevel(level: Level): string {
  const j = JSON.stringify;
  const dimText = (d: DimensionData): string => {
    const props = Object.keys(d.props)
      .filter((k) => {
        const p = parseCellKey(k);
        const def = p ? BLOCK_BY_CHAR.get(d.rows[p[1]]?.[p[0]] ?? '') : undefined;
        return def && def.params.length > 0 && Object.keys(d.props[k]).length > 0;
      })
      .sort((a, b) => {
        const [ax, ay] = parseCellKey(a)!;
        const [bx, by] = parseCellKey(b)!;
        return ay - by || ax - bx;
      });
    const monsterLine = (m: MonsterDef) =>
      j({ id: m.id, path: m.path, mode: m.mode, speed: m.speed, pause: m.pause, viewRadius: m.viewRadius, viewAngle: m.viewAngle, facing: m.facing });
    return [
      '    {',
      '      "rows": [',
      d.rows.map((r) => `        ${j(r)}`).join(',\n'),
      '      ],',
      props.length ? `      "props": {\n${props.map((k) => `        ${j(k)}: ${j(d.props[k])}`).join(',\n')}\n      },` : '      "props": {},',
      d.monsters.length ? `      "monsters": [\n${d.monsters.map((m) => `        ${monsterLine(m)}`).join(',\n')}\n      ]` : '      "monsters": []',
      '    }',
    ].join('\n');
  };
  return [
    '{',
    `  "format": ${level.format},`,
    `  "id": ${j(level.id)},`,
    `  "name": ${j(level.name)},`,
    `  "size": ${j(level.size)},`,
    '  "dimensions": [',
    level.dimensions.map(dimText).join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}
