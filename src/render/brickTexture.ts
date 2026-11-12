/**
 * Procedural stone-brick texture for the backdrop under and round the level: big rectangular blocks in running
 * bond, split by dark mortar, each block with its own tone, worn edges and the odd chip. The blocks are several
 * times the size of the floor's flagstones, so the backdrop reads as something apart from the level.
 * Neutral grey so a material colour tints it per dimension. Tiles seamlessly over BRICK_SPAN world units.
 */
import { DataTexture, NearestFilter, NearestMipmapNearestFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace } from 'three';
import { mulberry32, TEXEL_DENSITY, valueNoise } from './texgen';

/** World units covered by one repeat of the texture. */
export const BRICK_SPAN = 4;
const SIZE = BRICK_SPAN * TEXEL_DENSITY;
/** Courses per repeat and bricks per course: each brick is 1 x 0.5 world units. */
const ROWS = 8;
const COLS = 4;
/** Mortar width, in texels. */
const MORTAR = 2;

let tex: DataTexture | null = null;

export function brickTexture(): DataTexture {
  if (tex) return tex;
  const rand = mulberry32(41);
  const bricks = Array.from({ length: ROWS * COLS }, () => ({ tone: rand(), hue: rand() - 0.5, chip: rand() }));
  const coarse = valueNoise(43, 8);
  const fine = valueNoise(47, 48);
  const bh = SIZE / ROWS;
  const bw = SIZE / COLS;
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let py = 0; py < SIZE; py++) {
    const row = Math.floor(py / bh);
    const ly = py - row * bh;
    for (let px = 0; px < SIZE; px++) {
      // every other course shifts half a brick (running bond)
      const sx = (px + (row % 2) * (bw / 2)) % SIZE;
      const col = Math.floor(sx / bw);
      const lx = sx - col * bw;
      const b = bricks[row * COLS + col];
      const u = px / SIZE;
      const v = py / SIZE;
      // distance to the brick's edge, roughened so the joints wander a little
      const edge = Math.min(lx, bw - 1 - lx, ly, bh - 1 - ly) + (coarse(u * 3, v * 3) - 0.5) * 1.6;
      let lum: number;
      let hue = 0;
      if (edge < MORTAR) {
        lum = 0.2 + fine(u, v) * 0.06;
      } else {
        lum = 0.55 + b.tone * 0.22;
        lum += (coarse(u + b.tone, v) - 0.5) * 0.16 + (fine(u, v) - 0.5) * 0.1;
        if (edge < MORTAR + 3) lum -= 0.08; // worn, rounded arrises
        else if (ly < MORTAR + 6) lum += 0.04; // the top of each block catches a little more light
        // a chipped corner on some blocks
        if (b.chip < 0.35 && Math.hypot(lx - bw * b.chip * 2, ly - bh * 0.7) < bh * 0.22) lum -= 0.14;
        hue = b.hue * 0.06;
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
