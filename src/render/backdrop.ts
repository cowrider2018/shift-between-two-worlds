/**
 * The backdrop: what shows wherever no geometry covers the frame (e.g. down past the near wall when the camera
 * hole cuts it away), in layers:
 *  1. a flat hand-drawn cross-section of the ground (backdropPaint.ts), scrolled slowly with the camera's yaw and
 *     pitch so it sits far behind the level, darkening upwards into the theme background;
 *  2. the other dimension's reflection: the other level mirrored about the floor plane, hanging upside down
 *     directly beneath this one in world space (the view renders it from its own camera into `mirror`, see
 *     GameView.renderMirror), laid faintly over the painting with a gentle ripple;
 *  3. a dithered darkening into the corners.
 * The deeper below the floor, the fainter the reflection, until it is gone: the outer rock hanging down
 * thins away before it leaves the view. Drawn first each frame on a full-screen quad.
 */
import {
  Color, DepthTexture, Matrix4, Mesh, NearestFilter, PlaneGeometry, ShaderMaterial, UnsignedIntType, Vector2,
  Vector3, WebGLRenderTarget, type PerspectiveCamera, type Texture,
} from 'three';
import { backdropPaint, PAINT_H, PAINT_W } from './backdropPaint';
import { THEMES } from './palette';

/** How strongly the reflection shows over the background. */
const MIRROR_OPACITY = 0.55;
/** Depth below the floor (world units) over which the reflection fades out completely. */
const FADE_DEPTH = 8;
/** Art pixels the painting scrolls per radian of yaw / pitch: well under the world's own sweep, so it reads far.
 *  A full turn scrolls exactly two tiles, so it joins up where the yaw wraps round. */
const PARALLAX_YAW = (PAINT_W * 2) / (Math.PI * 2);
const PARALLAX_PITCH = 70;

const _dir = new Vector3();

export class Backdrop {
  readonly mesh: Mesh;
  /** The other dimension's mirrored level, as seen from the view's camera (filled by the view each frame). */
  readonly mirror = new WebGLRenderTarget(1, 1, {
    minFilter: NearestFilter, magFilter: NearestFilter, depthTexture: new DepthTexture(1, 1, UnsignedIntType),
  });
  /** Background colour of the dimension on show; the mirror pass fogs the reflection into it with depth. */
  readonly bg = new Color();
  private readonly mat: ShaderMaterial;

  constructor() {
    this.mat = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tPaint: { value: null as Texture | null },
        paintSize: { value: new Vector2(PAINT_W, PAINT_H) },
        scroll: { value: new Vector2() },
        tMirror: { value: this.mirror.texture },
        tMirrorDepth: { value: this.mirror.depthTexture },
        projInv: { value: new Matrix4() },
        camWorld: { value: new Matrix4() },
        fadeDepth: { value: FADE_DEPTH },
        rtSize: { value: new Vector2(1, 1) },
        bg: { value: this.bg },
        mirrorOpacity: { value: MIRROR_OPACITY },
        time: { value: 0 },
      },
      vertexShader: /* glsl */ `
        void main() { gl_Position = vec4(position.xy, 0.9999, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tPaint, tMirror, tMirrorDepth;
        uniform mat4 projInv, camWorld;
        uniform vec2 rtSize, paintSize, scroll;
        uniform vec3 bg;
        uniform float mirrorOpacity, time, fadeDepth;
        // 4x4 Bayer threshold in (0, 1)
        float bayer4(vec2 p) {
          vec2 q = mod(p, 4.0);
          int i = int(q.x) + int(q.y) * 4;
          float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
          return (m[i] + 0.5) / 16.0;
        }
        void main() {
          vec2 px = floor(gl_FragCoord.xy);
          vec2 uv = (px + 0.5) / rtSize;
          // the reflection ripples sideways in whole art pixels, like a still pool barely stirred
          float wob = floor(sin(uv.y * 38.0 + time * 1.7) * 1.2 + 0.5);
          vec2 muv = vec2((px.x + wob + 0.5) / rtSize.x, uv.y);
          vec4 m = texture2D(tMirror, muv);
          // world height of what the reflection shows here, rebuilt from its depth: fade out with depth below the floor
          vec4 p = projInv * vec4(muv * 2.0 - 1.0, texture2D(tMirrorDepth, muv).r * 2.0 - 1.0, 1.0);
          float y = (camWorld * vec4(p.xyz / p.w, 1.0)).y;
          float fade = 1.0 - smoothstep(0.0, fadeDepth, -y);
          // the painting, one texel per art pixel, scrolled by the camera, darkening upwards into the background
          vec3 col = texture2D(tPaint, (px + scroll) / paintSize).rgb;
          col = mix(col, bg, smoothstep(0.3, 0.9, uv.y));
          col = mix(col, m.rgb, m.a * mirrorOpacity * fade);
          // darken into the corners. The post pass quantises luminance, which would snap a smooth falloff into
          // one hard ring in the dark range; instead each pixel is either darkened or not, by a 4x4 ordered
          // dither whose density grows outwards
          vec2 c = (uv - 0.5) * vec2(rtSize.x / rtSize.y, 1.0);
          float vig = smoothstep(0.45, 1.1, length(c));
          col = mix(col, bg * 0.6, step(bayer4(px), vig));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  setDim(dim: 0 | 1): void {
    this.bg.set(THEMES[dim].background);
    this.mat.uniforms.tPaint.value = backdropPaint(dim);
  }

  /** Match the low-res frame (art pixels) and the camera the reflection is rendered from. */
  update(w: number, h: number, camera: PerspectiveCamera, time: number): void {
    if (this.mirror.width !== w || this.mirror.height !== h) this.mirror.setSize(w, h);
    const u = this.mat.uniforms;
    (u.rtSize.value as Vector2).set(w, h);
    camera.updateMatrixWorld(); // it was just moved this frame; the render that would refresh it comes later
    (u.projInv.value as Matrix4).copy(camera.projectionMatrixInverse);
    (u.camWorld.value as Matrix4).copy(camera.matrixWorld);
    camera.getWorldDirection(_dir);
    const yaw = Math.atan2(_dir.z, _dir.x);
    const pitch = Math.asin(Math.max(-1, Math.min(1, _dir.y)));
    // whole art pixels, so the painting never swims between texels
    (u.scroll.value as Vector2).set(Math.round(yaw * PARALLAX_YAW), Math.round(pitch * PARALLAX_PITCH));
    this.mat.uniforms.time.value = time;
  }
}
