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
import { TUNING } from '../core/sim';
import { COBBLE_SPAN } from './cobbleTexture';

/** Wall height in tiles — taller than the troll so walls read as walls from the third-person camera. */
export const WALL_H = 1.6;
const BEVEL = 0.14;
const CORNER = 0.32;
const FILLET = 0.32;

/**
 * Height of the outermost walls (rock on the grid border, and the ring just outside it): tall enough that their
 * top never shows. Measured: the highest point on them any camera pose sees before the fog (far = 20) hides it
 * is 7.37 tiles (level01, 8° pitch, hero in a corner); rounded up to 8, plus 2 to spare. (The top frustum edge
 * at the lowest pitch reaches about 9 at fog depth, so this holds for bigger levels too.)
 */
export const OUTER_H = 10;

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
  /** `height` may vary over the footprint (see wallGeometry): the top, and its bevel, are taken where each point is. */
  constructor(private readonly isWall: IsWall, private readonly height: number | Sdf = WALL_H) {}

  /** Signed distance to the footprint outline (negative inside). */
  sdf(x: number, z: number): number {
    return this.sdfNear(x, z)(x, z);
  }

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

  /** Where (x, z) lands when pushed out of the footprint onto its outline (unmoved when already outside), and
   *  whether it had to move. */
  pushOut(x: number, z: number): [number, number, boolean] {
    const f = this.sdfNear(x, z);
    const s = f(x, z);
    if (s >= 0) return [x, z, false];
    const h = 1e-4;
    let gx = f(x + h, z) - f(x - h, z);
    let gz = f(x, z + h) - f(x, z - h);
    const gl = Math.hypot(gx, gz);
    if (gl === 0) return [x, z, true];
    gx /= gl;
    gz /= gl;
    return [x - gx * s, z - gz * s, true];
  }

  /**
   * Snap a point of a flat patch onto the rounded wall. `side` points lie on a vertical face and are moved
   * horizontally onto the footprint outline; `top` points lie at the wall's height and are only pulled in when outside
   * the footprint. Anything within BEVEL of the outline and above height − BEVEL lands on the top bevel.
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
    const base = (typeof this.height === 'number' ? this.height : this.height(x, z)) - BEVEL;
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
/** Rows of a side face from `from` up to a bevelled top at `top`. */
const faceHeights = (from: number, top: number) => [from, top - BEVEL, ...[1, 2, 3, 4].map((k) => top - BEVEL + (BEVEL * k) / 4)];
const HEIGHTS = faceHeights(0, WALL_H);

interface RawVertex { p: [number, number, number]; n: [number, number, number]; uv: [number, number]; c: Color; w?: number }

class MeshBuilder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  /** Per-vertex 0..1 blend to pure white light (the cave; see materials.ts `whitening`). */
  readonly white: number[] = [];
  readonly idx: number[] = [];
  private readonly tmp = new Color();

  /**
   * `buried`, when given, tells which (x, z) lie inside some taller rock (on its outline included): the cells of a
   * top patch with all four corners buried are left out, so nothing is drawn inside the cliff for the camera hole
   * to uncover.
   */
  constructor(
    readonly shape: WallShape,
    private readonly origin: [number, number],
    private readonly side: Color,
    private readonly top: Color,
    private readonly buried?: (x: number, z: number) => boolean,
  ) {}

  /** A flat nu×nv patch of pre-snap points, wound so its normal points along `out`. */
  patch(nu: number, nv: number, pre: (i: number, j: number) => [number, number, number], isSide: boolean,
    out: [number, number, number]): void {
    const base = this.pos.length / 3;
    const pts: [number, number, number][] = [];
    const hid: boolean[] = [];
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const q = pre(i, j);
        pts.push(q);
        const { p, n } = this.shape.shape(q[0], q[1], q[2], isSide);
        hid.push(!isSide && !!this.buried?.(p[0], p[2]));
        this.pos.push(p[0] - this.origin[0], p[1], p[2] - this.origin[1]);
        this.nor.push(...n);
        this.uv.push(isSide ? (q[0] + q[2]) / COBBLE_SPAN : q[0] / COBBLE_SPAN, isSide ? q[1] / COBBLE_SPAN : q[2] / COBBLE_SPAN);
        const t = Math.min(1, Math.max(0, (n[1] - 0.35) / 0.4));
        this.tmp.copy(this.side).lerp(this.top, t);
        this.col.push(this.tmp.r, this.tmp.g, this.tmp.b);
        this.white.push(0);
      }
    }
    this.wind(base, nu, nv, pts, out, hid);
  }

  /** Index a grid of vertices, with the winding taken from its (never degenerate) first cell; cells whose four
   *  corners are all `hid` are skipped. */
  private wind(base: number, nu: number, nv: number, pts: [number, number, number][], out: [number, number, number],
    hid?: boolean[]): void {
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
        if (hid && hid[p0 - base] && hid[p1 - base] && hid[p2 - base] && hid[p3 - base]) continue;
        if (flip) this.idx.push(p0, p2, p1, p0, p3, p2);
        else this.idx.push(p0, p1, p2, p0, p2, p3);
      }
    }
  }

  /** A nu×nv patch of finished vertices (no snapping), wound so its normal points along `out`. */
  raw(nu: number, nv: number, vtx: (i: number, j: number) => RawVertex, out: [number, number, number]): void {
    const base = this.pos.length / 3;
    const pts: [number, number, number][] = [];
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const v = vtx(i, j);
        pts.push(v.p);
        this.pos.push(v.p[0] - this.origin[0], v.p[1], v.p[2] - this.origin[1]);
        this.nor.push(...v.n);
        this.uv.push(...v.uv);
        this.col.push(v.c.r, v.c.g, v.c.b);
        this.white.push(v.w ?? 0);
      }
    }
    this.wind(base, nu, nv, pts, out);
  }

  /** Snap a face point onto the rounded wall (exposed for the cave, which starts from the snapped face). */
  snap(x: number, y: number, z: number): [number, number, number] {
    return this.shape.shape(x, y, z, true).p;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('whiten', new BufferAttribute(new Float32Array(this.white), 1));
    g.setIndex(this.idx);
    return g;
  }
}

