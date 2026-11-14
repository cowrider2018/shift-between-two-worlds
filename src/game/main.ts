import type { Level } from '../core/level';
import { Sim, type SimEvent } from '../core/sim';
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
/** Seconds to hold on the scene, after the monster's bonk has played out, before restarting. */
const CAUGHT_HOLD = 0.9;
/** -1: not caught; 0: caught, bonk still playing; >0: counting down to restart. */
let caughtT = -1;
/** After a win: seconds to show 「通關」, then fade to black, swap in the next level, and fade back in. */
const CLEAR_HOLD = 1.2;
const FADE_OUT = 0.6;
const FADE_IN = 0.6;
/** Time since the win (-1: none pending). Runs through hold → fade out → (next level) → fade in. */
let clearT = -1;

function start(index: number): void {
  levelIndex = index;
  const level = levels[index];
  if (!level) return;
  sim = new Sim(level);
  view.setSim(sim);
  caughtT = -1;
  $('cleared').hidden = true;
  $('cleared').textContent = '通關';
}

function hasNext(): boolean {
  return levelIndex + 1 < levels.length;
}

/** Advance the win → next-level transition; returns the black overlay's opacity. */
function stepClear(dt: number): number {
  if (clearT < 0) return 0;
  const before = clearT;
  clearT += dt;
  const swapAt = CLEAR_HOLD + FADE_OUT;
  if (before < swapAt && clearT >= swapAt) start(levelIndex + 1);
  if (clearT >= swapAt + FADE_IN) {
    clearT = -1;
    return 0;
  }
  if (clearT < CLEAR_HOLD) return 0;
  return clearT < swapAt ? (clearT - CLEAR_HOLD) / FADE_OUT : 1 - (clearT - swapAt) / FADE_IN;
}

function handle(events: SimEvent[]): void {
  // the restart countdown waits until the monster has bonked the hero (view.catchFinished)
  if (events.some((e) => e.type === 'caught')) caughtT = 0;
  if (events.some((e) => e.type === 'won')) {
    $('cleared').hidden = false;
    if (hasNext()) clearT = 0;
    else $('cleared').textContent = levels.length > 1 ? '全部通關' : '通關';
  }
  view.onEvents(events);
}

input.onKey.set('KeyR', () => {
  if (clearT < 0) start(levelIndex);
});
// Enter skips the 「通關」 hold and starts the fade right away
input.onKey.set('Enter', () => {
  if (clearT >= 0 && clearT < CLEAR_HOLD) clearT = CLEAR_HOLD;
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
  } else if (caughtT > 0) {
    caughtT -= dt;
    if (caughtT <= 0) start(levelIndex);
  }
  $('fade').style.opacity = String(stepClear(dt));
  view.frame(dt);
  requestAnimationFrame(loop);
}

window.addEventListener('resize', () => view.resize());
async function boot(): Promise<void> {
  if (levels.length === 0) return;
  await loadModels();
  start(levelIndex);
  last = performance.now();
  requestAnimationFrame(loop);
}

void boot();
