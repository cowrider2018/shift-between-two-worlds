/**
 * Solid objects lying on some plain floor cells (DESIGN §4.3): in the surface (A) a stone block with a pebble beside
 * it, in the underside (B) a skull with a bone. The two sit in the same place on the same cell, so a cell that has
 * one has the other. Each object is real geometry, shadowed like the rest of the floor, and keeps the direction it was
 * set down in: it never turns to face the camera. Nothing about them blocks movement or reveals anything.
 */
import { BoxGeometry, BufferGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, type Object3D } from 'three';
import type { Cell } from '../core/grid';
import { toon } from './materials';

/** Share of plain floor cells that carry an object. */
const CHANCE = 0.12;
/** How far an object may sit off the cell centre, in world units either side (keeps it inside the cell). */
const JITTER = 0.12;
/** Whole-object scale, so the stones and skulls read at the default camera distance. */
const SCALE = 1.4;

/** Knock a rounded mass out of shape: each vertex moves along its own direction by up to `amount`, the same for every
 *  copy of a shared corner (so the faces still meet), and the normals are rebuilt flat so it reads as cut stone. */
function rough(geo: BufferGeometry, amount: number, seed: number): BufferGeometry {
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let h = seed;
    for (const v of [x, y, z]) h = Math.imul(h ^ Math.round(v * 1e4), 2654435761);
    h ^= h >>> 15;
    h = Math.imul(h, 2246822519);
    h ^= h >>> 13;
    const k = 1 + ((h >>> 0) / 4294967296 * 2 - 1) * amount;
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

const rock = rough(new IcosahedronGeometry(0.13, 1).scale(1, 0.55, 1), 0.3, 7);

const GEO = {
  block: rock,
  pebble: new IcosahedronGeometry(0.06, 0),
  cranium: new IcosahedronGeometry(0.095, 1),
  jaw: new BoxGeometry(0.11, 0.04, 0.085),
  socket: new BoxGeometry(0.035, 0.035, 0.02),
  shaft: new CylinderGeometry(0.014, 0.014, 0.2, 6),
  knob: new IcosahedronGeometry(0.03, 0),
};

/** Deterministic per-cell numbers in [0, 1): the same cell gives the same result in both dimensions. */
function cellRand(x: number, y: number, salt: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function solid(geo: ConstructorParameters<typeof Mesh>[0], colour: string, x = 0, y = 0, z = 0): Mesh {
  const mesh = new Mesh(geo, toon(colour));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A stone block with a small pebble beside it, lying as it fell. */
function stoneObject(): Group {
  const g = new Group();
  g.add(solid(GEO.block, '#8a7560', 0, 0.07, 0));
  const pebble = solid(GEO.pebble, '#6f6252', 0.16, 0.036, 0.04);
  pebble.scale.set(1, 0.6, 1);
  g.add(pebble);
  return g;
}

/** A skull with its jaw and a bone lying beside it. */
function skullObject(): Group {
  const bone = '#d6e4ee';
  const g = new Group();
  g.add(solid(GEO.cranium, bone, 0, 0.1, 0));
  g.add(solid(GEO.jaw, bone, 0, 0.035, 0.04));
  g.add(solid(GEO.socket, '#1d1620', -0.035, 0.12, 0.085));
  g.add(solid(GEO.socket, '#1d1620', 0.035, 0.12, 0.085));
  // a long bone with a knob at each end, flat on the floor
  const femur = new Group();
  femur.position.set(0.16, 0.014, 0.1);
  femur.rotation.set(0, 0.7, 0);
  const shaft = solid(GEO.shaft, bone);
  shaft.rotation.z = Math.PI / 2;
  femur.add(shaft);
  femur.add(solid(GEO.knob, bone, 0.1, 0, 0), solid(GEO.knob, bone, -0.1, 0, 0));
  g.add(femur);
  return g;
}

/** The object lying on a floor cell, or null for most cells. Its place and direction depend only on the cell. */
export function floorObjects(cell: Pick<Cell, 'x' | 'y' | 'dim'>): Object3D[] {
  if (cellRand(cell.x, cell.y, 11) >= CHANCE) return [];
  const g = cell.dim === 0 ? stoneObject() : skullObject();
  g.position.set(
    (cellRand(cell.x, cell.y, 12) * 2 - 1) * JITTER,
    0,
    (cellRand(cell.x, cell.y, 13) * 2 - 1) * JITTER,
  );
  // set down facing a fixed way; the camera never turns it
  g.rotation.y = cellRand(cell.x, cell.y, 14) * Math.PI * 2;
  g.scale.setScalar(SCALE);
  return [g];
}
