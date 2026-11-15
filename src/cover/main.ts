/**
 * Cover studio (cover.html, driven by scripts/cover.ts): the itch.io and README cover art, shot through the game's own
 * GameView so the walls, vision cones, outlines and rim light are exactly the ones in play.
 *
 * The picture is the two dimensions back to back, seen from the floor itself (eye on the ground, no pitch, no yaw), so
 * each floor is one flat line and the two meet at the seam. The top
 * half is the surface (A): the hero, cloaked and crouching, keeps their back to a pillar while a troll walks off
 * behind, its lantern's cone laid out ahead of it. The bottom half is the underside (B) seen the same way and flipped
 * upside down, so the two heroes meet feet to feet at the seam like a reflection, each against their own pillar;
 * there a ghost troll's cone reaches toward the hero and falls short. SHIFT and "between two worlds" sit on the seam,
 * left of the hero.
 *
 * Each half is a frame of one hand-made level (not in levels/, so it is never played), rendered one screen pixel per
 * art pixel and cropped to place the hero; the halves, the title and the scale-up are composed on a 2D canvas.
 * window.cover.shoot(layout, scale) returns the finished PNG as a data URL.
 */
import { PropertyBinding, Quaternion, Vector3, type Object3D } from 'three';
import { parseLevel, type DimIndex, type Level } from '../core/level';
import { Sim } from '../core/sim';
import { loadModels, type CharacterInstance } from '../render/models';
import { GameView } from '../render/view';

/** The stage, both dimensions the same size: an open room, so the cones lie across bare floor. The hero stands at
 *  HERO in both, facing HERO_FACING; the pillars differ, as walls do between the dimensions in play. */
const HERO: [number, number] = [12.5, 7.35];
const HERO_FACING = (130 * Math.PI) / 180;
const LEVEL = {
  format: 1,
  id: 'cover',
  name: 'cover',
  size: { w: 19, h: 12 },
  dimensions: [
    {
      rows: [
        '###################',
        '#.................#',
        '#......##.....##..#',
        '#......##.....##..#',
        '#.................#',
        '#.................#',
        '#...........#.....#',
        '#.................#',
        '#.................#',
        '#.................#',
        '#.........S.......#',
        '###################',
      ],
      props: {},
      // sitting on the floor with its back to the hero's pillar, looking off to the right, legs out ahead of it
      monsters: [{ id: 'a', path: [[13, 6]], mode: 'pingpong', speed: 1.6, pause: 0.6, viewRadius: 5, viewAngle: 70, facing: 10 }],
    },
    {
      rows: [
        '###################',
        '#.................#',
        '#.....##.......##.#',
        '#.....##.......##.#',
        '#.................#',
        '#.................#',
        '#...........#.....#',
        '#.................#',
        '#.................#',
        '#.................#',
        '#.................#',
        '###################',
      ],
      props: {},
      // a ghost standing at the hero's pillar, looking out toward us, over the hero
      monsters: [{ id: 'b', path: [[13, 6]], mode: 'pingpong', speed: 1.6, pause: 0.6, viewRadius: 5, viewAngle: 70, facing: 100 }],
    },
  ],
};

/** Where each monster stands, off the cell centres its path allows: right up against the pillar (whose right face is
 *  x = 13). */
const MONSTER_AT: Record<string, [number, number]> = { a: [13.4, 6.5], b: [13.45, 6.5] };

/** The troll has no sitting clip: SIT poses it over its idle, every frame after the mixer. The body drops by `drop`;
 *  each thigh swings forward and each shin back (radians, about the troll's own left-right axis). */
const SIT = { who: 'a', drop: 0, thigh: 0.75, shin: 0.5 };
const _q = new Quaternion();
const _p = new Quaternion();
const _axis = new Vector3();

/** Turn a bone about a world axis, keeping its parent where it is. */
function turnBone(bone: Object3D, axis: Vector3, angle: number): void {
  bone.parent!.getWorldQuaternion(_p);
  _q.setFromAxisAngle(axis, angle);
  // local' = parent⁻¹ · q · parent · local
  bone.quaternion.premultiply(_p.clone().invert().multiply(_q).multiply(_p));
  bone.updateMatrixWorld(true);
}

