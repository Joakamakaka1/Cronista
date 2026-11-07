import { describe, expect, it } from 'vitest';

import { readingMinutes, sinceLabel, timeLeftToClose } from './clock-labels.ts';

describe('timeLeftToClose', () => {
  it('counts hours and minutes to 22:00 in Madrid', () => {
    // 16:42 in Madrid on 9 November 2026 (UTC+1).
    expect(timeLeftToClose(new Date('2026-11-09T15:42:00Z'), '2026-11-09')).toBe('5:18');
  });

  it('pads the minutes', () => {
    expect(timeLeftToClose(new Date('2026-11-09T20:55:00Z'), '2026-11-09')).toBe('0:05');
  });

  it('is zero once the day has closed', () => {
    expect(timeLeftToClose(new Date('2026-11-09T21:30:00Z'), '2026-11-09')).toBe('0:00');
  });
});

describe('sinceLabel', () => {
  const now = new Date('2026-11-09T15:42:00Z');
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

  it('says a moment for under a minute', () => {
    expect(sinceLabel(ago(0.5), now)).toBe('Hace un momento');
  });

  it('counts minutes, then hours', () => {
    expect(sinceLabel(ago(1), now)).toBe('Hace 1 minuto');
    expect(sinceLabel(ago(3), now)).toBe('Hace 3 minutos');
    expect(sinceLabel(ago(60), now)).toBe('Hace 1 hora');
    expect(sinceLabel(ago(185), now)).toBe('Hace 3 horas');
  });
});

describe('readingMinutes', () => {
  it('reads about 220 words a minute, never less than one', () => {
    expect(readingMinutes('Pasó.')).toBe(1);
    expect(readingMinutes(Array.from({ length: 880 }, () => 'palabra').join(' '))).toBe(4);
    expect(readingMinutes(Array.from({ length: 900 }, () => 'palabra').join(' '))).toBe(5);
  });
});
