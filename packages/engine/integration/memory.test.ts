import type { Narrator, NarratorResult, ResolutionOutput } from '@cronista/core';
import type { Database } from '@cronista/db';
import type { Voyage } from '@cronista/memory-tools';
import { PostgrestClient } from '@supabase/postgrest-js';
import { describe, expect, it } from 'vitest';

import { closeDay, type MemoryDependencies, openDay, submitAction } from '../src/index.ts';
import { localSupabase } from '../src/local.ts';
import {
  addDays,
  alertsInbox,
  bibleLoader,
  gameInstant,
  lateClock,
  localMemory,
  memory,
  newSeason,
  outcomeOf,
  scriptedNarrator,
  SIMULATED_PLAYERS,
  store,
  usageOf,
  wordsEmbedder,
} from './support.ts';

const { url, secretKey } = localSupabase();
const database = new PostgrestClient<Database>(`${url}/rest/v1`, {
  headers: { apikey: secretKey },
});

/** Opens, plays and closes one day, the first characters sending these actions. */
async function play(
  day: string,
  actions: readonly string[],
  overrides: Partial<Narrator> = {},
  memoryOfDay: MemoryDependencies = memory,
) {
  const { narrator, calls } = scriptedNarrator(overrides);
  const dependencies = {
    store,
    narrator,
    memory: memoryOfDay,
    loadBible: bibleLoader(),
    clock: lateClock,
    alert: alertsInbox().alert,
  };
  const opened = await openDay(dependencies, day);
  if (!opened.ok) throw new Error(`The day did not open: ${opened.error}`);
  for (const [index, text] of actions.entries()) {
    const sent = await submitAction(
      { store, clock: () => gameInstant(day, 12) },
      { userId: SIMULATED_PLAYERS[index]?.userId ?? '', action: { text, stake: 0 } },
    );
    if (!sent.ok) throw new Error(`The action was not sent: ${sent.error}`);
  }
  const closed = await closeDay({ ...dependencies, clock: () => gameInstant(day, 22) }, day);
  return { closed, calls, dependencies };
}

const chapterSaying =
  (body: string): Narrator['narrate'] =>
  () =>
    Promise.resolve({ ok: true, value: { title: 'Capítulo', body }, usage: [usageOf('narrate')] });

const failing = <Output>(): Promise<NarratorResult<Output>> =>
  Promise.resolve({ ok: false, error: { kind: 'technical' }, usage: [] });

/** Each published chapter of a season: whether its moments are written, and how many chunks. */
async function memoryOf(seasonId: number) {
  const { data, error } = await database
    .from('game_days')
    .select('day, chapters(moments_written_at, summary), chapter_chunks(id)')
    .eq('season_id', seasonId)
    .order('day');
  if (error !== null) throw new Error(error.code);
  return data.map(({ day, chapters, chapter_chunks }) => ({
    day,
    written: chapters?.moments_written_at !== null && chapters !== null,
    summary: chapters?.summary ?? null,
    chunks: chapter_chunks.length,
  }));
}

async function momentsOf(seasonId: number) {
  const { data, error } = await database
    .from('memories')
    .select('id, content, superseded_by, game_days!inner(day)')
    .eq('season_id', seasonId)
    .order('id');
  if (error !== null) throw new Error(error.code);
  return data.map(({ id, content, superseded_by, game_days }) => ({
    id,
    text: content,
    supersededBy: superseded_by,
    day: game_days.day,
  }));
}