/** Seat a troll: after its own update each frame, lower it and fold its legs. The idle clip does not move the legs,
 *  so they are put back to their rest pose first; otherwise the turns would pile up frame on frame. */
function seat(body: CharacterInstance): void {
  const root = body.root;
  // the loader drops the dots from Blender's bone names (thigh.L -> thighL)
  const bone = (name: string) => root.getObjectByName(PropertyBinding.sanitizeNodeName(name))!;
  const legs = ['L', 'R'].map((side) => ({ thigh: bone(`thigh.${side}`), shin: bone(`shin.${side}`) }));
  const rest = legs.map((l) => [l.thigh.quaternion.clone(), l.shin.quaternion.clone()]);
  const update = body.update.bind(body);
  body.update = (dt: number) => {
    update(dt);
    root.position.y -= SIT.drop;
    root.updateMatrixWorld(true);
    // the model faces +x, so its left-right axis is its z
    _axis.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new Quaternion()));
    legs.forEach((l, i) => {
      l.thigh.quaternion.copy(rest[i][0]);
      l.shin.quaternion.copy(rest[i][1]);
      l.thigh.updateMatrixWorld(true);
      turnBone(l.thigh, _axis, SIT.thigh);
      turnBone(l.shin, _axis, SIT.shin);
    });
  };
}

/** One half of the picture: which dimension, the camera, and where in the rendered frame the half is cut from. */
interface Half {
  dim: DimIndex;
  /** The camera looks level along the grid's -y (no pitch, no yaw), from `dist` in front of the hero at height
   *  `eye`; at 0 it sits on the floor, which then shows as one level line through the hero's feet. */
  eye: number;
  dist: number;
  /** Rendered frame, art pixels: its height sets how large things are (the camera's field of view spans it). The
   *  half is cut from it round the hero's feet. */
  frame: [number, number];
}

interface Layout {
  /** The finished picture in art pixels (the PNG is this times the scale). */
  w: number;
  h: number;
  /** Where the seam runs, art pixels from the top. */
  seam: number;
  /** Where the hero's feet land in the top half; the bottom half mirrors it about the seam. */
  hero: [number, number];
  top: Half;
  bottom: Half;
  /** Title and subtitle: font size in art pixels (multiples of 10 keep the pixel font on its grid) and baseline. */
  title: { size: number; x: number; y: number };
  sub: { size: number; x: number; y: number };
}

const LAYOUTS: Record<string, Layout> = {
  itch: {
    w: 315, h: 250, seam: 125, hero: [165, 125],
    top: { dim: 0, eye: 0, dist: 2.4, frame: [460, 250] },
    bottom: { dim: 1, eye: 0, dist: 2.4, frame: [460, 250] },
    title: { size: 40, x: 82, y: 140 },
    sub: { size: 10, x: 82, y: 152 },
  },
  wide: {
    w: 640, h: 360, seam: 180, hero: [360, 180],
    top: { dim: 0, eye: 0, dist: 2.4, frame: [840, 360] },
    bottom: { dim: 1, eye: 0, dist: 2.4, frame: [840, 360] },
    title: { size: 60, x: 190, y: 202 },
    sub: { size: 20, x: 190, y: 222 },
  },
};

const STEP = 1 / 60;
/** Frames run before a shot, for the animations to settle. */
const FRAMES = 150;

let view: GameView;
let level: Level;

