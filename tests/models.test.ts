/** Checks the exported character models without a GPU: reads the glTF JSON chunk of each .glb. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import palette from '../art/palette.json';
import { MODEL_NAMES } from '../src/render/models';

interface Gltf {
  animations?: {
    name: string;
    channels: { sampler: number; target: { node: number; path: string } }[];
    samplers: { output: number }[];
  }[];
  bufferViews: { byteOffset?: number }[];
  skins?: { joints: number[] }[];
  materials?: { name: string }[];
  nodes: { name?: string }[];
  meshes: { primitives: { indices?: number }[] }[];
  accessors: { count: number; bufferView: number; byteOffset?: number; type: string }[];
}

function readGlb(path: string): Gltf {
  return readGlbWithBin(path).json;
}

function readGlbWithBin(path: string): { json: Gltf; bin: Buffer } {
  const b = readFileSync(path);
  expect(b.toString('ascii', 0, 4)).toBe('glTF');
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
  const binLen = b.readUInt32LE(20 + len);
  return { json, bin: b.subarray(28 + len, 28 + len + binLen) };
}

/** Every float of an accessor (tightly packed, as the Blender exporter writes them). */
function floats(g: Gltf, bin: Buffer, index: number): number[] {
  const a = g.accessors[index];
  const n = a.count * ({ SCALAR: 1, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type];
  const off = (g.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0);
  return Array.from({ length: n }, (_, i) => bin.readFloatLE(off + i * 4));
}

const SPEC: Record<string, { animations: string[]; bones: string[]; maxTris: number }> = {
  troll: {
    animations: ['idle', 'sit', 'walk', 'alert', 'attack', 'death'],
    bones: ['root', 'hips', 'head', 'ear.L', 'ear.R', 'hand.L', 'hand.R', 'foot.L', 'foot.R'],
    maxTris: 8000,
  },
  hero: {
    animations: ['idle', 'run', 'attack', 'crouch', 'crouch_walk', 'takedown'],
    bones: ['root', 'hips', 'head', 'cape.1', 'hand.R', 'foot.L', 'foot.R', 'hair_full', 'hair_hood', 'hood', 'cape',
      'sword.R', 'sword.back'],
    maxTris: 8000,
  },
};

describe('character models', () => {
  for (const name of MODEL_NAMES) {
    it(`${name}.glb has its animations, bones, palette materials and stays in budget`, () => {
      const g = readGlb(resolve(import.meta.dirname, '..', 'public', 'models', `${name}.glb`));
      const spec = SPEC[name];
      expect(spec, `add a SPEC entry for ${name}`).toBeDefined();
      const anims = (g.animations ?? []).map((a) => a.name);
      for (const a of spec.animations) expect(anims).toContain(a);
      const nodes = g.nodes.map((n) => n.name);
      for (const bone of spec.bones) expect(nodes).toContain(bone);
      expect(g.skins?.length).toBeGreaterThan(0);
      for (const m of g.materials ?? []) expect(Object.keys(palette), `material ${m.name}`).toContain(m.name);
      const tris = g.meshes.flatMap((m) => m.primitives).reduce((n, p) => n + (p.indices !== undefined ? g.accessors[p.indices].count / 3 : 0), 0);
      expect(tris).toBeLessThanOrEqual(spec.maxTris);
    });
  }
});

describe('hero sword', () => {
  const { json: g, bin } = readGlbWithBin(resolve(import.meta.dirname, '..', 'public', 'models', 'hero.glb'));
  /** The sword holder's scale (x) over a clip: tiny while that copy is hidden. */
  const scale = (clip: string, bone: string) => {
    const node = g.nodes.findIndex((n) => n.name === bone);
    const anim = g.animations!.find((a) => a.name === clip)!;
    const ch = anim.channels.find((c) => c.target.node === node && c.target.path === 'scale');
    expect(ch, `${clip} keys ${bone}'s scale`).toBeDefined();
    return floats(g, bin, anim.samplers[ch!.sampler].output).filter((_, i) => i % 3 === 0);
  };

  for (const clip of ['idle', 'run', 'crouch', 'crouch_walk']) {
    it(`stays on the back through ${clip}`, () => {
      expect(Math.max(...scale(clip, 'sword.R'))).toBeLessThan(0.01);
      expect(Math.min(...scale(clip, 'sword.back'))).toBeGreaterThan(0.99);
    });
  }

  for (const clip of ['attack', 'takedown']) {
    it(`is drawn for ${clip} and put back by its end`, () => {
      const held = scale(clip, 'sword.R');
      const back = scale(clip, 'sword.back');
      expect(Math.max(...held)).toBeGreaterThan(0.99);
      expect(Math.min(...back)).toBeLessThan(0.01);
      expect(held[0]).toBeLessThan(0.01);
      expect(held[held.length - 1]).toBeLessThan(0.01);
      expect(back[back.length - 1]).toBeGreaterThan(0.99);
    });
  }
});
