import { describe, expect, it } from 'vitest';

import { seatOf } from './seat.ts';

const characters = [{ id: 31 }, { id: 12 }, { id: 40 }, { id: 18 }, { id: 25 }];

describe('seatOf', () => {
  it('seats characters by id, whatever order they arrive in', () => {
    expect([12, 18, 25, 31, 40].map((id) => seatOf(characters, id))).toEqual([0, 1, 2, 3, 4]);
  });

  it('wraps a sixth character round to the first seat', () => {
    expect(seatOf([...characters, { id: 50 }], 50)).toBe(0);
  });

  it('gives a character it does not know the first seat', () => {
    expect(seatOf(characters, 99)).toBe(0);
  });
});
