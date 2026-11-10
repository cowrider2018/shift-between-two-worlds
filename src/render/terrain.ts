/**
 * Rounded cobblestone terrain geometry.
 *
 * The wall mass of a dimension is the union of its wall cells. Its footprint is rounded in 2D (convex corners
 * get a CORNER-radius round, concave corners a FILLET), then the exposed top edges are bevelled with a
 * BEVEL-radius quarter round. Each wall cell emits only its own share: its top, its sides that face open
 * cells, and the fillets that belong to its corners — so neighbouring walls join without seams.
 *
 * Every surface is built as a flat, subdivided patch that is then snapped onto the rounded shape
 * (see `shape`), which keeps the meshing trivial and the joins between cells exact.
 */
import { BufferAttribute, BufferGeometry, Color } from 'three';
import type { LevelGrid } from '../core/grid';
import type { DimIndex } from '../core/level';
import { COBBLE_SPAN } from './cobbleTexture';

/** Wall height in tiles — taller than the troll so walls read as walls from the third-person camera. */
export const WALL_H = 1.6;
const BEVEL = 0.14;
const CORNER = 0.32;
const FILLET = 0.32;

type IsWall = (x: number, z: number) => boolean;
type Sdf = (x: number, z: number) => number;

/** SDF of a quadrant {u ≥ 0, v ≥ 0} whose corner is rounded with radius r (negative inside). */
function roundQuad(u: number, v: number, r: number): number {
  const qx = r - u;
  const qy = r - v;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * Footprint SDF near grid vertex (vx, vz), from the four cells that meet there. Valid within half a cell of
 * the vertex, which is all a point ever needs since it always asks its nearest vertex.
 */
function vertexSdf(isWall: IsWall, vx: number, vz: number): Sdf {
  const quads = ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz]) => ({
    sx, sz, wall: isWall(vx + (sx < 0 ? -1 : 0), vz + (sz < 0 ? -1 : 0)),
  }));
  const walls = quads.filter((q) => q.wall);
  if (walls.length === 4) return () => -1;
  if (walls.length === 0) return () => 1;
  if (walls.length === 3) {
    const o = quads.find((q) => !q.wall)!;
    return (x, z) => -roundQuad(o.sx * (x - vx), o.sz * (z - vz), FILLET);
  }
  if (walls.length === 2 && walls[0].sx === walls[1].sx) {
    const sx = walls[0].sx;
    return (x) => -sx * (x - vx);
  }
  if (walls.length === 2 && walls[0].sz === walls[1].sz) {
    const sz = walls[0].sz;
    return (_x, z) => -sz * (z - vz);
  }
  // one wall, or two touching only at this vertex: each is a convex corner
  return (x, z) => Math.min(...walls.map((w) => roundQuad(w.sx * (x - vx), w.sz * (z - vz), CORNER)));
}

interface Snapped { p: [number, number, number]; n: [number, number, number] }

class WallShape {
  private readonly cache = new Map<string, Sdf>();
  constructor(private readonly isWall: IsWall) {}

  private sdfNear(x: number, z: number): Sdf {
    const vx = Math.round(x);
    const vz = Math.round(z);
    const key = `${vx},${vz}`;
    let f = this.cache.get(key);
    if (!f) {
      f = vertexSdf(this.isWall, vx, vz);
      this.cache.set(key, f);
    }
    return f;
  }

  /**
   * Snap a point of a flat patch onto the rounded wall. `side` points lie on a vertical face and are moved
   * horizontally onto the footprint outline; `top` points lie at WALL_H and are only pulled in when outside
   * the footprint. Anything within BEVEL of the outline and above WALL_H − BEVEL lands on the top bevel.
   */
  shape(x: number, y: number, z: number, side: boolean): Snapped {
    const f = this.sdfNear(x, z);
    const s = f(x, z);
    const h = 1e-4;
    let gx = f(x + h, z) - f(x - h, z);
    let gz = f(x, z + h) - f(x, z - h);
    const gl = Math.hypot(gx, gz);
    if (gl > 0) {
      gx /= gl;
      gz /= gl;
    }
    let e = -s; // depth inside the footprint
    if (side || e < 0) {
      x -= gx * s;
      z -= gz * s;
      e = 0;
    }
    const base = WALL_H - BEVEL;
    if (e < BEVEL && y > base) {
      const dx = gx * (BEVEL - e);
      const dz = gz * (BEVEL - e);
      const dy = y - base;
      const l = Math.hypot(dx, dy, dz);
      const n: [number, number, number] = [dx / l, dy / l, dz / l];
      return { p: [x - dx + n[0] * BEVEL, base + n[1] * BEVEL, z - dz + n[2] * BEVEL], n };
    }
    return { p: [x, y, z], n: side ? [gx, 0, gz] : [0, 1, 0] };
  }
}

/** Patch breakpoints across a cell edge: fine near both ends where the rounding happens. */
const FINE: number[] = (() => {
  const out = new Set<number>([0, 1]);
  for (let k = 1; k <= 9; k++) {
    out.add(+(k * 0.05).toFixed(3));
    out.add(+(1 - k * 0.05).toFixed(3));
  }
  return [...out].sort((a, b) => a - b);
})();
const COARSE = [0, 1];
const HEIGHTS = [0, WALL_H - BEVEL, ...[1, 2, 3, 4].map((k) => WALL_H - BEVEL + (BEVEL * k) / 4)];

