import { hasDayClosed } from '@cronista/core';

/**
 * Where the current game day stands for the player:
 * - `none`: no day has opened in the season yet.
 * - `open`: actions are accepted.
 * - `closing`: past 22:00, waiting for the chapter.
 * - `postponed`: the chapter could not be published; the newspaper says so.
 * - `published`: the chapter is out, and the next day opens at 08:00.
 */
export type DayPhase = 'none' | 'open' | 'closing' | 'postponed' | 'published';

/**
 * The phase of the latest game day at `now`. It follows the data rather than the browser's clock,
 * except to tell an open day from one past its close.
 */
export function dayPhase(
  latest: { readonly day: string; readonly state: 'open' | 'postponed' | 'published' } | null,
  now: Date,
): DayPhase {
  if (latest === null) return 'none';
  if (latest.state !== 'open') return latest.state;
  return hasDayClosed(now, latest.day) ? 'closing' : 'open';
}

/** What a player may declare with today's action: a stake up to `max`, or none and why. */
export type StakeAllowance =
  | { readonly canStake: true; readonly max: number }
  | { readonly canStake: false; readonly reason: 'no_points' | 'out' };

/** ADR-30: a stake goes from 0 to the balance; at zero or below, or out, the player declares none. */
export function stakeAllowance(character: {
  readonly balance: number;
  readonly out: boolean;
}): StakeAllowance {
  if (character.out) return { canStake: false, reason: 'out' };
  if (character.balance <= 0) return { canStake: false, reason: 'no_points' };
  return { canStake: true, max: character.balance };
}
