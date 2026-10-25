import { describe, expect, it } from 'vitest';

import { gameMinuteOfDay, isDeployFrozen } from './schedule.ts';

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
});
