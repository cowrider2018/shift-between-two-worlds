/**
 * Paired floor decals (DESIGN §4.3): a few floor cells carry a small pixel patch, and the same cell carries the same
 * patch in the other dimension, drawn as its counterpart. A crack in the surface is a glowing seam underneath; moss is
 * frost; pebbles are ice shards. Which cells get a patch, and which kind, depends only on the cell, so the two
 * dimensions always match. Decals are flat, unlit and never block or reveal anything.
 */
import { CanvasTexture, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry } from 'three';
import type { Cell } from '../core/grid';

/** Share of floor cells that carry a patch. */
const CHANCE = 0.18;
/** World size of a patch: 12 texels, about three art pixels each. */
const SIZE = 0.7;
/** Jitter of a patch off the cell centre, in world units either side. */
const JITTER = 0.2;

/** One pattern per kind, 12 × 12. Letters are colours: `a` main, `b` shade, `.` empty. */
interface Kind {
  rows: string[];
  /** [main, shade] in the surface (A) and in the underside (B). */
  colours: [[string, string], [string, string]];
}

const KINDS: Kind[] = [
  { // a crack in the stone | a seam of light beneath it
    rows: [
      '............', '......a.....', '.....aa.....', '....a.......', '....aa......', '...a.a......',
      '..aa........', '..a.........', '.aa.........', '.a..........', '............', '............',
    ],
    colours: [['#3a2412', '#24160a'], ['#7fe8ff', '#e6fbff']],
  },
  { // moss | frost
    rows: [
      '............', '............', '..a.a.......', '.aaaaa......', '..aba.......', '....a.a.....',
      '.......aaa..', '......abba..', '.......aaa..', '............', '............', '............',
    ],
    colours: [['#6b7a2e', '#3f4a1a'], ['#cfeaff', '#7aa6c8']],
  },
  { // pebbles | ice shards
    rows: [
      '............', '............', '.....aa.....', '....abba....', '....abba....', '.....aa.....',
      '.......aaa..', '......abba..', '.......aaa..', '............', '............', '............',
    ],
    colours: [['#b8a88a', '#5c4c36'], ['#bff6ff', '#4fb9d9']],
  },
];

/** Deterministic per-cell numbers in [0, 1): the same cell gives the same result in both dimensions. */
function cellRand(x: number, y: number, salt: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const textures = new Map<string, CanvasTexture>();
const materials = new Map<string, MeshBasicMaterial>();
let plane: PlaneGeometry | null = null;

function patchMaterial(kind: number, dim: number): MeshBasicMaterial {
  const key = `${kind}:${dim}`;
  let mat = materials.get(key);
  if (mat) return mat;
  const { rows, colours } = KINDS[kind];
  const [main, shade] = colours[dim];
  const c = document.createElement('canvas');
  c.width = c.height = rows.length;
  const g = c.getContext('2d')!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '.') continue;
      g.fillStyle = row[x] === 'a' ? main : shade;
      g.fillRect(x, y, 1, 1);
    }
  });
  const tex = new CanvasTexture(c);
  tex.magFilter = tex.minFilter = NearestFilter;
  textures.set(key, tex);
  mat = new MeshBasicMaterial({
    map: tex, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  materials.set(key, mat);
  return mat;
}

/** The patch for a floor cell, as a flat mesh centred on the origin (empty for most cells). */
export function floorDecals(cell: Pick<Cell, 'x' | 'y' | 'dim'>): Mesh[] {
  if (cellRand(cell.x, cell.y, 1) >= CHANCE) return [];
  const kind = Math.floor(cellRand(cell.x, cell.y, 2) * KINDS.length);
  plane ??= new PlaneGeometry(SIZE, SIZE);
  const mesh = new Mesh(plane, patchMaterial(kind, cell.dim));
  // lying flat, turned in quarters so neighbouring patches of one kind do not repeat their pixels
  mesh.rotation.order = 'YXZ';
  mesh.rotation.set(-Math.PI / 2, Math.floor(cellRand(cell.x, cell.y, 3) * 4) * (Math.PI / 2), 0);
  mesh.position.set(
    (cellRand(cell.x, cell.y, 4) - 0.5) * 2 * JITTER,
    0.004,
    (cellRand(cell.x, cell.y, 5) - 0.5) * 2 * JITTER,
  );
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return [mesh];
}