/**
 * The exit cave, in face coordinates: u runs 0..1 along the open face, y up, d into the rock. The mouth is a
 * round-topped arch; the tunnel behind it is CAVE.depth deep and fades to white light from CAVE.fadeFrom inwards.
 */
export const CAVE = { half: 0.3, spring: 0.55, depth: TUNING.caveDepth, fadeFrom: TUNING.caveDepth / 2, margin: 0.07, lintel: 0.1 };
const CAVE_DEPTHS = [0, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8];

/** How far towards white the cave is at depth d: none to fadeFrom, then a smoothstep up to white at the end
 *  (no visible line). */
export function caveWhite(d: number): number {
  const u = Math.min(1, Math.max(0, (d - CAVE.fadeFrom) / (CAVE.depth - CAVE.fadeFrom)));
  return u * u * (3 - 2 * u);
}

const WHITE = new Color('#ffffff');

/** Open side of a cave and the colour of its floor. */
export interface CaveMouth { dx: number; dz: number; floor: string }

/** Shared layout of a cave mouth: the face point at (u, y), the arch's edges and the angles along its curve. */
function caveLayout(cx: number, cz: number, m: CaveMouth) {
  const face = (u: number, y: number): [number, number, number] =>
    m.dx > 0 ? [cx + 1, y, cz + u] : m.dx < 0 ? [cx, y, cz + u] : m.dz > 0 ? [cx + u, y, cz + 1] : [cx + u, y, cz];
  const { half: r, spring, margin, lintel } = CAVE;
  const a0 = 0.5 - r;
  const a1 = 0.5 + r;
  const o0 = a0 - margin; // the face is cut into strips round a rectangle a little larger than the arch
  const o1 = a1 + margin;
  const top = spring + r + lintel;
  const corner = Math.atan2(top - spring, o1 - 0.5);
  const TH = [...new Set([...Array.from({ length: 13 }, (_, k) => (Math.PI * k) / 12), corner, Math.PI - corner])]
    .sort((x, y) => x - y);
  return { face, out: [m.dx, 0, m.dz] as [number, number, number], r, spring, a0, a1, o0, o1, top, TH };
}

