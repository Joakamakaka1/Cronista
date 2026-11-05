import type { AiUsage, Bible, Narrator, NarratorFunction } from '@cronista/core';

import type { LoadBible } from '../src/index.ts';
import {
  addDays,
  gameInstant,
  localStore,
  nextSeasonSlot,
  SIMULATED_PLAYERS,
} from '../src/local.ts';

export { addDays, gameInstant, SIMULATED_PLAYERS };

/** The store of the local Supabase, shared by the tests of a file. */
export const store = localStore();

const nicknames = ['La Farera', 'El Notario', 'La Boticaria', 'El Sacristán', 'La Alcaldesa'];

/** An invented bible for the season's first `count` characters. */
export function inventedBible(count = 5): Bible {
  return {
    world: 'Un pueblo costero inventado.',
    tone: 'Crónica de sucesos.',
    toneExamples: ['El alcalde perdió la llave.'],
    redLines: [],
    characters: nicknames
      .slice(0, count)
      .map((nickname) => ({ nickname, sheet: `Ficha de ${nickname}.`, redLines: [] })),
  };
}

/** A bible loader that always answers with the invented bible. */
export function bibleLoader(count = 5): LoadBible {
  return () => Promise.resolve({ ok: true, value: inventedBible(count) });
}

/** A new season for this test in a free stretch of dates, whose players are the first `count`. */
export async function newSeason(count = 5, length = 30) {
  const { number, startsOn } = await nextSeasonSlot();
  const created = await store.createSeason({
    number,
    startsOn,
    endsOn: addDays(startsOn, length - 1),
    characters: SIMULATED_PLAYERS.slice(0, count).map(({ email }, index) => ({
      email,
      nickname: nicknames[index] ?? '',
    })),
  });
  if (!created.ok) throw new Error(`Could not create a season: ${created.error}`);
  return { seasonId: created.value, number, day: startsOn };
}

/** One invented ledger row for a scripted response. */
export function usageOf(name: NarratorFunction, refusalCategory: string | null = null): AiUsage {
  return {
    workspace: 'dev',
    function: name,
    promptVersion: 'scripted',
    model: 'scripted',
    inputTokens: 100,
    cacheReadTokens: 20,
    cacheWriteTokens: 10,
    outputTokens: 50,
    costUsd: 0.0001,
    latencyMs: 5,
    refusalCategory,
  };
}

/** A `Narrator` with fixed answers that records what it was asked. Only the model is faked. */
export function scriptedNarrator(overrides: Partial<Narrator> = {}) {
  const calls = {
    situation: [] as Parameters<Narrator['situation']>[0][],
    hint: [] as Parameters<Narrator['hint']>[0][],
    resolve: [] as Parameters<Narrator['resolve']>[0][],
    narrate: [] as Parameters<Narrator['narrate']>[0][],
  };
  const narrator: Narrator = {
    situation: (input) => {
      calls.situation.push(input);
      return (
        overrides.situation?.(input) ??
        Promise.resolve({
          ok: true,
          value: { text: `Situación del ${input.day}.` },
          usage: [usageOf('situation')],
        })
      );
    },
    hint: (input) => {
      calls.hint.push(input);
      return (
        overrides.hint?.(input) ??
        Promise.resolve({
          ok: true,
          value: { text: `Pista para ${input.action.nickname}.` },
          usage: [usageOf('hint')],
        })
      );
    },
    resolve: (input) => {
      calls.resolve.push(input);
      return (
        overrides.resolve?.(input) ??
        Promise.resolve({
          ok: true,
          value: {
            outcomes: input.actions.map(({ nickname }) => ({
              nickname,
              summary: 'Le sale bien.',
              award: 2,
            })),
          },
          usage: [usageOf('resolve')],
        })
      );
    },
    narrate: (input) => {
      calls.narrate.push(input);
      return (
        overrides.narrate?.(input) ??
        Promise.resolve({
          ok: true,
          value: { title: `Capítulo del ${input.day}`, body: 'Pasó lo que pasó.' },
          usage: [usageOf('narrate')],
        })
      );
    },
  };
  return { narrator, calls };
}
