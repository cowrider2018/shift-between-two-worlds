/**
 * The backdrop: a wide stone-brick ground laid just under the level, so wherever the view looks past the level's
 * rock (e.g. down past the near wall when the camera hole cuts it away) it meets big dark bricks, not empty colour.
 */
import { MeshToonMaterial, Color, Mesh, PlaneGeometry } from 'three';
import { BRICK_SPAN, brickTexture } from './brickTexture';
import type { DimTheme } from './palette';

/** How far the backdrop runs past the level on every side; the fog has hidden it well before then. */
const REACH = 40;
/** Just under the floor, so it never fights the floor tiles. */
const DROP = 0.02;

export function backdrop(w: number, h: number, theme: DimTheme): Mesh {
  const sx = w + REACH * 2;
  const sz = h + REACH * 2;
  const geo = new PlaneGeometry(sx, sz);
  geo.rotateX(-Math.PI / 2);
  // world-anchored UVs: one texture repeat per BRICK_SPAN units, aligned to the grid
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / BRICK_SPAN, (pos.getZ(i) + h / 2) / BRICK_SPAN);
  const mat = new MeshToonMaterial({ color: new Color(theme.wallSide), map: brickTexture() });
  const mesh = new Mesh(geo, mat);
  mesh.position.set(w / 2, -DROP, h / 2);
  mesh.receiveShadow = true;
  return mesh;
}
