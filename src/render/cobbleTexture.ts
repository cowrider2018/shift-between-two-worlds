/**
 * Procedural cobblestone texture: rounded stones in dark mortar, lit from the top-left.
 * Neutral grey so a material colour tints it per dimension. Tiles seamlessly over COBBLE_SPAN world units.
 */
import { DataTexture, NearestFilter, NearestMipmapNearestFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace } from 'three';

/** World units covered by one repeat of the texture. */
export const COBBLE_SPAN = 2;
/** Texels per repeat (power of two for mipmaps) and stones per repeat edge. */
const SIZE = 128;
const STONES = 10;

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

interface Stone { x: number; y: number; r: number; tone: number }

export function cobbleTexture(): DataTexture {
  if (tex) return tex;
  const rand = mulberry32(7);
  const stones: Stone[] = [];
  for (let cy = 0; cy < STONES; cy++) {
    for (let cx = 0; cx < STONES; cx++) {
      stones.push({ x: cx + 0.3 + rand() * 0.4, y: cy + 0.3 + rand() * 0.4, r: 0.5 + rand() * 0.12, tone: rand() });
    }
  }
  const data = new Uint8Array(SIZE * SIZE * 4);
  const cell = SIZE / STONES;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const fx = (px + 0.5) / cell;
      const fy = (py + 0.5) / cell;
      let f1 = Infinity;
      let f2 = Infinity;
      let best: Stone = stones[0];
      let bdx = 0;
      let bdy = 0;
      const gx = Math.floor(fx);
      const gy = Math.floor(fy);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const sx = gx + ox;
          const sy = gy + oy;
          const s = stones[((sy + STONES) % STONES) * STONES + ((sx + STONES) % STONES)];
          const dx = fx - (s.x + (sx - ((sx + STONES) % STONES)));
          const dy = fy - (s.y + (sy - ((sy + STONES) % STONES)));
          const d = Math.hypot(dx, dy);
          if (d < f1) {
            f2 = f1;
            f1 = d;
            best = s;
            bdx = dx;
            bdy = dy;
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
      let lum: number;
      if (f2 - f1 < 0.16 || f1 > best.r) {
        lum = 0.4; // mortar
      } else {
        lum = 0.8 + best.tone * 0.14;
        const rim = f1 / best.r;
        if (rim > 0.55) {
          const k = (rim - 0.55) / 0.45;
          lum += (((-bdx - bdy) / Math.SQRT2) / Math.max(f1, 1e-6)) * 0.12 * k; // lit top-left, shaded bottom-right
        }
        if (rand() < 0.05) lum -= 0.06; // grit
      }
      const v = Math.round(Math.min(1, Math.max(0, Math.round(lum / 0.04) * 0.04)) * 255);
      const i = (py * SIZE + px) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
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
