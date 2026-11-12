/**
 * The backdrop: what shows wherever no geometry covers the frame (e.g. down past the near wall when the camera
 * hole cuts it away). It is the other dimension's reflection: the other level mirrored about the floor plane,
 * hanging upside down directly beneath this one in world space (the view renders it from its own camera into
 * `mirror`, see GameView.renderMirror), laid faintly over the theme background with a gentle ripple, and darkened
 * into the corners. Drawn first each frame on a full-screen quad.
 */
import { Color, Mesh, NearestFilter, PlaneGeometry, ShaderMaterial, Vector2, WebGLRenderTarget } from 'three';
import { THEMES } from './palette';

/** How strongly the reflection shows over the background. */
const MIRROR_OPACITY = 0.55;

export class Backdrop {
  readonly mesh: Mesh;
  /** The other dimension's mirrored level, as seen from the view's camera (filled by the view each frame). */
  readonly mirror = new WebGLRenderTarget(1, 1, { minFilter: NearestFilter, magFilter: NearestFilter });
  /** Background colour of the dimension on show; the mirror pass fogs the reflection into it with depth. */
  readonly bg = new Color();
  private readonly mat: ShaderMaterial;

  constructor() {
    this.mat = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tMirror: { value: this.mirror.texture },
        rtSize: { value: new Vector2(1, 1) },
        bg: { value: this.bg },
        mirrorOpacity: { value: MIRROR_OPACITY },
        time: { value: 0 },
      },
      vertexShader: /* glsl */ `
        void main() { gl_Position = vec4(position.xy, 0.9999, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMirror;
        uniform vec2 rtSize;
        uniform vec3 bg;
        uniform float mirrorOpacity, time;
        void main() {
          vec2 px = floor(gl_FragCoord.xy);
          vec2 uv = (px + 0.5) / rtSize;
          // the reflection ripples sideways in whole art pixels, like a still pool barely stirred
          float wob = floor(sin(uv.y * 38.0 + time * 1.7) * 1.2 + 0.5);
          vec4 m = texture2D(tMirror, vec2((px.x + wob + 0.5) / rtSize.x, uv.y));
          vec3 col = mix(bg, m.rgb, m.a * mirrorOpacity);
          // darken into the corners
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

  setDim(dim: 0 | 1): void {
    this.bg.set(THEMES[dim].background);
  }

  /** Match the low-res frame (art pixels). */
  update(w: number, h: number, time: number): void {
    if (this.mirror.width !== w || this.mirror.height !== h) this.mirror.setSize(w, h);
    (this.mat.uniforms.rtSize.value as Vector2).set(w, h);
    this.mat.uniforms.time.value = time;
  }
}
