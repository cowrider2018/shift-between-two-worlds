/**
 * Procedural flagstone texture: irregular, flat, angular stones split by thin dark mortar, each stone with
 * its own tone and a mottled surface. Neutral grey so a material colour tints it per dimension.
 * Tiles seamlessly over COBBLE_SPAN world units.
 */
import { DataTexture, NearestFilter, NearestMipmapNearestFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace } from 'three';

/** World units covered by one repeat of the texture. */
export const COBBLE_SPAN = 2;
/** Texels per repeat (power of two for mipmaps) and stones per repeat edge. */
const SIZE = 128;
const STONES = 6;
/** Mortar where the two nearest stone centres are this close in distance (in stone-cell units). */
const MORTAR = 0.07;
/** Stones darken toward their edge across this band. */
const EDGE = 0.3;

let tex: DataTexture | null = null;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Stone { x: number; y: number; tone: number; hue: number }

/** Tileable value noise with `period` lattice cells across the texture. */
function valueNoise(seed: number, period: number): (u: number, v: number) => number {
  const r = mulberry32(seed);
  const lat = Array.from({ length: period * period }, r);
  const at = (i: number, j: number) => lat[((j % period) + period) % period * period + (((i % period) + period) % period)];
  return (u, v) => {
    const x = u * period;
    const y = v * period;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
    const bot = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return top + (bot - top) * sy;
  };
}

export function cobbleTexture(): DataTexture {
  if (tex) return tex;
  const rand = mulberry32(11);
  const stones: Stone[] = [];
  for (let cy = 0; cy < STONES; cy++) {
    for (let cx = 0; cx < STONES; cx++) {
      stones.push({ x: cx + 0.1 + rand() * 0.8, y: cy + 0.1 + rand() * 0.8, tone: rand(), hue: rand() - 0.5 });
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
  tex.minFilter = NearestMipmapNearestFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
