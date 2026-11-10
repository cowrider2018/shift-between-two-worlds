/**
 * DESIGN §4.1 — third-person perspective camera, ~30° above the ground, orbiting behind the hero.
 * Yaw is player-controlled (mouse / ← →); the boom length is player-zoomed (wheel / + −) between
 * CAMERA.minDistance (near the face) and CAMERA.distance (the default, farthest view). Walls between the
 * camera and the hero are cut away by a round hole (see cutaway.ts) instead of pulling the camera in.
 */
import { PerspectiveCamera } from 'three';
import type { Sim } from '../core/sim';

export const CAMERA = {
  elevationDeg: 30,
  /** Farthest (and default) boom length. */
  distance: 5.2,
  /** Closest boom length: the hero's face fills much of the screen. */
  minDistance: 1.1,
  /** Look-at height at the farthest zoom (mid-body) … */
  targetHeight: 0.75,
  /** … sliding to this at the closest zoom (face; hero is ~0.84 tall). */
  nearTargetHeight: 0.62,
  /** Zoom factor per wheel notch / per +− key press (multiplicative, so steps feel even at any range). */
  zoomStep: 1.15,
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
  /** Boom length the player asked for, and the smoothed length actually used. */
  private zoomTarget = CAMERA.distance;
  distance = CAMERA.distance;
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

  /** Zoom by notches: positive = out, negative = in. */
  zoom(notches: number): void {
    const d = this.zoomTarget * Math.pow(CAMERA.zoomStep, notches);
    this.zoomTarget = Math.min(CAMERA.distance, Math.max(CAMERA.minDistance, d));
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
    this.distance += (this.zoomTarget - this.distance) * Math.min(1, dt * 10);
    const d = this.distance;
    const near = (CAMERA.distance - d) / (CAMERA.distance - CAMERA.minDistance);
    const th = CAMERA.targetHeight + (CAMERA.nearTargetHeight - CAMERA.targetHeight) * near;
    const cx = this.tx - fx * d * Math.cos(elev);
    const cy = this.ty - fy * d * Math.cos(elev);
    this.camera.position.set(cx, th + d * Math.sin(elev), cy);
    this.camera.lookAt(this.tx, th, this.ty);
  }
}