/** The open face of a cave cell, cut round the arch (snapped onto the rounded wall like any other face). */
function caveFace(b: MeshBuilder, cx: number, cz: number, m: CaveMouth, HEIGHTS: number[]): void {
  const { face, out, r, spring, a0, a1, o0, o1, top, TH } = caveLayout(cx, cz, m);
  const span = (lo: number, hi: number) => [lo, ...FINE.filter((v) => v > lo + 1e-3 && v < hi - 1e-3), hi];
  const lift = HEIGHTS.filter((h) => h > top);

  // the face round the opening: full-height strips either side, a lintel above, thin jambs, and the
  // ring between the arch and the rectangle
  for (const [lo, hi] of [[0, o0], [o1, 1]]) {
    const U = span(lo, hi);
    b.patch(U.length, HEIGHTS.length, (i, j) => face(U[i], HEIGHTS[j]), true, out);
  }
  const UL = span(o0, o1);
  const HL = [top, ...lift];
  b.patch(UL.length, HL.length, (i, j) => face(UL[i], HL[j]), true, out);
  for (const [lo, hi] of [[o0, a0], [a1, o1]]) b.patch(2, 2, (i, j) => face(i ? hi : lo, j * spring), true, out);
  const ring = (k: number, outer: boolean): [number, number] => {
    const c = Math.cos(TH[k]);
    const s = Math.sin(TH[k]);
    const t = outer ? Math.min(Math.abs(c) > 1e-6 ? (o1 - 0.5) / Math.abs(c) : Infinity, s > 1e-6 ? (top - spring) / s : Infinity) : r;
    return [0.5 + c * t, spring + s * t];
  };
  b.patch(TH.length, 2, (i, j) => face(...ring(i, j === 1)), true, out);
}

/**
 * The tunnel behind a cave mouth, in coordinates local to the cell centre: walls and vault along the arch, and
 * the floor, whitening with depth. A separate mesh from the rock so the rock's shadow does not fill it.
 */
export function caveGeometry(grid: LevelGrid, dim: DimIndex, cx: number, cz: number, sideColor: string,
  m: CaveMouth): BufferGeometry {
  const b = new MeshBuilder(new WallShape((x, z) => isRock(grid, dim, x, z)), [cx + 0.5, cz + 0.5], new Color(), new Color());
  const side = new Color(sideColor);
  const floor = new Color(m.floor);
  const { face, out, r, spring, a0, a1, TH } = caveLayout(cx, cz, m);

  // the tunnel: walls and vault along the arch profile, then the floor, both whitening with depth
  const prof: { u: number; y: number; n: [number, number] }[] = [
    { u: a0, y: 0, n: [1, 0] },
    { u: a0, y: spring, n: [1, 0] },
    ...TH.slice().reverse().map((th) => ({ u: 0.5 + Math.cos(th) * r, y: spring + Math.sin(th) * r, n: [-Math.cos(th), -Math.sin(th)] as [number, number] })),
    { u: a1, y: spring, n: [-1, 0] },
    { u: a1, y: 0, n: [-1, 0] },
  ];
  const along: [number, number] = m.dx !== 0 ? [0, 1] : [1, 0]; // world xz direction of +u
  const tmp = new Color();
  const at = (u: number, y: number, d: number): [number, number, number] => {
    const p = b.snap(...face(u, y));
    return [p[0] - out[0] * d, p[1], p[2] - out[2] * d];
  };
  b.raw(prof.length, CAVE_DEPTHS.length, (i, j) => {
    const q = prof[i];
    const d = CAVE_DEPTHS[j];
    const p = at(q.u, q.y, d);
    return {
      p,
      n: [along[0] * q.n[0], q.n[1], along[1] * q.n[0]],
      uv: [(p[0] + p[2] + d) / COBBLE_SPAN, p[1] / COBBLE_SPAN],
      c: tmp.copy(side).lerp(WHITE, caveWhite(d)).clone(),
      w: caveWhite(d),
    };
  }, [along[0], 0, along[1]]); // the first strip is the left jamb, facing across the tunnel
  b.raw(2, CAVE_DEPTHS.length, (i, j) => {
    const d = CAVE_DEPTHS[j];
    const p = at(i ? a1 : a0, 0, d);
    p[1] = 0.002;
    return { p, n: [0, 1, 0], uv: [p[0] / COBBLE_SPAN, p[2] / COBBLE_SPAN], c: tmp.copy(floor).lerp(WHITE, caveWhite(d)).clone(), w: caveWhite(d) };
  }, [0, 1, 0]);
  // the end wall, closing the tunnel on the same ring of points (no separate board, so no seam): white
  const end = CAVE.depth;
  const mid = at(0.5, spring * 0.6, end);
  const loop = [...prof, prof[0]]; // round the whole outline, floor edge included
  b.raw(loop.length, 2, (i, j) => {
    const p = j ? mid : at(loop[i].u, loop[i].y, end);
    return { p, n: out, uv: [(p[0] + p[2]) / COBBLE_SPAN, p[1] / COBBLE_SPAN], c: WHITE.clone(), w: 1 };
  }, out);
  return b.build();
}

