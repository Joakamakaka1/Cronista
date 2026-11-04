import type { CreateSeasonRejection, Result } from '@cronista/core';

import type { GameStore, NewSeason, StoreFailure } from './store.ts';

/**
 * Creates a season and its characters, each with the starting balance.
 *
 * @returns The new season's id, or why it was not created.
 */
export function createSeason(
  dependencies: { readonly store: Pick<GameStore, 'createSeason'> },
  season: NewSeason,
): Promise<Result<number, StoreFailure | CreateSeasonRejection>> {
  return dependencies.store.createSeason(season);
}
