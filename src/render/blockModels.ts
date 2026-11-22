/**
 * Render registry: one model factory per block id in src/core/blocks.ts.
 * A factory returns an Object3D positioned at the cell origin plus an optional per-frame update.
 */
import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, CircleGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, PointLight, Shape, Vector3, ShapeGeometry, TorusGeometry,
  type Material, type Object3D,
} from 'three';
import { DOOR_THICKNESS } from '../core/blocks';
import type { Cell, LevelGrid } from '../core/grid';
import { TUNING, type Sim } from '../core/sim';
import type { DimTheme } from './palette';
import { cobble, toon, whitening, wood } from './materials';
import { throughMouth, withHole, type Mouth } from './cutaway';
import {
  CAVE, WALL_H, caveGeometry, cutOf, floorGeometry, outerWallGeometry, wallGeometry, type Cut,
} from './terrain';

export interface BlockView {
  object: Object3D;
  update?(sim: Sim, dt: number, t: number): void;
  /** Draw the rock with the heights in `heights` (indices z * w + x, see nearCut). */
  setHeights?(heights: ReadonlyMap<number, number>): void;
}

export interface ModelCtx {
  theme: DimTheme;
  grid: LevelGrid;
}

export type BlockModelFactory = (cell: Cell, ctx: ModelCtx) => BlockView;

function place(o: Object3D, cell: Cell): Object3D {
  o.position.set(cell.x + 0.5, 0, cell.y + 0.5);
  return o;
}

function m(g: ConstructorParameters<typeof Mesh>[0], mat: Material | Material[], x = 0, y = 0, z = 0, shadow = true): Mesh {
  const mesh = new Mesh(g, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  return mesh;
}

/** The cell's floor, up to the foot of the rounded rock (a rock cell has floor only where its corner is rounded off). */
function floorTile(cell: Cell, ctx: ModelCtx): Mesh[] {
  const geo = floorGeometry(ctx.grid, cell.dim, cell.x, cell.y);
  return geo ? [m(geo, cobble(ctx.theme.floor[(cell.x + cell.y) % 2]), 0, 0, 0, false)] : [];
}

/** Floor plus decoration. */
function onFloor(cell: Cell, ctx: ModelCtx, ...deco: Object3D[]): Group {
  const g = new Group();
  g.add(...floorTile(cell, ctx), ...deco);
  place(g, cell);
  return g;
}


/** A round-topped arch outline standing on y = 0 (the exit cave's profile), grown by `grow` on every side. */
function archShape(grow = 0): Shape {
  const r = CAVE.half + grow;
  const s = new Shape();
  s.moveTo(-r, 0);
  s.lineTo(r, 0);
  s.lineTo(r, CAVE.spring);
  s.absarc(0, CAVE.spring, r, 0, Math.PI, false);
  s.lineTo(-r, 0);
  return s;
}

/** Haze in the cave: [depth, opacity] of each thin veil of white light, thickening towards the back. */
const CAVE_HAZE: [number, number][] = [[0.42, 0.3], [0.5, 0.4], [0.58, 0.5], [0.66, 0.6], [0.74, 0.75]];

/** Raise an outermost wall (see Cut) on up to its top; the upper part casts no shadow. */
function addOuterWall(g: Group, cell: Cell, ctx: ModelCtx, cut: Cut): void {
  if (cut.top(cell.x, cell.y) === 0) return;
  const geo = outerWallGeometry(ctx.grid, cell.dim, cell.x, cell.y, ctx.theme.wallSide, ctx.theme.wallTop, cut);
  g.add(m(geo, withHole(cobble('#ffffff', true)), 0, 0, 0, false));
}

/**
 * The rock of `cell`, rebuilt for the heights of the rock round it (3 × 3: its faces, fillets and rounded corners
 * reach no further) and its own; each combination is built once, when first needed, and only the current one is
 * shown. Starts with every rock at its own height (see cutOf).
 */
function rockByHeight(cell: Cell, ctx: ModelCtx, build: (cut: Cut) => Object3D): { object: Object3D; setHeights(heights: ReadonlyMap<number, number>): void } {
  const { grid } = ctx;
  const copies = new Map<string, Object3D>();
  const object = new Group();
  let shown: Object3D | undefined;
  const setHeights = (heights: ReadonlyMap<number, number>) => {
    const cut = cutOf(grid, cell.dim, heights);
    let key = cut.low(cell.x, cell.y) ? 'L' : '';
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) key += `${cut.height(cell.x + dx, cell.y + dz)},`;
    let o = copies.get(key);
    if (!o) {
      copies.set(key, (o = build(cut)));
      object.add(o);
    }
    if (o === shown) return;
    if (shown) shown.visible = false;
    o.visible = true;
    shown = o;
  };
  setHeights(new Map());
  return { object, setHeights };
}

