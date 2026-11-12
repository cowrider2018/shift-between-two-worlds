/**
 * Motes welling up out of the reflection: the floor plane round the level reads as still water holding the other
 * dimension, and faint motes surface from it and drift up. Slow orange embers in the surface (A), cyan soul wisps
 * in the underside (B), matching the haunted doors. They surface anywhere but under the walkable floor: in the
 * open round the level, and under rock cells, so they show wherever the camera hole cuts the rock away; each appears as it breaks the surface, rises, sways and flickers, and thins away as it climbs.
 * Both dimensions share one layout and motion: the reflection (GameView.renderMirror) shows the other side's motes,
 * mirrored, so what sinks under the surface here is exactly what rises over there.
 * Everything moves in the vertex shader; only `time` changes per frame.
 * One art pixel or two per mote, so they sit in the pixel art like the rest.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial } from 'three';
import type { LevelGrid } from '../core/grid';
import type { DimIndex } from '../core/level';
import { WALL_H } from './terrain';
import { mulberry32 } from './texgen';

/** Motes per tile of the area they are scattered over (the floor cells are skipped). */
const DENSITY = 2.4;
/** How far round the level they spread, in tiles. */
const REACH = 8;
/** Height above the water (the floor plane, y = 0) at which they are gone. */
const RISE = 4;

/** Rise speed range and sideways sway, shared by both dimensions so each side's motes match the other's reflection. */
const SPEED = [0.3, 0.6] as const;
const SWAY = 0.35;

const STYLE = [
  { color: '#ffa04a', opacity: 0.75 }, // embers
  { color: '#7fe8dc', opacity: 0.6 }, // soul wisps
] as const;

export class Abyss {
  readonly points: [Points, Points];
  private readonly mats: ShaderMaterial[];

  constructor() {
    this.mats = STYLE.map((st) => new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        time: { value: 0 },
        color: { value: new Color(st.color) },
        sway: { value: SWAY },
        opacity: { value: st.opacity },
        rise: { value: RISE },
      },
      vertexShader: /* glsl */ `
        attribute vec4 seed; // phase, speed, flicker rate, size
        attribute float ceil; // how high this one may climb: under the top of the rock it rises in
        uniform float time, sway, rise;
        varying float vAlpha;
        void main() {
          float top = min(rise, ceil);
          float life = fract(seed.x + time * seed.y / top);
          vec3 p = position;
          p.y = life * top;
          // the sway grows as it leaves the water, so it surfaces on the spot
          p.x += sin(time * 0.6 + seed.x * 40.0) * sway * life;
          p.z += cos(time * 0.5 + seed.x * 23.0) * sway * life;
          // pops into sight as it breaks the surface, thins away as it climbs, with a flicker
          vAlpha = smoothstep(0.0, 0.06, life) * (1.0 - smoothstep(0.35, 1.0, life))
                 * (0.65 + 0.35 * sin(time * seed.z + seed.x * 17.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          // ones right by the camera (it hangs out over the water when it backs out of the level) would just
          // speckle the view: gone within a few tiles of it
          vAlpha *= smoothstep(2.0, 4.0, -mv.z);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = -mv.z < 6.0 ? seed.w + 1.0 : seed.w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float opacity;
        varying float vAlpha;
        // alpha carries the strength, so in the reflection pass it also tells the backdrop how much shows
        void main() { gl_FragColor = vec4(color, vAlpha * opacity); }
      `,
    }));
    this.points = [new Points(new BufferGeometry(), this.mats[0]), new Points(new BufferGeometry(), this.mats[1])];
    for (const p of this.points) p.frustumCulled = false;
  }

  /**
   * Scatter the motes round and through the level, anywhere neither dimension has walkable floor. Both
   * dimensions share the one layout and motion, so the reflection of one side (the other side's motes, mirrored)
   * matches the motes really rising over there.
   */
  setLevel(grid: LevelGrid, w: number, h: number): void {
    const rand = mulberry32(500);
    const count = Math.round(DENSITY * (w + REACH * 2) * (h + REACH * 2));
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    const ceil = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let x: number;
      let z: number;
      do {
        x = -REACH + rand() * (w + REACH * 2);
        z = -REACH + rand() * (h + REACH * 2);
      } while (!this.open(grid, 0, x, z) || !this.open(grid, 1, x, z));
      // inside the level's walls they stay under the wall top (they show only where the camera hole cuts
      // the rock away); out past the grid the rock is the tall outer rock or nothing
      ceil[i] = grid.inBounds(Math.floor(x), Math.floor(z)) ? WALL_H - 0.15 : RISE;
      pos[i * 3] = x;
      pos[i * 3 + 2] = z;
      seed[i * 4] = rand();
      seed[i * 4 + 1] = SPEED[0] + rand() * (SPEED[1] - SPEED[0]);
      seed[i * 4 + 2] = 1.5 + rand() * 4;
      seed[i * 4 + 3] = rand() < 0.25 ? 2 : 1;
    }
    this.points[0].geometry.dispose();
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('seed', new BufferAttribute(seed, 4));
    g.setAttribute('ceil', new BufferAttribute(ceil, 1));
    for (const p of this.points) p.geometry = g;
  }

  /** No floor tile here: rock (walls, the exit's rock, everything outside the grid). */
  private open(grid: LevelGrid, dim: DimIndex, x: number, z: number): boolean {
    const def = grid.cell(dim, Math.floor(x), Math.floor(z)).def;
    return def.solid === 'always' || def.behavior === 'exit';
  }

  setDim(dim: 0 | 1): void {
    this.points[0].visible = dim === 0;
    this.points[1].visible = dim === 1;
  }

  update(time: number): void {
    for (const m of this.mats) m.uniforms.time.value = time;
  }
}
