import {
  hasDayClosed,
  type NarratedAction,
  type Narrator,
  type NarratorFailure,
  type Result,
  validateResolution,
} from '@cronista/core';

import { activeSeason } from './active-season.ts';
import type { LoadBible } from './load-bible.ts';
import { CHAPTERS_FOR_CONTINUITY } from './open-day.ts';
import type { GameStore, StoreFailure, StoredGameDay } from './store.ts';

/** Why a chapter was postponed. Nothing moved, and it goes to the logs and the job's report. */
export type PostponedReason =
  | 'bible_unavailable'
  | `resolve_${NarratorFailure['kind']}`
  | 'resolution_invalid'
  | `narrate_${NarratorFailure['kind']}`
  | 'resolution_mismatch';

/** What running the close achieved. */
export type CloseDayOutcome =
  | { readonly status: 'no_active_season' | 'published' | 'already_published' }
  | { readonly status: 'postponed'; readonly reason: PostponedReason };

/** Why a close did not run. */
export type CloseDayFailure =
  | StoreFailure
  /** No situation opened this day, so there is nothing to resolve. */
  | 'no_open_day'
  /** Closing before 22:00 could not be undone, and it would take the day from the players. */
  | 'too_early';

/** What running the close achieved, or why it did not run. */
export type CloseDayResult = Result<CloseDayOutcome, CloseDayFailure>;

/** What {@link closeDay} needs. */
export interface CloseDayDependencies {
  readonly store: GameStore;
  readonly narrator: Pick<Narrator, 'resolve' | 'narrate'>;
  readonly loadBible: LoadBible;
  readonly clock: () => Date;
}

/**
 * Closes game day `day`: autopilot, resolution, validation in code, chapter, and publishing as one
 * step. Running it twice publishes once. Anything invalid or refused postpones the chapter and moves
 * nothing, and with no active season it does nothing and spends nothing.
 */
export async function closeDay(
  { store, narrator, loadBible, clock }: CloseDayDependencies,
  day: string,
): Promise<CloseDayResult> {
  const season = await activeSeason(store, day);
  if (!season.ok) return season;
  if (season.value === undefined) return { ok: true, value: { status: 'no_active_season' } };
  if (!hasDayClosed(clock(), day)) return { ok: false, error: 'too_early' };

  const gameDay = await store.gameDay(season.value.id, day);
  if (!gameDay.ok) return gameDay;
  if (gameDay.value === undefined) return { ok: false, error: 'no_open_day' };

  const begun = await store.beginClose(gameDay.value.id);
  if (!begun.ok) return begun;
  if (begun.value === 'already_published') {
    return { ok: true, value: { status: 'already_published' } };
  }

  const today = gameDay.value;
  const postpone = (reason: PostponedReason) => postponed(store, today, reason);

  const bible = await loadBible(season.value.number);
  if (!bible.ok) return postpone('bible_unavailable');

  const [characters, actions, lastChapters] = await Promise.all([
    store.characters(season.value.id),
    store.actions(gameDay.value.id),
    store.lastChapters(season.value.id, day, CHAPTERS_FOR_CONTINUITY),
  ]);
  if (!characters.ok) return characters;
  if (!actions.ok) return actions;
  if (!lastChapters.ok) return lastChapters;

  const nicknameOf = new Map(characters.value.map(({ id, nickname }) => [id, nickname]));
  const realActions: (NarratedAction & { readonly actionId: number })[] = [];
  const absent: string[] = [];
  for (const { id, characterId, origin, text } of actions.value) {
    const nickname = nicknameOf.get(characterId) ?? '';
    if (origin === 'player' && text !== null) realActions.push({ actionId: id, nickname, text });
    else absent.push(nickname);
  }

  const dayContext = {
    bible: bible.value,
    day,
    situation: gameDay.value.situation,
    canon: characters.value,
    lastChapters: lastChapters.value,
    actions: realActions.map(({ nickname, text }) => ({ nickname, text })),
    absent,
  };

  const resolution = await narrator.resolve(dayContext);
  await store.recordUsage(resolution.usage, day);
  if (!resolution.ok) return postpone(`resolve_${resolution.error.kind}`);

  const validated = validateResolution(
    resolution.value,
    realActions.map(({ nickname }) => nickname),
  );
  if (!validated.ok) return postpone('resolution_invalid');

  const chapter = await narrator.narrate({ ...dayContext, resolution: validated.value });
  await store.recordUsage(chapter.usage, day);
  if (!chapter.ok) return postpone(`narrate_${chapter.error.kind}`);

  const actionIdOf = new Map(realActions.map(({ nickname, actionId }) => [nickname, actionId]));
  const published = await store.publishChapter(
    gameDay.value.id,
    chapter.value,
    validated.value.outcomes.flatMap(({ nickname, award }) => {
      const actionId = actionIdOf.get(nickname);
      return actionId === undefined ? [] : [{ actionId, points: award }];
    }),
  );
  if (published.ok) return { ok: true, value: { status: published.value } };
  if (published.error === 'resolution_mismatch') return postpone('resolution_mismatch');
  return { ok: false, error: published.error };
}

async function postponed(
  store: Pick<GameStore, 'postponeChapter'>,
  gameDay: StoredGameDay,
  reason: PostponedReason,
): Promise<CloseDayResult> {
  console.warn({ message: 'chapter postponed', day: gameDay.day, reason });
  const stored = await store.postponeChapter(gameDay.id);
  return stored.ok ? { ok: true, value: { status: 'postponed', reason } } : stored;
}
