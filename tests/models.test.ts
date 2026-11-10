/** Checks the exported character models without a GPU: reads the glTF JSON chunk of each .glb. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import palette from '../art/palette.json';
import { MODEL_NAMES } from '../src/render/models';

interface Gltf {
  animations?: { name: string }[];
  skins?: { joints: number[] }[];
  materials?: { name: string }[];
  nodes: { name?: string }[];
  meshes: { primitives: { indices?: number }[] }[];
  accessors: { count: number }[];
}

function readGlb(path: string): Gltf {
  const b = readFileSync(path);
  expect(b.toString('ascii', 0, 4)).toBe('glTF');
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}

const SPEC: Record<string, { animations: string[]; bones: string[]; maxTris: number }> = {
  troll: {
    animations: ['idle', 'walk', 'alert', 'attack'],
    bones: ['root', 'hips', 'head', 'ear.L', 'ear.R', 'hand.L', 'hand.R', 'foot.L', 'foot.R'],
    maxTris: 8000,
  },
  hero: {
    animations: ['idle', 'walk', 'attack', 'crouch', 'crouch_walk'],
    bones: ['root', 'hips', 'head', 'cape.1', 'hand.R', 'foot.L', 'foot.R', 'hair_full', 'hair_hood', 'hood', 'cape'],
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
