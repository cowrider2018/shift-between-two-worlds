/**
 * Character models built in Blender (art/blender/*.py → public/models/*.glb).
 * Materials are re-mapped by name to the game's toon / glow materials using art/palette.json,
 * so the pixel pipeline treats imported models exactly like everything else.
 */
import {
  AnimationMixer, LoopOnce, Mesh, PropertyBinding, Quaternion, Vector3, type AnimationAction, type AnimationClip,
  type Interpolant, type Material, type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import palette from '../../art/palette.json';
import { withRockMask } from './cutaway';
import { ghost, glow, toon } from './materials';
import { CHARACTER } from './palette';

type PaletteEntry = { color: string; emissive?: boolean; doubleSided?: boolean };
const PALETTE = palette as Record<string, PaletteEntry>;

export const MODEL_NAMES = ['troll', 'hero'] as const;
export type ModelName = (typeof MODEL_NAMES)[number];

interface Template {
  scene: Object3D;
  clips: AnimationClip[];
  /** Outfit name -> part node names to show; every part named in any outfit is hidden otherwise. */
  variants: Record<string, string[]>;
}

/** Clips that play once and hold until finished instead of looping. */
const ONE_SHOT = new Set(['attack', 'alert', 'takedown', 'death']);

const templates = new Map<ModelName, Template>();

/** One track of a clip sampled by hand (CharacterInstance.pose): the node it moves and its value at any time. */
interface PoseTrack {
  key: string;
  node: Object3D;
  prop: 'quaternion' | 'scale';
  sample: Interpolant;
}

/** KeyframeTrack.createInterpolant exists at run time (set per track type) but is missing from three's types. */
type SampledTrack = { createInterpolant(): Interpolant };

const q = new Quaternion();
const v = new Vector3();

export async function loadModels(base = './models/'): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    MODEL_NAMES.map(async (name) => {
      const gltf = await loader.loadAsync(`${base}${name}.glb`);
      let variants: Record<string, string[]> = {};
      gltf.scene.traverse((o) => {
        if (typeof o.userData.variants === 'string') variants = JSON.parse(o.userData.variants);
      });
      templates.set(name, { scene: gltf.scene, clips: gltf.animations, variants });
    }),
  );
}

function paletteMaterial(name: string): Material {
  const entry = PALETTE[name];
  if (!entry) return withRockMask(toon('#ff00ff')); // loud magenta: a material name missing from the palette
  return withRockMask(entry.emissive ? glow(entry.color) : toon(entry.color, undefined, entry.doubleSided));
}

/** A posed, animated instance of a character model. */
export class CharacterInstance {
  readonly root: Object3D;
  private readonly mixer: AnimationMixer;
  private readonly actions = new Map<string, AnimationAction>();
  private current: AnimationAction | null = null;
  private readonly variants: Record<string, string[]>;
  private outfit = '';
  private readonly clips = new Map<string, AnimationClip>();
  private readonly poseTracks = new Map<string, PoseTrack[]>();

  constructor(name: ModelName, look: 'normal' | 'ghost', outfit?: string) {
    const t = templates.get(name);
    if (!t) throw new Error(`model "${name}" not loaded`);
    this.root = cloneSkinned(t.scene);
    this.variants = t.variants;
    const outfits = Object.keys(t.variants);
    if (outfits.length) this.setOutfit(outfit && t.variants[outfit] ? outfit : outfits[0]);
    const ghostMat = withRockMask(ghost(CHARACTER.ghost));
    this.root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const mapped = mats.map((m: Material) => (look === 'ghost' ? ghostMat : paletteMaterial(m.name)));
      o.material = Array.isArray(o.material) ? mapped : mapped[0];
      o.castShadow = look === 'normal';
      o.frustumCulled = false; // skinned bounds do not follow the animation
    });
    this.mixer = new AnimationMixer(this.root);
    for (const clip of t.clips) {
      this.clips.set(clip.name, clip);
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    }
    for (const [clip, action] of this.actions) {
      if (!ONE_SHOT.has(clip)) continue;
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
    }
  }

  /** Show one outfit's parts and hide every other outfit part (no-op if already worn or unknown). */
  setOutfit(name: string): void {
    const shown = this.variants[name];
    if (!shown || name === this.outfit) return;
    this.outfit = name;
    const parts = new Set(Object.values(this.variants).flat());
    this.root.traverse((o) => {
      if (parts.has(o.name)) o.visible = shown.includes(o.name);
    });
  }

  /** Name of the clip playing now ('' before any has played). */
  get clip(): string {
    return this.current?.getClip().name ?? '';
  }

  /** True while a one-shot clip (e.g. attack) is still playing; looping clips must not cut it off. */
  private busy(): boolean {
    const c = this.current;
    return !!c && c.loop === LoopOnce && c.isRunning() && c.getClip().name !== 'alert';
  }

  /** Restart a clip from the beginning (used for one-shots such as attack). */
  trigger(name: string, fade = 0.06): void {
    const next = this.actions.get(name);
    if (!next) return;
    next.reset().play();
    if (this.current && this.current !== next) next.crossFadeFrom(this.current, fade, false);
    this.current = next;
  }

  /** Cross-fade to a clip by name (no-op if already playing). */
  play(name: string, fade = 0.2, timeScale = 1): void {
    const next = this.actions.get(name);
    if (!next || this.busy()) return;
    next.timeScale = timeScale;
    if (next === this.current) return;
    next.reset().play();
    if (this.current) next.crossFadeFrom(this.current, fade, false);
    this.current = next;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  /**
   * Pose some bones from a clip at `progress` (0..1 of its length) over whatever the mixer posed, so it can run on top
   * of any other clip: call after update(). `weights` maps "bone.quaternion" / "bone.scale" (Blender bone names) to how
   * far the bone goes from its current pose to the clip's (1 = all the way); tracks not listed are left alone.
   */
  pose(clip: string, progress: number, weights: Record<string, number>): void {
    const tracks = this.tracksOf(clip);
    if (!tracks) return;
    const time = progress * this.clips.get(clip)!.duration;
    // glTF node names lose their dots ("cape.1" -> "cape1"): match the callers' Blender names the same way
    const byNode = new Map<string, number>();
    for (const [key, w] of Object.entries(weights)) {
      const dot = key.lastIndexOf('.');
      byNode.set(`${PropertyBinding.sanitizeNodeName(key.slice(0, dot))}${key.slice(dot)}`, w);
    }
    for (const t of tracks) {
      const w = byNode.get(t.key);
      if (!w) continue;
      const value = t.sample.evaluate(time);
      if (t.prop === 'quaternion') t.node.quaternion.slerp(q.fromArray(value), w);
      else t.node.scale.lerp(v.fromArray(value), w);
    }
  }

  private tracksOf(name: string): PoseTrack[] | undefined {
    const known = this.poseTracks.get(name);
    if (known) return known;
    const clip = this.clips.get(name);
    if (!clip) return undefined;
    const tracks: PoseTrack[] = [];
    for (const track of clip.tracks) {
      const { nodeName, propertyName } = PropertyBinding.parseTrackName(track.name);
      if (propertyName !== 'quaternion' && propertyName !== 'scale') continue;
      const node = this.root.getObjectByName(nodeName);
      if (!node) continue;
      tracks.push({ key: `${nodeName}.${propertyName}`, node, prop: propertyName, sample: (track as unknown as SampledTrack).createInterpolant() });
    }
    this.poseTracks.set(name, tracks);
    return tracks;
  }
}
