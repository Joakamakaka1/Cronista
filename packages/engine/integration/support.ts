import type { NarratorResult, ResolutionOutput } from '@cronista/core';

import { createMemoryStore, type Voyage } from '@cronista/memory-tools';

import type { GameAlert, MemoryDependencies, RaiseAlert } from '../src/index.ts';
import { INVENTED_NICKNAMES, usageOf, wordsEmbedder } from '../src/scripted.ts';
import {
  addDays,
  gameInstant,
  localStore,
  localSupabase,
  nextSeasonSlot,
  SIMULATED_PLAYERS,
} from '../src/local.ts';

export { addDays, gameInstant, SIMULATED_PLAYERS };
export {
  bibleLoader,
  INVENTED_NICKNAMES,
  inventedBible,
  outcomeOf,
  scriptedNarrator,
  usageOf,
  wordsEmbedder,
} from '../src/scripted.ts';

/** The store of the local Supabase, shared by the tests of a file. */
export const store = localStore();

/** Memory over the local database, with {@link wordsEmbedder} unless a test gives its own. */
export function localMemory(voyage: Voyage = wordsEmbedder()): MemoryDependencies {
  return { store: createMemoryStore(localSupabase()), voyage };
}

/** The memory the tests of a file share. */
export const memory = localMemory();

/** A new season for this test in a free stretch of dates, whose players are the first `count`. */
export async function newSeason(count = 5, length = 30) {
  const { number, startsOn } = await nextSeasonSlot();
  const created = await store.createSeason({
    number,
    startsOn,
    endsOn: addDays(startsOn, length - 1),
    characters: SIMULATED_PLAYERS.slice(0, count).map(({ email }, index) => ({
      email,
      nickname: INVENTED_NICKNAMES[index] ?? '',
    })),
  });
  if (!created.ok) throw new Error(`Could not create a season: ${created.error}`);
  return { seasonId: created.value, number, day: startsOn };
}

/** A clock well past any day a test plays, for jobs that do not depend on the hour. */
export const lateClock = () => new Date('2100-01-01T12:00:00Z');

/** An alert sink that keeps what it was told. */
export function alertsInbox(): { readonly alerts: GameAlert[]; readonly alert: RaiseAlert } {
  const alerts: GameAlert[] = [];
  return {
    alerts,
    alert: (alert) => {
      alerts.push(alert);
      return Promise.resolve(true);
    },
  };
}

/** A scripted resolution: these outcomes, once the model answers. */
export function answered(
  ...outcomes: ResolutionOutput['outcomes']
): Promise<NarratorResult<ResolutionOutput>> {
  return Promise.resolve({ ok: true, value: { outcomes }, usage: [usageOf('resolve')] });
}
