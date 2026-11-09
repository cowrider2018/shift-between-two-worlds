/**
 * GameView: turns a Sim into a three.js scene each frame. Owns no game rules.
 */
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  RingGeometry, Scene, Vector3,
} from 'three';
import type { DimIndex } from '../core/level';
import type { MonsterState, Sim, SimEvent } from '../core/sim';
import { BLOCK_MODELS, type BlockView } from './blockModels';
import { HeroModel, buildSoul, buildTroll } from './characters';
import { FollowCamera } from './followCamera';
import { glow } from './materials';
import { THEMES } from './palette';
import { PixelPipeline } from './pixelPipeline';

const CHAR_SCALE = 1.3;
const CONE_SEGMENTS = 32;

class VisionCone {
  readonly mesh: Mesh;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly geo = new BufferGeometry();

  constructor() {
    const n = CONE_SEGMENTS + 2;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    const idx: number[] = [];
    for (let i = 1; i <= CONE_SEGMENTS; i++) idx.push(0, i + 1, i);
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
    for (let i = 0; i <= CONE_SEGMENTS; i++) {
      const a = m.angle - half + (2 * half * i) / CONE_SEGMENTS;
      const d = sim.sightDistance(m, a, r);
      const k = (i + 1) * 3;
      this.pos[k] = m.x + Math.cos(a) * d;
      this.pos[k + 1] = y;
      this.pos[k + 2] = m.y + Math.sin(a) * d;
      this.col.set([cr, cg, cb, 0.12 + 0.18 * (1 - d / r)], (i + 1) * 4);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }
}

interface MonsterView {
  state: MonsterState;
  body: Group;
  soul: Group;
  cone: VisionCone;
  alert: Group;
  lastX: number;
  lastY: number;
  deathT: number;
}

export class GameView {
  readonly pipeline: PixelPipeline;
  readonly scene = new Scene();
  readonly follow = new FollowCamera();
  private readonly hemi = new HemisphereLight();
  private readonly sun = new DirectionalLight();
  private readonly world = new Group();
  private dims: [Group, Group] = [new Group(), new Group()];
  private blocks: BlockView[] = [];
  /** Tall block objects per dimension, keyed "x,y" — candidates for the camera cutaway. */
  private tall: [Map<string, BlockView['object']>, Map<string, BlockView['object']>] = [new Map(), new Map()];
  private cut: BlockView['object'][] = [];
  private monsters: MonsterView[] = [];
  private readonly hero = new HeroModel();
  private readonly shiftRing: Mesh;
  private sim!: Sim;
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
    this.shiftRing = new Mesh(new RingGeometry(0.3, 0.4, 20), glow('#7ff0ff'));
    this.shiftRing.rotation.x = -Math.PI / 2;
    this.hero.root.scale.setScalar(CHAR_SCALE);
    this.scene.add(this.hero.root, this.shiftRing);
  }

  setSim(sim: Sim): void {
    this.sim = sim;
    this.world.clear();
    this.dims = [new Group(), new Group()];
    this.blocks = [];
    this.tall = [new Map(), new Map()];
    this.cut = [];
    this.world.add(...this.dims);
    for (const dim of [0, 1] as DimIndex[]) {
      const ctx = { theme: THEMES[dim], grid: sim.grid };
      for (const cell of sim.grid.all(dim)) {
        const factory = BLOCK_MODELS[cell.def.id];
        if (!factory) continue;
        const v = factory(cell, ctx);
        this.dims[dim].add(v.object);
        this.blocks.push(v);
        if (cell.def.solid !== 'never') this.tall[dim].set(`${cell.x},${cell.y}`, v.object);
      }
    }
    this.monsters = sim.monsters.map((state) => {
      const body = buildTroll();
      const soul = buildSoul();
      body.scale.setScalar(CHAR_SCALE);
      soul.scale.setScalar(CHAR_SCALE);
      const cone = new VisionCone();
      const alert = new Group();
      alert.add(new Mesh(new BoxGeometry(0.08, 0.22, 0.08), glow('#ff4040')));
      const dot = new Mesh(new BoxGeometry(0.08, 0.08, 0.08), glow('#ff4040'));
      dot.position.y = -0.2;
      alert.add(dot);
      alert.position.y = 1.5;
      body.add(alert);
      this.world.add(body, soul, cone.mesh);
      return { state, body, soul, cone, alert, lastX: state.x, lastY: state.y, deathT: 0 };
    });
    const { w, h } = sim.level.size;
    const c = new Vector3(w / 2, 0, h / 2);
    this.sun.position.copy(c).add(new Vector3(-6, 14, 5));
    this.sun.target.position.copy(c);
    const s = Math.max(w, h);
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 50 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.shownDim = -1;
    this.follow.reset(sim);
    this.resize();
  }

  resize(): void {
    const { w, h } = this.pipeline.resize(window.innerWidth, window.innerHeight);
    this.follow.setAspect(w / h);
  }

  onEvents(events: SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'shift') {
        this.pipeline.fx.flash = 0.85;
        this.pipeline.fx.ripple = 1;
      } else if (e.type === 'kill') {
        this.pipeline.fx.flash = Math.max(this.pipeline.fx.flash, 0.3);
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
    this.hero.update(dt, sim.facing, sim.moving, sim.sneaking, sim.swingT);
    const canShift = sim.canShiftHere();
    this.shiftRing.visible = canShift;
    this.shiftRing.position.set(sim.x, 0.02, sim.y);
    this.shiftRing.scale.setScalar(1 + Math.sin(this.t * 6) * 0.08);

    for (const mv of this.monsters) this.updateMonster(mv, dt);
    this.follow.update(sim, dt);
    this.updateCutaway();
    this.pipeline.render(this.scene, this.follow.camera);
  }

  /** Squash walls / doors between the camera and the hero into low stubs. */
  private updateCutaway(): void {
    for (const o of this.cut) o.scale.y = 1;
    this.cut = [];
    const tall = this.tall[this.sim.dim];
    for (const [x, y] of this.follow.occluderCells()) {
      const o = tall.get(`${x},${y}`);
      if (!o) continue;
      o.scale.y = 0.12;
      this.cut.push(o);
    }
  }

  private updateMonster(mv: MonsterView, dt: number): void {
    const sim = this.sim;
    const m = mv.state;
    const moved = Math.hypot(m.x - mv.lastX, m.y - mv.lastY) > 1e-4;
    mv.lastX = m.x;
    mv.lastY = m.y;
    const home = m.dim === sim.dim;
    mv.body.visible = m.alive && home;
    mv.body.position.set(m.x, 0, m.y);
    mv.body.rotation.set(0, -m.angle, moved ? Math.sin(this.t * 9) * 0.07 : 0);
    mv.alert.visible = m.detect > 0.05;
    mv.alert.scale.setScalar(0.6 + m.detect * 0.8);

    if (!m.alive) mv.deathT += dt;
    const dying = !m.alive && mv.deathT < 0.5;
    mv.soul.visible = !home && (m.alive || dying);
    if (mv.soul.visible) {
      const k = dying ? mv.deathT / 0.5 : 0;
      mv.soul.position.set(m.x, 0.15 + Math.sin(this.t * 2 + m.x) * 0.06 + k * 0.6, m.y);
      mv.soul.rotation.y = -m.angle;
      mv.soul.scale.setScalar(CHAR_SCALE * (1 + k * 0.8));
      mv.soul.visible = k < 1;
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
