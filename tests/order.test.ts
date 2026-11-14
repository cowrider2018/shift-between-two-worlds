import { describe, expect, it } from 'vitest';
import { applyOrder, parseOrder } from '../src/core/order';

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
  it('treats a malformed order file as no order', () => {
    expect(parseOrder({ x: 1 })).toEqual([]);
    expect(parseOrder(['a', 2, 'b'])).toEqual(['a', 'b']);
  });
});
