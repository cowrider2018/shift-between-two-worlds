/**
 * GameView: turns a Sim into a three.js scene each frame. Owns no game rules.
 */
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  Matrix4, type Object3D, Quaternion, Scene, Vector3,
} from 'three';

const UP = new Vector3(0, 1, 0);
import { angleDiff } from '../core/grid';
import type { DimIndex } from '../core/level';
import { TUNING, type MonsterState, type Sim, type SimEvent } from '../core/sim';
import { Abyss } from './abyss';
import { Backdrop } from './backdrop';
import { BLOCK_MODELS, type BlockView } from './blockModels';
import { HOLE } from './cutaway';
import { CharacterInstance } from './models';
import { CAMERA, FollowCamera } from './followCamera';
import { glow } from './materials';
import { THEMES } from './palette';
import { PixelPipeline } from './pixelPipeline';
import { TEXEL_DENSITY } from './texgen';

const CONE_SEGMENTS = 32;

class VisionCone {
  readonly mesh: Mesh;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly geo = new BufferGeometry();

  constructor() {
    const n = CONE_SEGMENTS + 2; // the monster, then the arc
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    const idx: number[] = [];
    for (let i = 0; i < CONE_SEGMENTS; i++) idx.push(0, i + 2, i + 1);
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new BufferAttribute(this.col, 4));
    this.mesh = new Mesh(
      this.geo,
      new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  update(sim: Sim, m: MonsterState): void {
    const show = (m.alive || m.risen) && m.dim === sim.dim;
    this.mesh.visible = show;
    if (!show) return;
    const r = sim.viewRadius(m);
    const half = m.halfAngle;
    const heat = Math.min(1, m.detect);
    const cr = 1;
    const cg = 1 - heat * 0.75;
    const cb = 1 - heat * 0.8;
    const y = 0.025;
    this.pos.set([m.x, y, m.y], 0);
    this.col.set([cr, cg, cb, 0.6], 0);
    for (let i = 0; i <= CONE_SEGMENTS; i++) {
      const a = m.angle - half + (2 * half * i) / CONE_SEGMENTS;
      const d = sim.sightDistance(m, a, r);
      const k = (i + 1) * 3;
      this.pos[k] = m.x + Math.cos(a) * d;
      this.pos[k + 1] = y;
      this.pos[k + 2] = m.y + Math.sin(a) * d;
      this.col.set([cr, cg, cb, 0.12 + 0.18 * Math.max(0, 1 - d / r)], (i + 1) * 4);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }
}

interface MonsterView {
  state: MonsterState;
  body: CharacterInstance;
  /** A surface (A) monster that dies lingers in the underside (B) as a ghost; null for underside monsters. */
  ghost: CharacterInstance | null;
  cone: VisionCone;
  alert: Group;
  lastX: number;
  lastY: number;
  /** Seconds since the monster last changed position. */
  stillT: number;
  /** The troll's chest bone and the inverse of its rest transform: during a takedown the hero lies on its back,
   *  carried by the chest's motion (position and rotation). */
  chest: Object3D;
  chestRestInv: Matrix4;
}

/** The character that acts for a monster: its risen ghost once its body has died, else the body. */
const actor = (mv: MonsterView) => (mv.state.risen && mv.ghost ? mv.ghost : mv.body);

/** Ghosts float a little above the floor, bobbing (phase by position so neighbours do not bob in step). */
const hover = (t: number, phase: number) => 0.15 + Math.sin(t * 2 + phase) * 0.06;

/** A monster counts as walking until it has stood still this long: render frames outnumber sim steps on
 *  high-refresh screens, and a per-frame check would flicker walk/idle and restart the walk every frame. */
const WALK_HOLD = 0.12;

/** Caught sequence: the hunter has run the hero down (sim) and bonks them with its lantern. */
const CATCH = {
  /** Seconds into the troll's `attack` clip at which the lantern lands (frame 10 at 24 fps). */
  impact: 9 / 24,
  /** Seconds from the swing starting until the sequence counts as finished. */
  duration: 1.3,
  /** How far the hero is knocked back (radians of lean) and how fast the lean settles. */
  lean: 0.55,
  leanRate: 14,
};

/** Takedown choreography, in seconds from the kill, matched to the hero's `takedown` clip (24 fps, art/blender/hero.py)
 *  and the troll's `death` clip. The clips pose the bodies; this moves the hero's root along the leap. */
const TAKEDOWN = {
  /** Feet leave the ground (frame 5), land on the troll's back (frame 10). */
  jump: 4 / 24,
  perch: 9 / 24,
  /** After a standoff with the blade held at the thrashing troll's throat (0.4-1.2 s), it slices across (frame 30). */
  cut: 29 / 24,
  /** Push off as the troll lunges forward (frame 35), land back where the leap started (frame 41). */
  leave: 34 / 24,
  land: 40 / 24,
  /** Extra height of each leap's arc at its middle. */
  arc: 0.35,
  /** The hero's root while lying on the troll's back, chin over its crown, in the troll model's rest pose (x forward,
   *  y up). The hero clip pitches the body forward from there (art/blender/hero.py PRONE). */
  back: new Matrix4().makeTranslation(-0.42, 1.06, 0),
};

interface Takedown {
  mv: MonsterView;
  t: number;
  /** Where the leap started (the hero's position in the sim, which does not move during a takedown). */
  x: number;
  y: number;
  cut: boolean;
}

interface CatchSequence {
  mv: MonsterView;
  /** Seconds since the swing started. */
  swingT: number;
  hit: boolean;
  /** Current hero lean (radians). */
  lean: number;
}

/** Camera hole: radius as a fraction of screen height at the farthest zoom (grows as the camera closes in so it
 *  keeps framing the hero, capped at HOLE_RADIUS_MAX), aimed at the hero's mid-body. The cut volume's
 *  hemispherical cap ends HOLE_DEPTH_MARGIN in front of the hero. */
const HOLE_RADIUS = 0.2;
const HOLE_RADIUS_MAX = 0.6;
const HOLE_BODY_Y = 0.75;
const HOLE_DEPTH_MARGIN = 0.25;

export class GameView {
  readonly pipeline: PixelPipeline;
  readonly scene = new Scene();
  readonly follow = new FollowCamera();
  private readonly hemi = new HemisphereLight();
  private readonly sun = new DirectionalLight();
  private readonly world = new Group();
  private dims: [Group, Group] = [new Group(), new Group()];
  private blocks: BlockView[] = [];
  private readonly holeAt = new Vector3();
  private readonly sunDir = new Vector3();
  private monsters: MonsterView[] = [];
  private hero!: CharacterInstance;
  private sim!: Sim;
  private catching: CatchSequence | null = null;
  private takedown: Takedown | null = null;
  private readonly perchM = new Matrix4();
  private readonly perchPos = new Vector3();
  private readonly perchQuat = new Quaternion();
  private readonly perchScale = new Vector3();
  private readonly yawQuat = new Quaternion();
  private shownDim: DimIndex | -1 = -1;
  private readonly backdrop = new Backdrop();
  private readonly abyss = new Abyss();
  private readonly clearColor = new Color();
  /** Fog for the reflection: it sinks into the shown dimension's background with distance. It thickens at half
   *  the rate of a 4..16 fog (both ends doubled), so the reflection stays visible twice as far. */
  private readonly mirrorFog = new Fog('#000000', 8, 32);
  private readonly fogs = THEMES.map((th) => new Fog(th.background, 9, 20)) as [Fog, Fog];
  private t = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.pipeline = new PixelPipeline(canvas);
    this.hemi.intensity = 1.5;
    this.sun.intensity = 1.8;
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0015;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.world, this.backdrop.mesh, ...this.abyss.points);
  }

