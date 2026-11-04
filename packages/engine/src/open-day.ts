import type { Narrator, Result } from '@cronista/core';

import { activeSeason } from './active-season.ts';
import type { LoadBible } from './load-bible.ts';
import type { GameStore, StoreFailure } from './store.ts';

/** How many published chapters the narrator reads for continuity. */
export const CHAPTERS_FOR_CONTINUITY = 2;

/** Why a day did not open. Any of these keeps the job from reporting completion. */
export type OpenDayFailure =
  | StoreFailure
  /** A chapter is pending, and a situation cannot be written without knowing what happened. */
  | 'previous_day_unresolved'
  | 'bible_unavailable'
  /** The bible's nicknames are not the season's characters. */
  | 'bible_mismatch'
  /** The model refused or answered wrong, which a retry would likely repeat. */
  | 'situation_failed'
  /** The model could not be reached, which a retry can fix. */
  | 'situation_unavailable';

/** What running the opening achieved. */
export type OpenDayResult = Result<'no_active_season' | 'opened' | 'already_open', OpenDayFailure>;

/** What {@link openDay} needs. */
export interface OpenDayDependencies {
  readonly store: GameStore;
  readonly narrator: Pick<Narrator, 'situation'>;
  readonly loadBible: LoadBible;
}

/**
 * Opens game day `day` with its situation. Running it twice opens it once, and with no active season
 * it does nothing and spends nothing.
 */
export async function openDay(
  { store, narrator, loadBible }: OpenDayDependencies,
  day: string,
): Promise<OpenDayResult> {
  const season = await activeSeason(store, day);
  if (!season.ok) return season;
  if (season.value === undefined) return { ok: true, value: 'no_active_season' };

  const existing = await store.gameDay(season.value.id, day);
  if (!existing.ok) return existing;
  if (existing.value !== undefined) return { ok: true, value: 'already_open' };

  const unresolved = await store.hasUnresolvedDayBefore(season.value.id, day);
  if (!unresolved.ok) return unresolved;
  if (unresolved.value) return { ok: false, error: 'previous_day_unresolved' };

  const bible = await loadBible(season.value.number);
  if (!bible.ok) return bible;

  const characters = await store.characters(season.value.id);
  if (!characters.ok) return characters;
  const inBible = new Set(bible.value.characters.map(({ nickname }) => nickname));
  const matches =
    inBible.size === characters.value.length &&
    characters.value.every(({ nickname }) => inBible.has(nickname));
  if (!matches) return { ok: false, error: 'bible_mismatch' };

  const lastChapters = await store.lastChapters(season.value.id, day, CHAPTERS_FOR_CONTINUITY);
  if (!lastChapters.ok) return lastChapters;

  const situation = await narrator.situation({
    bible: bible.value,
    day,
    canon: characters.value,
    lastChapters: lastChapters.value,
  });
  await store.recordUsage(situation.usage, day);
  if (!situation.ok) {
    console.warn({ message: 'situation failed', day, failure: situation.error.kind });
    return {
      ok: false,
      error: situation.error.kind === 'technical' ? 'situation_unavailable' : 'situation_failed',
    };
  }

  const opened = await store.openGameDay(season.value.id, day, situation.value.text);
  if (!opened.ok) return opened;
  return { ok: true, value: opened.value.opened ? 'opened' : 'already_open' };
}
