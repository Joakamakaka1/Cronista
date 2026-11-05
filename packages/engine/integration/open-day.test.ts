import { RESERVE_SITUATION } from '@cronista/core';
import { describe, expect, it } from 'vitest';

import { closeDay, createSeason, openDay } from '../src/index.ts';
import {
  addDays,
  alertsInbox,
  bibleLoader,
  lateClock,
  newSeason,
  scriptedNarrator,
  SIMULATED_PLAYERS,
  store,
  usageOf,
} from './support.ts';

const dependencies = (
  narrator: ReturnType<typeof scriptedNarrator>['narrator'],
  alert = alertsInbox().alert,
) => ({
  store,
  narrator,
  loadBible: bibleLoader(),
  clock: lateClock,
  alert,
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

  it('does not open when the bible does not match the characters', async () => {
    const { day } = await newSeason();
    const { narrator, calls } = scriptedNarrator();

    expect(await openDay({ ...dependencies(narrator), loadBible: bibleLoader(3) }, day)).toEqual({
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
        ...dependencies(narrator),
        loadBible: () => Promise.resolve({ ok: false, error: 'bible_unavailable' }),
      },
      day,
    );

    expect(result).toEqual({ ok: false, error: 'bible_unavailable' });
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

describe('a situation the narrator cannot write', () => {
  const situationOf = async (seasonId: number, day: string) => {
    const stored = await store.gameDay(seasonId, day);
    return stored.ok ? stored.value?.situation : undefined;
  };

  it('gets one softer retry after a refusal, and then the day opens as usual', async () => {
    const { seasonId, day } = await newSeason();
    let tries = 0;
    const { narrator, calls } = scriptedNarrator({
      situation: () => {
        tries += 1;
        return Promise.resolve(
          tries === 1
            ? { ok: false, error: { kind: 'refused', category: 'cyber' }, usage: [] }
            : { ok: true, value: { text: 'Amanece.' }, usage: [] },
        );
      },
    });
    const { alert, alerts } = alertsInbox();

    expect(await openDay(dependencies(narrator, alert), day)).toEqual({
      ok: true,
      value: 'opened',
    });

    expect(calls.situation[1]?.retry).toEqual({ kind: 'softer' });
    expect(await situationOf(seasonId, day)).toBe('Amanece.');
    expect(alerts).toEqual([]);
  });

  it('gets one retry with its errors when it is invalid', async () => {
    const { seasonId, day } = await newSeason();
    let tries = 0;
    const { narrator, calls } = scriptedNarrator({
      situation: () => {
        tries += 1;
        return Promise.resolve(
          tries === 1
            ? { ok: false, error: { kind: 'invalid', issues: ['text: too_small'] }, usage: [] }
            : { ok: true, value: { text: 'Amanece.' }, usage: [] },
        );
      },
    });

    await openDay(dependencies(narrator), day);

    expect(calls.situation[1]?.retry).toEqual({ kind: 'fix', issues: ['text: too_small'] });
    expect(await situationOf(seasonId, day)).toBe('Amanece.');
  });

  it.each([
    ['refused', { kind: 'refused', category: 'cyber' }, 2],
    ['invalid', { kind: 'invalid', issues: ['bad'] }, 2],
    ['over the spend limit', { kind: 'spend_limit' }, 1],
  ] as const)(
    'opens with the reserve situation and an alert when it stays %s',
    async (_, error, attempts) => {
      const { seasonId, day } = await newSeason();
      const { narrator, calls } = scriptedNarrator({
        situation: () => Promise.resolve({ ok: false, error, usage: [usageOf('situation')] }),
      });
      const { alert, alerts } = alertsInbox();

      expect(await openDay(dependencies(narrator, alert), day)).toEqual({
        ok: true,
        value: 'opened',
      });

      expect(await situationOf(seasonId, day)).toBe(RESERVE_SITUATION);
      expect(calls.situation).toHaveLength(attempts);
      expect(alerts.map(({ subject }) => subject)).toEqual([
        'Cronista: the reserve situation opened the day',
      ]);
    },
  );

  it('does not spend the reserve on an outage, because a retry can fix that', async () => {
    const { seasonId, day } = await newSeason();
    const { narrator, calls } = scriptedNarrator({
      situation: () => Promise.resolve({ ok: false, error: { kind: 'technical' }, usage: [] }),
    });
    const { alert, alerts } = alertsInbox();

    expect(await openDay(dependencies(narrator, alert), day)).toEqual({
      ok: false,
      error: 'situation_unavailable',
    });

    expect(calls.situation).toHaveLength(1);
    expect(await situationOf(seasonId, day)).toBeUndefined();
    expect(alerts).toEqual([]);
  });
});

describe('a chapter still pending at the opening', () => {
  const refusedNarrator = () =>
    scriptedNarrator({
      narrate: () =>
        Promise.resolve({ ok: false, error: { kind: 'refused', category: 'cyber' }, usage: [] }),
    });

  it('is tried first, and the day opens once it is published', async () => {
    const { seasonId, day } = await newSeason();
    const broken = refusedNarrator();
    await openDay(dependencies(broken.narrator), day);
    await closeDay(dependencies(broken.narrator), day);

    const { narrator, calls } = scriptedNarrator();
    const next = addDays(day, 1);
    expect(await openDay(dependencies(narrator), next)).toEqual({ ok: true, value: 'opened' });

    const pending = await store.gameDay(seasonId, day);
    expect(pending.ok && pending.value?.state).toBe('published');
    expect(calls.narrate).toHaveLength(1);
    expect(calls.situation[0]?.lastChapters.map((chapter) => chapter.day)).toEqual([day]);
  });

  it('keeps the day closed when it fails again, and tells the owner', async () => {
    const { seasonId, day } = await newSeason();
    const { narrator, calls } = refusedNarrator();
    const { alert, alerts } = alertsInbox();
    await openDay(dependencies(narrator), day);
    await closeDay(dependencies(narrator), day);
    const situations = calls.situation.length;
    const next = addDays(day, 1);

    expect(await openDay(dependencies(narrator, alert), next)).toEqual({
      ok: false,
      error: 'previous_day_unresolved',
    });

    const tomorrow = await store.gameDay(seasonId, next);
    expect(tomorrow.ok && tomorrow.value).toBeUndefined();
    expect(calls.situation).toHaveLength(situations);
    expect(alerts.map(({ subject }) => subject)).toEqual([
      'Cronista: the day did not open, a chapter is pending',
    ]);
    expect(JSON.stringify(alerts)).toContain('refused_no_culprit');
  });

  it('asks Lambda to retry on an outage, with no email of its own', async () => {
    const { day } = await newSeason();
    const { narrator } = scriptedNarrator({
      narrate: () => Promise.resolve({ ok: false, error: { kind: 'technical' }, usage: [] }),
    });
    const { alert, alerts } = alertsInbox();
    await openDay(dependencies(narrator), day);
    await closeDay(dependencies(narrator), day);

    expect(await openDay(dependencies(narrator, alert), addDays(day, 1))).toEqual({
      ok: false,
      error: 'previous_day_unavailable',
    });
    expect(alerts).toEqual([]);
  });

  it('is safe to run by hand again and again: it publishes once and opens once', async () => {
    const { day } = await newSeason();
    const broken = refusedNarrator();
    await openDay(dependencies(broken.narrator), day);
    await closeDay(dependencies(broken.narrator), day);
    const next = addDays(day, 1);
    await openDay(dependencies(broken.narrator), next);

    const { narrator, calls } = scriptedNarrator();
    expect(await closeDay(dependencies(narrator), day)).toEqual({
      ok: true,
      value: { status: 'published' },
    });
    expect(await closeDay(dependencies(narrator), day)).toEqual({
      ok: true,
      value: { status: 'already_published' },
    });
    expect(await openDay(dependencies(narrator), next)).toEqual({ ok: true, value: 'opened' });
    expect(await openDay(dependencies(narrator), next)).toEqual({
      ok: true,
      value: 'already_open',
    });

    expect(calls.narrate).toHaveLength(1);
    expect(calls.situation).toHaveLength(1);
  });

  it('is not lost on a season that has ended: a postponed finale is tried the next morning', async () => {
    const { seasonId, day } = await newSeason(5, 1);
    const broken = refusedNarrator();
    await openDay(dependencies(broken.narrator), day);
    await closeDay(dependencies(broken.narrator), day);

    const { narrator, calls } = scriptedNarrator();
    expect(await openDay(dependencies(narrator), addDays(day, 1))).toEqual({
      ok: true,
      value: 'no_active_season',
    });

    const finale = await store.gameDay(seasonId, day);
    expect(finale.ok && finale.value?.state).toBe('published');
    expect(calls.narrate[0]?.finale).toBeDefined();
    expect(calls.situation).toEqual([]);
  });
});
