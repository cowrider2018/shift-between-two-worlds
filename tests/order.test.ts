import { describe, expect, it } from 'vitest';
import { fileStemFor, isSafeStem } from '../src/core/levelFile';
import { applyOrder, parseOrder, renameInOrder } from '../src/core/order';

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('level play order', () => {
  const levels = [{ id: 'b' }, { id: 'a' }, { id: 'd' }, { id: 'c' }];
  it('follows the order list, then puts unlisted levels after it by id', () => {
    expect(ids(applyOrder(levels, ['c', 'a']))).toEqual(['c', 'a', 'b', 'd']);
  });
  it('falls back to id order and ignores ids that no longer exist', () => {
    expect(ids(applyOrder(levels, []))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(applyOrder(levels, ['gone', 'd']))).toEqual(['d', 'a', 'b', 'c']);
  });
  it('keeps a renamed id at its place', () => {
    expect(renameInOrder(['a', 'b', 'c'], 'b', 'x')).toEqual(['a', 'x', 'c']);
    expect(renameInOrder(['a', 'b'], 'b', 'b')).toBeNull();
    expect(renameInOrder(['a', 'b'], 'z', 'x')).toBeNull();
  });
  it('treats a malformed order file as no order', () => {
    expect(parseOrder({ x: 1 })).toEqual([]);
    expect(parseOrder(['a', 2, 'b'])).toEqual(['a', 'b']);
  });
});

describe('level file names follow level names', () => {
  it('keeps readable names and replaces characters no file system accepts', () => {
    expect(fileStemFor('trapped_beast', 'x')).toBe('trapped_beast');
    expect(fileStemFor('牠看著的地方', 'x')).toBe('牠看著的地方');
    expect(fileStemFor(' a/b:c? ', 'x')).toBe('a_b_c_');
  });
  it('falls back to the id and steers clear of reserved names', () => {
    expect(fileStemFor('  ', 'level07')).toBe('level07');
    expect(fileStemFor('...', 'level07')).toBe('level07');
    expect(fileStemFor('CON', 'x')).toBe('CON_');
    expect(fileStemFor('order', 'x')).toBe('order_');
  });
  it('accepts only stems it could have produced', () => {
    expect(isSafeStem('迴環')).toBe(true);
    expect(isSafeStem('../evil')).toBe(false);
    expect(isSafeStem('a\b')).toBe(false);
    expect(isSafeStem('')).toBe(false);
  });
});
