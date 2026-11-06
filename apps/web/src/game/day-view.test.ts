import { describe, expect, it } from 'vitest';

import { dayPhase, stakeAllowance } from './day-view.ts';

// 12:00 and 23:00 in Madrid on 9 November 2026 (UTC+1).
const noon = new Date('2026-11-09T11:00:00Z');
const night = new Date('2026-11-09T22:00:00Z');

const day = (state: 'open' | 'postponed' | 'published', date = '2026-11-09') => ({
  day: date,
  state,
});

describe('dayPhase', () => {
  it('is none before the first day of a season opens', () => {
    expect(dayPhase(null, noon)).toBe('none');
  });

  it('is open from the situation until the close', () => {
    expect(dayPhase(day('open'), noon)).toBe('open');
  });

  it('is closing once 22:00 has passed and the chapter is not out yet', () => {
    expect(dayPhase(day('open'), night)).toBe('closing');
    expect(dayPhase(day('open', '2026-11-08'), noon)).toBe('closing');
  });

  it('follows the data for a day the browser clock has not reached', () => {
    expect(dayPhase(day('open', '2030-01-01'), noon)).toBe('open');
  });

  it('is postponed or published as the day says', () => {
    expect(dayPhase(day('postponed'), noon)).toBe('postponed');
    expect(dayPhase(day('published'), night)).toBe('published');
  });
});

describe('stakeAllowance', () => {
  it('goes from 0 up to the balance', () => {
    expect(stakeAllowance({ balance: 10, out: false })).toEqual({ canStake: true, max: 10 });
  });

  it('declares nothing at zero or below', () => {
    expect(stakeAllowance({ balance: 0, out: false })).toEqual({
      canStake: false,
      reason: 'no_points',
    });
    expect(stakeAllowance({ balance: -3, out: false })).toEqual({
      canStake: false,
      reason: 'no_points',
    });
  });

  it('declares nothing while the character is out', () => {
    expect(stakeAllowance({ balance: 10, out: true })).toEqual({ canStake: false, reason: 'out' });
  });
});
