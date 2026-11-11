/**
 * DESIGN §4.1 — third-person perspective camera, ~30° above the ground by default, orbiting behind the hero.
 * Yaw is player-controlled (mouse X / ← →), pitch too (mouse Y, clamped to CAMERA.min/maxElevationDeg); the boom length is player-zoomed (wheel / + −) between
 * CAMERA.minDistance (near the face) and CAMERA.distance (the default, farthest view). Walls between the
 * camera and the hero are cut away by a round hole (see cutaway.ts) instead of pulling the camera in.
 *
 * Pixel discipline: the camera's position is snapped so the plane through its look-at point moves across the
 * low-res frame in whole art pixels (the sub-pixel remainder, `subpixel`, is applied by the upscale pass, so the
 * view still scrolls smoothly), and characters are snapped to the art-pixel grid at their own depth. While the
 * camera only translates, the hero and what is around it keep a stable pixel pattern instead of shimmering.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { angleDiff } from '../core/grid';
import type { Sim } from '../core/sim';

export const CAMERA = {
  /** Default pitch above the ground. */
  elevationDeg: 30,
  /** Pitch limits: low enough to look along the floor, high enough for a near top-down view. */
  minElevationDeg: 8,
  maxElevationDeg: 80,
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

const _v = new Vector3();

export class FollowCamera {
  readonly camera = new PerspectiveCamera(CAMERA.fov, 1, 0.1, 60);
  /** Grid angle the camera looks along (0 = +x, π/2 = +y). */
  yaw = -Math.PI / 2;
  /** Pitch above the ground, radians. */
  private elevation = (CAMERA.elevationDeg * Math.PI) / 180;
  /** Boom length the player asked for, and the smoothed length actually used. */
  private zoomTarget = CAMERA.distance;
  distance = CAMERA.distance;
  private tx = 0;
  private ty = 0;
  /** A yaw the camera swings round to on its own (a cutscene beat), or null for player control only. */
  private yawTarget: number | null = null;
  /** Camera offset from its pixel-snapped position, in art pixels (x right, y up); the upscale pass shifts by it. */
  readonly subpixel = { x: 0, y: 0 };
  /** Low-res frame height in art pixels (set by setViewport). */
  private frameH = 1;
  private readonly right = new Vector3();
  private readonly up = new Vector3();

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
    this.yawTarget = null;
  }

  /** Swing round to look along `yaw` (eased in update) until the next reset. */
  swingTo(yaw: number): void {
    this.yawTarget = yaw;
  }

  /** Tilt by radians: positive = camera rises (looks more downward). */
  tilt(rad: number): void {
    const lo = (CAMERA.minElevationDeg * Math.PI) / 180;
    const hi = (CAMERA.maxElevationDeg * Math.PI) / 180;
    this.elevation = Math.min(hi, Math.max(lo, this.elevation + rad));
  }

  /** Zoom by notches: positive = out, negative = in. */
  zoom(notches: number): void {
    const d = this.zoomTarget * Math.pow(CAMERA.zoomStep, notches);
    this.zoomTarget = Math.min(CAMERA.distance, Math.max(CAMERA.minDistance, d));
  }

  /** Fit the projection to a low-res frame of w×h art pixels. */
  setViewport(w: number, h: number): void {
    this.frameH = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Art pixels per world unit in the image plane at view depth `z`. */
  private pixelsPerUnit(z: number): number {
    return this.frameH / (2 * z * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  update(sim: Sim, dt: number): void {
    if (this.yawTarget !== null) this.yaw += angleDiff(this.yawTarget, this.yaw) * Math.min(1, dt * 6);
    const k = Math.min(1, dt * 12);
    this.tx += (sim.x - this.tx) * k;
    this.ty += (sim.y - this.ty) * k;
    const elev = this.elevation;
    const [fx, fy] = this.forward();
    this.distance += (this.zoomTarget - this.distance) * Math.min(1, dt * 10);
    const d = this.distance;
    const near = (CAMERA.distance - d) / (CAMERA.distance - CAMERA.minDistance);
    const th = CAMERA.targetHeight + (CAMERA.nearTargetHeight - CAMERA.targetHeight) * near;
    const cx = this.tx - fx * d * Math.cos(elev);
    const cy = this.ty - fy * d * Math.cos(elev);
    this.camera.position.set(cx, th + d * Math.sin(elev), cy);
    this.camera.lookAt(this.tx, th, this.ty);
    this.camera.updateMatrixWorld();
    // snap so the look-at plane lands on whole art pixels; keep the remainder for the upscale pass
    this.right.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.up.setFromMatrixColumn(this.camera.matrixWorld, 1);
    const ppu = this.pixelsPerUnit(d);
    const p = this.camera.position;
    const a = p.dot(this.right) * ppu;
    const b = p.dot(this.up) * ppu;
    this.subpixel.x = a - Math.round(a);
    this.subpixel.y = b - Math.round(b);
    p.addScaledVector(this.right, -this.subpixel.x / ppu).addScaledVector(this.up, -this.subpixel.y / ppu);
    this.camera.updateMatrixWorld();
  }

  /** Move a world position onto the art-pixel grid at its own depth (in the image plane), so a moving character
   *  keeps a stable pixel pattern instead of re-rasterising at sub-pixel offsets. Call after update(). */
  snap(p: Vector3): Vector3 {
    const v = _v.copy(p).applyMatrix4(this.camera.matrixWorldInverse);
    const z = -v.z;
    if (z <= this.camera.near) return p;
    const k = this.pixelsPerUnit(z);
    v.x = Math.round(v.x * k) / k;
    v.y = Math.round(v.y * k) / k;
    return p.copy(v.applyMatrix4(this.camera.matrixWorld));
  }
}
