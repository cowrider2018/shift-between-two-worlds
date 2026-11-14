/**
 * Start screens (DESIGN §2): the controls, shown once before the first level as three flat pages in the game's own
 * pixel look. Each is a full-screen canvas of rock facing the camera, with the figures standing flat in front of it:
 *  1. the hero running: WASD moves;
 *  2. a troll and a lever, under one Space key: it cuts the troll's throat, or pulls the lever;
 *  3. the hero above their exact mirror image, on the rock mirrored too, in the other dimension's colours: Shift.
 * Any key turns the page; after the last the first level starts. The labels are HTML (index.html #briefing); this
 * only pins them to their figures each frame.
 * The camera is a perspective one with a very narrow field of view from far off, so the picture is flat but the
 * post pass still reads its depth buffer the way it expects.
 */
import {
  BufferAttribute, CircleGeometry, DirectionalLight, Group, HemisphereLight, Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector3,
  type Material,
} from 'three';
import { leverParts } from './blockModels';
import { COBBLE_SPAN } from './cobbleTexture';
import { cobble } from './materials';
import { CharacterInstance } from './models';
import { THEMES } from './palette';
import type { PixelPipeline } from './pixelPipeline';

/** Field of view (degrees): narrow enough that nothing visibly recedes. */
const FOV = 6;
/** World units shown top to bottom. */
const VIEW_H = 2.6;
/** The rock canvas sits this far behind the figures. */
const BACK_Z = -1.5;

interface Page {
  root: Group;
  /** Height the camera centres on. */
  centerY: number;
  /** Where each of the page's labels is pinned, in label order. */
  anchors: Vector3[];
  /** The rock below y = 0: the same surface rock running on, or (the last page) its mirror image in the underside. */
  mirrored: boolean;
  update(dt: number, t: number): void;
}

