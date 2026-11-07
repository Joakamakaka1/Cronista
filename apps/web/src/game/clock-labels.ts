import { CLOSING_MINUTE_OF_DAY, gameDayOf, gameMinuteOfDay } from '@cronista/core';

/** What is left of an open day until 22:00 in Madrid, as "h:mm". */
export function timeLeftToClose(now: Date, day: string): string {
  const today = gameDayOf(now);
  const left =
    today > day
      ? 0
      : today < day
        ? CLOSING_MINUTE_OF_DAY
        : CLOSING_MINUTE_OF_DAY - gameMinuteOfDay(now);
  const minutes = Math.max(0, left);
  return `${String(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, '0')}`;
}

/** How long ago something happened, as a notice says it: "Hace 3 minutos". */
export function sinceLabel(at: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - Date.parse(at)) / 60_000);
  if (minutes < 1) return 'Hace un momento';
  if (minutes < 60) return minutes === 1 ? 'Hace 1 minuto' : `Hace ${String(minutes)} minutos`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? 'Hace 1 hora' : `Hace ${String(hours)} horas`;
}

/** Minutes to read a chapter, at about 220 words a minute. */
export function readingMinutes(body: string): number {
  return Math.max(1, Math.ceil(body.split(/\s+/).filter(Boolean).length / 220));
}
