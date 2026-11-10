/** Deterministic helpers shared by the procedural textures. */

/** Seeded PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise with `period` lattice cells across the texture. */
export function valueNoise(seed: number, period: number): (u: number, v: number) => number {
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
