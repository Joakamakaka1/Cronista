import {
  gameDayOf,
  hasDayClosed,
  type Hint,
  HINT_CENSOR_LINE,
  type HintRejection,
  type Narrator,
  type Result,
} from '@cronista/core';

import { activeSeason } from './active-season.ts';
import type { LoadBible } from './load-bible.ts';
import type { GameStore, StoreFailure } from './store.ts';

/** A player's hint, or why there is none. */
export type HintResult = Result<Hint, StoreFailure | HintRejection>;

/** What {@link requestHint} needs. */
export interface RequestHintDependencies {
  readonly store: GameStore;
  readonly narrator: Pick<Narrator, 'hint'>;
  readonly loadBible: LoadBible;
  readonly clock: () => Date;
}

/**
 * Gives a player their one hint of the day, built from the situation, canon and their action. A
 * second request answers with the stored hint. A refusal answers with the censor line and spends the
 * quota; a technical failure spends none, so the player can ask again.
 */
export async function requestHint(
  { store, narrator, loadBible, clock }: RequestHintDependencies,
  { userId }: { readonly userId: string },
): Promise<HintResult> {
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

  const stored = await store.hint(gameDay.value.id, character.value.id);
  if (!stored.ok) return stored;
  if (stored.value !== undefined) return { ok: true, value: stored.value };

  if (gameDay.value.state !== 'open' || gameDay.value.closedAt !== null || hasDayClosed(now, day)) {
    return { ok: false, error: 'day_closed' };
  }

  const actions = await store.actions(gameDay.value.id);
  if (!actions.ok) return actions;
  const own = actions.value.find(({ characterId }) => characterId === character.value?.id);
  if (own?.text === undefined || own.text === null) return { ok: false, error: 'no_action' };

  const bible = await loadBible(season.value.number);
  if (!bible.ok) return { ok: false, error: 'hint_unavailable' };

  const canon = await store.characters(season.value.id);
  if (!canon.ok) return canon;

  const hint = await narrator.hint({
    bible: bible.value,
    situation: gameDay.value.situation,
    canon: canon.value,
    action: { nickname: character.value.nickname, text: own.text },
  });
  await store.recordUsage(hint.usage, day);

  if (hint.ok) {
    return store.storeHint(gameDay.value.id, character.value.id, {
      text: hint.value.text,
      censored: false,
    });
  }
  if (hint.error.kind === 'refused') {
    return store.storeHint(gameDay.value.id, character.value.id, {
      text: HINT_CENSOR_LINE,
      censored: true,
    });
  }
  console.warn({ message: 'hint failed', day, failure: hint.error.kind });
  return { ok: false, error: 'hint_unavailable' };
}