/** Cells drawn as part of the rock mass: walls, and the exit, which is a small cave cut into the rock. A dug-out
 *  (void) cell is nothing at all. */
function isRock(grid: LevelGrid, dim: DimIndex, x: number, z: number): boolean {
  const def = grid.cell(dim, x, z).def;
  return def.behavior === 'exit' || (def.solid === 'always' && def.behavior !== 'void');
}

const isVoid = (grid: LevelGrid, dim: DimIndex, x: number, z: number) => grid.cell(dim, x, z).def.behavior === 'void';

/**
 * The outermost rock, raised to OUTER_H: rock on the grid border, everything outside the grid, and rock bordering
 * a dug-out (void) cell, side or corner, so a level of any outline is ringed by the cliff.
 */
export function isOuterRock(grid: LevelGrid, dim: DimIndex, x: number, z: number): boolean {
  if (!isRock(grid, dim, x, z)) return false;
  if (x <= 0 || z <= 0 || x >= grid.w - 1 || z >= grid.h - 1) return true;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (isVoid(grid, dim, x + dx, z + dz)) return true;
  return false;
}

/** Rounded inner-corner tops at height y: where this wall's two neighbours are walls but the diagonal cell is
 *  open, the corner spills into that open cell; its sides come from the neighbours' faces. */
function fillets(b: MeshBuilder, isWall: IsWall, cx: number, cz: number, y: number): void {
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
      return [ox - sx * c * r, y, oz - sz * s * r];
    }, false, [0, 1, 0]);
  }
}

/**
 * Geometry for the wall at (cx, cz), in coordinates local to the cell centre (cx + .5, 0, cz + .5).
 * Also used for the exit cell, whose cave mouth is added on top (blockModels.ts).
 * Vertex colours blend `sideColor` → `topColor` by how upward each point faces.
 */
export function wallGeometry(grid: LevelGrid, dim: DimIndex, cx: number, cz: number, sideColor: string,
  topColor: string, cave?: CaveMouth): BufferGeometry {
  const isWall: IsWall = (x, z) => isRock(grid, dim, x, z);
  const isOuter: IsWall = (x, z) => isOuterRock(grid, dim, x, z);
  // an outermost wall stops at WALL_H here (no top, no bevel); outerWallGeometry carries it on up. Where ordinary
  // rock meets it, the two footprints differ at WALL_H (the cliff has no fillet into, and rounds the corner beside,
  // the lower wall), so there it is also topped and bevelled like an ordinary wall wherever it lies outside the cliff.
  const outer = isOuter(cx, cz);
  let exposed = false;
  let shelf = false;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!isWall(cx + dx, cz + dz)) exposed = true;
      else if (outer && !isOuter(cx + dx, cz + dz)) shelf = true;
    }
  }
  const cliff = new WallShape(isOuter);
  const shape = new WallShape(isWall, !outer ? WALL_H : !shelf ? OUTER_H : (x, z) => (cliff.sdf(x, z) < 1e-3 ? OUTER_H : WALL_H));
  const b = new MeshBuilder(shape, [cx + 0.5, cz + 0.5], new Color(sideColor), new Color(topColor),
    outer ? (x, z) => cliff.sdf(x, z) < 1e-3 : undefined);
  const B = exposed ? FINE : COARSE;
  const n = B.length;
  const topped = !outer || shelf;
  const H = topped ? HEIGHTS : [0, WALL_H];

  if (topped) b.patch(n, n, (i, j) => [cx + B[i], WALL_H, cz + B[j]], false, [0, 1, 0]);
  const open = (dx: number, dz: number) => !isWall(cx + dx, cz + dz) && !(cave && cave.dx === dx && cave.dz === dz);
  if (cave) caveFace(b, cx, cz, cave, H);
  if (open(1, 0)) b.patch(n, H.length, (i, j) => [cx + 1, H[j], cz + B[i]], true, [1, 0, 0]);
  if (open(-1, 0)) b.patch(n, H.length, (i, j) => [cx, H[j], cz + B[i]], true, [-1, 0, 0]);
  if (open(0, 1)) b.patch(n, H.length, (i, j) => [cx + B[i], H[j], cz + 1], true, [0, 0, 1]);
  if (open(0, -1)) b.patch(n, H.length, (i, j) => [cx + B[i], H[j], cz], true, [0, 0, -1]);
  if (topped) fillets(b, isWall, cx, cz, WALL_H);
  return b.build();
}

