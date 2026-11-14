/**
 * Ending (DESIGN §2): after the last level, the hero runs toward the right of the screen, three-quarters to the
 * camera, over an endless plain of the surface's flagstones that fades into the dark, seen from 15° above the
 * ground. The hero, large and turned 60° toward the camera, runs a little right of centre; the words are
 * centred in the space to their left. The hero stays put and the
 * ground slides under them; the plane steps back by whole texture repeats, so the stones never jump.
 * The words are HTML (index.html #ending); this pins them beside the hero, main fades them in.
 */
import { BufferAttribute, Color, DirectionalLight, Vector3, Fog, HemisphereLight, Mesh, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { TUNING } from '../core/sim';
import { COBBLE_SPAN } from './cobbleTexture';
import { cobble } from './materials';
import { CharacterInstance } from './models';
import { THEMES } from './palette';
import type { PixelPipeline } from './pixelPipeline';
import { renderStandalone } from './standalone';

/** The plane's extent: past the camera's far plane every way, so it is cut off there, at the same depth as the empty
 *  background, and the post pass sees no edge to outline at the horizon (the fog has long since swallowed it). */
const PLANE = { w: 200, d: 200 };
/** Near and far planes kept tight: with the usual 0.1 near plane the depth far off is too coarse, and the post pass
 *  outlines its noise as a bright band along the horizon. The fog is solid well before FAR. */
const NEAR = 0.5;
const FAR = 20;
/** Camera: close enough that the hero stands about two thirds of the screen's height, 15° above the ground. */
const CAMERA_DIST = 1.7;
const CAMERA_PITCH = (15 * Math.PI) / 180;
const LOOK_Y = 0.4;
/** The words weigh less than the hero, so the hero runs a little right of centre to balance them. */
const HERO_X = 0.2;
/** The words are centred at the hero's mid-body height. */
const WORDS_AT = new Vector3(HERO_X, 0.45, 0);
/** Seconds of running (more than one stride cycle) over which the hero's leftmost reach on screen is measured; the
 *  words are centred between it and the screen's left edge, and stay put once it is known. */
const MEASURE_FOR = 1.5;

export class Ending {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(40, 1, NEAR, FAR);
  private readonly sun = new DirectionalLight();
  private readonly hero = new CharacterInstance('hero', 'normal', 'plain');
  private readonly floor: Mesh;
  private readonly at = new Vector3();
  private t = 0;
  /** Leftmost x (normalised device coordinates) the hero's geometry has reached, measured since `measureFrom`;
   *  restarted whenever the view changes size. */
  private heroLeft = Infinity;
  private measureFrom = 0;
  private measuredSize = '';

  constructor(private readonly pipeline: PixelPipeline, private readonly label: HTMLElement) {
    const th = THEMES[0];
    this.scene.background = new Color(th.background);
    this.scene.fog = new Fog(th.background, 6, 14);
    this.scene.add(new HemisphereLight(th.hemiSky, th.hemiGround, 1.5));
    this.sun.color.set(th.sun);
    this.sun.intensity = 1.8;
    this.sun.position.set(HERO_X - 6, 14, 5);
    this.sun.target.position.set(HERO_X, 0, 0);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0015;
    this.sun.shadow.normalBias = 0.04;
    Object.assign(this.sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 40 });
    this.sun.shadow.mapSize.set(1024, 1024);
    this.floor = this.plain();
    this.scene.add(this.sun, this.sun.target, this.floor);

    // running to the screen's right, turned 60° toward the camera
    this.hero.root.rotation.y = -Math.PI / 3;
    this.hero.root.position.x = HERO_X;
    this.hero.root.traverse((o) => (o.castShadow = true));
    this.hero.play('run', 0);
    this.scene.add(this.hero.root);

    this.camera.position.set(0, LOOK_Y + CAMERA_DIST * Math.sin(CAMERA_PITCH), CAMERA_DIST * Math.cos(CAMERA_PITCH));
    this.camera.lookAt(0, LOOK_Y, 0);
  }

  /** A wide plane of flagstones, tiled at the same scale as the floor in play. */
  private plain(): Mesh {
    const g = new PlaneGeometry(PLANE.w, PLANE.d);
    g.rotateX(-Math.PI / 2);
    const pos = g.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i) / COBBLE_SPAN;
      uv[i * 2 + 1] = pos.getZ(i) / COBBLE_SPAN;
    }
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    const floor = new Mesh(g, cobble(THEMES[0].floor[0]));
    floor.receiveShadow = true;
    return floor;
  }

  frame(dt: number): void {
    this.t += dt;
    this.hero.update(dt);
    // the ground goes by at the hero's running speed, wrapped by whole texture repeats
    this.floor.position.x = -((this.t * TUNING.playerSpeed) % COBBLE_SPAN);
    this.camera.aspect = this.pipeline.width / this.pipeline.height;
    this.camera.updateProjectionMatrix();
    renderStandalone(this.pipeline, this.scene, this.camera, this.sun, this.t);
    this.measureHero();
    const rect = this.pipeline.canvas.getBoundingClientRect();
    const edge = rect.left + (this.heroLeft * 0.5 + 0.5) * rect.width;
    this.label.style.left = `${(rect.left + edge) / 2}px`;
    const p = this.at.copy(WORDS_AT).project(this.camera);
    this.label.style.top = `${rect.top + (0.5 - p.y * 0.5) * rect.height}px`;
  }

  /** Widen heroLeft to the hero's skinned, posed geometry this frame, for the first MEASURE_FOR seconds at a size. */
  private measureHero(): void {
    const size = `${this.pipeline.width}x${this.pipeline.height}`;
    if (size !== this.measuredSize) {
      this.measuredSize = size;
      this.heroLeft = Infinity;
      this.measureFrom = this.t;
    }
    if (this.t - this.measureFrom > MEASURE_FOR) return;
    const v = this.at;
    this.hero.root.updateMatrixWorld(true);
    this.hero.root.traverseVisible((o) => {
      if (!(o instanceof Mesh)) return;
      const n = o.geometry.getAttribute('position').count;
      for (let i = 0; i < n; i++) {
        o.getVertexPosition(i, v);
        v.applyMatrix4(o.matrixWorld).project(this.camera);
        if (v.x < this.heroLeft) this.heroLeft = v.x;
      }
    });
  }
}
