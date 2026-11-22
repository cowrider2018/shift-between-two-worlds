/** Print the hidden near side of the outline (nearCut) as text, for a few camera directions, the hero on the spawn
 *  or the cell given: `tsx scripts/cutaway-map.ts levels/x.json [dim] [x,z]`.
 *  # stands, _ gone, E/e exit standing/gone, @ hero, . open, space nothing. */
import { readFileSync } from 'node:fs';
import { LevelGrid } from '../src/core/grid';
import type { DimIndex } from '../src/core/level';
import { nearCut } from '../src/render/terrain';

const grid = new LevelGrid(JSON.parse(readFileSync(process.argv[2], 'utf8')));
const dim = Number(process.argv[3] ?? 0) as DimIndex;
let hx = 0, hz = 0;
for (let z = 0; z < grid.h; z++) for (let x = 0; x < grid.w; x++) if (grid.cell(dim, x, z).def.behavior === 'spawn') [hx, hz] = [x, z];
if (process.argv[4]) [hx, hz] = process.argv[4].split(',').map(Number);
const dirs: [string, number, number][] = [['N (cam south)', 0, -1], ['NE (cam SW)', 1, -1], ['E (cam west)', 1, 0], ['S (cam north)', 0, 1], ['SW (cam NE)', -1, 1]];
const maps = dirs.map(([name, fx, fz]) => {
  const h = nearCut(grid, dim, fx, fz);
  const rows = [name.padEnd(grid.w)];
  for (let z = 0; z < grid.h; z++) {
    let r = '';
    for (let x = 0; x < grid.w; x++) {
      const c = grid.cell(dim, x, z).def;
      const v = h.get(z * grid.w + x);
      if (x === hx && z === hz) r += '@';
      else if (c.behavior === 'exit') r += v === 0 ? 'e' : 'E';
      else if (c.behavior === 'void') r += ' ';
      else if (c.solid === 'always') r += v === 0 ? '_' : '#';
      else r += '.';
    }
    rows.push(r);
  }
  return rows;
});
for (let i = 0; i < maps[0].length; i++) console.log(maps.map((m) => m[i].padEnd(Math.max(grid.w, 14))).join('   '));