class MeshBuilder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];
  private readonly tmp = new Color();

  constructor(
    private readonly shape: WallShape,
    private readonly origin: [number, number],
    private readonly side: Color,
    private readonly top: Color,
  ) {}

  /** A flat nu×nv patch of pre-snap points, wound so its normal points along `out`. */
  patch(nu: number, nv: number, pre: (i: number, j: number) => [number, number, number], isSide: boolean,
    out: [number, number, number]): void {
    const base = this.pos.length / 3;
    const pts: [number, number, number][] = [];
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const q = pre(i, j);
        pts.push(q);
        const { p, n } = this.shape.shape(q[0], q[1], q[2], isSide);
        this.pos.push(p[0] - this.origin[0], p[1], p[2] - this.origin[1]);
        this.nor.push(...n);
        this.uv.push(isSide ? (q[0] + q[2]) / COBBLE_SPAN : q[0] / COBBLE_SPAN, isSide ? q[1] / COBBLE_SPAN : q[2] / COBBLE_SPAN);
        const t = Math.min(1, Math.max(0, (n[1] - 0.35) / 0.4));
        this.tmp.copy(this.side).lerp(this.top, t);
        this.col.push(this.tmp.r, this.tmp.g, this.tmp.b);
      }
    }
    // winding from the flat patch, which is never degenerate
    const a = pts[0];
    const b = pts[1];
    const d = pts[nu];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const flip = cross[0] * out[0] + cross[1] * out[1] + cross[2] * out[2] < 0;
    for (let j = 0; j < nv - 1; j++) {
      for (let i = 0; i < nu - 1; i++) {
        const p0 = base + j * nu + i;
        const p1 = p0 + 1;
        const p2 = p0 + nu + 1;
        const p3 = p0 + nu;
        if (flip) this.idx.push(p0, p2, p1, p0, p3, p2);
        else this.idx.push(p0, p1, p2, p0, p2, p3);
      }
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setIndex(this.idx);
    return g;
  }
}

/**
 * Geometry for the wall at (cx, cz), in coordinates local to the cell centre (cx + .5, 0, cz + .5).
 * Vertex colours blend `sideColor` → `topColor` by how upward each point faces.
 */
export function wallGeometry(grid: LevelGrid, dim: DimIndex, cx: number, cz: number, sideColor: string,
  topColor: string): BufferGeometry {
  const isWall: IsWall = (x, z) => grid.cell(dim, x, z).def.solid === 'always';
  const shape = new WallShape(isWall);
  const b = new MeshBuilder(shape, [cx + 0.5, cz + 0.5], new Color(sideColor), new Color(topColor));
  let exposed = false;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!isWall(cx + dx, cz + dz)) exposed = true;
  const B = exposed ? FINE : COARSE;
  const n = B.length;
  const H = HEIGHTS;

  b.patch(n, n, (i, j) => [cx + B[i], WALL_H, cz + B[j]], false, [0, 1, 0]);
  if (!isWall(cx + 1, cz)) b.patch(n, H.length, (i, j) => [cx + 1, H[j], cz + B[i]], true, [1, 0, 0]);
  if (!isWall(cx - 1, cz)) b.patch(n, H.length, (i, j) => [cx, H[j], cz + B[i]], true, [-1, 0, 0]);
  if (!isWall(cx, cz + 1)) b.patch(n, H.length, (i, j) => [cx + B[i], H[j], cz + 1], true, [0, 0, 1]);
  if (!isWall(cx, cz - 1)) b.patch(n, H.length, (i, j) => [cx + B[i], H[j], cz], true, [0, 0, -1]);

  // Fillet tops: at a corner where this wall's two neighbours are walls but the diagonal cell is open,
  // the rounded inner corner spills into that open cell; its sides come from the neighbours' faces.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    if (isWall(cx + sx, cz + sz) || !isWall(cx + sx, cz) || !isWall(cx, cz + sz)) continue;
    const vx = cx + (sx > 0 ? 1 : 0);
    const vz = cz + (sz > 0 ? 1 : 0);
    const ox = vx + sx * FILLET;
    const oz = vz + sz * FILLET;
    const steps = 9;
    b.patch(steps, 5, (i, j) => {
      const a = (i / (steps - 1)) * (Math.PI / 2);
      const c = Math.cos(a);
      const s = Math.sin(a);
      const r0 = FILLET * 0.95;
      const r1 = FILLET / Math.max(c, s);
      const r = r0 + ((r1 - r0) * j) / 4;
      return [ox - sx * c * r, WALL_H, oz - sz * s * r];
    }, false, [0, 1, 0]);
  }
  return b.build();
}

let floorGeos: BufferGeometry[] | null = null;

/** A 1×1 floor quad at y = 0 (local to the cell centre) whose UVs continue the world-space cobble pattern. */
export function floorGeometry(cx: number, cz: number): BufferGeometry {
  floorGeos ??= [0, 1, 2, 3].map((k) => {
    const ox = k & 1;
    const oz = k >> 1;
    const g = new BufferGeometry();
    const p = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5];
    const uv: number[] = [];
    for (let i = 0; i < 4; i++) uv.push((ox + p[i * 3] + 0.5) / COBBLE_SPAN, (oz + p[i * 3 + 2] + 0.5) / COBBLE_SPAN);
    g.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    return g;
  });
  return floorGeos[(cx & 1) + ((cz & 1) << 1)];
}
