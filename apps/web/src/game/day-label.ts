const dayFormatter = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/** A game day (`YYYY-MM-DD`) as players read it: "lunes, 9 de noviembre". */
export function dayLabel(day: string): string {
  return dayFormatter.format(new Date(`${day}T12:00:00Z`));
}

/** The season as players call it: the pre-season is season 0. */
export function seasonLabel(number: number): string {
  return number === 0 ? 'Pretemporada' : `Temporada ${String(number)}`;
}
