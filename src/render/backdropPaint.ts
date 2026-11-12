/**
 * The hand-drawn layer of the backdrop: a flat pixel-art cross-section of the ground the level is cut from,
 * one per dimension. The surface (A) is warm earth strata threaded with roots and pebbles; the underside (B) is
 * cold slate strata full of bones, skulls and rubble. Bands get a dark ink line on top and a lit edge under it,
 * so it reads drawn rather than rendered. Tiles seamlessly both ways (the backdrop lays it on the floor plane).
 */
import { DataTexture, NearestFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace } from 'three';
import { mulberry32 } from './texgen';

/** Size in texels (one per art pixel at TEXEL_DENSITY on the ground, like the level's own textures). */
export const PAINT_W = 320;
export const PAINT_H = 160;
const BANDS = 7;

interface PaintStyle {
  seed: number;
  bands: string[];
  ink: string;
  /** Lit edge just under each band's ink line, as a brightening factor. */
  lit: number;
  deco: (p: Painter, rand: () => number) => void;
}

/** Tileable value noise with separate periods across (u) and down (v), so it can be stretched along the strata. */
function noise2(seed: number, pu: number, pv: number): (u: number, v: number) => number {
  const r = mulberry32(seed);
  const lat = Array.from({ length: pu * pv }, r);
  const at = (i: number, j: number) => lat[(((j % pv) + pv) % pv) * pu + (((i % pu) + pu) % pu)];
  return (u, v) => {
    const x = u * pu;
    const y = v * pv;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const sx = (x - i) * (x - i) * (3 - 2 * (x - i));
    const sy = (y - j) * (y - j) * (3 - 2 * (y - j));
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
    const bot = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return top + (bot - top) * sy;
  };
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Pixel plotting with wrap-around, so stamps across the edge continue on the far side. */
class Painter {
  readonly data = new Uint8Array(PAINT_W * PAINT_H * 4);
  set(x: number, y: number, c: [number, number, number]): void {
    const px = ((Math.round(x) % PAINT_W) + PAINT_W) % PAINT_W;
    const py = ((Math.round(y) % PAINT_H) + PAINT_H) % PAINT_H;
    const i = (py * PAINT_W + px) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = 255;
  }
  /** A filled ellipse with a 1px ink outline and a lit upper-left rim. */
  blob(cx: number, cy: number, rx: number, ry: number, fill: string, ink: string, lit: string): void {
    const f = rgb(fill);
    const k = rgb(ink);
    const l = rgb(lit);
    for (let y = -ry - 1; y <= ry + 1; y++) {
      for (let x = -rx - 1; x <= rx + 1; x++) {
        const d = (x / (rx + 0.5)) ** 2 + (y / (ry + 0.5)) ** 2;
        const dOut = (x / (rx + 1.4)) ** 2 + (y / (ry + 1.4)) ** 2;
        if (d <= 1) this.set(cx + x, cy + y, d > 0.45 && x + y < -1 ? l : f);
        else if (dOut <= 1) this.set(cx + x, cy + y, k);
      }
    }
  }
  /** A line of `w` px, ink on both sides. */
  line(x0: number, y0: number, x1: number, y1: number, fill: string, ink: string, w = 1): void {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    const f = rgb(fill);
    const k = rgb(ink);
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) pts.push([x0 + ((x1 - x0) * i) / Math.max(1, n), y0 + ((y1 - y0) * i) / Math.max(1, n)]);
    for (const [x, y] of pts) for (let a = -w; a <= w; a++) for (let b = -w; b <= w; b++) this.set(x + a, y + b, k);
    for (const [x, y] of pts) for (let a = 0; a < w; a++) for (let b = 0; b < w; b++) this.set(x + a, y + b, f);
  }
}

const SURFACE: PaintStyle = {
  seed: 101,
  bands: ['#3d2615', '#4b301a', '#33200f', '#57391f', '#432a17', '#4f3320', '#382311'],
  ink: '#170d05',
  lit: 1.35,
  deco: (p, rand) => {
    // roots: wandering down from a band line, forking now and then
    const root = (x: number, y: number, len: number, w: number) => {
      let a = Math.PI / 2 + (rand() - 0.5) * 0.6;
      for (let i = 0; i < len; i += 3) {
        const nx = x + Math.cos(a) * 3;
        const ny = y + Math.sin(a) * 3;
        p.line(x, y, nx, ny, '#5c3d20', '#1d1108', w);
        x = nx;
        y = ny;
        a += (rand() - 0.5) * 0.7;
        a = Math.min(Math.PI * 0.85, Math.max(Math.PI * 0.15, a));
        if (rand() < 0.08 && len - i > 12) root(x, y, (len - i) * 0.6, 0);
      }
    };
    for (let i = 0; i < 9; i++) root(rand() * PAINT_W, rand() * PAINT_H, 18 + rand() * 40, rand() < 0.4 ? 1 : 0);
    for (let i = 0; i < 26; i++) {
      const r = 1 + Math.floor(rand() * 4);
      p.blob(rand() * PAINT_W, rand() * PAINT_H, r + 1, r, rand() < 0.5 ? '#6e4c2c' : '#5f4127', '#1d1108', '#8a6440');
    }
  },
};

