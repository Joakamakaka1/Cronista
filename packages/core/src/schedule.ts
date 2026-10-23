/** Every game deadline is expressed in this time zone. */
export const GAME_TIME_ZONE = 'Europe/Madrid';

/** Daily closing time: the resolver runs at 23:00 game time. */
export const CLOSING_MINUTE_OF_DAY = 23 * 60;

/** Deploys are frozen from 22:30 until midnight (game time) so they never overlap the resolution. */
export const DEPLOY_FREEZE_START_MINUTE_OF_DAY = 22 * 60 + 30;

const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: GAME_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

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

export function isDeployFrozen(instant: Date): boolean {
  return gameMinuteOfDay(instant) >= DEPLOY_FREEZE_START_MINUTE_OF_DAY;
}
