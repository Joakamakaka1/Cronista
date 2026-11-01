/** Every game deadline is expressed in this time zone. */
export const GAME_TIME_ZONE = 'Europe/Madrid';

/** Daily opening time: the day's situation is published at 08:00 game time. */
export const OPENING_MINUTE_OF_DAY = 8 * 60;

/** Daily closing time: the resolver runs at 22:00 game time. */
export const CLOSING_MINUTE_OF_DAY = 22 * 60;

/** The owner gets an alert if the opening has not reported by 08:30 game time. */
export const OPENING_DEADLINE_MINUTE_OF_DAY = OPENING_MINUTE_OF_DAY + 30;

/** The owner gets an alert if the close has not reported by 22:30 game time. */
export const CLOSING_DEADLINE_MINUTE_OF_DAY = CLOSING_MINUTE_OF_DAY + 30;

/** Reminders to the players who have not played yet: 3 hours and 1 hour before the close. */
export const REMINDER_MINUTES_OF_DAY = [
  CLOSING_MINUTE_OF_DAY - 3 * 60,
  CLOSING_MINUTE_OF_DAY - 60,
] as const;

/** Around the close, deploys are frozen from 21:30 (game time) so they never overlap the resolution. */
export const DEPLOY_FREEZE_START_MINUTE_OF_DAY = 21 * 60 + 30;

/** The deploy freeze around the close ends at 23:00 game time (exclusive). */
export const DEPLOY_FREEZE_END_MINUTE_OF_DAY = 23 * 60;

/** Overnight, while the owner cannot react to a deploy, deploys are frozen from 01:00 game time. */
export const NIGHT_DEPLOY_FREEZE_START_MINUTE_OF_DAY = 60;

/** On Friday and Saturday nights (Saturday and Sunday mornings) the night freeze starts at 03:00. */
export const WEEKEND_NIGHT_DEPLOY_FREEZE_START_MINUTE_OF_DAY = 3 * 60;

/** The night freeze ends at 08:30 game time (exclusive), once the day has opened. */
export const NIGHT_DEPLOY_FREEZE_END_MINUTE_OF_DAY = OPENING_MINUTE_OF_DAY + 30;

const weekendMornings: readonly string[] = ['Sat', 'Sun'];

const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: GAME_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: GAME_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const weekdayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: GAME_TIME_ZONE,
  weekday: 'short',
});

/**
 * The game day `instant` falls on, as `YYYY-MM-DD` in the game time zone. Jobs derive it from
 * their scheduled time, so a late retry still names the day it was scheduled for.
 */
export function gameDayOf(instant: Date): string {
  const parts = new Map(dayFormatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.get('year') ?? ''}-${parts.get('month') ?? ''}-${parts.get('day') ?? ''}`;
}

/** Minutes elapsed since midnight in the game time zone (0-1439). */
export function gameMinuteOfDay(instant: Date): number {
  let hour = 0;
  let minute = 0;
  for (const part of clockFormatter.formatToParts(instant)) {
    if (part.type === 'hour') hour = Number(part.value);
    if (part.type === 'minute') minute = Number(part.value);
  }
  return hour * 60 + minute;
}

/**
 * Whether `instant` falls inside a deploy freeze (game time): around the close, from
 * `DEPLOY_FREEZE_START_MINUTE_OF_DAY` up to `DEPLOY_FREEZE_END_MINUTE_OF_DAY`, or overnight, from
 * `NIGHT_DEPLOY_FREEZE_START_MINUTE_OF_DAY` (`WEEKEND_NIGHT_DEPLOY_FREEZE_START_MINUTE_OF_DAY` on
 * Saturday and Sunday mornings) up to `NIGHT_DEPLOY_FREEZE_END_MINUTE_OF_DAY`.
 */
export function isDeployFrozen(instant: Date): boolean {
  const minute = gameMinuteOfDay(instant);
  if (minute >= DEPLOY_FREEZE_START_MINUTE_OF_DAY && minute < DEPLOY_FREEZE_END_MINUTE_OF_DAY) {
    return true;
  }
  const nightStart = weekendMornings.includes(weekdayFormatter.format(instant))
    ? WEEKEND_NIGHT_DEPLOY_FREEZE_START_MINUTE_OF_DAY
    : NIGHT_DEPLOY_FREEZE_START_MINUTE_OF_DAY;
  return minute >= nightStart && minute < NIGHT_DEPLOY_FREEZE_END_MINUTE_OF_DAY;
}

/** Where a deploy of a given length can start: an instant, or why there is none. */
export type DeployWindowStart =
  | { readonly ok: true; readonly value: Date }
  | { readonly ok: false; readonly error: 'duration_out_of_range' };

const millisecondsPerMinute = 60_000;

/**
 * The first whole minute at or after `from` from which a deploy of `durationMinutes` ends before
 * the next deploy freeze starts, so no part of it runs inside a freeze.
 *
 * @returns An error when `durationMinutes` is not a positive integer or never fits between two
 * freezes.
 */
export function deployWindowStart(from: Date, durationMinutes: number): DeployWindowStart {
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1) {
    return { ok: false, error: 'duration_out_of_range' };
  }
  // The freezes are the same within a minute, so checking each minute's start covers all of it.
  let start = Math.ceil(from.getTime() / millisecondsPerMinute) * millisecondsPerMinute;
  // Two days hold a whole open stretch between two freezes, so any duration that fits one is found.
  const giveUpAt = start + 2 * 24 * 60 * millisecondsPerMinute;
  while (start < giveUpAt) {
    let frozenAt: number | undefined;
    for (let minute = 0; minute < durationMinutes && frozenAt === undefined; minute++) {
      const instant = start + minute * millisecondsPerMinute;
      if (isDeployFrozen(new Date(instant))) frozenAt = instant;
    }
    if (frozenAt === undefined) return { ok: true, value: new Date(start) };
    start = frozenAt;
    while (isDeployFrozen(new Date(start))) start += millisecondsPerMinute;
  }
  return { ok: false, error: 'duration_out_of_range' };
}
