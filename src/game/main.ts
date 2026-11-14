import type { Level } from '../core/level';
import { Sim, type SimEvent } from '../core/sim';
import { Briefing } from '../render/briefing';
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
/** Every change of screen (a control page to the next, the last page to the first level, a won level to the next)
 *  fades to black, swaps at full black, and fades back in. */
const FADE_OUT = 0.6;
const FADE_IN = 0.6;
/** The fade in progress: seconds since it began, and the swap to make at full black (already made once past it). */
let fade: { t: number; atBlack: (() => void) | null } | null = null;
/** The controls screen shown once before the first level (not when playtesting from the editor); null once dismissed. */
let briefing: Briefing | null = null;

function start(index: number): void {
  levelIndex = index;
  const level = levels[index];
  if (!level) return;
  sim = new Sim(level);
  view.setSim(sim);
  caughtT = -1;
}

/** Fade to black, run `atBlack` there, and fade back in (ignored while another fade is running). */
function fadeThrough(atBlack: () => void): void {
  fade ??= { t: 0, atBlack };
}

/** Advance the fade; returns the black overlay's opacity. */
function stepFade(dt: number): number {
  if (!fade) return 0;
  fade.t += dt;
  if (fade.t >= FADE_OUT && fade.atBlack) {
    const swap = fade.atBlack;
    fade.atBlack = null;
    swap();
  }
  if (fade.t >= FADE_OUT + FADE_IN) {
    fade = null;
    return 0;
  }
  return fade.t < FADE_OUT ? fade.t / FADE_OUT : 1 - (fade.t - FADE_OUT) / FADE_IN;
}

function handle(events: SimEvent[]): void {
  // the restart countdown waits until the monster has bonked the hero (view.catchFinished)
  if (events.some((e) => e.type === 'caught')) caughtT = 0;
  // the last level has no transition: an ending sequence will go here
  if (events.some((e) => e.type === 'won') && levelIndex + 1 < levels.length) fadeThrough(() => start(levelIndex + 1));
  view.onEvents(events);
}

input.onKey.set('KeyR', () => {
  if (!fade && !briefing) start(levelIndex);
});

function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  $('fade').style.opacity = String(stepFade(dt));
  if (briefing) {
    briefing.frame(dt);
    requestAnimationFrame(loop);
    return;
  }
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
  view.frame(dt);
  requestAnimationFrame(loop);
}

/** Show the control pages; each key release or mouse press fades to the next, and past the last into the level. Waiting
 *  for the release lets a Shift tap finish here, so it does not shift dimension on the first frame; the actions
 *  pressed meanwhile are dropped. */
function showBriefing(): void {
  const el = $('briefing');
  el.hidden = false;
  view.resize();
  const pages = [...el.querySelectorAll<HTMLElement>('.page')];
  const hint = el.querySelector<HTMLElement>('.start')!;
  const b = new Briefing(view.pipeline, pages, pages.map((p) => [...p.querySelectorAll<HTMLElement>('.station')]));
  briefing = b;
  // the first page fades in from black too
  fade = { t: FADE_OUT, atBlack: null };
  const swap = () => {
    input.take();
    if (b.next()) {
      if (pages.at(-1)?.hidden === false) hint.textContent = '按任意鍵開始';
      return;
    }
    removeEventListener('keyup', turn);
    removeEventListener('mousedown', turn);
    el.hidden = true;
    briefing = null;
    acc = 0;
  };
  const turn = () => {
    if (!fade) fadeThrough(swap);
  };
  addEventListener('keyup', turn);
  addEventListener('mousedown', turn);
}

window.addEventListener('resize', () => view.resize());
async function boot(): Promise<void> {
  if (levels.length === 0) return;
  await loadModels();
  if (!playtest) showBriefing();
  start(levelIndex);
  last = performance.now();
  requestAnimationFrame(loop);
}

void boot();