/** Underside door: light leaking through the seams between its boards (woodTexture BOARDS = 4). */
const SEAM_GLOW = '#ff3a24';
/** ...and the soul haze drifting out of them. */
const WISP_GLOW = '#7fe8dc';
const WISPS = 7;

type DoorPart = (along: number, h: number, across: number, mat: Material, a: number, y: number, off?: number, shadow?: boolean) => Mesh;

/**
 * The underside's door glows from within: every seam between boards is lit in broken, flickering stretches on both
 * faces, and faint wisps seep out of the seams and rise, swaying, until they thin away. All of it rides on the panel,
 * so it sinks and hides with the door when it opens.
 */
function hauntDoor(cell: Cell, doorH: number, alongX: boolean, part: DoorPart): { object: Object3D; update(dt: number, t: number): void } {
  const g = new Group();
  const seed = (cell.x * 73856093) ^ (cell.y * 19349663);
  let s = seed >>> 0;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const seams = [-0.25, 0, 0.25];
  // broken stretches of light along each seam, each flickering on its own phase
  const cracks: { mat: MeshBasicMaterial; base: number; phase: number; speed: number }[] = [];
  for (const a of seams) {
    let y = 0.05 + rand() * 0.12;
    while (y < doorH - 0.1) {
      const len = Math.min(doorH - 0.05 - y, 0.18 + rand() * 0.4);
      const base = 0.45 + rand() * 0.55;
      const mat = withHole(new MeshBasicMaterial({ color: SEAM_GLOW, transparent: true, opacity: base, depthWrite: false, blending: AdditiveBlending }));
      for (const side of [-1, 1]) g.add(part(0.022, len, 0.004, mat, a, y + len / 2, side * 0.152, false));
      cracks.push({ mat, base, phase: rand() * 6.28, speed: 2 + rand() * 5 });
      y += len + 0.04 + rand() * 0.2;
    }
  }
  // red light spilling out onto the floor and walls round the door
  const light = new PointLight(SEAM_GLOW, 0.9, 2.2, 1.6);
  light.position.y = doorH * 0.45;
  g.add(light);
  // wisps: each rises from a random seam on a random face, sways, swells and fades, then starts over
  const wispGeo = new IcosahedronGeometry(0.05, 0);
  const wisps = Array.from({ length: WISPS }, () => {
    const mat = withHole(new MeshBasicMaterial({ color: WISP_GLOW, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending }));
    const mesh = new Mesh(wispGeo, mat);
    mesh.renderOrder = 3;
    g.add(mesh);
    const w = { mesh, mat, age: rand() * 3, life: 1, a: 0, side: 1, y0: 0, sway: 0, drift: 0 };
    return w;
  });
  const respawn = (w: (typeof wisps)[number]) => {
    w.age = 0;
    w.life = 2.2 + rand() * 1.8;
    w.a = seams[Math.floor(rand() * seams.length)] + (rand() - 0.5) * 0.03;
    w.side = rand() < 0.5 ? -1 : 1;
    w.y0 = 0.15 + rand() * (doorH - 0.5);
    w.sway = rand() * 6.28;
    w.drift = 0.08 + rand() * 0.12;
  };
  for (const w of wisps) {
    const age = w.age;
    respawn(w);
    w.age = age % w.life;
  }
  return {
    object: g,
    update: (dt, t) => {
      let sum = 0;
      for (const c of cracks) {
        // a slow breath plus a quick ragged flutter
        const f = 0.7 + 0.2 * Math.sin(t * 1.3 + c.phase) + 0.1 * Math.sin(t * c.speed + c.phase * 3);
        c.mat.opacity = c.base * f;
        sum += f;
      }
      light.intensity = 0.9 * (sum / cracks.length);
      for (const w of wisps) {
        w.age += dt;
        if (w.age >= w.life) respawn(w);
        const k = w.age / w.life; // 0..1 through its life
        const out = 0.16 + w.drift * k; // seeps out of the face, then drifts off it
        const a = w.a + Math.sin(t * 1.7 + w.sway) * 0.06 * k;
        const y = w.y0 + k * 0.7;
        w.mesh.position.set(alongX ? a : w.side * out, y, alongX ? w.side * out : a);
        w.mesh.scale.setScalar(0.5 + k * 1.3);
        w.mat.opacity = 0.55 * Math.sin(Math.PI * Math.min(1, k * 1.4)) * (1 - k * 0.5);
      }
    },
  };
}