/** Render one half: a fresh sim with the hero and monsters placed, run FRAMES frames, copy the crop out. */
function half(h: Half, w: number, hh: number, at: [number, number]): HTMLCanvasElement {
  const sim = new Sim(level);
  sim.dim = h.dim;
  [sim.x, sim.y] = HERO;
  sim.sneaking = true;
  // crouched still against the pillar, out of sight
  sim.moving = false;
  sim.facing = HERO_FACING;
  for (const m of sim.monsters) [m.x, m.y] = MONSTER_AT[m.def.id] ?? [m.x, m.y];
  view.setSim(sim);
  for (const mv of (view as unknown as { monsters: { state: { def: { id: string } }; body: CharacterInstance }[] }).monsters)
    if (mv.state.def.id === SIT.who) seat(mv.body);
  view.pipeline.pixelSize = 1;
  const size = view.pipeline.resize(h.frame[0], h.frame[1]);
  const follow = view.follow;
  follow.setViewport(size.w, size.h);
  // the game's camera always looks down (8° at least): stand in a level one, aimed straight along -y
  follow.distance = h.dist;
  follow.update = () => {
    follow.camera.position.set(HERO[0], h.eye, HERO[1] + h.dist);
    follow.camera.lookAt(HERO[0], h.eye, HERO[1]);
    follow.camera.updateMatrixWorld();
    follow.subpixel.x = follow.subpixel.y = 0;
  };
  for (let i = 0; i < FRAMES; i++) view.frame(STEP);
  // read the WebGL canvas in the same task as the render, before its buffer is cleared
  const out = document.createElement('canvas');
  out.width = w;
  out.height = hh;
  const feet = new Vector3(HERO[0], 0, HERO[1]).project(follow.camera);
  const x = Math.round((feet.x * 0.5 + 0.5) * h.frame[0]) - at[0];
  const y = Math.round((0.5 - feet.y * 0.5) * h.frame[1]) - at[1];
  if (x < 0 || y < 0 || x + w > h.frame[0] || y + hh > h.frame[1]) throw new Error(`frame ${h.frame} too small for the crop`);
  out.getContext('2d')!.drawImage(view.pipeline.canvas, -x, -y);
  return out;
}

/** Text with a one-pixel drop shadow, every pixel fully on or off (the font's own pixels, no smoothing). */
function text(ctx: CanvasRenderingContext2D, s: string, size: number, x: number, y: number, color: string): void {
  const c = document.createElement('canvas');
  c.width = ctx.canvas.width;
  c.height = ctx.canvas.height;
  const t = c.getContext('2d')!;
  t.font = `${size}px "Fusion Pixel 10px"`;
  t.textAlign = 'center';
  t.textBaseline = 'alphabetic';
  t.fillStyle = '#000';
  t.fillText(s, x + Math.max(1, size / 20), y + Math.max(1, size / 20));
  t.fillStyle = color;
  t.fillText(s, x, y);
  const img = t.getImageData(0, 0, c.width, c.height);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] >= 128 ? 255 : 0;
  t.putImageData(img, 0, 0);
  ctx.drawImage(c, 0, 0);
}

function shoot(name: string, scale: number): string {
  const L = LAYOUTS[name];
  if (!L) throw new Error(`no layout "${name}"`);
  const art = document.createElement('canvas');
  art.width = L.w;
  art.height = L.h;
  const ctx = art.getContext('2d')!;
  ctx.drawImage(half(L.top, L.w, L.seam, L.hero), 0, 0);
  // the underside upside down beneath the surface
  ctx.save();
  ctx.translate(0, L.h);
  ctx.scale(1, -1);
  ctx.drawImage(half(L.bottom, L.w, L.h - L.seam, [L.hero[0], L.h - L.seam - (L.seam - L.hero[1])]), 0, 0);
  ctx.restore();
  text(ctx, 'SHIFT', L.title.size, L.title.x, L.title.y, '#f4eedd');
  text(ctx, 'between two worlds', L.sub.size, L.sub.x, L.sub.y, '#f4eedd');
  const out = document.createElement('canvas');
  out.width = L.w * scale;
  out.height = L.h * scale;
  const o = out.getContext('2d')!;
  o.imageSmoothingEnabled = false;
  o.drawImage(art, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

async function boot(): Promise<void> {
  const parsed = parseLevel(LEVEL);
  if (!parsed.level) throw new Error(`cover level: ${parsed.errors.join('; ')}`);
  level = parsed.level;
  await Promise.all([loadModels('/models/'), document.fonts.load('10px "Fusion Pixel 10px"')]);
  view = new GameView(document.getElementById('gl') as HTMLCanvasElement);
  (window as unknown as { cover: unknown }).cover = { layouts: Object.keys(LAYOUTS), shoot };
}

void boot();
