/**
 * Deterministic game simulation (DESIGN §3). No rendering, no DOM.
 * Drive with `update(input, dt)`; read state and `drainEvents()` from the outside.
 */
import { isDoorOpen } from './blocks';
import { LevelGrid, angleDiff, castRay, moveBox, type Cell } from './grid';
import { cellKey, type DimIndex, type Level, type MonsterDef } from './level';

export const TUNING = {
  playerSpeed: 3.2,
  sneakSpeedMul: 0.6,
  sneakRadiusMul: 0.5,
  playerHalfSize: 0.26,
  detectRise: 2,
  detectFall: 1,
  /** Within this distance a monster notices the player regardless of the cone. */
  touchRadius: 0.45,
  attackRange: 1.3,
  attackCooldown: 0.35,
  interactRange: 1.05,
  shiftCooldown: 0.25,
  monsterTurnSpeed: 5,
};

export interface SimInput {
  moveX: number;
  moveY: number;
  sneak: boolean;
  /** Edge-triggered actions. */
  shift: boolean;
  interact: boolean;
  attack: boolean;
}

export const NO_INPUT: SimInput = { moveX: 0, moveY: 0, sneak: false, shift: false, interact: false, attack: false };

export type SimEvent =
  | { type: 'shift'; dim: DimIndex }
  | { type: 'pickup'; what: 'core' | 'reward'; cell: Cell }
  | { type: 'lever'; cell: Cell; on: boolean }
  | { type: 'swing' }
  | { type: 'kill'; monster: MonsterState }
  | { type: 'caught'; monster: MonsterState }
  | { type: 'exitLocked'; have: number; need: number }
  | { type: 'won' };

export class MonsterState {
  x: number;
  y: number;
  angle: number;
  alive = true;
  /** 0..1, caught at 1. */
  detect = 0;
  seeing = false;
  private target = 1;
  private dir = 1;
  private pauseT = 0;

  constructor(readonly def: MonsterDef, readonly dim: DimIndex) {
    const [sx, sy] = def.path[0];
    this.x = sx + 0.5;
    this.y = sy + 0.5;
    this.angle = (def.facing * Math.PI) / 180;
    if (def.path.length > 1) {
      const [nx, ny] = def.path[1];
      this.angle = Math.atan2(ny - sy, nx - sx);
    }
  }

  get halfAngle(): number {
    return ((this.def.viewAngle / 2) * Math.PI) / 180;
  }

  update(dt: number): void {
    const path = this.def.path;
    if (!this.alive || path.length < 2) return;
    const [tx, ty] = path[this.target];
    const gx = tx + 0.5;
    const gy = ty + 0.5;
    const dx = gx - this.x;
    const dy = gy - this.y;
    const dist = Math.hypot(dx, dy);
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      this.turnTowards(Math.atan2(dy, dx), dt);
      return;
    }
    const step = this.def.speed * dt;
    if (dist > 1e-6) this.turnTowards(Math.atan2(dy, dx), dt);
    if (step >= dist) {
      this.x = gx;
      this.y = gy;
      this.pauseT = this.def.pause;
      this.advance();
    } else {
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
    }
  }

  private advance(): void {
    const n = this.def.path.length;
    if (this.def.mode === 'loop') {
      this.target = (this.target + 1) % n;
      return;
    }
    if (this.target + this.dir < 0 || this.target + this.dir >= n) this.dir = -this.dir;
    this.target += this.dir;
  }

  private turnTowards(a: number, dt: number): void {
    const d = angleDiff(a, this.angle);
    const max = TUNING.monsterTurnSpeed * dt;
    this.angle += Math.abs(d) <= max ? d : Math.sign(d) * max;
  }
}

export type SimStatus = 'playing' | 'caught' | 'won';

