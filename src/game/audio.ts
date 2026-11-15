/**
 * Sound effects (public/sfx/), played through one Web Audio context. The browser keeps the context suspended until
 * the first key or mouse press, so it is resumed on each press until it runs; sounds asked for before then are dropped.
 *
 * walk.wav is a seamless loop (six evenly loud steps); it is WAV because AAC decoding pads the start with silence,
 * which would leave a gap at every turn of the loop.
 */
const FILES = {
  ambush1: 'ambush1.m4a',
  ambush2: 'ambush2.m4a',
  wailing: 'wailing.m4a',
  wailing2: 'wailing2.m4a',
  spotted: 'spotted.m4a',
  door: 'door.m4a',
  lever: 'lever.m4a',
  squat: 'squat.m4a',
  walk: 'walk.wav',
} as const;

export type SfxName = keyof typeof FILES;

/** Per-sound gain, levelling the recordings against each other (walk was recorded far quieter than the rest). */
const GAIN: Record<SfxName, number> = {
  ambush1: 0.8,
  ambush2: 0.8,
  wailing: 0.9,
  wailing2: 0.9,
  spotted: 0.9,
  door: 1.6,
  lever: 1.2,
  squat: 1.4,
  walk: 0.5,
};

/** Seconds the walk loop takes to fade in or out: short enough to act as a switch, long enough not to click. */
const WALK_FADE = 0.02;
/** Seconds into walk.wav just before its first footfall (at 0.12 s). */
const WALK_FIRST_STEP = 0.1;
/** Walking again within this many seconds of stopping picks the loop up where it stopped, so tapping a key does not
 *  restart the first step over and over; after a longer stop it starts from the first step. It is the longest gap
 *  between two footfalls in the loop (0.297 s), rounded up. */
const WALK_RESUME = 0.3;

export class Sfx {
  private readonly ctx = new AudioContext();
  private readonly buffers = new Map<SfxName, AudioBuffer>();
  /** Sounds scheduled ahead (a takedown's), so they can be called off. */
  private pending = new Set<AudioBufferSourceNode>();
  private walkSrc: AudioBufferSourceNode | null = null;
  private walkGain: GainNode | null = null;
  private walkLevel = 0;
  /** Where the loop is (seconds into walk.wav) at context time `walkAt`: while playing, where it was when started;
   *  once stopped, where it stopped. */
  private walkPos = WALK_FIRST_STEP;
  private walkAt = -Infinity;

  constructor(target: Window = window) {
    const resume = () => {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    };
    target.addEventListener('keydown', resume);
    target.addEventListener('mousedown', resume);
  }

  /** Fetch and decode every sound; one that fails to load stays silent rather than stopping the game. */
  async load(base = './sfx/'): Promise<void> {
    await Promise.all(
      (Object.keys(FILES) as SfxName[]).map(async (name) => {
        try {
          const res = await fetch(base + FILES[name]);
          this.buffers.set(name, await this.ctx.decodeAudioData(await res.arrayBuffer()));
        } catch (e) {
          console.warn(`sfx ${name} did not load`, e);
        }
      }),
    );
  }

  /** Play `name` once, `delay` seconds from now, cut off `until` seconds from now if given. Delayed sounds can be
   *  called off with cancelPending. */
  play(name: SfxName, delay = 0, until?: number): void {
    const buffer = this.buffers.get(name);
    if (!buffer || this.ctx.state !== 'running') return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = GAIN[name];
    src.connect(gain).connect(this.ctx.destination);
    src.start(this.ctx.currentTime + delay);
    if (until !== undefined) src.stop(this.ctx.currentTime + until);
    if (delay > 0) {
      this.pending.add(src);
      src.onended = () => this.pending.delete(src);
    }
  }

  /** Call off every delayed sound that has not started yet (one already playing is cut short too). */
  cancelPending(): void {
    for (const src of this.pending) src.stop();
    this.pending.clear();
  }

  /** Set the walk loop's level: 0 stops it, 1 is full. Call every frame; it only acts on a change. Walking again soon
   *  after stopping (WALK_RESUME) carries on from where the loop stopped; otherwise it starts just before the first
   *  step, so the first footfall comes at once. */
  walk(level: number): void {
    if (level === this.walkLevel) return;
    const now = this.ctx.currentTime;
    if (level === 0) {
      this.walkLevel = 0;
      this.walkGain?.gain.cancelScheduledValues(now);
      this.walkGain?.gain.setTargetAtTime(0, now, WALK_FADE / 3);
      if (this.walkSrc) {
        const end = now + WALK_FADE;
        this.walkSrc.stop(end);
        const len = this.walkSrc.buffer?.duration ?? 1;
        this.walkPos = (this.walkPos + end - this.walkAt) % len;
        this.walkAt = end;
      }
      this.walkSrc = null;
      this.walkGain = null;
      return;
    }
    if (!this.walkGain) {
      const buffer = this.buffers.get('walk');
      if (!buffer || this.ctx.state !== 'running') return;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.ctx.destination);
      if (now - this.walkAt > WALK_RESUME) this.walkPos = WALK_FIRST_STEP;
      src.start(now, this.walkPos);
      this.walkAt = now;
      this.walkSrc = src;
      this.walkGain = gain;
    }
    this.walkLevel = level;
    const g = this.walkGain.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(level * GAIN.walk, now, WALK_FADE / 3);
  }
}