const UNDERSIDE: PaintStyle = {
  seed: 202,
  bands: ['#1c232d', '#252e3a', '#181e27', '#2c3644', '#202833', '#283240', '#1a2029'],
  ink: '#07090d',
  lit: 1.4,
  deco: (p, rand) => {
    const bone = '#a7b3c0';
    const ink = '#07090d';
    // long bones: a shaft with a knob at each end
    for (let i = 0; i < 14; i++) {
      const x = rand() * PAINT_W;
      const y = rand() * PAINT_H;
      const a = (rand() - 0.5) * 1.2;
      const len = 7 + rand() * 9;
      const ex = x + Math.cos(a) * len;
      const ey = y + Math.sin(a) * len;
      p.line(x, y, ex, ey, bone, ink, 1);
      for (const [kx, ky] of [[x, y], [ex, ey]]) {
        p.blob(kx - Math.sin(a) * 1.2, ky + Math.cos(a) * 1.2, 1, 1, bone, ink, '#d4dde6');
        p.blob(kx + Math.sin(a) * 1.2, ky - Math.cos(a) * 1.2, 1, 1, bone, ink, '#d4dde6');
      }
    }
    // skulls: a dome, two dark sockets, a row of teeth
    for (let i = 0; i < 4; i++) {
      const x = rand() * PAINT_W;
      const y = rand() * PAINT_H;
      p.blob(x, y, 5, 4, bone, ink, '#d4dde6');
      const k = rgb(ink);
      for (const sx of [-2, 2]) for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) p.set(x + sx - 0.5 + a, y + b, k);
      p.set(x, y + 2, k);
      for (let t = -2; t <= 2; t++) p.set(x + t, y + 4, t % 2 === 0 ? rgb(bone) : k);
    }
    // rubble
    for (let i = 0; i < 24; i++) {
      const r = 1 + Math.floor(rand() * 3);
      p.blob(rand() * PAINT_W, rand() * PAINT_H, r + 1, r, rand() < 0.5 ? '#3a4554' : '#33404e', ink, '#56657a');
    }
  },
};

const cache: (DataTexture | null)[] = [null, null];

export function backdropPaint(dim: 0 | 1): DataTexture {
  const hit = cache[dim];
  if (hit) return hit;
  const style = dim === 0 ? SURFACE : UNDERSIDE;
  const rand = mulberry32(style.seed);
  const warp = noise2(style.seed + 1, 4, 2);
  const wobble = noise2(style.seed + 2, 16, 4);
  const streak = noise2(style.seed + 3, 8, 48);
  const mottle = noise2(style.seed + 4, 24, 12);
  const bands = style.bands.map(rgb);
  const ink = rgb(style.ink);
  const p = new Painter();
  const bandPx = PAINT_H / BANDS;
  for (let py = 0; py < PAINT_H; py++) {
    for (let px = 0; px < PAINT_W; px++) {
      const u = px / PAINT_W;
      const v = py / PAINT_H;
      // strata lines wander across the picture
      const y = (v + (warp(u, v) - 0.5) * 0.12 + (wobble(u, v) - 0.5) * 0.03 + 1) % 1;
      const f = y * BANDS;
      const band = Math.floor(f) % BANDS;
      const inBand = (f - Math.floor(f)) * bandPx; // px below this band's top line
      let c: [number, number, number];
      if (inBand < 1) c = ink;
      else {
        const base = bands[band];
        let k = 1 + (streak(u, v) - 0.5) * 0.35 + (mottle(u, v) - 0.5) * 0.15;
        if (inBand < 2.2) k *= style.lit; // the drawn lit edge under the ink line
        // quantise to a few flat steps, like a limited hand-picked ramp
        k = Math.round(k / 0.12) * 0.12;
        c = [0, 1, 2].map((i) => Math.min(255, Math.round(base[i] * k))) as [number, number, number];
      }
      p.set(px, py, c);
    }
  }
  style.deco(p, rand);
  const tex = new DataTexture(p.data, PAINT_W, PAINT_H, RGBAFormat);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  cache[dim] = tex;
  return tex;
}
