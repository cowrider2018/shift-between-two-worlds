/**
 * The backdrop: what shows wherever no geometry covers the frame (e.g. down past the near wall when the camera
 * hole cuts it away), in three layers, drawn first each frame on a full-screen quad:
 *  1. a flat hand-drawn cross-section of the ground (backdropPaint.ts), scrolled slowly with the camera's yaw
 *     and pitch so it sits far behind the level;
 *  2. the other dimension's reflection: the same view rendered in the other dimension, flipped upside down,
 *     faded and gently rippling, as if the other world lay mirrored beneath this one;
 *  3. a gradient darkening towards the top into the theme background, and a vignette into the corners.
 */
import {
  Color, Mesh, NearestFilter, PlaneGeometry, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget,
  type PerspectiveCamera, type Texture,
} from 'three';
import { backdropPaint, PAINT_H, PAINT_W } from './backdropPaint';
import { THEMES } from './palette';

/** Art pixels the painting scrolls per radian of yaw / pitch: well under the world's own sweep, so it reads far.
 *  A full turn scrolls exactly two tiles, so it joins up where the yaw wraps round. */
const PARALLAX_YAW = (PAINT_W * 2) / (Math.PI * 2);
const PARALLAX_PITCH = 70;
/** Peak opacity of the other dimension's reflection. */
const MIRROR_OPACITY = 0.5;
/** Frame heights below the floor line over which the reflection thins away. */
const MIRROR_REACH = 0.45;

const _dir = new Vector3();

export class Backdrop {
  readonly mesh: Mesh;
  /** The other dimension, rendered from the view's camera each frame (filled by the view). */
  readonly mirror = new WebGLRenderTarget(1, 1, { minFilter: NearestFilter, magFilter: NearestFilter });
  private readonly mat: ShaderMaterial;

  constructor() {
    this.mat = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tPaint: { value: null as Texture | null },
        tMirror: { value: this.mirror.texture },
        paintSize: { value: new Vector2(PAINT_W, PAINT_H) },
        rtSize: { value: new Vector2(1, 1) },
        scroll: { value: new Vector2() },
        bg: { value: new Color() },
        mirrorTint: { value: new Color() },
        mirrorOpacity: { value: MIRROR_OPACITY },
        time: { value: 0 },
        anchor: { value: 0.5 },
        mirrorReach: { value: MIRROR_REACH },
      },
      vertexShader: /* glsl */ `
        void main() { gl_Position = vec4(position.xy, 0.9999, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tPaint, tMirror;
        uniform vec2 paintSize, rtSize, scroll;
        uniform vec3 bg, mirrorTint;
        uniform float mirrorOpacity, time, anchor, mirrorReach;
        void main() {
          vec2 px = floor(gl_FragCoord.xy);
          vec2 uv = (px + 0.5) / rtSize;
          // 1. the painting, one texel per art pixel, scrolled by the camera
          vec3 col = texture2D(tPaint, (px + scroll) / paintSize).rgb;
          // 2. the other dimension, flipped about the floor line under the hero, like a reflection in water;
          //    it ripples sideways in whole art pixels
          float wob = floor(sin(uv.y * 38.0 + time * 1.7) * 1.6 + 0.5);
          vec2 muv = vec2((px.x + wob + 0.5) / rtSize.x, 2.0 * anchor - uv.y);
          vec4 m = texture2D(tMirror, muv);
          float lum = dot(m.rgb, vec3(0.3, 0.55, 0.15));
          vec3 ghost = mix(vec3(lum), m.rgb, 0.45) * mirrorTint;
          // strongest just under the floor line, thinning away below it; nothing above it
          float below = anchor - uv.y;
          float mFade = below < 0.0 || muv.y > 1.0 ? 0.0 : mirrorOpacity * (1.0 - smoothstep(0.0, mirrorReach, below));
          col = mix(col, ghost, m.a * mFade);
          // 3. darken upwards into the background colour, then a vignette into the corners
          col = mix(col, bg, smoothstep(0.3, 0.9, uv.y));
          vec2 c = (uv - 0.5) * vec2(rtSize.x / rtSize.y, 1.0);
          col = mix(col, bg * 0.6, smoothstep(0.45, 1.05, length(c)));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  /** Show `dim`'s painting and tint the reflection with the other dimension's light. */
  setDim(dim: 0 | 1): void {
    const u = this.mat.uniforms;
    u.tPaint.value = backdropPaint(dim);
    (u.bg.value as Color).set(THEMES[dim].background);
    (u.mirrorTint.value as Color).set(THEMES[1 - dim].hemiSky);
  }

  /** Match the low-res frame (art pixels) and follow the camera; `floor` is the world point the reflection
   *  hangs from (the hero's feet). */
  update(w: number, h: number, camera: PerspectiveCamera, floor: Vector3, time: number): void {
    if (this.mirror.width !== w || this.mirror.height !== h) this.mirror.setSize(w, h);
    const u = this.mat.uniforms;
    (u.rtSize.value as Vector2).set(w, h);
    camera.getWorldDirection(_dir);
    const yaw = Math.atan2(_dir.z, _dir.x);
    const pitch = Math.asin(Math.max(-1, Math.min(1, _dir.y)));
    // whole art pixels, so the painting never swims between texels
    (u.scroll.value as Vector2).set(Math.round(yaw * PARALLAX_YAW), Math.round(pitch * PARALLAX_PITCH));
    u.time.value = time;
    u.anchor.value = _dir.copy(floor).project(camera).y * 0.5 + 0.5;
  }
}
