/**
 * Drifting motes round the hero (DESIGN §4.3): embers rising in the surface (A), snow falling in the underside (B).
 * They are single-pixel points in a field fixed to the world, wrapped round the hero so the field never runs out.
 * Brightest near the hero and dimmest at the edge of the field, so they gather the eye where the hero is. They are
 * added to the scene itself, not to a dimension's group, so the reflection does not show them.
 */
import { BufferAttribute, BufferGeometry, Color, Points, PointsMaterial } from 'three';
import { mulberry32 } from './texgen';

const COUNT = 90;
/** Half-width of the field round the hero, in world units. */
const RANGE = 6;
const HEIGHT = 2.4;
/** Vertical speed per dimension: embers rise, snow falls. */
const RISE = [0.12, -0.08] as const;
const COLOURS = [new Color('#ffb85c'), new Color('#cfe8ff')] as const;

/** `d` wrapped into [-RANGE, RANGE). */
function wrap(d: number): number {
  return ((((d + RANGE) % (2 * RANGE)) + 2 * RANGE) % (2 * RANGE)) - RANGE;
}

export class Motes {
  readonly points: Points;
  private readonly pos = new Float32Array(COUNT * 3);
  private readonly vel = new Float32Array(COUNT * 2);
  private readonly phase = new Float32Array(COUNT);
  private readonly col = new Float32Array(COUNT * 3);
  private readonly position = new BufferAttribute(this.pos, 3);
  private readonly colour = new BufferAttribute(this.col, 3);

  constructor() {
    const rand = mulberry32(21);
    for (let i = 0; i < COUNT; i++) {
      this.pos[i * 3] = (rand() * 2 - 1) * RANGE;
      this.pos[i * 3 + 1] = rand() * HEIGHT;
      this.pos[i * 3 + 2] = (rand() * 2 - 1) * RANGE;
      this.vel[i * 2] = (rand() - 0.5) * 0.3;
      this.vel[i * 2 + 1] = (rand() - 0.5) * 0.3;
      this.phase[i] = rand() * Math.PI * 2;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('color', this.colour);
    // one art pixel: the points are drawn into the low-res frame, so a size of 1 is exactly one art pixel
    const material = new PointsMaterial({ vertexColors: true, size: 1, sizeAttenuation: false });
    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
  }

  /** Move the motes round the hero at (cx, cz) in dimension `dim`; `t` is the view's clock in seconds. */
  update(cx: number, cz: number, dim: number, dt: number, t: number): void {
    const base = COLOURS[dim];
    const rise = RISE[dim];
    for (let i = 0; i < COUNT; i++) {
      const p = i * 3;
      this.pos[p] += this.vel[i * 2] * dt;
      this.pos[p + 2] += this.vel[i * 2 + 1] * dt;
      this.pos[p + 1] = ((this.pos[p + 1] + rise * dt) % HEIGHT + HEIGHT) % HEIGHT;
      // keep the field round the hero: a mote that drifts past the edge reappears on the far side
      const dx = wrap(this.pos[p] - cx);
      const dz = wrap(this.pos[p + 2] - cz);
      this.pos[p] = cx + dx;
      this.pos[p + 2] = cz + dz;
      const near = 1 - Math.min(1, Math.hypot(dx, dz) / RANGE);
      const flicker = 0.7 + 0.3 * Math.sin(t * 2.5 + this.phase[i]);
      const k = (0.25 + 0.75 * near) * flicker * 2.2; // bright enough to read through the dark, dimmer far off
      this.col[p] = base.r * k;
      this.col[p + 1] = base.g * k;
      this.col[p + 2] = base.b * k;
    }
    this.position.needsUpdate = true;
    this.colour.needsUpdate = true;
  }
}
