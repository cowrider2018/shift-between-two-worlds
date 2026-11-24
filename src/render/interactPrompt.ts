/**
 * The Space prompt: a small pixel keycap that floats over whatever Space would act on right now (a lever in reach, or
 * a monster to take down). It glides to the new target when the target changes, pops once, and fades out when Space
 * has nothing to do. It is drawn as an ordinary sprite, so the post pass pixelates it like everything else.
 */
import { CanvasTexture, NearestFilter, Sprite, SpriteMaterial, Vector3 } from 'three';

export type PromptKind = 'lever' | 'takedown';

export interface PromptTarget {
  kind: PromptKind;
  /** Identifies the target: a different key means the icon moves to it. */
  key: string;
  /** World position to float the icon at (x, y up, z). */
  x: number;
  y: number;
  z: number;
}

/** Keycap in art pixels: # outline, w face, d shaded lip, b the space-bar glyph, . transparent. */
const KEYCAP = [
  '.##########.',
  '#wwwwwwwwww#',
  '#wwwwwwwwww#',
  '#wwwwwwwwww#',
  '#wwbbbbbbww#',
  '#dddddddddd#',
  '.##########.',
];
const INK = '#1d1620';
/** The original look for both kinds: a white keycap with a red bar across it. */
const FACE = '#f4ecd8';
const LIP = '#b9ae98';
const BAR = '#e0302a';
/** World size of one art pixel at the default camera distance (see TEXEL_DENSITY). */
const PIXEL = 1 / 48;
/** The icon is drawn a little larger than one key's art pixels, so it still reads from the default distance. */
const SCALE = 1.6;
/** Bob amplitude and speed, world units and radians per second. */
const BOB = 0.035;
const BOB_SPEED = 5;
/** How quickly the icon glides to its target (per second, as a fraction of the way left). */
const GLIDE = 14;
const FADE = 8;
const POP = 5;

function keycapTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = KEYCAP[0].length;
  c.height = KEYCAP.length;
  const g = c.getContext('2d')!;
  KEYCAP.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      g.fillStyle = ch === '#' ? INK : ch === 'b' ? BAR : ch === 'w' ? FACE : LIP;
      g.fillRect(x, y, 1, 1);
    }
  });
  const tex = new CanvasTexture(c);
  tex.magFilter = tex.minFilter = NearestFilter;
  return tex;
}

export class InteractPrompt {
  readonly sprite: Sprite;
  private readonly mats: Record<PromptKind, SpriteMaterial>;
  private key = '';
  private kind: PromptKind = 'lever';
  private opacity = 0;
  private pop = 0;
  private readonly at = new Vector3();
  private readonly goal = new Vector3();

  constructor() {
    const keycap = new SpriteMaterial({ map: keycapTexture(), transparent: true, depthWrite: false });
    this.mats = { lever: keycap, takedown: keycap };
    this.sprite = new Sprite(this.mats.lever);
    this.sprite.visible = false;
    this.sprite.scale.set(KEYCAP[0].length * SCALE * PIXEL, KEYCAP.length * SCALE * PIXEL, 1);
  }

  /** A new level: forget the old target so the icon does not glide in from the last one. */
  reset(): void {
    this.key = '';
    this.opacity = 0;
    this.pop = 0;
    this.sprite.visible = false;
  }

  /** `target` is what Space acts on now, or null when it does nothing. */
  update(target: PromptTarget | null, dt: number, t: number): void {
    if (target) {
      if (target.key !== this.key) {
        // a fresh target appears where it is; a move from one target to another glides there
        if (this.opacity < 0.05) this.at.set(target.x, target.y, target.z);
        this.key = target.key;
        this.kind = target.kind;
        this.pop = 1;
      }
      this.goal.set(target.x, target.y, target.z);
    }
    this.opacity += ((target ? 1 : 0) - this.opacity) * Math.min(1, dt * FADE);
    this.at.lerp(this.goal, Math.min(1, dt * GLIDE));
    if (this.opacity < 0.01) {
      this.sprite.visible = false;
      return;
    }
    this.sprite.visible = true;
    this.sprite.material = this.mats[this.kind];
    this.mats[this.kind].opacity = this.opacity;
    this.sprite.position.set(this.at.x, this.at.y + Math.sin(t * BOB_SPEED) * BOB, this.at.z);
    const s = SCALE * PIXEL * (1 + 0.3 * this.pop);
    this.sprite.scale.set(KEYCAP[0].length * s, KEYCAP.length * s, 1);
    this.pop = Math.max(0, this.pop - dt * POP);
  }
}
