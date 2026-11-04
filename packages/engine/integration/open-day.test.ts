import { describe, expect, it } from 'vitest';

import { closeDay, createSeason, openDay } from '../src/index.ts';
import {
  addDays,
  bibleLoader,
  gameInstant,
  newSeason,
  scriptedNarrator,
  SIMULATED_PLAYERS,
  store,
} from './support.ts';

const dependencies = (narrator: ReturnType<typeof scriptedNarrator>['narrator']) => ({
  store,
  narrator,
  loadBible: bibleLoader(),
});

describe('createSeason', () => {
  it('rejects someone who is not a player, by value', async () => {
    const result = await createSeason(
      { store },
      {
        number: 900_000,
        startsOn: '2029-01-01',
        endsOn: '2029-01-02',
        characters: [{ email: 'nadie@example.com', nickname: 'X' }],
      },
    );

    expect(result).toEqual({ ok: false, error: 'unknown_player' });
  });
});

describe('openDay', () => {
  it('does nothing and spends nothing on a day with no active season', async () => {
    const { narrator, calls } = scriptedNarrator();

    // Earlier than any season a test creates.
    expect(await openDay(dependencies(narrator), '2020-01-01')).toEqual({
      ok: true,
      value: 'no_active_season',
    });
    expect(calls.situation).toEqual([]);
  });

  it('treats the day after a season ends as no active season', async () => {
    const { day } = await newSeason(5, 1);
    const { narrator, calls } = scriptedNarrator();

    expect(await openDay(dependencies(narrator), addDays(day, 1))).toEqual({
      ok: true,
      value: 'no_active_season',
    });
    expect(calls.situation).toEqual([]);
  });

  it('opens the day with its situation', async () => {
    const { seasonId, day } = await newSeason();
    const { narrator, calls } = scriptedNarrator();

    expect(await openDay(dependencies(narrator), day)).toEqual({ ok: true, value: 'opened' });

    const stored = await store.gameDay(seasonId, day);
    expect(stored.ok && stored.value?.situation).toBe(`Situación del ${day}.`);
    expect(stored.ok && stored.value?.state).toBe('open');
    expect(calls.situation[0]?.lastChapters).toEqual([]);
  });

  it('opens once when run twice, with no second AI call', async () => {
    const { day } = await newSeason();
    const { narrator, calls } = scriptedNarrator();

    await openDay(dependencies(narrator), day);

    expect(await openDay(dependencies(narrator), day)).toEqual({
      ok: true,
      value: 'already_open',
    });
    expect(calls.situation).toHaveLength(1);
  });

  it('does not open while an earlier chapter is postponed, and spends nothing', async () => {
    const { day } = await newSeason();
    const { narrator, calls } = scriptedNarrator({
      narrate: () => Promise.resolve({ ok: false, error: { kind: 'technical' }, usage: [] }),
    });
    await openDay(dependencies(narrator), day);
    await closeDay({ ...dependencies(narrator), clock: () => gameInstant(day, 22) }, day);

    expect(await openDay(dependencies(narrator), addDays(day, 1))).toEqual({
      ok: false,
      error: 'previous_day_unresolved',
    });
    expect(calls.situation).toHaveLength(1);
  });

  it('does not open when the bible does not match the characters', async () => {
    const { day } = await newSeason();
    const { narrator, calls } = scriptedNarrator();

    expect(await openDay({ store, narrator, loadBible: bibleLoader(3) }, day)).toEqual({
      ok: false,
      error: 'bible_mismatch',
    });
    expect(calls.situation).toEqual([]);
  });

  it('does not open without a bible', async () => {
    const { day } = await newSeason();
    const { narrator } = scriptedNarrator();

    const result = await openDay(
      {
        store,
        narrator,
        loadBible: () => Promise.resolve({ ok: false, error: 'bible_unavailable' }),
      },
      day,
    );

    expect(result).toEqual({ ok: false, error: 'bible_unavailable' });
  });

  it('does not open when the narrator fails, so the job can run again', async () => {
    const { seasonId, day } = await newSeason();
    const { narrator } = scriptedNarrator({
      situation: () =>
        Promise.resolve({ ok: false, error: { kind: 'refused', category: 'cyber' }, usage: [] }),
    });

    expect(await openDay(dependencies(narrator), day)).toEqual({
      ok: false,
      error: 'situation_failed',
    });
    const stored = await store.gameDay(seasonId, day);
    expect(stored.ok && stored.value).toBeUndefined();
  });

  it('tells a model it could not reach apart, because a retry can fix that', async () => {
    const { day } = await newSeason();
    const { narrator } = scriptedNarrator({
      situation: () => Promise.resolve({ ok: false, error: { kind: 'technical' }, usage: [] }),
    });

    expect(await openDay(dependencies(narrator), day)).toEqual({
      ok: false,
      error: 'situation_unavailable',
    });
  });

  it('keeps the pre-season from coming back once a later season has ended', async () => {
    const created = await store.createSeason({
      number: 0,
      startsOn: '2029-06-01',
      endsOn: null,
      characters: [{ email: SIMULATED_PLAYERS[0]?.email ?? '', nickname: 'La Farera' }],
    });
    const { narrator, calls } = scriptedNarrator();
    const { day } = await newSeason(5, 1);

    // On a local database that already ran this, the pre-season is there from the last time.
    expect(created.ok || created.error === 'season_number_taken').toBe(true);
    expect(await openDay(dependencies(narrator), addDays(day, 1))).toEqual({
      ok: true,
      value: 'no_active_season',
    });
    expect(calls.situation).toEqual([]);
  });
});
