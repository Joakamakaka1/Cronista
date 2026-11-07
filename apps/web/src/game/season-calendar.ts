/**
 * The last day of the pre-season as the app draws it. Season 0 has no end date in the database, but
 * the owner closes it on Sunday 22 November 2026, when season 1 starts clean.
 */
export const PRESEASON_ENDS_ON = '2026-11-22';

/** A day of the season as the calendar shows it. */
export interface CalendarDay {
  readonly date: string;
  readonly dayOfMonth: number;
  /** Its place in the season, from 1. */
  readonly number: number;
  readonly state: 'done' | 'today' | 'future';
  /** What a screen reader says for it. */
  readonly label: string;
}

/** The season laid out by day, for the archive's calendar and Today's survival bars. */
export interface SeasonCalendar {
  /** Today's place in the season, from 1. */
  readonly dayNumber: number;
  /** Days in the season, or null when it has no end the app can draw. */
  readonly totalDays: number | null;
  readonly endsOn: string | null;
  /** Published days: each one survived. */
  readonly daysSurvived: number;
  /** Empty cells before the first day, so the grid starts on Monday. */
  readonly leadingBlanks: number;
  readonly days: readonly CalendarDay[];
  /** The week of today, Monday to Sunday; days outside the season count as still to come. */
  readonly week: readonly { readonly state: CalendarDay['state'] }[];
}

const DAY_MS = 86_400_000;
const monthName = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (time: number) => new Date(time).toISOString().slice(0, 10);
// Monday is 0.
const weekdayOf = (date: string) => (new Date(toTime(date)).getUTCDay() + 6) % 7;

/** The calendar of a season, given its dates, today and the days already published. */
export function seasonCalendar(season: {
  readonly number: number;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly today: string;
  readonly publishedDays: readonly string[];
}): SeasonCalendar {
  const planned = season.endsOn ?? (season.number === 0 ? PRESEASON_ENDS_ON : null);
  const endsOn = planned !== null && planned >= season.startsOn ? planned : null;
  // With no end, the calendar runs to the Sunday of the current week.
  const last = endsOn ?? toDate(toTime(season.today) + (6 - weekdayOf(season.today)) * DAY_MS);
  const published = new Set(season.publishedDays);

  const days: CalendarDay[] = [];
  for (let time = toTime(season.startsOn); time <= toTime(last); time += DAY_MS) {
    const date = toDate(time);
    const number = days.length + 1;
    const state =
      date === season.today
        ? 'today'
        : published.has(date) || date < season.today
          ? 'done'
          : 'future';
    const label =
      state === 'today'
        ? `Día ${String(number)}, hoy`
        : `Día ${String(number)}, ${monthName.format(new Date(time))}${state === 'done' ? ', publicado' : ''}`;
    days.push({ date, dayOfMonth: new Date(time).getUTCDate(), number, state, label });
  }

  const monday = toTime(season.today) - weekdayOf(season.today) * DAY_MS;
  const week = Array.from({ length: 7 }, (_, offset) => {
    const date = toDate(monday + offset * DAY_MS);
    return { state: days.find((day) => day.date === date)?.state ?? ('future' as const) };
  });

  return {
    dayNumber: Math.round((toTime(season.today) - toTime(season.startsOn)) / DAY_MS) + 1,
    totalDays: endsOn === null ? null : days.length,
    endsOn,
    daysSurvived: season.publishedDays.length,
    leadingBlanks: weekdayOf(season.startsOn),
    days,
    week,
  };
}
