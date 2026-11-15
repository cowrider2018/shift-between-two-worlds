import type { Level } from '../core/level';
import { Sim, type SimEvent } from '../core/sim';
import { Briefing } from '../render/briefing';
import { Ending } from '../render/ending';
import { CAMERA } from '../render/followCamera';
import { loadModels } from '../render/models';
import { GameView, TAKEDOWN } from '../render/view';
import { Sfx } from './audio';
import { Input } from './input';
import { BUILTIN_LEVELS } from './levels';
import { loadPlaytest } from './playtest';

const STEP = 1 / 60;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** The release build (npm run build) is the game alone: no editor link, no playtest hand-off, no ?level= jump, and only
 *  the keys the control pages teach (WASD, Space, Shift; R and the camera keys are dev-only). */
const DEV = import.meta.env.DEV;
const params = new URLSearchParams(location.search);
const playtest = DEV && params.has('playtest') ? loadPlaytest() : null;
const levels: Level[] = playtest ? [playtest] : BUILTIN_LEVELS;
let levelIndex = DEV ? Math.max(0, levels.findIndex((l) => l.id === params.get('level'))) : 0;

const view = new GameView($<HTMLCanvasElement>('game'));
const input = new Input(window, { devKeys: DEV });
input.bindPointerLock($<HTMLCanvasElement>('game'));
const sfx = new Sfx();
/** Sneaking only muffles the footsteps (the loop's level), so the steps keep their sound. */
const SNEAK_STEPS = 0.45;
/** The walk loop's level last frame, and the level carried through a won level's fade (null when none is running). */
let walkLevel = 0;
let walkCarry: number | null = null;
let sim: Sim;
/** Which door cells are open, so a lever pull knows whether it moved a door. */
let doorsOpen = '';
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
/** The ending, once the last level is won; it runs until the page is closed. */
let ending: Ending | null = null;
/** Seconds after the ending has faded in before ESCAPED fades in, and then before "thanks for playing" does. */
const ESCAPED_AT = 1.2;
const THANKS_AFTER = 0.5;

function start(index: number): void {
  levelIndex = index;
  const level = levels[index];
  if (!level) return;
  sim = new Sim(level);
  view.setSim(sim);
  caughtT = -1;
  sfx.cancelPending();
  doorsOpen = doorState();
}

function doorState(): string {
  return sim.grid
    .all()
    .filter((c) => c.def.behavior === 'door')
    .map((c) => (sim.doorOpen(c) ? 1 : 0))
    .join('');
}

/** Sounds for this step's events: the lever and any door it moved; the takedown's leap, landing on the troll's back
 *  (with its wail) and cut, timed to the choreography and called off if another monster catches the hero first. */
function playEvents(events: SimEvent[]): void {
  for (const e of events) {
    if (e.type === 'lever') {
      sfx.play('lever');
      const doors = doorState();
      if (doors !== doorsOpen) sfx.play('door');
      doorsOpen = doors;
    } else if (e.type === 'kill') {
      sfx.play('ambush1', TAKEDOWN.jump);
      sfx.play('ambush1', TAKEDOWN.perch);
      // the troll wails as the hero lands on it and again at the cut; the second wail cuts off the first
      sfx.play('wailing', TAKEDOWN.perch, TAKEDOWN.cut);
      sfx.play('ambush2', TAKEDOWN.cut);
      sfx.play('wailing2', TAKEDOWN.cut);
    } else if (e.type === 'spotted') {
      sfx.play('spotted');
    } else if (e.type === 'caught') {
      sfx.cancelPending();
    }
  }
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
  // the last level fades into the ending, except when playtesting a single level from the editor
  if (events.some((e) => e.type === 'won')) {
    if (levelIndex + 1 < levels.length) fadeThrough(() => start(levelIndex + 1));
    else if (!playtest) fadeThrough(showEnding);
    if (fade) walkCarry = walkLevel;
  }
  playEvents(events);
  view.onEvents(events);
}

// every Shift press crouches (held or tapped), in a level only
for (const code of ['ShiftLeft', 'ShiftRight']) {
  input.onKey.set(code, () => {
    if (!briefing && !ending) sfx.play('squat');
  });
}

if (DEV) {
  input.onKey.set('KeyR', () => {
    if (!fade && !briefing && !ending) start(levelIndex);
  });
  const link = document.createElement('a');
  link.className = 'editor';
  link.href = './editor.html';
  link.textContent = '編輯器';
  document.body.append(link);
}

function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  $('fade').style.opacity = String(stepFade(dt));
  if (walkCarry !== null && !fade) walkCarry = null;
  if (walkCarry !== null && fade) {
    // a won level's footsteps carry on at full level while the screen fades out, then die away as the next fades in
    sfx.walk(walkCarry * (fade.t < FADE_OUT ? 1 : Math.max(0, 1 - (fade.t - FADE_OUT) / FADE_IN)));
  } else {
    walkLevel = !briefing && !ending && sim.status === 'playing' && sim.moving ? (sim.sneaking ? SNEAK_STEPS : 1) : 0;
    sfx.walk(walkLevel);
  }
  if (ending) {
    ending.frame(dt);
    requestAnimationFrame(loop);
    return;
  }
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

/** Show the control pages; each key or mouse-button release fades to the next, and past the last into the level. Waiting
 *  for the release lets a Shift tap finish here, so it does not shift dimension on the first frame; the actions pressed
 *  meanwhile are dropped. A click only counts when the game already had focus as it was pressed: on itch.io the first
 *  click just gives the game's iframe focus, and it would otherwise skip the first page unseen. */
function showBriefing(): void {
  const el = $('briefing');
  el.hidden = false;
  view.resize();
  const pages = [...el.querySelectorAll<HTMLElement>('.page')];
  const b = new Briefing(view.pipeline, pages, pages.map((p) => [...p.querySelectorAll<HTMLElement>('.station')]));
  briefing = b;
  // the first page fades in from black too
  fade = { t: FADE_OUT, atBlack: null };
  const swap = () => {
    input.take();
    if (b.next()) return;
    removeEventListener('keyup', turn);
    removeEventListener('mousedown', press);
    removeEventListener('mouseup', release);
    el.hidden = true;
    briefing = null;
    acc = 0;
  };
  const turn = () => {
    if (!fade) fadeThrough(swap);
  };
  // focus moves as the press's default action, so a press that is giving the game focus still sees it unfocused
  let armed = false;
  const press = () => {
    armed = document.hasFocus();
  };
  const release = () => {
    if (armed) turn();
    armed = false;
  };
  addEventListener('keyup', turn);
  addEventListener('mousedown', press);
  addEventListener('mouseup', release);
}

/** Swap to the ending (at full black); the words fade in one under the other once it has faded back in. */
function showEnding(): void {
  const el = $('ending');
  ending = new Ending(view.pipeline, el);
  el.hidden = false;
  const reveal = (cls: string, at: number) => setTimeout(() => el.querySelector(cls)?.classList.add('in'), at * 1000);
  reveal('.escaped', FADE_IN + ESCAPED_AT);
  reveal('.thanks', FADE_IN + ESCAPED_AT + THANKS_AFTER);
}

window.addEventListener('resize', () => view.resize());
async function boot(): Promise<void> {
  if (levels.length === 0) return;
  await Promise.all([loadModels(), sfx.load()]);
  if (!playtest) showBriefing();
  start(levelIndex);
  last = performance.now();
  requestAnimationFrame(loop);
}

void boot();
