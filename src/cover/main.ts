/**
 * Cover studio (cover.html, driven by scripts/cover.ts): the itch.io and README cover art, shot through the game's own
 * GameView so the walls, vision cones, outlines and rim light are exactly the ones in play.
 *
 * The picture is the two dimensions back to back. The top half is the surface (A): the hero, cloaked and crouching
 * near the seam, with a troll walking off behind them, its lantern's cone laid out ahead of it. The bottom half is the
 * underside (B) seen the same way and flipped upside down, so the two heroes meet feet to feet at the seam like a
 * reflection; there a ghost troll's cone reaches toward the hero and falls short. SHIFT and "between two worlds" sit
 * on the seam, left of the hero.
 *
 * Each half is a frame of one hand-made level (not in levels/, so it is never played), rendered one screen pixel per
 * art pixel and cropped to place the hero; the halves, the title and the scale-up are composed on a 2D canvas.
 * window.cover.shoot(layout, scale) returns the finished PNG as a data URL.
 */
import { parseLevel, type DimIndex, type Level } from '../core/level';
import { Sim } from '../core/sim';
import { loadModels } from '../render/models';
import { GameView } from '../render/view';

/** The stage, both dimensions the same size: an open room, so the cones lie across bare floor. The hero stands at
 *  HERO in both, facing HERO_FACING; the pillars differ, as walls do between the dimensions in play. */
const HERO: [number, number] = [8.5, 7.5];
const HERO_FACING = (150 * Math.PI) / 180;
const LEVEL = {
  format: 1,
  id: 'cover',
  name: 'cover',
  size: { w: 15, h: 12 },
  dimensions: [
    {
      rows: [
        '###############',
        '#.............#',
        '#..##.....##..#',
        '#..##.....##..#',
        '#.............#',
        '#.............#',
        '#.............#',
        '#.............#',
        '#.............#',
        '#.............#',
        '#.....S.......#',
        '###############',
      ],
      props: {},
      // walking away from the hero toward the left, its cone stretched out ahead of it
      monsters: [{ id: 'a', path: [[8, 4]], mode: 'pingpong', speed: 1.6, pause: 0.6, viewRadius: 5, viewAngle: 70, facing: 200 }],
    },
    {
      rows: [
        '###############',
        '#.............#',
        '#.##...#...##.#',
        '#.##...#...##.#',
        '#.............#',
        '#.............#',
        '#.............#',
        '#.............#',
        '#.............#',
        '#.............#',
        '#.............#',
        '###############',
      ],
      props: {},
      // a ghost on the far side, its cone swept toward the hero and falling just short
      monsters: [{ id: 'b', path: [[6, 4]], mode: 'pingpong', speed: 1.6, pause: 0.6, viewRadius: 3.5, viewAngle: 70, facing: 56 }],
    },
  ],
};

/** One half of the picture: which dimension, the camera, and where in the rendered frame the half is cut from. */
interface Half {
  dim: DimIndex;
  /** Grid angle the camera looks along (radians), and its pitch above the ground (degrees, 8..80). */
  yaw: number;
  elev: number;
  /** Boom length (CAMERA.minDistance..distance). */
  dist: number;
  /** Rendered frame, art pixels: its height sets how large things are (the camera's field of view spans it). The
   *  camera aims at the hero, so the hero is at its centre; the half is cut from it round that. */
  frame: [number, number];
}

interface Layout {
  /** The finished picture in art pixels (the PNG is this times the scale). */
  w: number;
  h: number;
  /** Where the seam runs, art pixels from the top. */
  seam: number;
  /** Where the camera's aim on the hero (mid-body) lands in the top half; the bottom half mirrors it about the seam. */
  hero: [number, number];
  top: Half;
  bottom: Half;
  /** Title and subtitle: font size in art pixels (multiples of 10 keep the pixel font on its grid) and baseline. */
  title: { size: number; x: number; y: number };
  sub: { size: number; x: number; y: number };
}

const LAYOUTS: Record<string, Layout> = {
  itch: {
    w: 315, h: 250, seam: 125, hero: [225, 88],
    top: { dim: 0, yaw: -Math.PI / 2 + 0.35, elev: 32, dist: 3.8, frame: [460, 230] },
    bottom: { dim: 1, yaw: -Math.PI / 2 + 0.35, elev: 32, dist: 3.8, frame: [460, 230] },
    title: { size: 40, x: 90, y: 140 },
    sub: { size: 10, x: 90, y: 152 },
  },
  wide: {
    w: 640, h: 360, seam: 180, hero: [420, 127],
    top: { dim: 0, yaw: -Math.PI / 2 + 0.35, elev: 32, dist: 3.8, frame: [840, 330] },
    bottom: { dim: 1, yaw: -Math.PI / 2 + 0.35, elev: 32, dist: 3.8, frame: [840, 330] },
    title: { size: 60, x: 190, y: 202 },
    sub: { size: 20, x: 190, y: 222 },
  },
};

const STEP = 1 / 60;
/** Frames run before a shot: the camera and the animations settle; the monsters walk the last WALK of them. */
const FRAMES = 150;
const WALK = 60;

let view: GameView;
let level: Level;

/** Render one half: a fresh sim with the hero and monsters placed, run FRAMES frames, copy the crop out. */
function half(h: Half, w: number, hh: number, at: [number, number]): HTMLCanvasElement {
  const sim = new Sim(level);
  sim.dim = h.dim;
  [sim.x, sim.y] = HERO;
  sim.sneaking = true;
  sim.moving = true;
  sim.facing = HERO_FACING;
  view.setSim(sim);
  view.pipeline.pixelSize = 1;
  const size = view.pipeline.resize(h.frame[0], h.frame[1]);
  view.follow.setViewport(size.w, size.h);
  view.follow.yaw = h.yaw;
  view.follow.tilt(-10);
  view.follow.tilt(((h.elev - 8) * Math.PI) / 180);
  view.follow.zoom(50);
  view.follow.zoom(Math.log(h.dist / 5.2) / Math.log(1.15));
  for (let i = 0; i < FRAMES; i++) {
    if (i >= FRAMES - WALK) {
      for (const m of sim.monsters) {
        m.x += Math.cos(m.angle) * m.def.speed * STEP;
        m.y += Math.sin(m.angle) * m.def.speed * STEP;
      }
    } else if (i === 0) {
      // start each monster WALK frames back, so it ends on its path point
      for (const m of sim.monsters) {
        m.x -= Math.cos(m.angle) * m.def.speed * STEP * WALK;
        m.y -= Math.sin(m.angle) * m.def.speed * STEP * WALK;
      }
    }
    view.frame(STEP);
  }
  // read the WebGL canvas in the same task as the render, before its buffer is cleared
  const out = document.createElement('canvas');
  out.width = w;
  out.height = hh;
  const x = h.frame[0] / 2 - at[0];
  const y = h.frame[1] / 2 - at[1];
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
