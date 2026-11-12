/**
 * Render registry: one model factory per block id in src/core/blocks.ts.
 * A factory returns an Object3D positioned at the cell origin plus an optional per-frame update.
 */
import {
  AdditiveBlending, BoxGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, PointLight, Shape, Vector3, ShapeGeometry, TorusGeometry,
  type Material, type Object3D,
} from 'three';
import type { Cell, LevelGrid } from '../core/grid';
import type { Sim } from '../core/sim';
import type { DimTheme } from './palette';
import { cobble, toon, whitening, wood } from './materials';
import { throughMouth, withHole, type Mouth } from './cutaway';
import { CAVE, WALL_H, caveGeometry, floorGeometry, isOuterRock, outerWallGeometry, wallGeometry } from './terrain';

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

/** Raise an outermost wall (see isOuterRock) on up to OUTER_H; the upper part casts no shadow. */
function addOuterWall(g: Group, cell: Cell, ctx: ModelCtx): void {
  if (!isOuterRock(ctx.grid, cell.dim, cell.x, cell.y)) return;
  const geo = outerWallGeometry(ctx.grid, cell.dim, cell.x, cell.y, ctx.theme.wallSide, ctx.theme.wallTop);
  g.add(m(geo, withHole(cobble('#ffffff', true)), 0, 0, 0, false));
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

export const BLOCK_MODELS: Record<string, BlockModelFactory> = {
  floor: (cell, ctx) => ({ object: onFloor(cell, ctx) }),

  wall: (cell, ctx) => {
    const g = wallGeometry(ctx.grid, cell.dim, cell.x, cell.y, ctx.theme.wallSide, ctx.theme.wallTop);
    const group = new Group();
    group.add(m(g, withHole(cobble('#ffffff', true))));
    addOuterWall(group, cell, ctx);
    return { object: place(group, cell) };
  },

  spawn: (cell, ctx) => ({ object: onFloor(cell, ctx) }),

  lever: (cell, ctx) => {
    const base = m(new BoxGeometry(0.44, 0.16, 0.3), toon('#5a5560'), 0, 0.06, 0);
    const arm = new Group();
    arm.position.y = 0.1;
    arm.add(m(new CylinderGeometry(0.04, 0.04, 0.45, 6), toon('#3a3238'), 0, 0.16, 0));
    arm.add(m(new IcosahedronGeometry(0.09), toon('#6a6470'), 0, 0.46, 0));
    const g = onFloor(cell, ctx, base, arm);
    let angle = -0.6;
    return {
      object: g,
      update: (sim, dt) => {
        const on = sim.leverOn(cell);
        const target = on ? 0.6 : -0.6;
        angle += (target - angle) * Math.min(1, dt * 12);
        arm.rotation.z = angle;
      },
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
    const rock = m(wallGeometry(ctx.grid, cell.dim, cell.x, cell.y, ctx.theme.wallSide, ctx.theme.wallTop, mouth), stone);
    // the tunnel takes no shadow from the rock over it: its light comes from inside
    // everything inside shows only through the arch, so it hides like the wall round it from any other angle
    // (e.g. through the camera hole cut into a neighbouring wall)
    const arch: Mouth = {
      origin: new Vector3(cell.x + 0.5 + dx * 0.5, 0, cell.y + 0.5 + dz * 0.5),
      normal: new Vector3(dx, 0, dz),
      along: new Vector3(-dz, 0, dx),
      half: CAVE.half,
      spring: CAVE.spring,
    };
    const tunnel = m(caveGeometry(ctx.grid, cell.dim, cell.x, cell.y, ctx.theme.wallSide, mouth),
      throughMouth(whitening(stone), arch), 0, 0, 0, false);
    tunnel.receiveShadow = false;
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
    g.add(rock, tunnel, inside);
    addOuterWall(g, cell, ctx);
    place(g, cell);
    return { object: g };
  },
};