/**
 * The part of an outermost wall (isOuterRock) above WALL_H, up to OUTER_H, local to the cell centre like
 * wallGeometry. Its footprint is the outermost rock alone, so it also rises above the ordinary walls that meet it.
 * A separate mesh so it casts no shadow: a cliff that tall would darken half the level.
 */
export function outerWallGeometry(grid: LevelGrid, dim: DimIndex, cx: number, cz: number, sideColor: string,
  topColor: string): BufferGeometry {
  const isWall: IsWall = (x, z) => isOuterRock(grid, dim, x, z);
  const b = new MeshBuilder(new WallShape(isWall, OUTER_H), [cx + 0.5, cz + 0.5], new Color(sideColor), new Color(topColor));
  let exposed = false;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!isWall(cx + dx, cz + dz)) exposed = true;
  const B = exposed ? FINE : COARSE;
  const n = B.length;
  const H = faceHeights(WALL_H, OUTER_H);
  b.patch(n, n, (i, j) => [cx + B[i], OUTER_H, cz + B[j]], false, [0, 1, 0]);
  if (!isWall(cx + 1, cz)) b.patch(n, H.length, (i, j) => [cx + 1, H[j], cz + B[i]], true, [1, 0, 0]);
  if (!isWall(cx - 1, cz)) b.patch(n, H.length, (i, j) => [cx, H[j], cz + B[i]], true, [-1, 0, 0]);
  if (!isWall(cx, cz + 1)) b.patch(n, H.length, (i, j) => [cx + B[i], H[j], cz + 1], true, [0, 0, 1]);
  if (!isWall(cx, cz - 1)) b.patch(n, H.length, (i, j) => [cx + B[i], H[j], cz], true, [0, 0, -1]);
  fillets(b, isWall, cx, cz, OUTER_H);
  return b.build();
}

/** Floors of cells with no rock round them, shared per offset in the cobble pattern. */
const freeFloors = new Map<number, BufferGeometry>();

/**
 * The floor of cell (cx, cz) at y = 0, local to the cell centre, with UVs continuing the world-space cobble pattern:
 * the part of the cell outside the rounded rock, so it runs exactly up to every wall's foot. It neither reaches in
 * under a fillet (where a cut-away wall would show its corner) nor leaves the cut-off corner of a rounded wall bare.
 * A dug-out (void) cell counts as rock here, so no floor ever lies beyond the outermost wall. Null when the cell
 * has no open part.
 */
export function floorGeometry(grid: LevelGrid, dim: DimIndex, cx: number, cz: number): BufferGeometry | null {
  const solid: IsWall = (x, z) => isRock(grid, dim, x, z) || isVoid(grid, dim, x, z);
  let near = false;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (solid(cx + dx, cz + dz)) near = true;
  if (!near) {
    // the pattern repeats every COBBLE_SPAN cells, so a free cell needs only its offset within one span
    const ox = ((cx % COBBLE_SPAN) + COBBLE_SPAN) % COBBLE_SPAN;
    const oz = ((cz % COBBLE_SPAN) + COBBLE_SPAN) % COBBLE_SPAN;
    const key = ox * COBBLE_SPAN + oz;
    let g = freeFloors.get(key);
    if (!g) {
      g = new BufferGeometry();
      const p = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5];
      const uv: number[] = [];
      for (let i = 0; i < 4; i++) uv.push((ox + p[i * 3] + 0.5) / COBBLE_SPAN, (oz + p[i * 3 + 2] + 0.5) / COBBLE_SPAN);
      g.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
      g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
      g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
      g.setIndex([0, 2, 1, 0, 3, 2]);
      freeFloors.set(key, g);
    }
    return g;
  }
  const shape = new WallShape(solid);
  const n = FINE.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const moved: boolean[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [x, z, m] = shape.pushOut(cx + FINE[i], cz + FINE[j]);
      pos.push(x - cx - 0.5, 0, z - cz - 0.5);
      uv.push(x / COBBLE_SPAN, z / COBBLE_SPAN);
      moved.push(m);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const p0 = j * n + i;
      const p1 = p0 + 1;
      const p2 = p0 + n + 1;
      const p3 = p0 + n;
      if (moved[p0] && moved[p1] && moved[p2] && moved[p3]) continue; // wholly under rock
      idx.push(p0, p2, p1, p0, p3, p2);
    }
  }
  if (idx.length === 0) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(pos.map((_, k) => (k % 3 === 1 ? 1 : 0))), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  return g;
}
