/**
 * Render registry: one model factory per block id in src/core/blocks.ts.
 * A factory returns an Object3D positioned at the cell origin plus an optional per-frame update.
 */
import {
  BoxGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, Shape, ShapeGeometry, TorusGeometry,
  type Material, type Object3D,
} from 'three';
import type { Cell, LevelGrid } from '../core/grid';
import type { Sim } from '../core/sim';
import type { DimTheme } from './palette';
import { cobble, glow, toon, wood } from './materials';
import { withHole } from './cutaway';
import { CAVE, WALL_H, caveGeometry, floorGeometry, wallGeometry } from './terrain';

export interface BlockView {
  object: Object3D;
  update?(sim: Sim, dt: number, t: number): void;
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

function floorTile(cell: Cell, ctx: ModelCtx): Mesh {
  return m(floorGeometry(cell.x, cell.y), cobble(ctx.theme.floor[(cell.x + cell.y) % 2]), 0, 0, 0, false);
}

/** Floor plus decoration. */
function onFloor(cell: Cell, ctx: ModelCtx, ...deco: Object3D[]): Group {
  const g = new Group();
  g.add(floorTile(cell, ctx), ...deco);
  place(g, cell);
  return g;
}

const bob = (t: number, phase: number) => 0.38 + Math.sin(t * 2.5 + phase) * 0.06;

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

/** Haze in the cave: [depth, opacity] of each thin black veil, thickening towards the back (dogsouls-style). */
const CAVE_HAZE: [number, number][] = [[0.42, 0.3], [0.5, 0.4], [0.58, 0.5], [0.66, 0.6], [0.74, 0.75]];

export const BLOCK_MODELS: Record<string, BlockModelFactory> = {
  floor: (cell, ctx) => ({ object: onFloor(cell, ctx) }),

  wall: (cell, ctx) => {
    const g = wallGeometry(ctx.grid, cell.dim, cell.x, cell.y, ctx.theme.wallSide, ctx.theme.wallTop);
    return { object: place(m(g, withHole(cobble('#ffffff', true))), cell) };
  },

  spawn: (cell, ctx) => ({ object: onFloor(cell, ctx) }),

  lever: (cell, ctx) => {
    const base = m(new BoxGeometry(0.44, 0.16, 0.3), toon('#5a5560'), 0, 0.06, 0);
    const arm = new Group();
    arm.position.y = 0.1;
    arm.add(m(new CylinderGeometry(0.04, 0.04, 0.45, 6), toon('#3a3238'), 0, 0.16, 0));
    arm.add(m(new IcosahedronGeometry(0.09), toon('#6a6470'), 0, 0.46, 0));
    const lamp = m(new BoxGeometry(0.1, 0.05, 0.32), glow('#333'), -0.17, 0.16, 0, false);
    const g = onFloor(cell, ctx, base, arm, lamp);
    let angle = -0.6;
    return {
      object: g,
      update: (sim, dt) => {
        const on = sim.leverOn(cell);
        const target = on ? 0.6 : -0.6;
        angle += (target - angle) * Math.min(1, dt * 12);
        arm.rotation.z = angle;
        lamp.material = glow(on ? '#ffcf6b' : '#333333');
      },
    };
  },

  door: (cell, ctx) => {
    // span across the corridor: if walls are left/right, the door panel spans x
    const solidAt = (dx: number, dy: number) => ctx.grid.cell(cell.dim, cell.x + dx, cell.y + dy).def.solid === 'always';
    const spanX = solidAt(-1, 0) || solidAt(1, 0) || !(solidAt(0, -1) || solidAt(0, 1));
    const panel = new Group();
    const doorH = WALL_H - 0.1;
    // a box measured along the door (`along`), up, and through it (`across`), centred `off` through the door
    const part = (along: number, h: number, across: number, mat: Material, a: number, y: number, off = 0, shadow = true) =>
      m(new BoxGeometry(spanX ? along : across, h, spanX ? across : along), mat, spanX ? a : off, y, spanX ? off : a, shadow);
    const iron = withHole(toon('#34343a'));
    panel.add(part(1, doorH, 0.3, withHole(wood('#b8a088')), 0, doorH / 2));
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
    const g = onFloor(cell, ctx, panel);
    let y = 0;
    return {
      object: g,
      update: (sim, dt) => {
        const target = sim.doorOpen(cell) ? -WALL_H : 0;
        y += (target - y) * Math.min(1, dt * 8);
        panel.position.y = y;
        panel.visible = y > -WALL_H + 0.05;
      },
    };
  },

  core: (cell, ctx) => {
    const crystal = m(new IcosahedronGeometry(0.22), glow('#7ff0ff'), 0, 0.42, 0);
    const halo = m(new TorusGeometry(0.32, 0.025, 4, 16), glow('#58d6e8'), 0, 0.42, 0, false);
    const g = onFloor(cell, ctx, crystal, halo);
    return {
      object: g,
      update: (sim, _dt, t) => {
        const show = !sim.isPicked(cell);
        crystal.visible = halo.visible = show;
        crystal.position.y = halo.position.y = bob(t, cell.y);
        crystal.rotation.set(t, t * 1.3, 0);
        halo.rotation.set(Math.PI / 2 + Math.sin(t) * 0.4, t * 0.8, 0);
      },
    };
  },

  exit: (cell, ctx) => {
    // a small cave dug into the rock: plain wall outside, a tunnel behind its one open side that fades to black
    const [dx, dz] = ctx.grid.openSides(cell.dim, cell.x, cell.y)[0] ?? [0, 1];
    const mouth = { dx, dz, floor: ctx.theme.floor[0] };
    const stone = withHole(cobble('#ffffff', true));
    const rock = m(wallGeometry(ctx.grid, cell.dim, cell.x, cell.y, ctx.theme.wallSide, ctx.theme.wallTop, mouth), stone);
    // the tunnel takes no shadow from the rock over it: its light falls off with depth on its own
    const tunnel = m(caveGeometry(ctx.grid, cell.dim, cell.x, cell.y, ctx.theme.wallSide, mouth), stone, 0, 0, 0, false);
    tunnel.receiveShadow = false;
    const inside = new Group();
    inside.rotation.y = Math.atan2(dx, dz); // local +z points out of the open side; the face is at z = 0.5
    // the back of the tunnel: black, glowing faintly once enough cores are carried
    const back = m(new ShapeGeometry(archShape(0.04), 12), withHole(glow('#000000')), 0, 0, 0.5 - CAVE.depth, false);
    inside.add(back);
    // veils of black haze, so whatever walks in sinks into the dark instead of meeting a flat black board
    for (const [d, opacity] of CAVE_HAZE) {
      const veil = new Mesh(new ShapeGeometry(archShape(0.02), 12),
        withHole(new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity, depthWrite: false })));
      veil.position.z = 0.5 - d;
      veil.renderOrder = 3;
      inside.add(veil);
    }
    const g = new Group();
    g.add(rock, tunnel, inside);
    place(g, cell);
    return {
      object: g,
      update: (sim, _dt, t) => {
        const need = Number(cell.props.coresRequired) || sim.coresTotal;
        const open = sim.cores >= need;
        back.material = withHole(glow(open ? (Math.sin(t * 3) > 0 ? '#2c1442' : '#22103a') : '#000000'));
      },
    };
  },
};
