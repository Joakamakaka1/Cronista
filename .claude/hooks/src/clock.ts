/**
 * Formats minutes since midnight (0-1439) as `HH:MM`.
 */
export function formatClock(minuteOfDay: number): string {
  const hours = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const minutes = String(minuteOfDay % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}
