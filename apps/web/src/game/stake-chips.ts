// The chips the design offers, two rows of five.
const DESIGN_CHIPS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12] as const;
const MAX_CHIPS = 10;

/**
 * The stakes a player can pick with one tap, from 0 to `max`: every value up to nine, and above
 * that the design's chips with the whole balance always last.
 */
export function stakeChips(max: number): readonly number[] {
  if (max < MAX_CHIPS) return Array.from({ length: max + 1 }, (_, value) => value);
  const below = DESIGN_CHIPS.filter((value) => value < max).slice(0, MAX_CHIPS - 1);
  return [...below, max];
}
