import { describe, expect, it } from 'vitest';

import {
  CLOSING_MINUTE_OF_DAY,
  DEPLOY_FREEZE_END_MINUTE_OF_DAY,
  DEPLOY_FREEZE_START_MINUTE_OF_DAY,
  deployWindowStart,
  gameDayOf,
  gameMinuteOfDay,
  isDeployFrozen,
  OPENING_MINUTE_OF_DAY,
  REMINDER_MINUTES_OF_DAY,
} from './schedule.ts';

describe('the daily calendar', () => {
  it('opens the day at 08:00 and reminds at 19:00 and 21:00, before the 22:00 close', () => {
    expect(OPENING_MINUTE_OF_DAY).toBe(8 * 60);
    expect(REMINDER_MINUTES_OF_DAY).toEqual([19 * 60, 21 * 60]);
    expect(CLOSING_MINUTE_OF_DAY).toBe(22 * 60);
  });
});

describe('gameDayOf', () => {
  it.each([
    ['2026-07-01T06:00:00Z', '2026-07-01'], // 08:00 CEST, the opening
    ['2026-07-01T20:00:00Z', '2026-07-01'], // 22:00 CEST, the close
    ['2026-07-01T21:59:59Z', '2026-07-01'], // 23:59:59 CEST
    ['2026-07-01T22:00:00Z', '2026-07-02'], // 00:00 CEST, already the next day
    ['2026-12-01T21:00:00Z', '2026-12-01'], // 22:00 CET, the close
    ['2026-12-01T22:59:59Z', '2026-12-01'], // 23:59:59 CET
    ['2026-12-01T23:00:00Z', '2026-12-02'], // 00:00 CET
  ])('%s is game day %s', (iso, day) => {
    expect(gameDayOf(new Date(iso))).toBe(day);
  });

  it('follows the clock change, when UTC midnight and Madrid midnight drift apart', () => {
    // 2026-10-25 lasts 25 hours in Madrid: CEST until 03:00, then CET.
    expect(gameDayOf(new Date('2026-10-24T22:00:00Z'))).toBe('2026-10-25');
    expect(gameDayOf(new Date('2026-10-25T22:59:59Z'))).toBe('2026-10-25');
  });
});

describe('gameMinuteOfDay', () => {
  it('uses Madrid summer time (UTC+2)', () => {
    expect(gameMinuteOfDay(new Date('2026-07-01T21:00:00Z'))).toBe(23 * 60);
  });

  it('uses Madrid winter time (UTC+1)', () => {
    expect(gameMinuteOfDay(new Date('2026-12-01T22:00:00Z'))).toBe(23 * 60);
  });
});

describe('isDeployFrozen', () => {
  it.each([
    ['2026-10-23T19:29:00Z', false], // 21:29 CEST
    ['2026-10-23T19:30:00Z', true], // 21:30 CEST
    ['2026-10-23T20:59:00Z', true], // 22:59 CEST
    ['2026-10-23T21:00:00Z', false], // 23:00 CEST
    ['2026-10-23T21:30:00Z', false], // 23:30 CEST
    ['2026-12-01T20:29:00Z', false], // 21:29 CET
    ['2026-12-01T20:30:00Z', true], // 21:30 CET
    ['2026-12-01T21:59:00Z', true], // 22:59 CET
    ['2026-12-01T22:00:00Z', false], // 23:00 CET
  ])('%s → %s', (iso, frozen) => {
    expect(isDeployFrozen(new Date(iso))).toBe(frozen);
  });

  it('covers the daily close', () => {
    expect(CLOSING_MINUTE_OF_DAY).toBeGreaterThanOrEqual(DEPLOY_FREEZE_START_MINUTE_OF_DAY);
    expect(CLOSING_MINUTE_OF_DAY).toBeLessThan(DEPLOY_FREEZE_END_MINUTE_OF_DAY);
  });
});

describe('deployWindowStart', () => {
  it.each([
    ['2026-10-23T14:00:00Z', 30, '2026-10-23T14:00:00Z'], // 16:00 CEST: fits now
    ['2026-10-23T19:00:00Z', 30, '2026-10-23T19:00:00Z'], // 21:00 CEST: ends as the freeze starts
    ['2026-10-23T19:01:00Z', 30, '2026-10-23T21:00:00Z'], // 21:01 CEST: would run into it
    ['2026-10-23T20:15:00Z', 30, '2026-10-23T21:00:00Z'], // 22:15 CEST: inside it
    ['2026-10-23T21:00:00Z', 30, '2026-10-23T21:00:00Z'], // 23:00 CEST: just reopened
    ['2026-12-01T20:00:00Z', 30, '2026-12-01T20:00:00Z'], // 21:00 CET
    ['2026-12-01T20:01:00Z', 30, '2026-12-01T22:00:00Z'], // 21:01 CET
    ['2026-12-01T20:45:00Z', 1, '2026-12-01T22:00:00Z'], // 21:45 CET
  ])('from %s for %i minutes starts at %s', (from, minutes, start) => {
    expect(deployWindowStart(new Date(from), minutes)).toEqual({
      ok: true,
      value: new Date(start),
    });
  });

  it('starts on the next whole minute, so the deploy never ends inside the freeze', () => {
    // 21:00:30 CEST plus 30 minutes would end at 21:30:30.
    expect(deployWindowStart(new Date('2026-10-23T19:00:30Z'), 30)).toEqual({
      ok: true,
      value: new Date('2026-10-23T21:00:00Z'),
    });
    expect(deployWindowStart(new Date('2026-10-23T14:00:30Z'), 30)).toEqual({
      ok: true,
      value: new Date('2026-10-23T14:01:00Z'),
    });
  });

  it('follows the clock changes', () => {
    // 2026-10-25 falls back to CET at 03:00; 2026-03-29 springs forward to CEST at 02:00.
    expect(deployWindowStart(new Date('2026-10-25T20:15:00Z'), 30)).toEqual({
      ok: true,
      value: new Date('2026-10-25T22:00:00Z'),
    });
    expect(deployWindowStart(new Date('2026-03-29T19:45:00Z'), 30)).toEqual({
      ok: true,
      value: new Date('2026-03-29T21:00:00Z'),
    });
    expect(deployWindowStart(new Date('2026-10-25T00:30:00Z'), 120)).toEqual({
      ok: true,
      value: new Date('2026-10-25T00:30:00Z'),
    });
  });

  // 24 hours never fit: even the 25-hour day of the clock change leaves 23.5 open hours.
  it.each([0, -5, 1.5, Number.NaN, 24 * 60])('rejects a duration of %s minutes', (minutes) => {
    expect(deployWindowStart(new Date('2026-10-23T14:00:00Z'), minutes)).toEqual({
      ok: false,
      error: 'duration_out_of_range',
    });
  });
});
