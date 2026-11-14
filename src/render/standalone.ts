/**
 * Scenes outside a level (the control pages, the ending) drawn through the game's pixel pipeline: the post pass
 * gets the sun's on-screen direction for its rim light, none of the in-level effects, and no floor clipping.
 */
import { Vector3, type DirectionalLight, type PerspectiveCamera, type Scene } from 'three';
import type { PixelPipeline } from './pixelPipeline';

const sunDir = new Vector3();

export function renderStandalone(pipeline: PixelPipeline, scene: Scene, camera: PerspectiveCamera, sun: DirectionalLight,
  t: number): void {
  camera.updateMatrixWorld();
  // the post pass's rim light wants the sun's direction on screen (as the game view does)
  const s = sunDir.subVectors(sun.position, sun.target.position).transformDirection(camera.matrixWorldInverse);
  pipeline.sun.dir.set(s.x, s.y);
  if (pipeline.sun.dir.lengthSq() > 1e-6) pipeline.sun.dir.normalize();
  pipeline.sun.color.copy(sun.color);
  pipeline.subpixel.x = pipeline.subpixel.y = 0;
  pipeline.hole = { x: 0, y: 0, r: 0, tip: 0, capR: 0 };
  pipeline.fx.flash = pipeline.fx.ripple = pipeline.fx.danger = 0;
  pipeline.fx.time = t;
  // the game clips everything under the floor (its mirror pass draws the other dimension there); these scenes do not
  const renderer = pipeline.renderer;
  const clip = renderer.clippingPlanes;
  renderer.clippingPlanes = [];
  pipeline.render(scene, camera);
  renderer.clippingPlanes = clip;
}
