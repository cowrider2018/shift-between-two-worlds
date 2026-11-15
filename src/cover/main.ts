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
 * The icon ('icon') is shot like the control pages instead (src/render/briefing.ts): the troll's face straight on, flat,
 * against a canvas of rock, once in each dimension, the underside's left half beside the surface's right half.
 * window.cover.shoot(layout, scale) returns the finished PNG as a data URL.
 */
import {
  BufferAttribute, Color, DirectionalLight, HemisphereLight, Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector3,
} from 'three';
import { parseLevel, type DimIndex, type Level } from '../core/level';
import { Sim } from '../core/sim';
import { COBBLE_SPAN } from '../render/cobbleTexture';
import { cobble } from '../render/materials';
import { CharacterInstance, loadModels } from '../render/models';
import { THEMES } from '../render/palette';
import { renderStandalone } from '../render/standalone';
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
      // sitting on the floor with its back to the hero's pillar, looking off to the right (a single-point path: the
      // game seats a troll that never walks)
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
      // a ghost standing at the left of the hero's pillar, looking away to the left (two path points keep it on its feet)
      monsters: [{ id: 'b', path: [[11, 6], [11, 7]], mode: 'pingpong', speed: 1.6, pause: 0.6, viewRadius: 5, viewAngle: 70, facing: 180 }],
    },
  ],
};

/** Where each monster stands, off the cell centres its path allows: right up against the pillar (whose right face is
 *  x = 13). */
const MONSTER_AT: Record<string, [number, number]> = { a: [13.4, 6.5], b: [11.65, 6.5] };

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
  // the same density as wide (art pixels per unit at the hero), so the hero's face, eyes and all, is drawn the same:
  // the frame is 500/360 as tall, so the camera stands 500/360 as far off
  itch: {
    w: 630, h: 500, seam: 250, hero: [395, 250],
    top: { dim: 0, eye: 0, dist: (2.4 * 500) / 360, frame: [800, 500] },
    bottom: { dim: 1, eye: 0, dist: (2.4 * 500) / 360, frame: [800, 500] },
    title: { size: 60, x: 175, y: 272 },
    sub: { size: 20, x: 175, y: 292 },
  },
  wide: {
    w: 640, h: 360, seam: 180, hero: [400, 180],
    top: { dim: 0, eye: 0, dist: 2.4, frame: [840, 360] },
    bottom: { dim: 1, eye: 0, dist: 2.4, frame: [840, 360] },
    title: { size: 60, x: 190, y: 202 },
    sub: { size: 20, x: 190, y: 222 },
  },
};

/** The icon: the troll's face straight on, the left half from the underside (B, its ghost), the right half from the
 *  surface (A), in the control pages' flat look: a very narrow field of view from far off, so nothing recedes, and a
 *  flat canvas of rock behind instead of a room. */
const ICON = {
  /** Art pixels, square. */
  size: 128,
  /** World units shown top to bottom, and how far above the head bone's root the picture centres. */
  viewH: 1.3,
  lift: 0.0,
  /** Field of view (degrees) and the rock canvas's distance behind the troll. */
  fov: 6,
  back: 1.5,
  /** World units one cobble tile spans on the canvas: the floor's own size, which in a picture only half the control
   *  pages' height shows each stone twice as large there, big and quiet behind the see-through ghost. */
  span: COBBLE_SPAN,
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
  for (const m of sim.monsters) {
    [m.x, m.y] = MONSTER_AT[m.def.id] ?? [m.x, m.y];
    // a patrol faces along its path; these stand still, facing where the level says
    m.angle = (m.def.facing * Math.PI) / 180;
  }
  view.setSim(sim);
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

/** One dimension of the icon, full frame: that dimension's troll (the underside's a ghost) facing us in front of a
 *  canvas of its rock, in its light. Both are posed the same, at the same moment of the same clip. */
function iconHalf(dim: DimIndex): HTMLCanvasElement {
  const th = THEMES[dim];
  const scene = new Scene();
  scene.background = new Color(th.background);
  scene.add(new HemisphereLight(th.hemiSky, th.hemiGround, 1.5));
  const sun = new DirectionalLight(th.sun, 1.8);
  // from the front, high and to the left, as on the control pages
  sun.position.set(-4, 6, 8);
  scene.add(sun, sun.target);
  const w = 20;
  const g = new PlaneGeometry(w, w);
  g.translate(0, 0, -ICON.back);
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / ICON.span;
    uv[i * 2 + 1] = pos.getY(i) / ICON.span;
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  scene.add(new Mesh(g, cobble(th.floor[0])));
  const troll = new CharacterInstance('troll', dim === 1 ? 'ghost' : 'normal');
  troll.root.rotation.y = -Math.PI / 2; // facing the camera
  troll.play('idle', 0);
  scene.add(troll.root);
  for (let i = 0; i < FRAMES; i++) troll.update(STEP);
  troll.root.updateMatrixWorld(true);
  const head = (troll.root.getObjectByName('head') ?? troll.root).getWorldPosition(new Vector3());
  const y = head.y + ICON.lift;

  const pipeline = view.pipeline;
  pipeline.pixelSize = 1;
  const size = pipeline.resize(ICON.size, ICON.size);
  const camera = new PerspectiveCamera(ICON.fov, size.w / size.h, 1, 100);
  const dist = ICON.viewH / 2 / Math.tan((ICON.fov * Math.PI) / 360);
  camera.position.set(0, y, dist);
  camera.near = dist - 5;
  camera.far = dist + 5;
  camera.updateProjectionMatrix();
  camera.lookAt(0, y, 0);
  renderStandalone(pipeline, scene, camera, sun, FRAMES * STEP);
  const out = document.createElement('canvas');
  out.width = out.height = ICON.size;
  out.getContext('2d')!.drawImage(pipeline.canvas, 0, 0);
  return out;
}

/** The icon, `scale` screen pixels per art pixel: underside on the left, surface on the right. */
function icon(scale: number): string {
  const n = ICON.size;
  const art = document.createElement('canvas');
  art.width = art.height = n;
  const ctx = art.getContext('2d')!;
  ctx.drawImage(iconHalf(1), 0, 0, n / 2, n, 0, 0, n / 2, n);
  ctx.drawImage(iconHalf(0), n / 2, 0, n / 2, n, n / 2, 0, n / 2, n);
  const out = document.createElement('canvas');
  out.width = out.height = n * scale;
  const o = out.getContext('2d')!;
  o.imageSmoothingEnabled = false;
  o.drawImage(art, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
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
  (window as unknown as { cover: unknown }).cover = { layouts: [...Object.keys(LAYOUTS), 'icon'], shoot: (name: string, scale: number) => (name === 'icon' ? icon(scale) : shoot(name, scale)) };
}

void boot();
