/**
 * Procedural flagstone texture: irregular, flat, angular stones split by thin dark mortar, each stone with
 * its own tone and a mottled surface. Neutral grey so a material colour tints it per dimension.
 * Tiles seamlessly over COBBLE_SPAN world units.
 */
import { DataTexture, NearestFilter, NearestMipmapNearestFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace } from 'three';
import { mulberry32, TEXEL_DENSITY, valueNoise } from './texgen';

/** World units covered by one repeat of the texture. */
export const COBBLE_SPAN = 2;
/** Texels per repeat: one texel per art pixel (DESIGN §4.1); and stones per repeat edge. */
const SIZE = COBBLE_SPAN * TEXEL_DENSITY;
const STONES = 6;
/** Mortar where the two nearest stone centres are this close in distance (in stone-cell units). */
const MORTAR = 0.07;
/** Stones darken toward their edge across this band. */
const EDGE = 0.3;

let tex: DataTexture | null = null;

interface Stone { x: number; y: number; tone: number; hue: number; crack: number }

/** Share of stones that carry a hairline crack, and its length in stone-cell units. */
const CRACK_CHANCE = 0.3;
const CRACK_LEN = 0.32;
/** Half-width of a crack line, in stone-cell units (about half an art pixel). */
const CRACK_HALF = 0.5 / (TEXEL_DENSITY * COBBLE_SPAN / STONES);
/** Chance per texel of a light speck on a stone surface. */
const SPECK_CHANCE = 0.005;

/** Cheap integer hash to [0, 1), for per-texel decisions that must stay the same every run. */
function hash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function cobbleTexture(): DataTexture {
  if (tex) return tex;
  const rand = mulberry32(11);
  const stones: Stone[] = [];
  for (let cy = 0; cy < STONES; cy++) {
    for (let cx = 0; cx < STONES; cx++) {
      const crack = rand() < CRACK_CHANCE ? rand() * Math.PI * 2 : -1;
      stones.push({ x: cx + 0.1 + rand() * 0.8, y: cy + 0.1 + rand() * 0.8, tone: rand(), hue: rand() - 0.5, crack });
    }
  }
  const coarse = valueNoise(3, 8);
  const fine = valueNoise(5, 32);
  const data = new Uint8Array(SIZE * SIZE * 4);
  const cell = SIZE / STONES;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const fx = (px + 0.5) / cell;
      const fy = (py + 0.5) / cell;
      let f1 = Infinity;
      let f2 = Infinity;
      let best: Stone = stones[0];
      let bestX = 0;
      let bestY = 0;
      const gx = Math.floor(fx);
      const gy = Math.floor(fy);
      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          const sx = gx + ox;
          const sy = gy + oy;
          const wx = ((sx % STONES) + STONES) % STONES;
          const wy = ((sy % STONES) + STONES) % STONES;
          const s = stones[wy * STONES + wx];
          const d = Math.hypot(fx - (s.x + sx - wx), fy - (s.y + sy - wy));
          if (d < f1) {
            f2 = f1;
            f1 = d;
            best = s;
            bestX = s.x + sx - wx;
            bestY = s.y + sy - wy;
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
      const gap = f2 - f1;
      const u = px / SIZE;
      const v = py / SIZE;
      let lum: number;
      let hue = 0;
      if (gap < MORTAR) {
        lum = 0.26 + fine(u, v) * 0.06;
      } else {
        lum = 0.6 + best.tone * 0.26;
        lum += (coarse(u + best.tone, v) - 0.5) * 0.14 + (fine(u, v) - 0.5) * 0.1; // mottling
        if (gap < EDGE) lum -= ((EDGE - gap) / (EDGE - MORTAR)) * 0.1; // worn edges
        if (best.crack >= 0) {
          // a hairline crack: a short segment from the stone's centre, drawn as a dark line one texel wide
          const ax = Math.cos(best.crack);
          const ay = Math.sin(best.crack);
          const rx = fx - bestX;
          const ry = fy - bestY;
          const t = Math.min(CRACK_LEN, Math.max(0, rx * ax + ry * ay));
          if (Math.hypot(rx - ax * t, ry - ay * t) < CRACK_HALF) lum -= 0.15;
        }
        if (hash(px, py) < SPECK_CHANCE) lum += 0.09; // a rare light fleck of grit
        hue = best.hue * 0.06;
      }
      const q = (x: number) => Math.round(Math.min(1, Math.max(0, Math.round(x / 0.03) * 0.03)) * 255);
      const i = (py * SIZE + px) * 4;
      data[i] = q(lum * (1 + hue));
      data[i + 1] = q(lum);
      data[i + 2] = q(lum * (1 - hue));
      data[i + 3] = 255;
    }
  }
  tex = new DataTexture(data, SIZE, SIZE, RGBAFormat);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = NearestFilter;
  // mipmaps for distant or grazing floor under the perspective camera; without them it shimmers into moire
  tex.minFilter = NearestMipmapNearestFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
