import { describe, expect, it } from 'vitest';

import { PRESEASON_ENDS_ON, seasonCalendar } from './season-calendar.ts';

// The pre-season of the canvas: Monday 9 to Sunday 22 November 2026, today the 13th.
const preseason = {
  number: 0,
  startsOn: '2026-11-09',
  endsOn: null,
  today: '2026-11-13',
  publishedDays: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'],
};

describe('seasonCalendar', () => {
  it('draws the open-ended pre-season as ending on Sunday 22 November', () => {
    expect(PRESEASON_ENDS_ON).toBe('2026-11-22');
    const calendar = seasonCalendar(preseason);
    expect(calendar.dayNumber).toBe(5);
    expect(calendar.totalDays).toBe(14);
    expect(calendar.endsOn).toBe('2026-11-22');
    expect(calendar.daysSurvived).toBe(4);
  });

  it('lays the days out in weeks from Monday, done, today and still to come', () => {
    const { days } = seasonCalendar(preseason);
    expect(days).toHaveLength(14);
    expect(days.map(({ state }) => state)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'today',
      ...Array.from({ length: 9 }, () => 'future'),
    ]);
    expect(days[0]).toEqual({
      date: '2026-11-09',
      dayOfMonth: 9,
      number: 1,
      state: 'done',
      label: 'Día 1, 9 de noviembre, publicado',
    });
    expect(days[4]?.label).toBe('Día 5, hoy');
    expect(seasonCalendar(preseason).leadingBlanks).toBe(0);
  });

  it('pads the first week when the season starts after Monday', () => {
    const calendar = seasonCalendar({
      ...preseason,
      number: 1,
      startsOn: '2026-11-11',
      endsOn: '2026-11-22',
    });
    expect(calendar.leadingBlanks).toBe(2);
    expect(calendar.totalDays).toBe(12);
  });

  it('gives the current week, Monday to Sunday, for the survival bars', () => {
    expect(seasonCalendar(preseason).week.map(({ state }) => state)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'today',
      'future',
      'future',
    ]);
  });

  it('runs to the current week when a season has no end it can draw', () => {
    const calendar = seasonCalendar({
      number: 0,
      startsOn: '2031-01-01',
      endsOn: null,
      today: '2031-01-02',
      publishedDays: ['2031-01-01'],
    });
    expect(calendar.totalDays).toBeNull();
    expect(calendar.endsOn).toBeNull();
    expect(calendar.dayNumber).toBe(2);
    // Wednesday 1 January to Sunday 5.
    expect(calendar.days.map(({ date }) => date)).toEqual([
      '2031-01-01',
      '2031-01-02',
      '2031-01-03',
      '2031-01-04',
      '2031-01-05',
    ]);
  });
});
