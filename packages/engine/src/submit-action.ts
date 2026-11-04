import {
  type Action,
  gameDayOf,
  hasDayClosed,
  type Result,
  type SubmitActionRejection,
} from '@cronista/core';

import { activeSeason } from './active-season.ts';
import type { GameStore, StoreFailure } from './store.ts';

/** The game day an action was stored for, or why it was not. */
export type SubmitActionResult = Result<
  { readonly day: string },
  StoreFailure | SubmitActionRejection
>;

/** What {@link submitAction} needs: no narrator, so `core-api` reads no AI key. */
export interface SubmitActionDependencies {
  readonly store: Pick<
    GameStore,
    'latestStartedSeason' | 'characterOfUser' | 'gameDay' | 'submitAction'
  >;
  readonly clock: () => Date;
}

/**
 * Stores a player's one action of the day. It reaches the database as `service_role`, so the
 * character comes from the verified session, never from anything the client sent.
 */
export async function submitAction(
  { store, clock }: SubmitActionDependencies,
  { userId, action }: { readonly userId: string; readonly action: Action },
): Promise<SubmitActionResult> {
  const now = clock();
  const day = gameDayOf(now);

  const season = await activeSeason(store, day);
  if (!season.ok) return season;
  if (season.value === undefined) return { ok: false, error: 'no_character' };

  const character = await store.characterOfUser(userId, season.value.id);
  if (!character.ok) return character;
  if (character.value === undefined) return { ok: false, error: 'no_character' };

  const gameDay = await store.gameDay(season.value.id, day);
  if (!gameDay.ok) return gameDay;
  if (gameDay.value === undefined) return { ok: false, error: 'day_not_open' };
  // The clock stops a job that is late; the function's lock stops a close already running.
  if (hasDayClosed(now, day)) return { ok: false, error: 'day_closed' };

  const stored = await store.submitAction(
    gameDay.value.id,
    character.value.id,
    action.text,
    action.stake,
  );
  return stored.ok ? { ok: true, value: { day } } : stored;
}
