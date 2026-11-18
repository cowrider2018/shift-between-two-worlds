/**
 * Read-only query layer over a Level: block lookup, solidity, line of sight, collision.
 * Shared by the simulation, solver, validator, renderer and editor.
 */
import { BLOCK_BY_CHAR, VOID, WALL, evalCondition, resolveProps, type BlockDef, type ChannelFn, type Props } from './blocks';
import { cellKey, type DimIndex, type Level } from './level';

/** Exit `dir` values: 0 up (-y), 1 right (+x), 2 down (+y), 3 left (-x). */
export const EXIT_DIRS: readonly [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export interface Cell {
  dim: DimIndex;
  x: number;
  y: number;
  def: BlockDef;
  props: Props;
}

export class LevelGrid {
  readonly w: number;
  readonly h: number;
  private readonly cells: Cell[][];

  constructor(readonly level: Level) {
    this.w = level.size.w;
    this.h = level.size.h;
    this.cells = level.dimensions.map((d, di) => {
      const arr: Cell[] = [];
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          const def = BLOCK_BY_CHAR.get(d.rows[y]?.[x] ?? '') ?? WALL;
          arr.push({ dim: di as DimIndex, x, y, def, props: resolveProps(def, d.props[cellKey(x, y)]) });
        }
      }
      return arr;
    });
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /**
   * Out-of-bounds reads behave as wall, except beyond a dug-out (void) border cell, where the void carries on: the
   * outside continues whatever the nearest border cell is, rock or nothing.
   */
  cell(dim: DimIndex, x: number, y: number): Cell {
    if (!this.inBounds(x, y)) {
      const edge = this.cells[dim][Math.min(this.h - 1, Math.max(0, y)) * this.w + Math.min(this.w - 1, Math.max(0, x))];
      return { dim, x, y, def: edge.def === VOID ? VOID : WALL, props: {} };
    }
    return this.cells[dim][y * this.w + x];
  }

  all(dim?: DimIndex): Cell[] {
    return dim === undefined ? [...this.cells[0], ...this.cells[1]] : this.cells[dim];
  }

  /** The way out of an exit cave: the offset of its one open side, from its `dir` parameter (DESIGN §3.6). */
  exitMouth(c: Cell): [number, number] {
    return EXIT_DIRS[Number(c.props.dir ?? 0)] ?? EXIT_DIRS[0];
  }

  /** An exit is rock on three sides: true when the step between neighbouring cells a and b goes through one of them. */
  walled(dim: DimIndex, ax: number, ay: number, bx: number, by: number): boolean {
    const shut = (ex: number, ey: number, ox: number, oy: number) => {
      const e = this.cell(dim, ex, ey);
      if (e.def.behavior !== 'exit') return false;
      const [dx, dy] = this.exitMouth(e);
      return ox !== ex + dx || oy !== ey + dy;
    };
    return shut(ax, ay, bx, by) || shut(bx, by, ax, ay);
  }

  /**
   * Collision for a body whose centre is in cell (fromX, fromY): solid cells, plus an exit's three rock sides. From
   * outside an exit only its mouth cell leads in; from inside it only the mouth cell leads out.
   */
  blocksMover(dim: DimIndex, x: number, y: number, channelOn: ChannelFn, fromX: number, fromY: number): boolean {
    if (this.solid(dim, x, y, channelOn)) return true;
    if (x === fromX && y === fromY) return false;
    const mouthOf = (ex: number, ey: number) => {
      const e = this.cell(dim, ex, ey);
      if (e.def.behavior !== 'exit') return null;
      const [dx, dy] = this.exitMouth(e);
      return [ex + dx, ey + dy];
    };
    const inside = mouthOf(fromX, fromY);
    if (inside) return x !== inside[0] || y !== inside[1];
    const into = mouthOf(x, y);
    return !!into && (fromX !== into[0] || fromY !== into[1]);
  }

  /** The lever at the same cell in the other dimension, if any: the two are one switch and always move together. */
  leverTwin(c: Cell): Cell | null {
    if (c.def.behavior !== 'lever') return null;
    const t = this.cell((1 - c.dim) as DimIndex, c.x, c.y);
    return t.def.behavior === 'lever' ? t : null;
  }

  private leverChannels?: Set<number>;

  /**
   * A door no lever answers to and that is not inverted never opens: it is chained shut, a permanent barrier for a
   * cell that must be walkable in the other dimension (DESIGN §3.5).
   */
  chained(c: Cell): boolean {
    if (c.def.behavior !== 'door' || c.props.inverted) return false;
    this.leverChannels ??= new Set(this.all().filter((l) => l.def.behavior === 'lever').map((l) => Number(l.props.channel)));
    return !this.leverChannels.has(Number(c.props.channel));
  }

  solid(dim: DimIndex, x: number, y: number, channelOn: ChannelFn): boolean {
    const c = this.cell(dim, x, y);
    return evalCondition(c.def.solid, c.def, c.props, channelOn);
  }

  opaque(dim: DimIndex, x: number, y: number, channelOn: ChannelFn): boolean {
    const c = this.cell(dim, x, y);
    return evalCondition(c.def.opaque, c.def, c.props, channelOn);
  }
}

