/**
 * DESIGN §4.1 — render the 3D scene at low resolution (one render pixel = one art pixel), then a post pass adds
 * depth outlines, colour quantisation and screen effects while upscaling to the screen with nearest sampling.
 * Silhouettes are read per art pixel: the edge facing the sun gets a RIM_WIDTH-pixel rim of light, the edge facing
 * away the dark outline.
 * The low-res frame is one art pixel larger on every side than the screen needs, so the upscale can shift it by
 * the camera's sub-pixel remainder (FollowCamera.subpixel): geometry stays locked to the art-pixel grid while the
 * view still scrolls smoothly.
 */
import {
  DepthTexture, Mesh, type PerspectiveCamera, NearestFilter, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial,
  Color, Vector2, Vector3, WebGLRenderTarget, WebGLRenderer, BasicShadowMap, UnsignedIntType,
} from 'three';
import { HOLE_INNER, HOLE_SCALE_GLSL } from './cutaway';

/** Screen pixels per art pixel. */
export const PIXEL_SCALE = 3;
/** Extra art pixels rendered on each side, room for the sub-pixel shift. */
const MARGIN = 1;
/** Depth jump between neighbouring pixels, relative to the pixel's depth, that counts as a silhouette edge. */
const SILHOUETTE = 0.07;
/** A silhouette pixel whose outward direction is within this cosine of the on-screen sun direction gets the rim. */
const RIM_FACING = 0.35;
/** Rim thickness in art pixels: the silhouette pixel plus this many minus one more inward, on the same surface. */
const RIM_WIDTH = 2;
/** Brightness steps kept after the post pass. Few steps read as a deliberate palette; many read as a smooth render. */
export const LUMA_LEVELS = 8;
/** How far the brightness steps are dithered: 0 rounds to the nearest step, 1 spreads each step over an ordered
 *  4×4 pattern of art pixels, so a gradient reads as dots between two steps instead of a hard band. */
export const DITHER = 0.5;

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
  /** Sun direction projected onto the screen (unit, x right, y up; zero when the sun is straight along the view)
   *  and its colour, set per frame by the view. */
  readonly sun = { dir: new Vector2(), color: new Color('#ffffff') };
  /** Camera hole in render pixels (see cutaway.ts); depth outlines are skipped across its dithered rim. */
  hole = { x: 0, y: 0, r: 0, tip: 0, capR: 0 };

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
        levels: { value: LUMA_LEVELS },
        outline: { value: new Color('#140f18') },
        sunDir: { value: new Vector2() },
        sunColor: { value: new Color() },
        flash: { value: 0 },
        ripple: { value: 0 },
        danger: { value: 0 },
        time: { value: 0 },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 60 },
        hole: { value: new Vector3() },
        holeCap: { value: new Vector2() },
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
        uniform vec2 sunDir;
        uniform vec3 sunColor;
        uniform vec3 hole;
        uniform vec2 holeCap;
        ${HOLE_SCALE_GLSL}
        varying vec2 vUv;
        /** Ordered-dither threshold in [0, 1) for a 4x4 Bayer matrix; a pixel's position picks the entry. */
        float Bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
        float Bayer4(vec2 a) { return Bayer2(0.5 * a) * 0.25 + Bayer2(a); }
        float depthAt(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar); }
        /** Is the pixel at uv (depth d) a silhouette pixel whose outward side faces the sun? */
        bool sunEdge(vec2 uv, float d) {
          float dl = depthAt(uv - vec2(texel.x, 0.0));
          float dr = depthAt(uv + vec2(texel.x, 0.0));
          float dd = depthAt(uv - vec2(0.0, texel.y));
          float du = depthAt(uv + vec2(0.0, texel.y));
          if ((max(max(dl, dr), max(dd, du)) - d) / d <= ${SILHOUETTE.toFixed(3)}) return false;
          // outward = toward the farther neighbours
          vec2 out2 = vec2(dr - dl, du - dd);
          return dot(out2, sunDir) / max(length(out2), 1e-5) > ${RIM_FACING.toFixed(2)};
        }
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
          float dl = depthAt(uv - vec2(texel.x, 0.0));
          float dr = depthAt(uv + vec2(texel.x, 0.0));
          float dd = depthAt(uv - vec2(0.0, texel.y));
          float du = depthAt(uv + vec2(0.0, texel.y));
          c = pow(max(c, 0.0), vec3(1.0 / 2.2));
          // quantise brightness only, scaling the colour along with it: hue and saturation survive, where rounding
          // each channel on its own pushed dark browns toward olive. The threshold comes from an ordered 4x4 pattern
          // over art pixels, so between two steps the pixels mix in a fixed dot pattern (dithering, DESIGN §4.1)
          float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float threshold = (Bayer4(px) - 0.5) * ${DITHER.toFixed(2)};
          if (luma > 1e-4) c = min(c * (floor(luma * levels + 0.5 + threshold) / levels) / luma, vec3(1.0));
          float hd = distance(px, hole.xy);
          float hr = hole.z * holeScale(d, holeCap);
          bool rim = hr > 0.0 && hd > hr * ${HOLE_INNER.toFixed(3)} - 1.5 && hd < hr + 1.5;
          float far = (max(max(dl, dr), max(dd, du)) - d) / d;
          if (!rim && d < cameraFar * 0.99) {
            bool lit = false;
            if (far > ${SILHOUETTE.toFixed(3)}) {
              // a silhouette pixel: facing the sun -> rim light, else ink
              lit = sunEdge(uv, d);
              // sel-out: the nearer side of the jump darkens into its own colour instead of one flat ink
              if (!lit) c = mix(c * 0.45, outline, 0.35);
            } else {
              // inner rim pixels: the rim grows inward from the sun-facing silhouette. Any pixel within RIM_WIDTH-1
              // (square) on the sun's side and on the same surface that is a sun-facing silhouette pixel lights this
              // one too. Looking at the whole neighbourhood, not one step along a rounded sun direction, keeps the
              // band solid on slanted edges (a single diagonal step skipped every other pixel there)
              const int R = ${RIM_WIDTH - 1};
              for (int oy = -R; oy <= R; oy++) {
                for (int ox = -R; ox <= R; ox++) {
                  vec2 o = vec2(float(ox), float(oy));
                  if (lit || o == vec2(0.0) || dot(o, sunDir) <= 0.0) continue;
                  vec2 q = uv + o * texel;
                  float dq = depthAt(q);
                  if (abs(dq - d) / d > ${SILHOUETTE.toFixed(3)}) continue;
                  if (sunEdge(q, dq)) lit = true;
                }
              }
            }
            if (lit) c = min(c * 1.45 + sunColor * 0.12, vec3(1.0));
          }
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
    (u.holeCap.value as Vector2).set(this.hole.tip, this.hole.capR);
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    (u.sunDir.value as Vector2).copy(this.sun.dir);
    (u.sunColor.value as Color).copy(this.sun.color).convertLinearToSRGB();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }
}
