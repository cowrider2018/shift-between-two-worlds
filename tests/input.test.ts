import { describe, expect, it } from 'vitest';
import { isSpike, MOUSE_SPIKE } from '../src/game/input';

describe('fake mouse jumps', () => {
  it('drops a lone huge movement after a small one', () => {
    expect(isSpike(2000, 5, 16)).toBe(true);
  });

  it('drops a huge movement out of stillness', () => {
    expect(isSpike(2000, 2000, MOUSE_SPIKE.calm + 1)).toBe(true);
  });

  it('never drops a movement within the threshold', () => {
    expect(isSpike(MOUSE_SPIKE.spike, 0, 16)).toBe(false);
  });

  it('keeps a real flick that builds up move by move', () => {
    let prev = 10;
    let dropped = 0;
    for (let s = 20; s <= 1600; s *= 2) {
      if (isSpike(s, prev, 16)) dropped++;
      prev = s;
    }
    expect(dropped).toBe(0);
  });
});
