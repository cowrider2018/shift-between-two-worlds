import { DIM_NAMES, type Level } from '../core/level';
import { Sim, TUNING, type SimEvent } from '../core/sim';
import { CAMERA } from '../render/followCamera';
import { loadModels } from '../render/models';
import { GameView } from '../render/view';
import { Input } from './input';
import { BUILTIN_LEVELS } from './levels';
import { loadPlaytest } from './playtest';

const STEP = 1 / 60;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const params = new URLSearchParams(location.search);
const playtest = params.has('playtest') ? loadPlaytest() : null;
const levels: Level[] = playtest ? [playtest] : BUILTIN_LEVELS;
let levelIndex = Math.max(0, levels.findIndex((l) => l.id === params.get('level')));

const view = new GameView($<HTMLCanvasElement>('game'));
const input = new Input();
input.bindPointerLock($<HTMLCanvasElement>('game'));
let sim: Sim;
let acc = 0;
let last = performance.now();
/** Seconds the "caught" card stays up, after the monster's bonk has played out, before restarting. */
const CAUGHT_HOLD = 0.9;
/** -1: not caught; 0: caught, bonk still playing; >0: card up, counting down to restart. */
let caughtT = -1;
let toastT = 0;

function start(index: number): void {
  levelIndex = index;
  const level = levels[index];
  if (!level) return;
  sim = new Sim(level);
  view.setSim(sim);
  caughtT = -1;
  $('level-name').textContent = `${playtest ? '試玩：' : ''}${level.name}`;
  $('overlay').className = 'hidden';
  toast(`輕點 Shift 轉移次元・按住 Shift 潛行`, 3);
}

function toast(text: string, seconds = 1.6): void {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  toastT = seconds;
}

function overlay(title: string, sub: string, kind: 'won' | 'caught'): void {
  const el = $('overlay');
  el.className = kind;
  $('overlay-title').textContent = title;
  $('overlay-sub').textContent = sub;
}

function handle(events: SimEvent[]): void {
  for (const e of events) {
    switch (e.type) {
      case 'shift':
        toast(`→ ${DIM_NAMES[e.dim]}`, 0.8);
        break;
      case 'pickup':
        toast(e.what === 'core' ? `取得核心 ${sim.cores}/${sim.coresTotal}` : '獎勵 +1', 1.2);
        break;
      case 'lever':
        toast(`拉桿 ${e.on ? '開' : '關'}`, 1.2);
        break;
      case 'kill':
        toast('靈魂消散 — 本體也消失了', 1.4);
        break;
      case 'exitLocked':
        toast(`出口需要 ${e.need} 顆核心（目前 ${e.have}）`, 1.6);
        break;
      case 'spotted':
        toast('被發現了！快逃！', 1.6);
        break;
      case 'caught':
        caughtT = 0; // the card waits until the monster has bonked the hero (view.catchFinished)
        break;
      case 'won': {
        const hasNext = levelIndex + 1 < levels.length;
        overlay('通關！', `獎勵 ${sim.rewards}/${sim.rewardsTotal}・${hasNext ? 'Enter 下一關' : 'Enter 重玩'}`, 'won');
        break;
      }
      default:
        break;
    }
  }
  view.onEvents(events);
}

function updateHud(): void {
  $('dim').textContent = `次元 ${DIM_NAMES[sim.dim]}`;
  $('dim').className = `badge dim${sim.dim}`;
  $('cores').textContent = `◆ ${sim.cores}/${sim.coresTotal}`;
  $('rewards').textContent = `$ ${sim.rewards}/${sim.rewardsTotal}`;
  const hints: string[] = [];
  hints.push('<b>Shift</b> 轉移');
  if (sim.sneaking) hints.push(`<b>潛行中</b> 視野 ×${TUNING.sneakRadiusMul}`);
  if (sim.nearestLever()) hints.push('<b>E</b> 拉桿');
  if (sim.attackableSoul()) hints.push('<b>Space</b> 擊殺靈魂');
  $('hint').innerHTML = hints.join('　');
}

input.onKey.set('KeyR', () => start(levelIndex));
input.onKey.set('Enter', () => {
  if (sim.status === 'won') start(levelIndex + 1 < levels.length ? levelIndex + 1 : levelIndex);
});

function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  view.follow.yaw += input.takeTurn(dt, CAMERA.mouseSensitivity, CAMERA.keyTurnSpeed);
  view.follow.tilt(input.takeTilt(CAMERA.mouseSensitivity));
  view.follow.zoom(input.takeZoom());
  while (acc >= STEP) {
    acc -= STEP;
    // WASD is camera-relative: rotate the stick into grid space before the sim sees it
    const raw = input.take();
    const [moveX, moveY] = view.follow.toWorld(raw.moveX, raw.moveY);
    sim.update({ ...raw, moveX, moveY }, STEP);
    handle(sim.drainEvents());
  }
  if (caughtT === 0 && view.catchFinished()) {
    caughtT = CAUGHT_HOLD;
    overlay('被抓住了！', 'R 立即重來', 'caught');
  } else if (caughtT > 0) {
    caughtT -= dt;
    if (caughtT <= 0) start(levelIndex);
  }
  if (toastT > 0) {
    toastT -= dt;
    if (toastT <= 0) $('toast').classList.remove('show');
  }
  updateHud();
  view.frame(dt);
  requestAnimationFrame(loop);
}

window.addEventListener('resize', () => view.resize());
async function boot(): Promise<void> {
  if (levels.length === 0) {
    $('level-name').textContent = '沒有關卡';
    return;
  }
  $('level-name').textContent = '載入中…';
  await loadModels();
  start(levelIndex);
  last = performance.now();
  requestAnimationFrame(loop);
}

void boot();
