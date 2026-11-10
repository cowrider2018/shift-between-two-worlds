/**
 * Procedural weathered-plank texture for door faces: vertical boards with dark seams, long grain streaks,
 * per-board tone and the odd knot. Neutral grey-brown so a material colour tints it.
 * Maps once onto a face (u across the boards, v along them).
 */
import { DataTexture, NearestFilter, NearestMipmapNearestFilter, RGBAFormat, SRGBColorSpace } from 'three';
import { mulberry32, valueNoise } from './texgen';

const W = 64;
const H = 128;
const BOARDS = 5;

let tex: DataTexture | null = null;

export function woodTexture(): DataTexture {
  if (tex) return tex;
  const rand = mulberry32(23);
  const boards = Array.from({ length: BOARDS }, () => ({
    tone: rand(),
    shift: rand(),
    knot: rand() < 0.6 ? { v: 0.15 + rand() * 0.7, u: 0.3 + rand() * 0.4, r: 0.04 + rand() * 0.03 } : null,
  }));
  const grain = valueNoise(31, 64);
  const blotch = valueNoise(37, 8);
  const data = new Uint8Array(W * H * 4);
  const bw = W / BOARDS;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W;
      const v = (py + 0.5) / H;
      const bi = Math.min(BOARDS - 1, Math.floor(px / bw));
      const b = boards[bi];
      const lu = (px - bi * bw) / bw; // 0..1 across this board
      let lum: number;
      if (px % Math.round(bw) === 0) {
        lum = 0.2; // seam between boards
      } else {
        // grain: noise stretched hard along the board
        const g = grain(u * 0.5 + b.shift, v * 0.06 + b.shift);
        lum = 0.62 + b.tone * 0.16 + (g - 0.5) * 0.34 + (blotch(u, v) - 0.5) * 0.12;
        if (lu < 0.12 || lu > 0.88) lum -= 0.06; // rounded board edges catch less light
        if (b.knot) {
          const d = Math.hypot((lu - b.knot.u) * 1.6, (v - b.knot.v) * (H / bw) * 0.55);
          if (d < b.knot.r * 4) lum -= 0.22 * Math.max(0, 1 - d / (b.knot.r * 4));
        }
      }
      const q = Math.round(Math.min(1, Math.max(0, Math.round(lum / 0.03) * 0.03)) * 255);
      const i = (py * W + px) * 4;
      data[i] = q;
      data[i + 1] = Math.round(q * 0.96);
      data[i + 2] = Math.round(q * 0.9);
      data[i + 3] = 255;
    }
  }
  tex = new DataTexture(data, W, H, RGBAFormat);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestMipmapNearestFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
