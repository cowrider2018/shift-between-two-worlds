/**
 * GameView: turns a Sim into a three.js scene each frame. Owns no game rules.
 */
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  Scene, Vector3,
} from 'three';
import { angleDiff } from '../core/grid';
import type { DimIndex } from '../core/level';
import { TUNING, type MonsterState, type Sim, type SimEvent } from '../core/sim';
import { BLOCK_MODELS, type BlockView } from './blockModels';
import { HOLE } from './cutaway';
import { CharacterInstance } from './models';
import { CAMERA, FollowCamera } from './followCamera';
import { glow } from './materials';
import { THEMES } from './palette';
import { PixelPipeline } from './pixelPipeline';

const CONE_SEGMENTS = 32;
/** Segments of the touch circle drawn around the back of the monster, outside the cone. */
const RING_SEGMENTS = 24;
/** Outline points: the cone arc, then the circle's interior points back round to where the cone started. */
const OUTLINE = CONE_SEGMENTS + RING_SEGMENTS;

class VisionCone {
  readonly mesh: Mesh;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly geo = new BufferGeometry();

  constructor() {
    const n = OUTLINE + 1;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    const idx: number[] = [];
    // a closed fan: the cone's lit wedge plus the touch circle around the monster's feet
    for (let i = 0; i < OUTLINE; i++) idx.push(0, 1 + ((i + 1) % OUTLINE), 1 + i);
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
    const show = m.alive && m.dim === sim.dim;
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
    const touch = TUNING.touchRadius;
    for (let i = 0; i < OUTLINE; i++) {
      const inCone = i <= CONE_SEGMENTS;
      const a = inCone
        ? m.angle - half + (2 * half * i) / CONE_SEGMENTS
        : m.angle + half + ((2 * Math.PI - 2 * half) * (i - CONE_SEGMENTS)) / RING_SEGMENTS;
      const d = inCone ? Math.max(touch, sim.sightDistance(m, a, r)) : touch;
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
  soul: CharacterInstance;
  cone: VisionCone;
  alert: Group;
  lastX: number;
  lastY: number;
  /** Seconds since the monster last changed position. */
  stillT: number;
  deathT: number;
}

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

interface CatchSequence {
  mv: MonsterView;
  /** Seconds since the swing started. */
  swingT: number;
  hit: boolean;
  /** Current hero lean (radians). */
  lean: number;
}

/** Camera hole: radius as a fraction of screen height at the farthest zoom (grows as the camera closes in so it
 *  keeps framing the hero, capped at HOLE_RADIUS_MAX), aimed at the hero's mid-body; geometry closer to the
 *  camera than the hero by more than the margin is cut. */
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
  private monsters: MonsterView[] = [];
  private hero!: CharacterInstance;
  private sim!: Sim;
  private catching: CatchSequence | null = null;
  private shownDim: DimIndex | -1 = -1;
  private t = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.pipeline = new PixelPipeline(canvas);
    this.hemi.intensity = 1.5;
    this.sun.intensity = 1.8;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0015;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.world);
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
    for (const dim of [0, 1] as DimIndex[]) {
      const ctx = { theme: THEMES[dim], grid: sim.grid };
      for (const cell of sim.grid.all(dim)) {
        const factory = BLOCK_MODELS[cell.def.id];
        if (!factory) continue;
        const v = factory(cell, ctx);
        this.dims[dim].add(v.object);
        this.blocks.push(v);
      }
    }
    this.monsters = sim.monsters.map((state) => {
      const body = new CharacterInstance('troll', 'normal');
      const soul = new CharacterInstance('troll', 'soul');
      const cone = new VisionCone();
      const alert = new Group();
      alert.add(new Mesh(new BoxGeometry(0.08, 0.22, 0.08), glow('#ff4040')));
      const dot = new Mesh(new BoxGeometry(0.08, 0.08, 0.08), glow('#ff4040'));
      dot.position.y = -0.2;
      alert.add(dot);
      alert.position.y = 1.75;
      body.root.add(alert);
      this.world.add(body.root, soul.root, cone.mesh);
      return { state, body, soul, cone, alert, lastX: state.x, lastY: state.y, stillT: WALK_HOLD, deathT: 0 };
    });
    const { w, h } = sim.level.size;
    const c = new Vector3(w / 2, 0, h / 2);
    this.sun.position.copy(c).add(new Vector3(-6, 14, 5));
    this.sun.target.position.copy(c);
    const s = Math.max(w, h);
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 50 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.shownDim = -1;
    this.catching = null;
    this.hero.root.rotation.set(0, 0, 0);
    this.follow.reset(sim);
    this.resize();
  }

  resize(): void {
    const { w, h } = this.pipeline.resize(window.innerWidth, window.innerHeight);
    this.follow.setAspect(w / h);
  }

  onEvents(events: SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'swing') {
        this.hero.trigger('attack');
      } else if (e.type === 'shift') {
        this.pipeline.fx.flash = 0.85;
        this.pipeline.fx.ripple = 1;
      } else if (e.type === 'kill') {
        this.pipeline.fx.flash = Math.max(this.pipeline.fx.flash, 0.3);
      } else if (e.type === 'caught') {
        const mv = this.monsters.find((v) => v.state === e.monster);
        if (mv) {
          this.catching = { mv, swingT: 0, hit: false, lean: 0 };
          mv.body.trigger('attack');
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
    this.hero.root.rotation.y = -sim.facing;
    if (this.catching) this.updateCatch(this.catching, dt);
    this.hero.setOutfit(sim.sneaking ? 'hooded' : 'plain'); // cloak up while sneaking, off when standing
    const moving = sim.moving && !this.catching; // the sim froze mid-stride when caught
    this.hero.play(sim.sneaking ? (moving ? 'crouch_walk' : 'crouch') : moving ? 'walk' : 'idle', 0.15);
    this.hero.update(dt);

    for (const mv of this.monsters) this.updateMonster(mv, dt);
    this.follow.update(sim, dt);
    this.updateHole();
    this.pipeline.render(this.scene, this.follow.camera);
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

  /** Centre the camera hole (cutaway.ts) on the hero's body and cut everything nearer than the hero. */
  private updateHole(): void {
    const cam = this.follow.camera;
    cam.updateMatrixWorld();
    const p = this.holeAt.set(this.sim.x, HOLE_BODY_Y, this.sim.y);
    const depth = -p.clone().applyMatrix4(cam.matrixWorldInverse).z;
    p.project(cam);
    const { width, height } = this.pipeline;
    const r = height * Math.min(HOLE_RADIUS_MAX, (HOLE_RADIUS * CAMERA.distance) / this.follow.distance);
    HOLE.uHoleCenter.value.set((p.x * 0.5 + 0.5) * width, (p.y * 0.5 + 0.5) * height);
    HOLE.uHoleRadius.value = r;
    HOLE.uHoleDepth.value = depth - HOLE_DEPTH_MARGIN;
    this.pipeline.hole = { x: HOLE.uHoleCenter.value.x, y: HOLE.uHoleCenter.value.y, r };
  }

  private updateMonster(mv: MonsterView, dt: number): void {
    const sim = this.sim;
    const m = mv.state;
    mv.stillT = Math.hypot(m.x - mv.lastX, m.y - mv.lastY) > 1e-4 ? 0 : mv.stillT + dt;
    const moved = mv.stillT < WALK_HOLD;
    mv.lastX = m.x;
    mv.lastY = m.y;
    const home = m.dim === sim.dim;
    const pace = m.def.speed / 1.4;
    const caught = this.catching?.mv === mv;
    mv.body.root.visible = m.alive && home;
    mv.body.root.position.set(m.x, 0, m.y);
    if (caught) {
      // squared up to the hero for the swing (attack is a one-shot, so nothing else cuts it off)
      mv.body.root.rotation.y = -Math.atan2(sim.y - m.y, sim.x - m.x);
    } else {
      // a hunter runs flat out after the hero
      const anim = m.hunting ? 'walk' : m.detect > 0.3 ? 'alert' : moved ? 'walk' : 'idle';
      mv.body.root.rotation.y = -m.angle;
      mv.body.play(anim, 0.2, m.hunting ? TUNING.huntSpeed / 1.4 : anim === 'walk' ? pace : 1);
    }
    mv.body.update(dt);
    mv.alert.visible = m.detect > 0.05;
    mv.alert.scale.setScalar(0.6 + m.detect * 0.8);

    if (!m.alive) mv.deathT += dt;
    const dying = !m.alive && mv.deathT < 0.5;
    const soul = mv.soul.root;
    soul.visible = !home && (m.alive || dying);
    if (soul.visible) {
      const k = dying ? mv.deathT / 0.5 : 0;
      soul.position.set(m.x, 0.15 + Math.sin(this.t * 2 + m.x) * 0.06 + k * 0.6, m.y);
      soul.rotation.y = -m.angle;
      soul.scale.setScalar(1 + k * 0.8);
      soul.visible = k < 1;
      mv.soul.play(moved ? 'walk' : 'idle', 0.2, moved ? pace : 1);
      mv.soul.update(dt);
    }
    mv.cone.update(sim, m);
  }

  private applyTheme(dim: DimIndex): void {
    this.shownDim = dim;
    const th = THEMES[dim];
    this.scene.background = new Color(th.background);
    this.scene.fog = new Fog(th.background, 9, 20);
    this.hemi.color.set(th.hemiSky);
    this.hemi.groundColor.set(th.hemiGround);
    this.sun.color.set(th.sun);
    this.dims[0].visible = dim === 0;
    this.dims[1].visible = dim === 1;
  }
}
