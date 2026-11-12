/**
 * The water the reflection lies in: a plane just under the floor, covering the level and round it, drawn with a
 * few hand-drawn pixel-art frames of the water's surface played in a loop like a flipbook. Mostly clear, so the
 * reflection shows through: short glints of light that stretch and shrink, small rings spreading out and thinning,
 * and the odd twinkle. The floor hides it wherever there is floor; it shows where the reflection does.
 */
import { Color, DataTexture, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry, RGBAFormat, RepeatWrapping, SRGBColorSpace } from 'three';
import { mulberry32, TEXEL_DENSITY } from './texgen';

/** World units per repeat of the drawing. */
const SPAN = 8;
const SIZE = SPAN * TEXEL_DENSITY;
/** Frames in the loop, and how long each is held. */
const FRAMES = 4;
const FRAME_TIME = 0.22;
/** How far round the level the water reaches; the fog has hidden it well before then. */
const REACH = 40;
/** Just under the floor, so the floor tiles always win. */
const DROP = 0.01;

interface Glint { x: number; y: number; len: number; phase: number }
interface Ring { x: number; y: number; phase: number }
interface Twinkle { x: number; y: number; frame: number }

function drawFrames(): DataTexture[] {
  const rand = mulberry32(77);
  const glints: Glint[] = Array.from({ length: 280 }, () => ({ x: rand() * SIZE, y: rand() * SIZE, len: 3 + Math.floor(rand() * 8), phase: Math.floor(rand() * FRAMES) }));
  const rings: Ring[] = Array.from({ length: 14 }, () => ({ x: rand() * SIZE, y: rand() * SIZE, phase: Math.floor(rand() * FRAMES) }));
  const twinkles: Twinkle[] = Array.from({ length: 160 }, () => ({ x: rand() * SIZE, y: rand() * SIZE, frame: Math.floor(rand() * FRAMES) }));
  return Array.from({ length: FRAMES }, (_, f) => {
    const data = new Uint8Array(SIZE * SIZE * 4);
    const plot = (x: number, y: number, a: number) => {
      const px = ((Math.round(x) % SIZE) + SIZE) % SIZE;
      const py = ((Math.round(y) % SIZE) + SIZE) % SIZE;
      const i = (py * SIZE + px) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.max(data[i + 3], Math.round(a * 255));
    };
    // glints: a dash of light that grows, holds, shrinks and is gone, drifting a pixel a frame
    const GROW = [0.4, 1, 0.7, 0];
    for (const g of glints) {
      const k = GROW[(f + g.phase) % FRAMES];
      const n = Math.round(g.len * k);
      const x0 = g.x + ((f + g.phase) % FRAMES) - n / 2;
      for (let i = 0; i < n; i++) plot(g.y, x0 + i, i === 0 || i === n - 1 ? 0.3 : 0.55);
    }
    // rings: a drop's ripple spreading out over the loop, fainter as it grows
    for (const r of rings) {
      const step = (f + r.phase) % FRAMES;
      const rad = 3 + step * 4;
      const a = 0.45 * (1 - step / FRAMES);
      const n = Math.round(rad * 6);
      // round on the water: the camera's slant flattens it on screen
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        plot(r.x + Math.cos(t) * rad, r.y + Math.sin(t) * rad, a);
      }
    }
    // twinkles: a single bright pixel with a faint cross, on one frame only
    for (const t of twinkles) {
      if (t.frame !== f) continue;
      plot(t.x, t.y, 0.9);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) plot(t.x + dx, t.y + dy, 0.3);
    }
    const tex = new DataTexture(data, SIZE, SIZE, RGBAFormat);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.magFilter = tex.minFilter = NearestFilter;
    tex.needsUpdate = true;
    return tex;
  });
}

let frames: DataTexture[] | null = null;

export class WaterSurface {
  readonly mesh: Mesh;
  /** One material per frame: the flipbook swaps materials (swapping a material's map left later frames unuploaded). */
  private readonly mats: MeshBasicMaterial[];

  constructor() {
    const tex = (frames ??= drawFrames());
    this.mats = tex.map((map) => new MeshBasicMaterial({ map, transparent: true, depthWrite: false, opacity: 0.8 }));
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.mats[0]);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 1;
  }

  /** Spread the water under a level of w x h tiles, its drawing anchored to the grid. */
  setLevel(w: number, h: number): void {
    const sx = w + REACH * 2;
    const sz = h + REACH * 2;
    this.mesh.geometry.dispose();
    const g = new PlaneGeometry(sx, sz);
    const uv = g.getAttribute('uv');
    const pos = g.getAttribute('position');
    // plane space before the rotation: x along x, y along -z
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + sx / 2 - REACH) / SPAN, (pos.getY(i) + sz / 2 - REACH) / SPAN);
    this.mesh.geometry = g;
    this.mesh.position.set(w / 2, -DROP, h / 2);
  }

  /** Glints take the shown dimension's light. */
  setTint(color: string): void {
    for (const m of this.mats) m.color = new Color(color);
  }

  update(time: number): void {
    this.mesh.material = this.mats[Math.floor(time / FRAME_TIME) % FRAMES];
  }
}