export class Sim {
  readonly grid: LevelGrid;
  dim: DimIndex = 0;
  x = 0;
  y = 0;
  facing = Math.PI / 2;
  moving = false;
  sneaking = false;
  status: SimStatus = 'playing';
  time = 0;
  cores = 0;
  rewards = 0;
  readonly coresTotal: number;
  readonly rewardsTotal: number;
  readonly monsters: MonsterState[] = [];
  private readonly picked = new Set<string>();
  private readonly levers = new Map<string, boolean>();
  private channels = new Map<number, boolean>();
  private events: SimEvent[] = [];
  private attackT = 0;
  private shiftT = 0;
  private lastCell: Cell | null = null;
  swingT = 0;

  constructor(readonly level: Level) {
    this.grid = new LevelGrid(level);
    const cells = this.grid.all();
    this.coresTotal = cells.filter((c) => c.def.behavior === 'core').length;
    this.rewardsTotal = cells.filter((c) => c.def.behavior === 'reward').length;
    const spawn = cells.find((c) => c.def.behavior === 'spawn');
    if (spawn) {
      this.dim = spawn.dim;
      this.x = spawn.x + 0.5;
      this.y = spawn.y + 0.5;
    }
    level.dimensions.forEach((d, di) => {
      for (const m of d.monsters) if (m.path.length) this.monsters.push(new MonsterState(m, di as DimIndex));
    });
    this.lastCell = this.currentCell();
  }

  // ---- queries ------------------------------------------------------------

  readonly channelOn = (ch: number): boolean => this.channels.get(ch) ?? false;

  private static itemKey(c: Cell): string {
    return `${c.dim}:${cellKey(c.x, c.y)}`;
  }

  isPicked(c: Cell): boolean {
    return this.picked.has(Sim.itemKey(c));
  }

  leverOn(c: Cell): boolean {
    return this.levers.get(Sim.itemKey(c)) ?? false;
  }

  doorOpen(c: Cell): boolean {
    return isDoorOpen(c.props, this.channelOn);
  }

  currentCell(): Cell {
    return this.grid.cell(this.dim, Math.floor(this.x), Math.floor(this.y));
  }

  viewRadius(m: MonsterState): number {
    return m.def.viewRadius * (this.sneaking ? TUNING.sneakRadiusMul : 1);
  }

  /** Visible distance along a ray from a monster in its own dimension (walls / closed doors occlude). */
  sightDistance(m: MonsterState, angle: number, maxDist: number): number {
    return castRay(m.x, m.y, Math.cos(angle), Math.sin(angle), maxDist, (cx, cy) =>
      this.grid.opaque(m.dim, cx, cy, this.channelOn),
    );
  }

  /** The nearest monster nearby that the player is currently able to attack (a soul). */
  attackableSoul(): MonsterState | null {
    let best: MonsterState | null = null;
    let bestD = TUNING.attackRange;
    for (const m of this.monsters) {
      if (!m.alive || m.dim === this.dim) continue;
      const d = Math.hypot(m.x - this.x, m.y - this.y);
      if (d <= bestD) {
        best = m;
        bestD = d;
      }
    }
    return best;
  }

