import { describe, expect, it } from 'vitest';

import { stakeChips } from './stake-chips.ts';

describe('stakeChips', () => {
  it('offers every value up to a balance of nine', () => {
    expect(stakeChips(4)).toEqual([0, 1, 2, 3, 4]);
    expect(stakeChips(9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('offers the design chips below a larger balance, and the whole balance last', () => {
    expect(stakeChips(17)).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 10, 17]);
    expect(stakeChips(11)).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 10, 11]);
  });

  it('does not repeat a balance that is already a chip', () => {
    expect(stakeChips(10)).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 10]);
    expect(stakeChips(12)).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 10, 12]);
  });

  it('never offers more than ten chips', () => {
    for (const balance of [13, 30, 120]) expect(stakeChips(balance)).toHaveLength(10);
  });
});
