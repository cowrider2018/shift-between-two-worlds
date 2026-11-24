/**
 * Upright pixel sprites on the floor (DESIGN §4.1, §4.3): grass tufts and dead twigs in the surface, and the same
 * shapes in the underside made of frost and ice. Each sprite is a flat-coloured picture that always faces the camera,
 * so a few small pixel drawings stand on the 3D floor. They sit where the floor is plain and never block or reveal
 * anything; they are deliberately not objects one could pick up.
 */
import { CanvasTexture, NearestFilter, Sprite, SpriteMaterial } from 'three';
import type { Cell } from '../core/grid';

/** Share of plain floor cells that carry a sprite. */
const CHANCE = 0.14;
/** World height of a sprite: 12 texels, about two art pixels each. */
const SIZE = 0.45;
/** Jitter off the cell centre, in world units either side. */
const JITTER = 0.25;

/** One sprite kind, 12 × 12. Letters are colours: `a` main, `b` shade, `.` empty. Bottom row is the ground. */
interface Kind {
  rows: string[];
  /** [main, shade] in the surface (A) and in the underside (B). */
  colours: [[string, string], [string, string]];
}

const KINDS: Kind[] = [
  { // grass tuft | frost sprout
    rows: [
      '............', '............', '...a...a....', '..aa..aa....', '.a.aa.aa.a..', '.aaba.aba.a.',
      '.aabaaabaa..', '..abbbbbaa..', '.aaaaaaaaa..', '............', '............', '............',
    ],
    colours: [['#7a8c3a', '#434f1f'], ['#cfeaff', '#7aa6c8']],
  },
  { // dead twig | ice spike
    rows: [
      '............', '............', '............', '.........a..', '........aa.a', '.......a..a.',
      '......aa....', '.....a......', '....aa......', '...a........', '..aaa.......', '............',
    ],
    colours: [['#6b4a2e', '#3a2716'], ['#bff6ff', '#4fb9d9']],
  },
];

/** Deterministic per-cell numbers in [0, 1): the same cell gives the same result in both dimensions. */
function cellRand(x: number, y: number, salt: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const materials = new Map<string, SpriteMaterial>();

function spriteMaterial(kind: number, dim: number): SpriteMaterial {
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
  mat = new SpriteMaterial({ map: tex, alphaTest: 0.5 });
  materials.set(key, mat);
  return mat;
}

/** The sprite standing on a floor cell, or null for most cells. Its base sits on the floor at the sprite's position. */
export function floorSprites(cell: Pick<Cell, 'x' | 'y' | 'dim'>): Sprite[] {
  if (cellRand(cell.x, cell.y, 6) >= CHANCE) return [];
  const kind = Math.floor(cellRand(cell.x, cell.y, 7) * KINDS.length);
  const sprite = new Sprite(spriteMaterial(kind, cell.dim));
  sprite.center.set(0.5, 0); // the base, not the middle, stands on the floor
  sprite.scale.set(SIZE, SIZE, 1);
  sprite.position.set(
    (cellRand(cell.x, cell.y, 8) - 0.5) * 2 * JITTER,
    0,
    (cellRand(cell.x, cell.y, 9) - 0.5) * 2 * JITTER,
  );
  sprite.castShadow = false;
  sprite.receiveShadow = false;
  return [sprite];
}