/**
 * Grid DDA ray cast. Returns the distance travelled before entering a blocked cell, capped at maxDist.
 * The starting cell is never considered blocking.
 */
export function castRay(
  ox: number, oy: number, dx: number, dy: number, maxDist: number,
  blocked: (x: number, y: number) => boolean,
  /** Optional walls between cells (an exit's rock sides): blocks the step from (ax, ay) into (bx, by). */
  walled?: (ax: number, ay: number, bx: number, by: number) => boolean,
): number {
  let cx = Math.floor(ox);
  let cy = Math.floor(oy);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx > 0 ? (cx + 1 - ox) * tDeltaX : dx < 0 ? (ox - cx) * tDeltaX : Infinity;
  let tMaxY = dy > 0 ? (cy + 1 - oy) * tDeltaY : dy < 0 ? (oy - cy) * tDeltaY : Infinity;
  for (let i = 0; i < 4096; i++) {
    let t: number;
    const px = cx;
    const py = cy;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tMaxX += tDeltaX;
      cx += stepX;
    } else {
      t = tMaxY;
      tMaxY += tDeltaY;
      cy += stepY;
    }
    if (t >= maxDist) return maxDist;
    if (blocked(cx, cy) || walled?.(px, py, cx, cy)) return t;
  }
  return maxDist;
}

/**
 * Move an axis-aligned square (half-size r) through the grid, sliding along walls.
 * Cells the square already overlaps are ignored, so a door closing on the player never traps them.
 */
export function moveBox(
  x: number, y: number, dx: number, dy: number, r: number,
  solid: (cx: number, cy: number) => boolean,
): { x: number; y: number } {
  const EPS = 1e-4;
  const overlapped = new Set<string>();
  forCells(x, y, r, (cx, cy) => {
    if (solid(cx, cy)) overlapped.add(cellKey(cx, cy));
  });
  const hits = (px: number, py: number, fn: (cx: number, cy: number) => void) =>
    forCells(px, py, r, (cx, cy) => {
      if (!overlapped.has(cellKey(cx, cy)) && solid(cx, cy)) fn(cx, cy);
    });

  let nx = x + dx;
  hits(nx, y, (cx) => {
    nx = dx > 0 ? Math.min(nx, cx - r - EPS) : Math.max(nx, cx + 1 + r + EPS);
  });
  let ny = y + dy;
  hits(nx, ny, (_cx, cy) => {
    ny = dy > 0 ? Math.min(ny, cy - r - EPS) : Math.max(ny, cy + 1 + r + EPS);
  });
  return { x: nx, y: ny };
}

function forCells(x: number, y: number, r: number, fn: (cx: number, cy: number) => void): void {
  for (let cy = Math.floor(y - r); cy <= Math.floor(y + r); cy++)
    for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) fn(cx, cy);
}

export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