  setSim(sim: Sim): void {
    this.sim = sim;
    this.world.clear();
    this.dims = [new Group(), new Group()];
    this.blocks = [];
    this.world.add(...this.dims);
    if (!this.hero) {
      this.hero = new CharacterInstance('hero', 'normal', 'plain');
      this.scene.add(this.hero.root);
    }
    this.abyss.setLevel(sim.level.size.w, sim.level.size.h);
    for (const dim of [0, 1] as DimIndex[]) {
      const ctx = { theme: THEMES[dim], grid: sim.grid };
      // the ring of rock just outside the grid: the outermost wall wherever the level's border is open
      const { w, h } = sim.level.size;
      const ring = [];
      for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) if (x < 0 || y < 0 || x >= w || y >= h) ring.push(sim.grid.cell(dim, x, y));
      for (const cell of [...sim.grid.all(dim), ...ring]) {
        const factory = BLOCK_MODELS[cell.def.id];
        if (!factory) continue;
        const v = factory(cell, ctx);
        this.dims[dim].add(v.object);
        this.blocks.push(v);
      }
    }
    this.monsters = sim.monsters.map((state) => {
      // every underside (B) monster is a ghost: the look marks the dimension, not death
      const body = new CharacterInstance('troll', state.home === 1 ? 'ghost' : 'normal');
      const ghost = state.home === 0 ? new CharacterInstance('troll', 'ghost') : null;
      const cone = new VisionCone();
      const alert = new Group();
      alert.add(new Mesh(new BoxGeometry(0.08, 0.22, 0.08), glow('#ff4040')));
      const dot = new Mesh(new BoxGeometry(0.08, 0.08, 0.08), glow('#ff4040'));
      dot.position.y = -0.2;
      alert.add(dot);
      alert.position.y = 1.75;
      body.root.add(alert);
      this.world.add(body.root, cone.mesh);
      if (ghost) this.world.add(ghost.root);
      // still in its rest pose at the origin (no clip has played): remember the chest's rest transform
      const chest = body.root.getObjectByName('chest') ?? body.root;
      body.root.updateMatrixWorld(true);
      const chestRestInv = chest.matrixWorld.clone().invert();
      return { state, body, ghost, cone, alert, lastX: state.x, lastY: state.y, stillT: WALK_HOLD, chest, chestRestInv };
    });
    const { w, h } = sim.level.size;
    const c = new Vector3(w / 2, 0, h / 2);
    this.sun.position.copy(c).add(new Vector3(-6, 14, 5));
    this.sun.target.position.copy(c);
    const s = Math.max(w, h);
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 50 });
    this.sun.shadow.camera.updateProjectionMatrix();
    // about one shadow texel per art pixel, so hard shadow edges step like the rest of the art
    const size = Math.min(4096, 2 ** Math.ceil(Math.log2(2 * s * TEXEL_DENSITY)));
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.shownDim = -1;
    this.catching = null;
    this.takedown = null;
    this.hero.root.rotation.set(0, 0, 0);
    this.follow.reset(sim);
    this.resize();
  }

  resize(): void {
    const { w, h } = this.pipeline.resize(window.innerWidth, window.innerHeight);
    this.follow.setViewport(w, h);
  }

  onEvents(events: SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'shift') {
        this.pipeline.fx.flash = 0.85;
        this.pipeline.fx.ripple = 1;
      } else if (e.type === 'kill') {
        const mv = this.monsters.find((v) => v.state === e.monster);
        if (mv) {
          this.takedown = { mv, t: 0, x: this.sim.x, y: this.sim.y, cut: false };
          this.hero.trigger('takedown');
          mv.body.trigger('death');
        }
      } else if (e.type === 'caught') {
        this.takedown = null; // spotted by another monster mid-takedown: the hero is back on the ground for the bonk
        const mv = this.monsters.find((v) => v.state === e.monster);
        if (mv) {
          this.catching = { mv, swingT: 0, hit: false, lean: 0 };
          actor(mv).trigger('attack');
          // a hunter catches up from behind, i.e. between the camera and the hero: swing round to watch side-on
          const line = Math.atan2(this.sim.y - e.monster.y, this.sim.x - e.monster.x);
          const sides = [line + Math.PI / 2, line - Math.PI / 2];
          const yaw = this.follow.yaw;
          this.follow.swingTo(Math.abs(angleDiff(sides[0], yaw)) <= Math.abs(angleDiff(sides[1], yaw)) ? sides[0] : sides[1]);
        }
      }
    }
  }

  frame(dt: number): void {
    const sim = this.sim;
    this.t += dt;
    const fx = this.pipeline.fx;
    fx.time = this.t;
    fx.flash = Math.max(0, fx.flash - dt * 4);
    fx.ripple = Math.max(0, fx.ripple - dt * 2.5);
    fx.danger = Math.max(0, ...sim.monsters.map((m) => (m.dim === sim.dim ? m.detect : 0)));

    if (this.shownDim !== sim.dim) this.applyTheme(sim.dim);
    for (const b of this.blocks) b.update?.(sim, dt, this.t);

    this.hero.root.position.set(sim.x, 0, sim.y);
    this.hero.root.rotation.set(0, -sim.facing, 0);
    if (this.catching) this.updateCatch(this.catching, dt);
    // always cloaked in the underside; on the surface the cloak goes up only while sneaking
    this.hero.setOutfit(sim.dim === 1 || sim.sneaking ? 'hooded' : 'plain');
    const moving = sim.moving && !this.catching; // the sim froze mid-stride when caught
    this.hero.play(sim.sneaking ? (moving ? 'crouch_walk' : 'crouch') : moving ? 'walk' : 'idle', 0.15);
    this.hero.update(dt);

    for (const mv of this.monsters) this.updateMonster(mv, dt);
    if (this.takedown) this.updateTakedown(this.takedown, dt);
    this.follow.update(sim, dt);
    this.snapCharacters();
    this.pipeline.subpixel.x = this.follow.subpixel.x;
    this.pipeline.subpixel.y = this.follow.subpixel.y;
    this.updateHole();
    this.updateSunOnScreen();
    this.backdrop.update(this.pipeline.width, this.pipeline.height, this.follow.camera, this.t);
    this.abyss.update(this.t);
    this.renderMirror();
    this.pipeline.render(this.scene, this.follow.camera);
  }

  /**
   * Render the other dimension (level and monsters) mirrored about the floor plane (y -> -y), from this camera, into the
   * backdrop's reflection: upside down directly beneath this level, in its own light. The lights are mirrored
   * with it so its tops stay lit; fog fades it with depth into this dimension's background.
   */
  private renderMirror(): void {
    const shown = this.shownDim as DimIndex;
    const other = (1 - shown) as DimIndex;
    // the other side's level and monsters as they stand there (not the hero, who is on this side, nor the
    // vision cones, which lie flat on the floor)
    const shows: [Object3D, boolean][] = [[this.hero.root, false], [this.backdrop.mesh, false], ...this.abyss.points.map((p) => [p, false] as [Object3D, boolean])];
    for (const mv of this.monsters) {
      // the same rules as updateMonster, for the other dimension
      shows.push([mv.body.root, mv.state.home === other], [mv.cone.mesh, false]);
      if (mv.ghost) shows.push([mv.ghost.root, mv.state.risen && other === 1]);
    }
    const was = shows.map(([o]) => o.visible);
    for (const [o, v] of shows) o.visible = v;
    this.light(other);
    this.mirrorFog.color.copy(this.backdrop.bg);
    this.scene.fog = this.mirrorFog;
    const flip = [this.world.scale, this.sun.position, this.sun.target.position, this.hemi.position];
    for (const v of flip) v.y = -v.y;
    const background = this.scene.background;
    this.scene.background = null;
    const r = this.pipeline.renderer;
    const clearAlpha = r.getClearAlpha();
    r.getClearColor(this.clearColor);
    r.setRenderTarget(this.backdrop.mirror);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.follow.camera);
    r.setRenderTarget(null);
    r.setClearColor(this.clearColor, clearAlpha);
    this.scene.background = background;
    for (const v of flip) v.y = -v.y;
    this.light(shown);
    shows.forEach(([o], i) => (o.visible = was[i]));
  }

  /** True once a caught sequence has played out (the game restarts the level then). */
  catchFinished(): boolean {
    return !!this.catching && this.catching.swingT >= CATCH.duration;
  }

  /** Play out the lantern swing and knock the hero back when it lands. */
  private updateCatch(c: CatchSequence, dt: number): void {
    const sim = this.sim;
    const m = c.mv.state;
    const dx = sim.x - m.x;
    const dy = sim.y - m.y;
    const d = Math.hypot(dx, dy);
    c.swingT += dt;
    if (!c.hit && c.swingT >= CATCH.impact) {
      c.hit = true;
      c.lean = CATCH.lean;
      this.pipeline.fx.flash = 0.7;
    }
    // the hero turns to face its catcher, and reels back from the blow
    if (d > 1e-6) this.hero.root.rotation.y = -Math.atan2(-dy, -dx);
    this.hero.root.rotation.z = c.hit ? c.lean : 0;
    if (c.hit) c.lean += (CATCH.lean * 0.6 - c.lean) * Math.min(1, dt * CATCH.leanRate);
  }

  /** Carry the hero along the leap onto the troll's back, hold it there through the standoff and the cut, and back
   *  off again. */
  private updateTakedown(td: Takedown, dt: number): void {
    td.t += dt;
    const T = TAKEDOWN;
    const m = td.mv.state;
    if (!td.cut && td.t >= T.cut) {
      td.cut = true;
      this.pipeline.fx.flash = Math.max(this.pipeline.fx.flash, 0.35);
    }
    if (td.t >= T.land) {
      this.takedown = null;
      return;
    }
    // lying on the troll's back: the chest's current transform relative to its rest pose carries the hero along,
    // twisting and lurching with it
    td.mv.body.root.updateMatrixWorld(true);
    this.perchM.multiplyMatrices(td.mv.chest.matrixWorld, td.mv.chestRestInv).multiply(T.back);
    this.perchM.decompose(this.perchPos, this.perchQuat, this.perchScale);
    const p = this.perchPos;
    const hero = this.hero.root;
    // facing the troll on the way up, then turning with it; back off facing where it faced
    const toward = Math.atan2(m.y - td.y, m.x - td.x);
    const ground = { x: td.x, y: 0, z: td.y };
    const yaw = (a: number) => this.yawQuat.setFromAxisAngle(UP, -a);
    let from = ground;
    let to = ground;
    let k = 0;
    if (td.t < T.jump) {
      hero.quaternion.copy(yaw(toward));
    } else if (td.t < T.perch) {
      to = p;
      k = (td.t - T.jump) / (T.perch - T.jump);
      hero.quaternion.copy(yaw(toward)).slerp(this.perchQuat, k);
    } else if (td.t < T.leave) {
      from = to = p;
      hero.quaternion.copy(this.perchQuat);
    } else {
      from = p;
      k = (td.t - T.leave) / (T.land - T.leave);
      hero.quaternion.copy(this.perchQuat).slerp(yaw(m.angle), k);
    }
    hero.position.set(
      from.x + (to.x - from.x) * k,
      from.y + (to.y - from.y) * k + T.arc * 4 * k * (1 - k),
      from.z + (to.z - from.z) * k,
    );
  }

  /** Project the sun's direction onto the screen for the post pass's lit-side rim. */
  private updateSunOnScreen(): void {
    const s = this.pipeline.sun;
    const v = this.sunDir.subVectors(this.sun.position, this.sun.target.position);
    v.transformDirection(this.follow.camera.matrixWorldInverse);
    s.dir.set(v.x, v.y);
    if (s.dir.lengthSq() > 1e-6) s.dir.normalize();
    else s.dir.set(0, 0);
    s.color.copy(this.sun.color);
  }

  /** Put every character on the camera's pixel grid (after all of them have been placed this frame). */
  private snapCharacters(): void {
    this.follow.snap(this.hero.root.position);
    for (const mv of this.monsters) {
      this.follow.snap(mv.body.root.position);
      if (mv.ghost) this.follow.snap(mv.ghost.root.position);
    }
  }

  /** Centre the camera hole (cutaway.ts) on the hero's body: a cylinder from the camera, rounded off toward the hero. */
  private updateHole(): void {
    const cam = this.follow.camera;
    cam.updateMatrixWorld();
    const h = this.hero.root.position; // follows the hero up onto a troll's head during a takedown
    const p = this.holeAt.set(h.x, h.y + HOLE_BODY_Y, h.z);
    const depth = -p.clone().applyMatrix4(cam.matrixWorldInverse).z;
    p.project(cam);
    const { width, height } = this.pipeline;
    const r = height * Math.min(HOLE_RADIUS_MAX, (HOLE_RADIUS * CAMERA.distance) / this.follow.distance);
    HOLE.uHoleCenter.value.set((p.x * 0.5 + 0.5) * width, (p.y * 0.5 + 0.5) * height);
    HOLE.uHoleRadius.value = r;
    // the screen radius as a world radius at the hero's depth: the cap is a sphere of the cylinder's own width
    const world = (r * 2 * depth * Math.tan((cam.fov * Math.PI) / 360)) / (height * cam.zoom);
    HOLE.uHoleCap.value.set(depth - HOLE_DEPTH_MARGIN, world);
    this.pipeline.hole = { x: HOLE.uHoleCenter.value.x, y: HOLE.uHoleCenter.value.y, r, tip: depth - HOLE_DEPTH_MARGIN, capR: world };
  }

  private updateMonster(mv: MonsterView, dt: number): void {
    const sim = this.sim;
    const m = mv.state;
    mv.stillT = Math.hypot(m.x - mv.lastX, m.y - mv.lastY) > 1e-4 ? 0 : mv.stillT + dt;
    const moved = mv.stillT < WALK_HOLD;
    mv.lastX = m.x;
    mv.lastY = m.y;
    const caught = this.catching?.mv === mv;
    const float = (grounded: boolean) => (grounded ? 0 : hover(this.t, m.x));

    // the body, in its home dimension (underside monsters are ghosts from the start)
    const body = mv.body;
    body.root.visible = m.home === sim.dim;
    if (m.corpse) {
      // the dead stay where they fell; the death clip plays once and holds its last frame
      body.root.position.set(m.corpse.x, float(m.home === 0), m.corpse.y);
      body.root.rotation.y = -m.corpse.angle;
    } else {
      body.root.position.set(m.x, float(m.home === 0), m.y);
      this.animateLive(body, m, moved, caught);
    }
    body.update(dt);

    // a fallen surface monster's ghost, watching from where it fell in the underside
    const ghost = mv.ghost;
    if (ghost) {
      ghost.root.visible = m.risen && sim.dim === 1;
      if (m.risen) {
        ghost.root.position.set(m.x, float(false), m.y);
        this.animateLive(ghost, m, moved, caught);
        ghost.update(dt);
      }
    }

    const a = actor(mv);
    if (mv.alert.parent !== a.root) a.root.add(mv.alert);
    mv.alert.visible = m.detect > 0.05;
    mv.alert.scale.setScalar(0.6 + m.detect * 0.8);
    mv.cone.update(sim, m);
  }

  /** Face and animate a monster that is up and about (a living body or a risen ghost). */
  private animateLive(c: CharacterInstance, m: MonsterState, moved: boolean, caught: boolean): void {
    const sim = this.sim;
    if (caught) {
      // squared up to the hero for the swing (attack is a one-shot, so nothing else cuts it off)
      c.root.rotation.y = -Math.atan2(sim.y - m.y, sim.x - m.x);
      return;
    }
    // a hunter runs flat out after the hero
    const anim = m.hunting ? 'walk' : m.detect > 0.3 ? 'alert' : moved ? 'walk' : 'idle';
    c.root.rotation.y = -m.angle;
    c.play(anim, 0.2, m.hunting ? TUNING.huntSpeed / 1.4 : anim === 'walk' ? m.def.speed / 1.4 : 1);
  }

  private applyTheme(dim: DimIndex): void {
    this.shownDim = dim;
    this.scene.background = new Color(THEMES[dim].background);
    this.backdrop.setDim(dim);
    this.abyss.setDim(dim);
    this.light(dim);
  }

  /** Light, fog and show one dimension's level (the mirror pass borrows this for the other one). */
  private light(dim: DimIndex): void {
    const th = THEMES[dim];
    this.scene.fog = this.fogs[dim];
    this.hemi.color.set(th.hemiSky);
    this.hemi.groundColor.set(th.hemiGround);
    this.sun.color.set(th.sun);
    this.dims[0].visible = dim === 0;
    this.dims[1].visible = dim === 1;
  }
}
