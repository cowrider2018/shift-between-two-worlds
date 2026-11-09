/**
 * DESIGN §4.1 — render the 3D scene at low resolution, then a post pass adds depth outlines,
 * colour quantisation and screen effects. The canvas is CSS-upscaled with nearest filtering.
 */
import {
  Camera, DepthTexture, PerspectiveCamera, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial,
  Color, Vector2, WebGLRenderTarget, WebGLRenderer, PCFShadowMap, UnsignedIntType,
} from 'three';

/** Render resolution = screen resolution / PIXEL_SCALE (each art pixel is PIXEL_SCALE×PIXEL_SCALE screen pixels). */
export const PIXEL_SCALE = 3;

export class PixelPipeline {
  readonly renderer: WebGLRenderer;
  pixelSize = PIXEL_SCALE;
  width = 1;
  height = 1;
  private readonly rt: WebGLRenderTarget;
  private readonly post: ShaderMaterial;
  private readonly postScene = new Scene();
  private readonly postCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  /** Effects driven by the game. */
  readonly fx = { flash: 0, ripple: 0, danger: 0, time: 0 };

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.rt = new WebGLRenderTarget(1, 1, { minFilter: NearestFilter, magFilter: NearestFilter });
    this.rt.depthTexture = new DepthTexture(1, 1, UnsignedIntType);
    this.post = new ShaderMaterial({
      uniforms: {
        tColor: { value: this.rt.texture },
        tDepth: { value: this.rt.depthTexture },
        texel: { value: new Vector2() },
        levels: { value: 14 },
        outline: { value: new Color('#140f18') },
        flash: { value: 0 },
        ripple: { value: 0 },
        danger: { value: 0 },
        time: { value: 0 },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 60 },
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
        uniform vec2 texel;
        uniform float levels, flash, ripple, danger, time;
        uniform vec3 outline;
        varying vec2 vUv;
        float depthAt(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar); }
        void main() {
          vec2 uv = vUv;
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
          if ((dn - d) / d > 0.07 && d < cameraFar * 0.99) c = mix(c, outline, 0.8);
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
    this.pixelSize = PIXEL_SCALE;
    this.width = Math.max(1, Math.ceil(cssW / this.pixelSize));
    this.height = Math.max(1, Math.ceil(cssH / this.pixelSize));
    this.renderer.setSize(this.width, this.height, false);
    this.canvas.style.width = `${this.width * this.pixelSize}px`;
    this.canvas.style.height = `${this.height * this.pixelSize}px`;
    this.rt.setSize(this.width, this.height);
    (this.post.uniforms.texel.value as Vector2).set(1 / this.width, 1 / this.height);
    return { w: this.width, h: this.height };
  }

  render(scene: Scene, camera: Camera): void {
    const u = this.post.uniforms;
    u.flash.value = this.fx.flash;
    u.ripple.value = this.fx.ripple;
    u.danger.value = this.fx.danger;
    u.time.value = this.fx.time;
    if (camera instanceof PerspectiveCamera) {
      u.cameraNear.value = camera.near;
      u.cameraFar.value = camera.far;
    }
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }
}
