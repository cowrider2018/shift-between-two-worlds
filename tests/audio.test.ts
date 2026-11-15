import { describe, expect, it } from 'vitest';
import { firstPeak } from '../src/game/audio';

describe('firstPeak', () => {
  const rate = 1000;

  it('skips the near-silent lead-in, starting a few ms before the first rise', () => {
    const s = new Float32Array(1000);
    for (let i = 0; i < 200; i++) s[i] = 0.01; // hiss under a tenth of the peak
    s[200] = 0.5; // first peak
    s[600] = 1; // loudest, later
    expect(firstPeak(s, rate)).toBeCloseTo(0.197);
  });

  it('starts at 0 when the sound opens on its peak or is silent', () => {
    const s = new Float32Array(10);
    expect(firstPeak(s, rate)).toBe(0);
    s[0] = 1;
    expect(firstPeak(s, rate)).toBe(0);
  });
});