export class Briefing {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 1, 100);
  private readonly sun = new DirectionalLight();
  private readonly pages: Page[];
  /** Below y = 0: the surface rock carrying on, and the rock above mirrored in the underside's colours. */
  private readonly lower: Mesh;
  private readonly mirrorLower: Mesh;
  private readonly at = new Vector3();
  private index = 0;
  private t = 0;

  /** `labels[i]` holds the label elements of page i, in anchor order; `pageEls[i]` is shown while page i is. */
  constructor(private readonly pipeline: PixelPipeline, private readonly pageEls: HTMLElement[],
    private readonly labels: HTMLElement[][]) {
    const th = THEMES[0];
    this.scene.add(new HemisphereLight(th.hemiSky, th.hemiGround, 1.5));
    this.sun.color.set(th.sun);
    this.sun.intensity = 1.8;
    // from the front, high and to the left, as in play
    this.sun.position.set(-4, 6, 8);
    this.scene.add(this.sun, this.sun.target);

    const surface = cobble(THEMES[0].floor[0]);
    this.lower = this.rock(-1, surface, false);
    this.mirrorLower = this.rock(-1, cobble(THEMES[1].floor[0]), true);
    this.scene.add(this.rock(1, surface, false), this.lower, this.mirrorLower);

    this.pages = [this.movePage(), this.actPage(), this.shiftPage()];
    for (const p of this.pages) this.scene.add(p.root);
    this.show(0);
  }

  /** Half of the rock canvas: above (side 1) or below (side -1) y = 0, tiled at the floor's scale in play;
   *  `mirrored` flips its texture about y = 0, so the lower half shows the upper one's stones reflected. */
  private rock(side: 1 | -1, mat: Material, mirrored: boolean): Mesh {
    const w = 40;
    const h = 20;
    const g = new PlaneGeometry(w, h);
    g.translate(0, (side * h) / 2, BACK_Z);
    const pos = g.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i) / COBBLE_SPAN;
      uv[i * 2 + 1] = (mirrored ? -pos.getY(i) : pos.getY(i)) / COBBLE_SPAN;
    }
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    return new Mesh(g, mat);
  }

  private hero(outfit: 'plain' | 'hooded', clip: string, yaw: number): CharacterInstance {
    const c = new CharacterInstance('hero', 'normal', outfit);
    c.root.rotation.y = yaw;
    c.play(clip, 0);
    return c;
  }

  /** 1. The hero running across the page: WASD. */
  private movePage(): Page {
    const root = new Group();
    const hero = this.hero('plain', 'run', -0.45);
    root.add(hero.root);
    return { root, centerY: 0.3, anchors: [new Vector3(0, -0.2, 0)], mirrored: false, update: (dt) => hero.update(dt) };
  }

  /** 2. A troll facing us and a lever, one Space key between them: it does both. */
  private actPage(): Page {
    const root = new Group();
    const troll = new CharacterInstance('troll', 'normal');
    troll.root.position.x = -0.75;
    troll.root.rotation.y = -Math.PI / 2; // facing the camera
    troll.play('idle', 0);
    const lever = leverParts({ x: 0, y: 0 });
    const leverRoot = new Group();
    // without its pool of light on the floor: there is no floor here, and seen level it is only a red line
    leverRoot.add(...lever.parts.filter((o) => !(o instanceof Mesh && o.geometry instanceof CircleGeometry)));
    leverRoot.position.x = 0.85; // seen dead level, side on, like every other figure
    root.add(troll.root, leverRoot);
    return {
      root, centerY: 0.5, mirrored: false,
      anchors: [new Vector3(0.05, -0.2, 0)],
      update: (dt, t) => {
        troll.update(dt);
        lever.update(t, dt, false);
      },
    };
  }

  /** 3. The hero over their own reflection, one to one, on the rock's reflection in the underside's colours and
   *  cloak: Shift. */
  private shiftPage(): Page {
    const root = new Group();
    const yaw = -Math.PI / 2 + 0.45;
    const hero = this.hero('plain', 'idle', yaw);
    const mirror = this.hero('hooded', 'idle', yaw);
    mirror.root.scale.y = -1;
    root.add(hero.root, mirror.root);
    return {
      root, centerY: 0, mirrored: true,
      anchors: [new Vector3(0.45, 0, 0)],
      update: (dt) => {
        hero.update(dt);
        mirror.update(dt);
      },
    };
  }

  private show(i: number): void {
    this.index = i;
    this.pages.forEach((p, j) => (p.root.visible = j === i));
    this.pageEls.forEach((el, j) => (el.hidden = j !== i));
    this.mirrorLower.visible = this.pages[i].mirrored;
    this.lower.visible = !this.mirrorLower.visible;
  }

  /** Turn to the next page; false once past the last one. */
  next(): boolean {
    if (this.index + 1 >= this.pages.length) return false;
    this.show(this.index + 1);
    return true;
  }

  frame(dt: number): void {
    this.t += dt;
    const page = this.pages[this.index];
    page.update(dt, this.t);
    const { pipeline, camera } = this;
    camera.aspect = pipeline.width / pipeline.height;
    const dist = VIEW_H / 2 / Math.tan((FOV * Math.PI) / 360);
    camera.position.set(0, page.centerY, dist);
    camera.near = dist - 5;
    camera.far = dist + 5;
    camera.updateProjectionMatrix();
    camera.lookAt(0, page.centerY, 0);
    camera.updateMatrixWorld();
    // the post pass's rim light wants the sun's direction on screen (as the game view does)
    const s = this.at.subVectors(this.sun.position, this.sun.target.position).transformDirection(camera.matrixWorldInverse);
    pipeline.sun.dir.set(s.x, s.y);
    if (pipeline.sun.dir.lengthSq() > 1e-6) pipeline.sun.dir.normalize();
    pipeline.sun.color.copy(this.sun.color);
    pipeline.subpixel.x = pipeline.subpixel.y = 0;
    pipeline.hole = { x: 0, y: 0, r: 0, tip: 0, capR: 0 };
    pipeline.fx.flash = pipeline.fx.ripple = pipeline.fx.danger = 0;
    pipeline.fx.time = this.t;
    // the game clips everything under the floor (its mirror pass draws the other dimension there); the pages do not
    const renderer = pipeline.renderer;
    const clip = renderer.clippingPlanes;
    renderer.clippingPlanes = [];
    pipeline.render(this.scene, camera);
    renderer.clippingPlanes = clip;
    this.placeLabels(page);
  }

  /** Pin each label of the page to its anchor, in CSS pixels (the label's CSS decides which of its points). */
  private placeLabels(page: Page): void {
    const rect = this.pipeline.canvas.getBoundingClientRect();
    this.labels[this.index].forEach((el, i) => {
      const p = this.at.copy(page.anchors[i]).project(this.camera);
      el.style.left = `${rect.left + (p.x * 0.5 + 0.5) * rect.width}px`;
      el.style.top = `${rect.top + (0.5 - p.y * 0.5) * rect.height}px`;
    });
  }
}
