/** One dimension's 2D editing canvas: drawing and hit-testing. Holds no editing logic. */
import { WALL } from '../core/blocks';
import { LevelGrid, castRay } from '../core/grid';
import { DIM_IDS, DIM_NAMES, type DimIndex, type MonsterDef } from '../core/level';
import type { Issue } from '../core/validate';
import { channelColor } from '../render/palette';

export type Selection = { kind: 'cell'; dim: DimIndex; x: number; y: number } | { kind: 'monster'; dim: DimIndex; id: string } | null;

export interface Overlays {
  souls: boolean;
  cones: boolean;
  grid: boolean;
}

export interface DrawState {
  grid: LevelGrid;
  selection: Selection;
  hover: { dim: DimIndex; x: number; y: number } | null;
  overlays: Overlays;
  issues: Issue[];
}

export class Pane {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  cell = 32;

  constructor(readonly dim: DimIndex, host: HTMLElement) {
    const wrap = document.createElement('div');
    wrap.className = `pane dim${dim}`;
    const title = document.createElement('div');
    title.className = 'pane-title';
    title.textContent = `次元 ${DIM_IDS[dim]}・${DIM_NAMES[dim]}`;
    this.canvas = document.createElement('canvas');
    wrap.append(title, this.canvas);
    host.append(wrap);
    this.ctx = this.canvas.getContext('2d')!;
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  layout(cellPx: number, w: number, h: number): void {
    this.cell = cellPx;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * cellPx * dpr);
    this.canvas.height = Math.round(h * cellPx * dpr);
    this.canvas.style.width = `${w * cellPx}px`;
    this.canvas.style.height = `${h * cellPx}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  cellAt(ev: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: Math.floor((ev.clientX - r.left) / this.cell), y: Math.floor((ev.clientY - r.top) / this.cell) };
  }

  draw(s: DrawState): void {
    const { ctx, cell: c, dim } = this;
    const g = s.grid;
    const other = (1 - dim) as DimIndex;
    ctx.clearRect(0, 0, g.w * c, g.h * c);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const selCell = s.selection?.kind === 'cell' ? g.cell(s.selection.dim, s.selection.x, s.selection.y) : null;
    const linkChannel = selCell && (selCell.def.behavior === 'lever' || selCell.def.behavior === 'door') ? Number(selCell.props.channel) : null;

    for (const cell of g.all(dim)) {
      const px = cell.x * c;
      const py = cell.y * c;
      ctx.fillStyle = cell.def.color;
      ctx.fillRect(px, py, c, c);
      if (cell.def === WALL) {
        ctx.fillStyle = '#00000030';
        ctx.fillRect(px, py + c * 0.7, c, c * 0.3);
      }
      const b = cell.def.behavior;
      if (b === 'door') {
        // the panel: a dark bar through the middle, the way the door is set
        ctx.fillStyle = '#1a162088';
        const t = Math.max(3, c * 0.12);
        if (cell.props.vertical) ctx.fillRect(px + (c - t) / 2, py + 2, t, c - 4);
        else ctx.fillRect(px + 2, py + (c - t) / 2, c - 4, t);
        if (g.chained(cell)) {
          // chained shut: a grey X over the whole cell
          ctx.strokeStyle = '#c8c8d0';
          ctx.lineWidth = Math.max(2, c * 0.07);
          ctx.beginPath();
          ctx.moveTo(px + c * 0.2, py + c * 0.2); ctx.lineTo(px + c * 0.8, py + c * 0.8);
          ctx.moveTo(px + c * 0.8, py + c * 0.2); ctx.lineTo(px + c * 0.2, py + c * 0.8);
          ctx.stroke();
        }
      }
      if (b !== 'none') {
        ctx.fillStyle = '#1a1620';
        ctx.font = `bold ${Math.round(c * 0.5)}px ui-monospace, monospace`;
        ctx.fillText(cell.def.char, px + c / 2, py + c / 2 + 1);
      }
      if (b === 'exit') {
        // the cave mouth: a bright bar along the one open side
        const [dx, dy] = g.exitMouth(cell);
        ctx.fillStyle = '#ffffff';
        const t = Math.max(3, c * 0.14);
        ctx.fillRect(px + (dx > 0 ? c - t : 0), py + (dy > 0 ? c - t : 0), dx === 0 ? c : t, dy === 0 ? c : t);
      }
      if (b === 'lever' || b === 'door') {
        const ch = Number(cell.props.channel);
        ctx.strokeStyle = channelColor(ch);
        ctx.lineWidth = Math.max(2, c * 0.08);
        ctx.strokeRect(px + 2, py + 2, c - 4, c - 4);
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.round(c * 0.28)}px ui-monospace, monospace`;
        ctx.fillText(`${ch}${cell.props.inverted ? '!' : ''}`, px + c * 0.78, py + c * 0.22);
        if (linkChannel === ch) {
          ctx.strokeStyle = '#ffffff';
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(px + 0.5, py + 0.5, c - 1, c - 1);
          ctx.setLineDash([]);
        }
      }
      if (s.overlays.grid) {
        ctx.strokeStyle = '#00000022';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, c - 1, c - 1);
      }
    }

    // issue markers
    for (const i of s.issues) {
      if (i.dim !== dim || i.x === undefined || i.y === undefined) continue;
      ctx.strokeStyle = i.severity === 'error' ? '#ff3b3b' : '#ffb020';
      ctx.lineWidth = 2;
      ctx.strokeRect(i.x * c + 3, i.y * c + 3, c - 6, c - 6);
    }

    // the other dimension's monsters (invisible in game; shown faintly here as a design aid)
    // patrols first, bodies after, so a waypoint on another monster's start never hides that monster
    const drawn = [
      ...(s.overlays.souls ? g.level.dimensions[other].monsters.map((m) => [m, true] as const) : []),
      ...g.level.dimensions[dim].monsters.map((m) => [m, false] as const),
    ];
    for (const [m, soul] of drawn) this.drawPatrol(m, s, soul);
    for (const [m, soul] of drawn) this.drawBody(m, s, soul);

    if (selCell && selCell.dim === dim) this.box(selCell.x, selCell.y, '#ffffff', 3);
    if (s.hover && s.hover.dim === dim) this.box(s.hover.x, s.hover.y, '#ffffff88', 1.5);
  }

  private box(x: number, y: number, color: string, width: number): void {
    const c = this.cell;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.strokeRect(x * c + 1, y * c + 1, c - 2, c - 2);
  }

  private monsterStyle(m: MonsterDef, s: DrawState, soul: boolean) {
    const c = this.cell;
    const selected = s.selection?.kind === 'monster' && s.selection.id === m.id;
    const center = ([x, y]: [number, number]) => [(x + 0.5) * c, (y + 0.5) * c] as const;
    const color = soul ? '#9fe8ff' : selected ? '#ffdd55' : '#ff8a3d';
    this.ctx.globalAlpha = soul ? 0.45 : 1;
    return { selected, center, color };
  }

  /** View cone, patrol line and numbered waypoints. */
  private drawPatrol(m: MonsterDef, s: DrawState, soul: boolean): void {
    const { ctx, cell: c } = this;
    if (m.path.length === 0) return;
    const { selected, center, color } = this.monsterStyle(m, s, soul);

    // view cone preview at the starting position (occluded by walls / doors closed)
    if (s.overlays.cones && !soul) {
      const [sx, sy] = m.path[0];
      const ox = sx + 0.5;
      const oy = sy + 0.5;
      const facing = m.path.length > 1 ? Math.atan2(m.path[1][1] - sy, m.path[1][0] - sx) : (m.facing * Math.PI) / 180;
      const half = ((m.viewAngle / 2) * Math.PI) / 180;
      ctx.fillStyle = '#ffffff40';
      ctx.beginPath();
      ctx.moveTo(ox * c, oy * c);
      const n = 24;
      for (let i = 0; i <= n; i++) {
        const a = facing - half + (2 * half * i) / n;
        const ray = castRay(ox, oy, Math.cos(a), Math.sin(a), m.viewRadius, (cx, cy) => s.grid.opaque(this.dim, cx, cy, () => false));
        ctx.lineTo((ox + Math.cos(a) * ray) * c, (oy + Math.sin(a) * ray) * c);
      }
      ctx.closePath();
      ctx.fill();
    }

    // patrol path
    ctx.strokeStyle = color;
    ctx.lineWidth = selected ? 3 : 2;
    if (soul) ctx.setLineDash([5, 4]);
    ctx.beginPath();
    m.path.forEach((p, i) => {
      const [x, y] = center(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (m.mode === 'loop' && m.path.length > 2) ctx.lineTo(...center(m.path[0]));
    ctx.stroke();
    ctx.setLineDash([]);

    // waypoints
    ctx.font = `bold ${Math.round(c * 0.26)}px ui-monospace, monospace`;
    m.path.forEach((p, i) => {
      if (i === 0) return;
      const [x, y] = center(p);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, c * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a1620';
      ctx.fillText(String(i), x, y + 1);
    });
    ctx.globalAlpha = 1;
  }

  /** The monster itself at its start, drawn above every patrol. */
  private drawBody(m: MonsterDef, s: DrawState, soul: boolean): void {
    const { ctx, cell: c } = this;
    if (m.path.length === 0) return;
    const { center, color } = this.monsterStyle(m, s, soul);
    const [x, y] = center(m.path[0]);
    ctx.fillStyle = soul ? '#bff6ff' : '#5b4e66';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, c * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = soul ? '#1a1620' : '#ffe066';
    ctx.font = `bold ${Math.round(c * 0.28)}px ui-monospace, monospace`;
    ctx.fillText(m.id.slice(0, 3), x, y + 1);
    ctx.globalAlpha = 1;
  }
}