  nearestLever(): Cell | null {
    let best: Cell | null = null;
    let bestD = TUNING.interactRange;
    const px = Math.floor(this.x);
    const py = Math.floor(this.y);
    for (let y = py - 1; y <= py + 1; y++)
      for (let x = px - 1; x <= px + 1; x++) {
        const c = this.grid.cell(this.dim, x, y);
        if (c.def.behavior !== 'lever') continue;
        const d = Math.hypot(x + 0.5 - this.x, y + 0.5 - this.y);
        if (d <= bestD) {
          best = c;
          bestD = d;
        }
      }
    return best;
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---- update -------------------------------------------------------------

  update(input: SimInput, dt: number): void {
    if (this.status !== 'playing') return;
    this.time += dt;
    this.attackT = Math.max(0, this.attackT - dt);
    this.shiftT = Math.max(0, this.shiftT - dt);
    this.swingT = Math.max(0, this.swingT - dt);
    this.sneaking = input.sneak;

    this.movePlayer(input, dt);
    if (input.shift) this.tryShift();
    if (input.interact) this.tryInteract();
    if (input.attack) this.tryAttack();
    this.enterCell();
    for (const m of this.monsters) m.update(dt);
    this.updateDetection(dt);
  }

  private movePlayer(input: SimInput, dt: number): void {
    let mx = input.moveX;
    let my = input.moveY;
    const len = Math.hypot(mx, my);
    this.moving = len > 0.01;
    if (!this.moving) return;
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.facing = Math.atan2(my, mx);
    const speed = TUNING.playerSpeed * (this.sneaking ? TUNING.sneakSpeedMul : 1) * dt;
    const p = moveBox(this.x, this.y, mx * speed, my * speed, TUNING.playerHalfSize, (cx, cy) =>
      this.grid.solid(this.dim, cx, cy, this.channelOn),
    );
    this.x = p.x;
    this.y = p.y;
  }

  private tryShift(): void {
    if (this.shiftT > 0) return;
    this.dim = (1 - this.dim) as DimIndex;
    this.shiftT = TUNING.shiftCooldown;
    for (const m of this.monsters) m.detect = 0;
    this.lastCell = this.currentCell();
    this.events.push({ type: 'shift', dim: this.dim });
  }

  private tryInteract(): void {
    const lever = this.nearestLever();
    if (!lever) return;
    const on = !this.leverOn(lever);
    this.levers.set(Sim.itemKey(lever), on);
    this.recomputeChannels();
    this.events.push({ type: 'lever', cell: lever, on });
  }

  private recomputeChannels(): void {
    const next = new Map<number, boolean>();
    for (const c of this.grid.all()) {
      if (c.def.behavior === 'lever' && this.leverOn(c)) next.set(Number(c.props.channel), true);
    }
    this.channels = next;
  }

  private tryAttack(): void {
    if (this.attackT > 0) return;
    this.attackT = TUNING.attackCooldown;
    this.swingT = 0.25;
    this.events.push({ type: 'swing' });
    const soul = this.attackableSoul();
    if (soul) {
      soul.alive = false;
      this.events.push({ type: 'kill', monster: soul });
    }
  }

  private enterCell(): void {
    const c = this.currentCell();
    if (c === this.lastCell) return;
    this.lastCell = c;
    const b = c.def.behavior;
    if ((b === 'core' || b === 'reward') && !this.isPicked(c)) {
      this.picked.add(Sim.itemKey(c));
      if (b === 'core') this.cores++;
      else this.rewards++;
      this.events.push({ type: 'pickup', what: b, cell: c });
    } else if (b === 'exit') {
      const need = Number(c.props.coresRequired) || this.coresTotal;
      if (this.cores >= need) {
        this.status = 'won';
        this.events.push({ type: 'won' });
      } else {
        this.events.push({ type: 'exitLocked', have: this.cores, need });
      }
    }
  }

  private updateDetection(dt: number): void {
    for (const m of this.monsters) {
      m.seeing = m.alive && m.dim === this.dim && this.monsterSeesPlayer(m);
      m.detect = m.seeing ? m.detect + TUNING.detectRise * dt : Math.max(0, m.detect - TUNING.detectFall * dt);
      if (m.detect >= 1 && this.status === 'playing') {
        m.detect = 1;
        this.status = 'caught';
        this.events.push({ type: 'caught', monster: m });
      }
    }
  }

  monsterSeesPlayer(m: MonsterState): boolean {
    const dx = this.x - m.x;
    const dy = this.y - m.y;
    const dist = Math.hypot(dx, dy);
    if (dist < TUNING.touchRadius) return true;
    if (dist > this.viewRadius(m)) return false;
    const a = Math.atan2(dy, dx);
    if (Math.abs(angleDiff(a, m.angle)) > m.halfAngle) return false;
    return this.sightDistance(m, a, dist) >= dist - 1e-6;
  }
}
