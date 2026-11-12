/**
 * The abyss under the level: faint motes drifting up out of the dark below the floor, round and beneath the level
 * (the floor hides those right under it). Slow orange embers in the surface (A), cyan soul wisps in the
 * underside (B), matching the haunted doors. Each mote rises, sways, flickers, and fades in from the deep and out
 * before it reaches the floor. Everything moves in the vertex shader; only `time` changes per frame.
 * One art pixel or two per mote, so they sit in the pixel art like the rest.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial } from 'three';
import { mulberry32 } from './texgen';

/** Motes per dimension. */
const COUNT = 420;
/** How far round the level they spread, in tiles. */
const REACH = 12;
/** Depth they rise from, and how far below the floor they are gone. */
const DEPTH = 14;
const TOP = 0.6;

const STYLE = [
  { color: '#ffa04a', speed: [0.35, 0.7], sway: 0.25, opacity: 0.75 }, // embers
  { color: '#7fe8dc', speed: [0.25, 0.5], sway: 0.45, opacity: 0.6 }, // soul wisps
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
        sway: { value: st.sway },
        opacity: { value: st.opacity },
        depth: { value: DEPTH },
        top: { value: TOP },
      },
      vertexShader: /* glsl */ `
        attribute vec4 seed; // phase, speed, flicker rate, size
        uniform float time, sway, depth, top;
        varying float vAlpha;
        void main() {
          float life = fract(seed.x + time * seed.y / depth);
          vec3 p = position;
          p.y = -depth + life * (depth - top);
          p.x += sin(time * 0.6 + seed.x * 40.0) * sway;
          p.z += cos(time * 0.5 + seed.x * 23.0) * sway;
          // in from the deep, out before the floor, with a flicker
          vAlpha = smoothstep(0.0, 0.35, life) * (1.0 - smoothstep(0.8, 1.0, life))
                 * (0.65 + 0.35 * sin(time * seed.z + seed.x * 17.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = -mv.z < 6.0 ? seed.w + 1.0 : seed.w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float opacity;
        varying float vAlpha;
        void main() { gl_FragColor = vec4(color * vAlpha * opacity, 1.0); }
      `,
    }));
    this.points = [new Points(new BufferGeometry(), this.mats[0]), new Points(new BufferGeometry(), this.mats[1])];
    for (const p of this.points) p.frustumCulled = false;
  }

  /** Scatter the motes round a level of w x h tiles. */
  setLevel(w: number, h: number): void {
    this.points.forEach((pts, dim) => {
      const st = STYLE[dim];
      const rand = mulberry32(500 + dim);
      const pos = new Float32Array(COUNT * 3);
      const seed = new Float32Array(COUNT * 4);
      for (let i = 0; i < COUNT; i++) {
        pos[i * 3] = -REACH + rand() * (w + REACH * 2);
        pos[i * 3 + 2] = -REACH + rand() * (h + REACH * 2);
        seed[i * 4] = rand();
        seed[i * 4 + 1] = st.speed[0] + rand() * (st.speed[1] - st.speed[0]);
        seed[i * 4 + 2] = 1.5 + rand() * 4;
        seed[i * 4 + 3] = rand() < 0.25 ? 2 : 1;
      }
      pts.geometry.dispose();
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setAttribute('seed', new BufferAttribute(seed, 4));
      pts.geometry = g;
    });
  }

  setDim(dim: 0 | 1): void {
    this.points[0].visible = dim === 0;
    this.points[1].visible = dim === 1;
  }

  update(time: number): void {
    for (const m of this.mats) m.uniforms.time.value = time;
  }
}