describe('the narrator remembers', () => {
  it('recalls an earlier moment on a later day, once its chapter is out of the full ones', async () => {
    const { seasonId, day } = await newSeason();
    await play(day, [], {
      narrate: chapterSaying('La Farera escondió la campana bajo el muelle.'),
    });
    const second = await play(addDays(day, 1), ['Busco la campana bajo el muelle.']);
    await play(addDays(day, 2), []);
    const fourth = await play(addDays(day, 3), ['Busco la campana bajo el muelle.']);

    // On day 2 the first chapter is read in full, so retrieval leaves it out.
    expect(second.calls.resolve[0]?.memory.recalled).toEqual([]);
    const recalled = fourth.calls.resolve[0]?.memory.recalled ?? [];
    expect(recalled.some(({ text }) => text.includes('escondió la campana'))).toBe(true);
    expect(recalled.every(({ day: from }) => from === day)).toBe(true);
    // The summary of the chapter just before the two full ones.
    expect(fourth.calls.resolve[0]?.memory.earlierSummary).toEqual({
      day,
      summary: `Resumen del ${day}.`,
    });
    expect(fourth.calls.narrate[0]?.memory).toEqual(fourth.calls.resolve[0]?.memory);
    expect((await memoryOf(seasonId)).every(({ written, chunks }) => written && chunks > 0)).toBe(
      true,
    );
  });

  it('keeps a fact that changed, pointing at the moment that replaced it', async () => {
    const { seasonId, day } = await newSeason();
    await play(day, [], { narrate: chapterSaying('La Farera tiene la llave del faro.') });
    let target: number | undefined;
    await play(addDays(day, 1), [], {
      narrate: chapterSaying('El Notario tiene ya la llave del faro.'),
      compareMoments: (input) => {
        target = input.moments[0]?.nearest[0]?.id;
        return Promise.resolve({
          ok: true,
          value: {
            decisions: input.moments.map((_, index) => ({
              moment: index + 1,
              decision: index === 0 ? ('UPDATE' as const) : ('NOOP' as const),
              target: index === 0 ? (target ?? null) : null,
            })),
          },
          usage: [usageOf('compare_moments')],
        });
      },
    });

    const moments = await momentsOf(seasonId);
    const replaced = moments.find(({ id }) => id === target);
    const replacing = moments.find(({ day: from }) => from === addDays(day, 1));
    expect(replaced?.day).toBe(day);
    expect(replaced?.supersededBy).toBe(replacing?.id);
    // The other new moments were already known.
    expect(moments.filter(({ day: from }) => from === addDays(day, 1))).toHaveLength(1);
  });

  it('accepts an update only for one of the nearest, and adds the moment otherwise', async () => {
    const { seasonId, day } = await newSeason();
    await play(day, [], { narrate: chapterSaying('La Farera tiene la llave del faro.') });
    await play(addDays(day, 1), [], {
      compareMoments: (input) =>
        Promise.resolve({
          ok: true,
          value: {
            decisions: input.moments.map((_, index) => ({
              moment: index + 1,
              decision: 'UPDATE' as const,
              target: 999_999_999,
            })),
          },
          usage: [usageOf('compare_moments')],
        }),
    });

    const moments = await momentsOf(seasonId);
    expect(moments.every(({ supersededBy }) => supersededBy === null)).toBe(true);
    expect(moments.filter(({ day: from }) => from === addDays(day, 1))).toHaveLength(5);
  });

  it('leaves the chapter standing when extraction fails, and writes it at the next close', async () => {
    const { seasonId, day } = await newSeason();
    const first = await play(day, [], {
      narrate: chapterSaying('La Farera vendió el faro.'),
      extractMoments: failing,
    });

    expect(first.closed).toEqual({ ok: true, value: { status: 'published' } });
    expect(await memoryOf(seasonId)).toEqual([{ day, written: false, summary: null, chunks: 1 }]);

    const second = await play(addDays(day, 1), []);

    expect(second.calls.extractMoments.map(({ chapter }) => chapter.day)).toEqual([
      day,
      addDays(day, 1),
    ]);
    // Written before resolving, so that the day recalls it.
    expect(
      (await memoryOf(seasonId)).map(({ day: from, written }) => ({ day: from, written })),
    ).toEqual([
      { day, written: true },
      { day: addDays(day, 1), written: true },
    ]);
  });

  it('writes what was pending when the close is run again by hand', async () => {
    const { seasonId, day } = await newSeason();
    const first = await play(day, [], { extractMoments: failing });

    const again = await closeDay(
      { ...first.dependencies, narrator: scriptedNarrator().narrator, clock: lateClock },
      day,
    );

    expect(again).toEqual({ ok: true, value: { status: 'already_published' } });
    expect((await memoryOf(seasonId))[0]?.written).toBe(true);
  });

  it('never lets a struck-out action into memory or into what is recalled after it', async () => {
    const { seasonId, day } = await newSeason();
    const embedder = wordsEmbedder();
    const watched = localMemory(embedder);
    let resolved = 0;
    const resolve: Narrator['resolve'] = (input) => {
      resolved += 1;
      if (resolved <= 2) {
        return Promise.resolve({
          ok: false,
          error: { kind: 'refused', category: 'general_harms' },
          usage: [usageOf('resolve', 'general_harms')],
        });
      }
      const value: ResolutionOutput = {
        outcomes: input.actions.map(({ nickname }) => outcomeOf(nickname)),
      };
      return Promise.resolve({ ok: true, value, usage: [usageOf('resolve')] });
    };
    let narrated = 0;
    const narrate: Narrator['narrate'] = (input) => {
      narrated += 1;
      return chapterSaying(`Capítulo ${String(narrated)} del ${input.day}.`)(input);
    };

    const first = await play(
      day,
      ['Quemo el archivo vetado.', 'Paseo por la plaza.'],
      {
        resolve,
        narrate,
        testAction: ({ action }) =>
          action.text.includes('vetado')
            ? Promise.resolve({
                ok: false,
                error: { kind: 'refused', category: 'general_harms' },
                usage: [usageOf('test_action', 'general_harms')],
              })
            : Promise.resolve({ ok: true, value: { text: 'Pasea.' }, usage: [] }),
      },
      watched,
    );
    expect(first.closed).toEqual({ ok: true, value: { status: 'published' } });

    // The first recall ran before anyone knew; the one for the chapter that stands did not use it.
    const lastResolve = first.calls.resolve.at(-1);
    expect(lastResolve?.struckOut).toEqual(['La Farera']);
    expect(embedder.calls[1]).toEqual([`Situación del ${day}.`, 'Paseo por la plaza.']);
    const afterStrike = embedder.calls.slice(1).flat();
    expect(afterStrike.some((text) => text.includes('vetado'))).toBe(false);

    await play(addDays(day, 1), ['Vuelvo a la plaza.'], {}, watched);
    expect(
      embedder.calls
        .slice(1)
        .flat()
        .some((text) => text.includes('vetado')),
    ).toBe(false);
    expect((await momentsOf(seasonId)).some(({ text }) => text.includes('vetado'))).toBe(false);
  });

  it('writes the chapter without the top-k when the queries cannot be embedded', async () => {
    const { seasonId, day } = await newSeason();
    await play(day, [], { narrate: chapterSaying('La Farera escondió la campana.') });
    const embedder = wordsEmbedder();
    const down: Voyage = {
      ...embedder,
      embedQueries: () => Promise.resolve({ ok: false, error: 'technical', usage: [] }),
      embedDocuments: () => Promise.resolve({ ok: false, error: 'technical', usage: [] }),
    };

    const second = await play(addDays(day, 1), ['Busco la campana.'], {}, localMemory(down));

    expect(second.closed).toEqual({ ok: true, value: { status: 'published' } });
    expect(second.calls.resolve[0]?.memory.recalled).toEqual([]);
    // Its own memory waits for the next close.
    expect((await memoryOf(seasonId)).map(({ written }) => written)).toEqual([true, false]);
  });
});
