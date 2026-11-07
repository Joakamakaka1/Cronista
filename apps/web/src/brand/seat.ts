/** One of the five mascots. A character keeps its seat for the whole season. */
export type Seat = 0 | 1 | 2 | 3 | 4;

const seats = [0, 1, 2, 3, 4] as const;

/**
 * A character's seat: its place among the season's characters by id. The mascots are seats, not
 * people, so the bible's nicknames can be anything.
 */
export function seatOf(characters: readonly { readonly id: number }[], id: number): Seat {
  const index = characters
    .map((character) => character.id)
    .sort((first, second) => first - second)
    .indexOf(id);
  return seats[Math.max(0, index) % seats.length] ?? 0;
}
