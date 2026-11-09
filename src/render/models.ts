/**
 * Character models built in Blender (art/blender/*.py → public/models/*.glb).
 * Materials are re-mapped by name to the game's toon / glow materials using art/palette.json,
 * so the pixel pipeline treats imported models exactly like everything else.
 */
import { AnimationMixer, LoopOnce, Mesh, type AnimationAction, type AnimationClip, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import palette from '../../art/palette.json';
import { ghost, glow, toon } from './materials';
import { CHARACTER } from './palette';

type PaletteEntry = { color: string; emissive?: boolean };
const PALETTE = palette as Record<string, PaletteEntry>;

export const MODEL_NAMES = ['troll'] as const;
export type ModelName = (typeof MODEL_NAMES)[number];

interface Template {
  scene: Object3D;
  clips: AnimationClip[];
}

const templates = new Map<ModelName, Template>();

export async function loadModels(base = './models/'): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    MODEL_NAMES.map(async (name) => {
      const gltf = await loader.loadAsync(`${base}${name}.glb`);
      templates.set(name, { scene: gltf.scene, clips: gltf.animations });
    }),
  );
}

function paletteMaterial(name: string): Material {
  const entry = PALETTE[name];
  if (!entry) return toon('#ff00ff'); // loud magenta: a material name missing from the palette
  return entry.emissive ? glow(entry.color) : toon(entry.color);
}

/** A posed, animated instance of a character model. */
export class CharacterInstance {
  readonly root: Object3D;
  private readonly mixer: AnimationMixer;
  private readonly actions = new Map<string, AnimationAction>();
  private current: AnimationAction | null = null;

  constructor(name: ModelName, look: 'normal' | 'soul') {
    const t = templates.get(name);
    if (!t) throw new Error(`model "${name}" not loaded`);
    this.root = cloneSkinned(t.scene);
    const soulMat = ghost(CHARACTER.soul);
    this.root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const mapped = mats.map((m: Material) => (look === 'soul' ? soulMat : paletteMaterial(m.name)));
      o.material = Array.isArray(o.material) ? mapped : mapped[0];
      o.castShadow = look === 'normal';
      o.frustumCulled = false; // skinned bounds do not follow the animation
    });
    this.mixer = new AnimationMixer(this.root);
    for (const clip of t.clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    const alert = this.actions.get('alert');
    if (alert) {
      alert.setLoop(LoopOnce, 1);
      alert.clampWhenFinished = true;
    }
  }

  /** Cross-fade to a clip by name (no-op if already playing). */
  play(name: string, fade = 0.2, timeScale = 1): void {
    const next = this.actions.get(name);
    if (!next) return;
    next.timeScale = timeScale;
    if (next === this.current) return;
    next.reset().play();
    if (this.current) next.crossFadeFrom(this.current, fade, false);
    this.current = next;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }
}