/** The red light of a lever: it glows in the slot in the top of its base and rises out of it in a short fading shaft,
 *  and pools on the floor round it exactly as far as the hero's reach (TUNING.interactRange). */
/** Red while the lever is off; once pulled it glows an orange-leaning yellow, and pulling it back turns it red again. */
const LEVER_GLOW = '#ff3020';
const LEVER_GLOW_ON = '#ffa818';
const LEVER_ARM = 0.45;
/** The shaft out of the slot rises a quarter of the arm's length. */
const SHAFT_H = LEVER_ARM / 4;
/** Length of the slot the arm swings in, along x on top of the base. */
const SLOT_LEN = 0.16;
let poolTexture: CanvasTexture | null = null;
const shaftTextures = new Map<string, CanvasTexture>();

/** A vertical fade for the shaft: alpha at each height (0 at the slot, 1 at the top). */
function shaftTexture(key: string, stops: [number, number][]): CanvasTexture {
  let tex = shaftTextures.get(key);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 128, 0, 0); // the canvas' bottom row is uv.y = 0, the slot
  for (const [at, a] of stops) grad.addColorStop(at, `rgba(255,255,255,${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  tex = new CanvasTexture(c);
  shaftTextures.set(key, tex);
  return tex;
}

/** The floor pool's falloff, like the monsters' vision cones (0.6 at the source, thinning linearly to 0.12 at the edge
 *  of reach, where it stops). */
function leverPoolTexture(): CanvasTexture {
  if (poolTexture) return poolTexture;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.6)');
  grad.addColorStop(0.999, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  poolTexture = new CanvasTexture(c);
  return poolTexture;
}

interface LeverGlow {
  parts: Object3D[];
  /** `on`: whether the lever is pulled; the colour follows it at the arm's pace. */
  update(t: number, dt: number, on: boolean): void;
}

function leverGlow(cell: Pick<Cell, 'x' | 'y'>): LeverGlow {
  const poolMat = new MeshBasicMaterial({
    color: LEVER_GLOW, map: leverPoolTexture(),
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const pool = new Mesh(new CircleGeometry(TUNING.interactRange, 40), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.025;
  pool.renderOrder = 2;
  // the slot the arm swings in, along x on top of the base
  const slotMat = new MeshBasicMaterial({ color: LEVER_GLOW, transparent: true, depthWrite: false, blending: AdditiveBlending });
  const slot = m(new BoxGeometry(SLOT_LEN, 0.006, 0.03), slotMat, 0, 0.143, 0, false);
  // a short shaft of light out of the slot, widening and thinning away, round a brighter core
  const additive = (map: CanvasTexture) => new MeshBasicMaterial({
    color: LEVER_GLOW, map, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
  });
  const shaftMat = additive(shaftTexture('shaft', [[0, 0.7], [0.25, 0.35], [1, 0]]));
  const shaft = new Mesh(new CylinderGeometry(0.24, 0.16, SHAFT_H, 20, 1, true), shaftMat);
  shaft.position.y = 0.14 + SHAFT_H / 2;
  shaft.scale.set(SLOT_LEN / 0.32, 1, 0.275); // as long as the slot, flattened across it
  const coreMat = additive(shaftTexture('core', [[0, 0.9], [0.15, 0.4], [0.6, 0]]));
  const core = new Mesh(new CylinderGeometry(0.12, 0.13, SHAFT_H * 0.7, 16, 1, true), coreMat);
  core.position.y = 0.14 + SHAFT_H * 0.35;
  core.scale.set(SLOT_LEN / 0.32, 1, 0.2);
  for (const o of [shaft, core]) o.renderOrder = 3;
  const phase = (cell.x * 1.7 + cell.y * 2.3) % 6.28;
  const off = new Color(LEVER_GLOW);
  const lit = new Color(LEVER_GLOW_ON);
  const color = new Color();
  let k = 0; // 0 red (off) .. 1 yellow (pulled)
  return {
    parts: [pool, slot, shaft, core],
    update: (t, dt, on) => {
      k += ((on ? 1 : 0) - k) * Math.min(1, dt * 12);
      color.lerpColors(off, lit, k);
      for (const mat of [poolMat, slotMat, shaftMat, coreMat]) mat.color.copy(color);
      // a slow breath plus a faint flutter, the same whichever way the arm leans
      const f = 0.85 + 0.1 * Math.sin(t * 2 + phase) + 0.05 * Math.sin(t * 7.3 + phase * 3);
      poolMat.opacity = f;
      slotMat.opacity = f;
      shaftMat.opacity = f;
      coreMat.opacity = f;
    },
  };
}

/** A lever without its floor tile: base, swinging arm and glow, centred on the origin. `update` swings the arm
 *  and recolours the glow toward `on`. */
export function leverParts(cell: Pick<Cell, 'x' | 'y'>): LeverGlow {
  const base = m(new BoxGeometry(0.44, 0.16, 0.3), toon('#5a5560'), 0, 0.06, 0);
  const arm = new Group();
  arm.position.y = 0.1;
  arm.add(m(new CylinderGeometry(0.04, 0.04, LEVER_ARM, 6), toon('#3a3238'), 0, 0.16, 0));
  arm.add(m(new IcosahedronGeometry(0.09), toon('#6a6470'), 0, 0.46, 0));
  const glow = leverGlow(cell);
  let angle = -0.6;
  return {
    parts: [...glow.parts, base, arm],
    update: (t, dt, on) => {
      glow.update(t, dt, on);
      angle += ((on ? 0.6 : -0.6) - angle) * Math.min(1, dt * 12);
      arm.rotation.z = angle;
    },
  };
}

/**
 * A door no lever opens (LevelGrid.chained): two thin black iron chains crossed in an X over each face, of the
 * same iron as the door's straps.
 * Built for a panel spanning x with its faces towards ±z; the caller turns it for a vertical door.
 */
function doorChains(doorH: number, iron: Material): Group {
  const g = new Group();
  const link = new TorusGeometry(0.04, 0.012, 4, 8);
  const bar = new BoxGeometry(0.12, 0.03, 0.04);
  const STEP = 0.095;
  const [x0, y0, x1, y1] = [-0.42, 0.14, 0.42, doorH - 0.14];
  for (const s of [-1, 1]) {
    const z = s * 0.175;
    for (const flip of [-1, 1]) {
      const ax = flip * x0, bx = flip * x1;
      const len = Math.hypot(bx - ax, y1 - y0);
      const angle = Math.atan2(y1 - y0, bx - ax);
      const n = Math.floor(len / STEP);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        // links alternate: a ring lying flat on the boards, stretched along the chain, then one standing edge-on,
        // drawn pressed flat into a thick bar along the chain
        const l = i % 2 ? m(bar, iron, 0, 0, 0, false) : m(link, iron, 0, 0, 0, false);
        l.position.set(ax + (bx - ax) * t, y0 + (y1 - y0) * t, z);
        l.rotation.z = angle;
        if (!(i % 2)) l.scale.set(1.45, 1, 1);
        g.add(l);
      }
      // a staple bolting each end into the door
      for (const [px, py] of [[ax, y0], [bx, y1]]) g.add(m(new BoxGeometry(0.07, 0.07, 0.03), iron, px, py, s * 0.16, false));
    }
  }
  return g;
}

export const BLOCK_MODELS: Record<string, BlockModelFactory> = {
  floor: (cell, ctx) => ({ object: onFloor(cell, ctx) }),

  // dug out of the level: nothing is drawn, the backdrop shows through
  void: () => ({ object: new Group() }),

  wall: (cell, ctx) => {
    const rock = rockByHeight(cell, ctx, (cut) => {
      const r = new Group();
      // cut down to nothing: not even the floor in its rounded-off corners
      if (cut.height(cell.x, cell.y) <= 0) return r;
      r.add(m(wallGeometry(ctx.grid, cell.dim, cell.x, cell.y, ctx.theme.wallSide, ctx.theme.wallTop, undefined, cut), withHole(cobble('#ffffff', true))),
        ...floorTile(cell, ctx));
      addOuterWall(r, cell, ctx, cut);
      return r;
    });
    return { object: place(rock.object, cell), setHeights: rock.setHeights };
  },

  spawn: (cell, ctx) => ({ object: onFloor(cell, ctx) }),

  lever: (cell, ctx) => {
    const lever = leverParts(cell);
    return {
      object: onFloor(cell, ctx, ...lever.parts),
      update: (sim, dt, t) => lever.update(t, dt, sim.leverOn(cell)),
    };
  },

  door: (cell, ctx) => {
    // set per door: horizontal (the panel spans x, blocking up/down) or vertical (spans z, blocking left/right)
    const spanX = !cell.props.vertical;
    const panel = new Group();
    const doorH = WALL_H - 0.1;
    // a box measured along the door (`along`), up, and through it (`across`), centred `off` through the door
    const part = (along: number, h: number, across: number, mat: Material, a: number, y: number, off = 0, shadow = true) =>
      m(new BoxGeometry(spanX ? along : across, h, spanX ? across : along), mat, spanX ? a : off, y, spanX ? off : a, shadow);
    const iron = withHole(toon('#34343a'));
    panel.add(part(1, doorH, DOOR_THICKNESS, withHole(wood('#b8a088')), 0, doorH / 2));
    // iron straps across both faces near the top and bottom, studded with rivets
    for (const y of [0.24, doorH - 0.22]) {
      panel.add(part(1.005, 0.09, 0.34, iron, 0, y));
      for (const a of [-0.36, 0, 0.36]) for (const s of [-1, 1]) panel.add(part(0.05, 0.05, 0.03, iron, a, y, s * 0.18, false));
    }
    // a latch bar with a ring pull on each face
    for (const s of [-1, 1]) {
      panel.add(part(0.05, 0.3, 0.03, iron, -0.34, 0.78, s * 0.165, false));
      const ring = m(new TorusGeometry(0.06, 0.014, 4, 10), iron, 0, 0.72, 0, false);
      ring.position.set(spanX ? -0.34 : s * 0.19, 0.66, spanX ? s * 0.19 : -0.34);
      if (!spanX) ring.rotation.y = Math.PI / 2;
      panel.add(ring);
    }
    if (ctx.grid.chained(cell)) {
      const chains = doorChains(doorH, iron);
      if (!spanX) chains.rotation.y = Math.PI / 2;
      panel.add(chains);
    }
    const haunt = cell.dim === 1 ? hauntDoor(cell, doorH, spanX, part) : null;
    if (haunt) panel.add(haunt.object);
    const g = onFloor(cell, ctx, panel);
    let y = 0;
    return {
      object: g,
      update: (sim, dt, t) => {
        haunt?.update(dt, t);
        const target = sim.doorOpen(cell) ? -WALL_H : 0;
        y += (target - y) * Math.min(1, dt * 8);
        panel.position.y = y;
        panel.visible = y > -WALL_H + 0.05;
      },
    };
  },

  exit: (cell, ctx) => {
    // a block of rock with a small cave dug into it: plain wall on three sides, a tunnel behind the open one that fades into light
    const [dx, dz] = ctx.grid.exitMouth(cell);
    const mouth = { dx, dz, floor: ctx.theme.floor[0] };
    const stone = withHole(cobble('#ffffff', true));
    // everything inside shows only through the arch, so it hides like the wall round it from any other angle
    // (e.g. through the camera hole cut into a neighbouring wall)
    const arch: Mouth = {
      origin: new Vector3(cell.x + 0.5 + dx * 0.5, 0, cell.y + 0.5 + dz * 0.5),
      normal: new Vector3(dx, 0, dz),
      along: new Vector3(-dz, 0, dx),
      half: CAVE.half,
      spring: CAVE.spring,
    };
    // hidden from the camera (see nearCut), none of its stone is drawn, the tunnel and floor included: only its light
    const rock = rockByHeight(cell, ctx, (cut) => {
      const r = new Group();
      if (cut.height(cell.x, cell.y) <= 0) return r;
      r.add(m(wallGeometry(ctx.grid, cell.dim, cell.x, cell.y, ctx.theme.wallSide, ctx.theme.wallTop, mouth, cut), stone));
      addOuterWall(r, cell, ctx, cut);
      // the tunnel takes no shadow from the rock over it: its light comes from inside
      const tunnel = m(caveGeometry(ctx.grid, cell.dim, cell.x, cell.y, ctx.theme.wallSide, mouth),
        throughMouth(whitening(stone), arch), 0, 0, 0, false);
      tunnel.receiveShadow = false;
      r.add(tunnel, ...floorTile(cell, ctx));
      return r;
    });
    const inside = new Group();
    inside.rotation.y = Math.atan2(dx, dz); // local +z points out of the open side; the face is at z = 0.5
    // veils of light, so whatever walks in sinks into the glow instead of meeting a flat white board
    for (const [d, opacity] of CAVE_HAZE) {
      const veil = new Mesh(new ShapeGeometry(archShape(0.02), 12),
        throughMouth(withHole(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false })), arch));
      veil.position.z = 0.5 - d;
      veil.renderOrder = 3;
      inside.add(veil);
    }
    // the glow spills out of the mouth onto the walls and floor round it
    const light = new PointLight('#fff4e0', 2.2, 3.2, 1.5);
    light.position.set(0, CAVE.spring * 0.8, 0.5 - CAVE.depth * 0.6);
    inside.add(light);
    const g = new Group();
    g.add(rock.object, inside);
    place(g, cell);
    return { object: g, setHeights: rock.setHeights };
  },
};
