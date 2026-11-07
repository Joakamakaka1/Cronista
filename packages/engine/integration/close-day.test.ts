import { POSTPONED_CHAPTER_MESSAGE } from '@cronista/core';
import type { Database } from '@cronista/db';
import { PostgrestClient } from '@supabase/postgrest-js';
import { beforeEach, describe, expect, it } from 'vitest';

import { closeDay, openDay, submitAction } from '../src/index.ts';
import {
  addDays,
  alertsInbox,
  answered,
  bibleLoader,
  gameInstant,
  lateClock,
  newSeason,
  outcomeOf,
  scriptedNarrator,
  SIMULATED_PLAYERS,
  store,
  memory,
  localSupabase,
} from './support.ts';

const player = (index: number) => SIMULATED_PLAYERS[index]?.userId ?? '';

describe('closeDay', () => {
  let day: string;
  let seasonId: number;

  beforeEach(async () => {
    ({ day, seasonId } = await newSeason());
    const { narrator } = scriptedNarrator();
    await openDay(
      {
        store,
        narrator,
        memory,
        loadBible: bibleLoader(),
        clock: lateClock,
        alert: alertsInbox().alert,
      },
      day,
    );
  });

  const play = (index: number, targetDay = day) =>
    submitAction(
      { store, clock: () => gameInstant(targetDay, 12) },
      { userId: player(index), action: { text: `Acción ${String(index)}.`, stake: 2 } },
    );

  const closeWith = (
    narrator: ReturnType<typeof scriptedNarrator>['narrator'],
    targetDay = day,
    alert = alertsInbox().alert,
  ) =>
    closeDay(
      {
        store,
        narrator,
        memory,
        loadBible: bibleLoader(),
        clock: () => gameInstant(targetDay, 22),
        alert,
      },
      targetDay,
    );

  const balances = async () => {
    const characters = await store.characters(seasonId);
    return characters.ok ? characters.value.map(({ balance }) => balance) : [];
  };

  const stored = async () => {
    const gameDay = await store.gameDay(seasonId, day);
    return gameDay.ok ? gameDay.value : undefined;
  };

  const pullQuote = async () => {
    const { url, secretKey } = localSupabase();
    const client = new PostgrestClient<Database>(`${url}/rest/v1`, {
      headers: { apikey: secretKey },
    });
    const gameDay = await stored();
    const { data } = await client
      .from('chapters')
      .select('pull_quote')
      .eq('game_day_id', gameDay?.id ?? 0)
      .single();
    return data?.pull_quote;
  };

  const narratingWith = (pullQuoteText: string) =>
    scriptedNarrator({
      narrate: () =>
        Promise.resolve({
          ok: true,
          value: {
            title: 'Lunes',
            body: 'Nadie vio entrar el barco.\n\nDesde arriba se ven cosas que desde abajo se entierran.',
            pullQuote: pullQuoteText,
          },
          usage: [],
        }),
    }).narrator;

  it('stores the pull quote the narrator copied from the chapter', async () => {
    await play(0);
    await closeWith(narratingWith('Desde arriba se ven cosas que desde abajo se entierran.'));
    expect(await pullQuote()).toBe('Desde arriba se ven cosas que desde abajo se entierran.');
  });

  it('publishes without a pull quote the chapter does not contain', async () => {
    await play(0);
    expect(await closeWith(narratingWith('Una frase que nadie escribió.'))).toEqual({
      ok: true,
      value: { status: 'published' },
    });
    expect(await pullQuote()).toBeNull();
  });

  it('does nothing and spends nothing with no active season', async () => {
    const { narrator, calls } = scriptedNarrator();

    expect(await closeWith(narrator, '2020-01-01')).toEqual({
      ok: true,
      value: { status: 'no_active_season' },
    });
    expect(calls.resolve).toEqual([]);
  });

  it('refuses to close well before 22:00', async () => {
    await play(0);
    const { narrator, calls } = scriptedNarrator();

    const early = await closeDay(
      {
        store,
        narrator,
        memory,
        loadBible: bibleLoader(),
        clock: () => gameInstant(day, 21, 58),
        alert: alertsInbox().alert,
      },
      day,
    );

    expect(early).toEqual({ ok: false, error: 'too_early' });
    expect(calls.resolve).toEqual([]);
    expect((await stored())?.state).toBe('open');
  });

  it('closes a moment before 22:00, because nothing would retry a close refused by clock skew', async () => {
    await play(0);
    const { narrator } = scriptedNarrator();

    const close = await closeDay(
      {
        store,
        narrator,
        memory,
        loadBible: bibleLoader(),
        clock: () => gameInstant(day, 21, 59),
        alert: alertsInbox().alert,
      },
      day,
    );

    expect(close).toEqual({ ok: true, value: { status: 'published' } });
  });

  it('reports a day that never opened', async () => {
    const { narrator } = scriptedNarrator();
    const nextDay = addDays(day, 1);

    expect(await closeWith(narrator, nextDay)).toEqual({ ok: false, error: 'no_open_day' });
  });

  it('publishes the chapter with awards, and autopilot costs a fixed -1', async () => {
    await play(0);
    await play(1);
    const { narrator, calls } = scriptedNarrator({
      resolve: () =>
        answered(outcomeOf('La Farera', { award: 5 }), outcomeOf('El Notario', { award: -3 })),
    });

    expect(await closeWith(narrator)).toEqual({ ok: true, value: { status: 'published' } });

    expect((await stored())?.state).toBe('published');
    expect(await balances()).toEqual([15, 7, 9, 9, 9]);
    expect(calls.resolve[0]?.actions).toEqual([
      { nickname: 'La Farera', text: 'Acción 0.', stake: 2 },
      { nickname: 'El Notario', text: 'Acción 1.', stake: 2 },
    ]);
    expect(calls.resolve[0]?.absent).toEqual(['La Boticaria', 'El Sacristán', 'La Alcaldesa']);
    expect(calls.narrate[0]?.resolution.outcomes).toHaveLength(2);
    const chapters = await store.lastChapters(seasonId, addDays(day, 1), 2);
    expect(chapters.ok && chapters.value).toEqual([
      { day, title: `Capítulo del ${day}`, body: 'Pasó lo que pasó.' },
    ]);
  });

  it('publishes once when run twice, with no second AI call', async () => {
    await play(0);
    const { narrator, calls } = scriptedNarrator();
    await closeWith(narrator);
    const once = await balances();

    expect(await closeWith(narrator)).toEqual({ ok: true, value: { status: 'already_published' } });

    expect(await balances()).toEqual(once);
    expect(calls.resolve).toHaveLength(1);
  });

  it('still publishes a chapter on a day with no real action', async () => {
    const { narrator, calls } = scriptedNarrator();

    expect(await closeWith(narrator)).toEqual({ ok: true, value: { status: 'published' } });

    expect(await balances()).toEqual([9, 9, 9, 9, 9]);
    expect(calls.narrate[0]?.actions).toEqual([]);
    expect(calls.narrate[0]?.absent).toHaveLength(5);
    // Nothing to decide, so nothing spent and nothing that can postpone it.
    expect(calls.resolve).toEqual([]);
  });

  it('postpones without a bible, moving nothing', async () => {
    const { narrator, calls } = scriptedNarrator();

    const result = await closeDay(
      {
        store,
        narrator,
        memory,
        loadBible: () => Promise.resolve({ ok: false, error: 'bible_unavailable' }),
        clock: () => gameInstant(day, 22),
        alert: alertsInbox().alert,
      },
      day,
    );

    expect(result).toEqual({
      ok: true,
      value: { status: 'postponed', reason: 'bible_unavailable' },
    });
    expect(calls.resolve).toEqual([]);
    expect((await stored())?.newspaperMessage).toBe(POSTPONED_CHAPTER_MESSAGE);
  });

  it('publishes a postponed chapter when the close runs again, and the message goes', async () => {
    await play(0);
    const broken = scriptedNarrator({
      resolve: () => Promise.resolve({ ok: false, error: { kind: 'technical' }, usage: [] }),
    });
    await closeWith(broken.narrator);

    const { narrator } = scriptedNarrator();
    expect(await closeWith(narrator)).toEqual({ ok: true, value: { status: 'published' } });

    expect(await balances()).toEqual([12, 9, 9, 9, 9]);
    expect((await stored())?.newspaperMessage).toBeNull();
  });

  it('gives the next day continuity: the last two chapters, oldest first', async () => {
    const { narrator } = scriptedNarrator();
    const dependencies = {
      store,
      narrator,
      memory,
      loadBible: bibleLoader(),
      clock: lateClock,
      alert: alertsInbox().alert,
    };
    await closeWith(narrator);
    const second = addDays(day, 1);
    await openDay(dependencies, second);
    await closeWith(narrator, second);
    const third = addDays(day, 2);
    await openDay(dependencies, third);
    await closeWith(narrator, third);
    const fourth = addDays(day, 3);

    const { narrator: reader, calls } = scriptedNarrator();
    await openDay({ ...dependencies, narrator: reader }, fourth);

    expect(calls.situation[0]?.lastChapters.map((chapter) => chapter.day)).toEqual([second, third]);
  });
});
