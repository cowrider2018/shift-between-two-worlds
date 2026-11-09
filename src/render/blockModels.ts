/**
 * Render registry: one model factory per block id in src/core/blocks.ts.
 * A factory returns an Object3D positioned at the cell origin plus an optional per-frame update.
 */
import {
  BoxGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, OctahedronGeometry, RingGeometry, TorusGeometry,
  type Material, type Object3D,
} from 'three';
import type { Cell, LevelGrid } from '../core/grid';
import type { Sim } from '../core/sim';
import { channelColor, type DimTheme } from './palette';
import { glow, toon } from './materials';

export interface BlockView {
  object: Object3D;
  update?(sim: Sim, dt: number, t: number): void;
}

export interface ModelCtx {
  theme: DimTheme;
  grid: LevelGrid;
}

export type BlockModelFactory = (cell: Cell, ctx: ModelCtx) => BlockView;

const geo = {
  floor: new BoxGeometry(1, 0.1, 1),
  wall: new BoxGeometry(1, 1.1, 1),
};

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
  const tile = m(geo.floor, toon(ctx.theme.floor[(cell.x + cell.y) % 2]), 0, -0.05, 0, false);
  return tile;
}

/** Floor plus decoration. */
function onFloor(cell: Cell, ctx: ModelCtx, ...deco: Object3D[]): Group {
  const g = new Group();
  g.add(floorTile(cell, ctx), ...deco);
  place(g, cell);
  return g;
}

const bob = (t: number, phase: number) => 0.38 + Math.sin(t * 2.5 + phase) * 0.06;

export const BLOCK_MODELS: Record<string, BlockModelFactory> = {
  floor: (cell, ctx) => ({ object: onFloor(cell, ctx) }),

  wall: (cell, ctx) => {
    const side = toon(ctx.theme.wallSide);
    const top = toon(ctx.theme.wallTop);
    const w = m(geo.wall, [side, side, top, side, side, side], 0, 0.55, 0);
    return { object: place(w, cell) };
  },

  spawn: (cell, ctx) => {
    const ring = m(new RingGeometry(0.28, 0.38, 16), glow('#5fd16b'), 0, 0.012, 0, false);
    ring.rotation.x = -Math.PI / 2;
    return { object: onFloor(cell, ctx, ring) };
  },

  reward: (cell, ctx) => {
    const gem = m(new OctahedronGeometry(0.2), toon('#f2c94c', '#6b5200'), 0, 0.4, 0);
    const g = onFloor(cell, ctx, gem);
    return {
      object: g,
      update: (sim, _dt, t) => {
        gem.visible = !sim.isPicked(cell);
        gem.position.y = bob(t, cell.x);
        gem.rotation.y = t * 2;
      },
    };
  },

  lever: (cell, ctx) => {
    const color = channelColor(Number(cell.props.channel));
    const base = m(new BoxGeometry(0.44, 0.16, 0.3), toon('#5a5560'), 0, 0.06, 0);
    const arm = new Group();
    arm.position.y = 0.1;
    arm.add(m(new CylinderGeometry(0.04, 0.04, 0.45, 6), toon('#3a3238'), 0, 0.16, 0));
    arm.add(m(new IcosahedronGeometry(0.09), glow(color), 0, 0.46, 0));
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
        lamp.material = glow(on ? color : '#333333');
      },
    };
  },

  door: (cell, ctx) => {
    const color = channelColor(Number(cell.props.channel));
    // span across the corridor: if walls are left/right, the door panel spans x
    const solidAt = (dx: number, dy: number) => ctx.grid.cell(cell.dim, cell.x + dx, cell.y + dy).def.solid === 'always';
    const spanX = solidAt(-1, 0) || solidAt(1, 0) || !(solidAt(0, -1) || solidAt(0, 1));
    const panel = new Group();
    const slab = m(new BoxGeometry(spanX ? 1 : 0.3, 1.05, spanX ? 0.3 : 1), toon('#7a4e33'), 0, 0.525, 0);
    const stripe = m(new BoxGeometry(spanX ? 1.01 : 0.31, 0.12, spanX ? 0.31 : 1.01), glow(color), 0, 0.75, 0, false);
    panel.add(slab, stripe);
    const g = onFloor(cell, ctx, panel);
    let y = 0;
    return {
      object: g,
      update: (sim, dt) => {
        const target = sim.doorOpen(cell) ? -1.0 : 0;
        y += (target - y) * Math.min(1, dt * 8);
        panel.position.y = y;
        panel.visible = y > -0.98;
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
    // an upright portal ring facing the camera, with one socket per required core
    const ring = m(new TorusGeometry(0.4, 0.07, 6, 24), toon('#9a90aa'), 0, 0.52, 0);
    const portal = m(new RingGeometry(0.0, 0.34, 24), glow('#3a2350'), 0, 0.52, -0.01, false);
    const pad = m(new BoxGeometry(0.95, 0.04, 0.5), toon('#9a90aa'), 0, 0.02, 0);
    const sockets: Mesh[] = [];
    const g = onFloor(cell, ctx, pad, ring, portal);
    return {
      object: g,
      update: (sim, _dt, t) => {
        const need = Number(cell.props.coresRequired) || sim.coresTotal;
        if (sockets.length !== need) {
          for (let i = 0; i < need; i++) {
            const a = Math.PI / 2 + ((i - (need - 1) / 2) * 0.6);
            const s = m(new OctahedronGeometry(0.07), glow('#333'), Math.cos(a) * 0.4, 0.52 + Math.sin(a) * 0.4, 0.06, false);
            sockets.push(s);
            g.add(s);
          }
        }
        sockets.forEach((s, i) => (s.material = glow(i < sim.cores ? '#7ff0ff' : '#333333')));
        const open = sim.cores >= need;
        portal.material = glow(open ? (Math.sin(t * 6) > 0 ? '#c46bff' : '#a24fe0') : '#3a2350');
        ring.material = open ? glow('#e2b8ff') : toon('#9a90aa');
      },
    };
  },
};
