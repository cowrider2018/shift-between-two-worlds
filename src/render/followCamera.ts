/**
 * DESIGN §4.1 — third-person perspective camera, ~30° above the ground, orbiting behind the hero.
 * Yaw is player-controlled (mouse / ← →). The boom length is fixed; walls between the camera and the
 * hero are cut away by a round hole (see cutaway.ts) instead of pulling the camera in.
 */
import { PerspectiveCamera } from 'three';
import type { Sim } from '../core/sim';

export const CAMERA = {
  elevationDeg: 30,
  distance: 5.2,
  targetHeight: 0.75,
  fov: 55,
  /** Radians per pixel of mouse movement. */
  mouseSensitivity: 0.004,
  /** Radians per second for ← / →. */
  keyTurnSpeed: 2.4,
};

export class FollowCamera {
  readonly camera = new PerspectiveCamera(CAMERA.fov, 1, 0.1, 60);
  /** Grid angle the camera looks along (0 = +x, π/2 = +y). */
  yaw = -Math.PI / 2;
  private tx = 0;
  private ty = 0;

  /** Unit vector (grid coords) the camera faces on the ground plane. */
  forward(): [number, number] {
    return [Math.cos(this.yaw), Math.sin(this.yaw)];
  }

  /** Convert stick input (x = right, y = back) into a grid-space move vector. */
  toWorld(moveX: number, moveY: number): [number, number] {
    const [fx, fy] = this.forward();
    // right of forward in grid space (y points "down" / toward +z)
    const rx = -fy;
    const ry = fx;
    return [rx * moveX - fx * moveY, ry * moveX - fy * moveY];
  }

  /** Face the camera from the spawn toward the level centre. */
  reset(sim: Sim): void {
    const { w, h } = sim.level.size;
    this.yaw = Math.atan2(h / 2 - sim.y, w / 2 - sim.x);
    this.tx = sim.x;
    this.ty = sim.y;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(sim: Sim, dt: number): void {
    const k = Math.min(1, dt * 12);
    this.tx += (sim.x - this.tx) * k;
    this.ty += (sim.y - this.ty) * k;
    const elev = (CAMERA.elevationDeg * Math.PI) / 180;
    const [fx, fy] = this.forward();
    const d = CAMERA.distance;
    const cx = this.tx - fx * d * Math.cos(elev);
    const cy = this.ty - fy * d * Math.cos(elev);
    this.camera.position.set(cx, CAMERA.targetHeight + d * Math.sin(elev), cy);
    this.camera.lookAt(this.tx, CAMERA.targetHeight, this.ty);
  }
}
