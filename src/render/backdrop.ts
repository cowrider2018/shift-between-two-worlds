/**
 * The backdrop: a wide stone ground laid just under the level, so wherever the view looks past the level's rock
 * (e.g. down past the near wall when the camera hole cuts it away) it meets stone, not empty colour. Same
 * flagstone texture as the level, drawn SCALE times larger on each axis so it reads as apart from the floor.
 */
import { Mesh, PlaneGeometry } from 'three';
import { COBBLE_SPAN } from './cobbleTexture';
import { cobble } from './materials';
import type { DimTheme } from './palette';

/** How far the backdrop runs past the level on every side; the fog has hidden it well before then. */
const REACH = 40;
/** Just under the floor, so it never fights the floor tiles. */
const DROP = 0.02;
/** Stones this many times larger per axis than on the floor (2 x 2 = 4 times the area). */
const SCALE = 2;
const SPAN = COBBLE_SPAN * SCALE;

export function backdrop(w: number, h: number, theme: DimTheme): Mesh {
  const sx = w + REACH * 2;
  const sz = h + REACH * 2;
  const geo = new PlaneGeometry(sx, sz);
  geo.rotateX(-Math.PI / 2);
  // world-anchored UVs: one texture repeat per SPAN units, aligned to the grid
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / SPAN, (pos.getZ(i) + h / 2) / SPAN);
  const mesh = new Mesh(geo, cobble(theme.wallSide));
  mesh.position.set(w / 2, -DROP, h / 2);
  mesh.receiveShadow = true;
  return mesh;
}
