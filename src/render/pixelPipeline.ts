/**
 * DESIGN §4.1 — render the 3D scene at low resolution (one render pixel = one art pixel), then a post pass adds
 * depth outlines, colour quantisation and screen effects while upscaling to the screen with nearest sampling.
 * The low-res frame is one art pixel larger on every side than the screen needs, so the upscale can shift it by
 * the camera's sub-pixel remainder (FollowCamera.subpixel): geometry stays locked to the art-pixel grid while the
 * view still scrolls smoothly.
 */
import {
  DepthTexture, Mesh, type PerspectiveCamera, NearestFilter, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial,
  Color, Vector2, Vector3, WebGLRenderTarget, WebGLRenderer, BasicShadowMap, UnsignedIntType,
} from 'three';
import { HOLE_INNER } from './cutaway';

/** Screen pixels per art pixel. */
export const PIXEL_SCALE = 3;
/** Extra art pixels rendered on each side, room for the sub-pixel shift. */
const MARGIN = 1;

export class PixelPipeline {
  readonly renderer: WebGLRenderer;
  pixelSize = PIXEL_SCALE;
  /** Low-res render target size, in art pixels (includes the margin). */
  width = 1;
  height = 1;
  /** Camera sub-pixel remainder in art pixels (x right, y up), set per frame by the view. */
  readonly subpixel = { x: 0, y: 0 };
  private readonly rt: WebGLRenderTarget;
  private readonly post: ShaderMaterial;
  private readonly postScene = new Scene();
  private readonly postCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  /** Effects driven by the game. */
  readonly fx = { flash: 0, ripple: 0, danger: 0, time: 0 };
  /** Camera hole in render pixels (see cutaway.ts); depth outlines are skipped across its dithered rim. */
  hole = { x: 0, y: 0, r: 0 };

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    // hard-edged, unfiltered shadows: a soft penumbra reads as a 3D render, not as drawn shading
    this.renderer.shadowMap.type = BasicShadowMap;
    this.rt = new WebGLRenderTarget(1, 1, { minFilter: NearestFilter, magFilter: NearestFilter });
    this.rt.depthTexture = new DepthTexture(1, 1, UnsignedIntType);
    this.post = new ShaderMaterial({
      uniforms: {
        tColor: { value: this.rt.texture },
        tDepth: { value: this.rt.depthTexture },
        texel: { value: new Vector2() },
        rtSize: { value: new Vector2() },
        screenSize: { value: new Vector2() },
        scale: { value: 3 },
        sub: { value: new Vector2() },
        levels: { value: 14 },
        outline: { value: new Color('#140f18') },
        flash: { value: 0 },
        ripple: { value: 0 },
        danger: { value: 0 },
        time: { value: 0 },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 60 },
        hole: { value: new Vector3() },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tColor;
        uniform float cameraNear, cameraFar;
        uniform sampler2D tDepth;
        uniform vec2 texel, rtSize, screenSize, sub;
        uniform float scale;
        uniform float levels, flash, ripple, danger, time;
        uniform vec3 outline;
        uniform vec3 hole;
        varying vec2 vUv;
        float depthAt(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar); }
        void main() {
          // screen pixel -> art pixel of the low-res frame, shifted by the camera's sub-pixel remainder
          vec2 px = floor((gl_FragCoord.xy - screenSize * 0.5) / scale + rtSize * 0.5 + sub) + 0.5;
          vec2 uv = px / rtSize;
          if (ripple > 0.0) {
            float row = floor(uv.y / texel.y);
            uv.x += floor(sin(row * 0.35 + time * 18.0) * 3.0 * ripple) * texel.x;
          }
          vec3 c = texture2D(tColor, uv).rgb;
          float d = depthAt(uv);
          float dn = max(max(depthAt(uv + vec2(texel.x, 0.0)), depthAt(uv - vec2(texel.x, 0.0))),
                         max(depthAt(uv + vec2(0.0, texel.y)), depthAt(uv - vec2(0.0, texel.y))));
          c = pow(max(c, 0.0), vec3(1.0 / 2.2));
          c = floor(c * levels + 0.5) / levels;
          float hd = distance(px, hole.xy);
          bool rim = hd > hole.z * ${HOLE_INNER.toFixed(3)} - 1.5 && hd < hole.z + 1.5;
          if (!rim && (dn - d) / d > 0.07 && d < cameraFar * 0.99) c = mix(c, outline, 0.8);
          vec2 q = vUv - 0.5;
          float vig = smoothstep(0.25, 0.75, length(q * vec2(1.3, 1.0)));
          c = mix(c, vec3(0.85, 0.08, 0.1), vig * danger * 0.75);
          c = mix(c, vec3(1.0), flash);
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.postScene.add(new Mesh(new PlaneGeometry(2, 2), this.post));
  }

  /** Resize to the window; returns the low-res framebuffer size. */
  resize(cssW: number, cssH: number): { w: number; h: number } {
    const pixelSize = this.pixelSize;
    const sw = Math.max(1, Math.floor(cssW));
    const sh = Math.max(1, Math.floor(cssH));
    this.width = Math.ceil(sw / pixelSize) + 2 * MARGIN;
    this.height = Math.ceil(sh / pixelSize) + 2 * MARGIN;
    this.renderer.setSize(sw, sh, false);
    this.canvas.style.width = `${sw}px`;
    this.canvas.style.height = `${sh}px`;
    this.rt.setSize(this.width, this.height);
    const u = this.post.uniforms;
    (u.texel.value as Vector2).set(1 / this.width, 1 / this.height);
    (u.rtSize.value as Vector2).set(this.width, this.height);
    (u.screenSize.value as Vector2).set(sw, sh);
    u.scale.value = pixelSize;
    return { w: this.width, h: this.height };
  }

  render(scene: Scene, camera: PerspectiveCamera): void {
    const u = this.post.uniforms;
    (u.sub.value as Vector2).set(this.subpixel.x, this.subpixel.y);
    u.flash.value = this.fx.flash;
    u.ripple.value = this.fx.ripple;
    u.danger.value = this.fx.danger;
    u.time.value = this.fx.time;
    (u.hole.value as Vector3).set(this.hole.x, this.hole.y, this.hole.r);
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }
}
