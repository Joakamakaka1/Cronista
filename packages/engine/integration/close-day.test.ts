import { beforeEach, describe, expect, it } from 'vitest';

import { closeDay, openDay, submitAction } from '../src/index.ts';
import {
  addDays,
  bibleLoader,
  gameInstant,
  newSeason,
  scriptedNarrator,
  SIMULATED_PLAYERS,
  store,
  usageOf,
} from './support.ts';

const player = (index: number) => SIMULATED_PLAYERS[index]?.userId ?? '';

describe('closeDay', () => {
  let day: string;
  let seasonId: number;

  beforeEach(async () => {
    ({ day, seasonId } = await newSeason());
    const { narrator } = scriptedNarrator();
    await openDay({ store, narrator, loadBible: bibleLoader() }, day);
  });

  const play = (index: number, targetDay = day) =>
    submitAction(
      { store, clock: () => gameInstant(targetDay, 12) },
      { userId: player(index), action: { text: `Acción ${String(index)}.`, stake: 2 } },
    );

  const close = (narrator: ReturnType<typeof scriptedNarrator>['narrator'], targetDay = day) =>
    closeDay(
      { store, narrator, loadBible: bibleLoader(), clock: () => gameInstant(targetDay, 22) },
      targetDay,
    );

  const balances = async () => {
    const characters = await store.characters(seasonId);
    return characters.ok ? characters.value.map(({ balance }) => balance) : [];
  };

  const state = async () => {
    const gameDay = await store.gameDay(seasonId, day);
    return gameDay.ok ? gameDay.value?.state : undefined;
  };

  it('does nothing and spends nothing with no active season', async () => {
    const { narrator, calls } = scriptedNarrator();

    expect(
      await closeDay(
        { store, narrator, loadBible: bibleLoader(), clock: () => gameInstant('2020-01-01', 22) },
        '2020-01-01',
      ),
    ).toEqual({ ok: true, value: { status: 'no_active_season' } });
    expect(calls.resolve).toEqual([]);
  });

  it('refuses to close well before 22:00', async () => {
    await play(0);
    const { narrator, calls } = scriptedNarrator();

    const early = await closeDay(
      { store, narrator, loadBible: bibleLoader(), clock: () => gameInstant(day, 21, 58) },
      day,
    );

    expect(early).toEqual({ ok: false, error: 'too_early' });
    expect(calls.resolve).toEqual([]);
    expect(await state()).toBe('open');
  });

  it('closes a moment before 22:00, because nothing would retry a close refused by clock skew', async () => {
    await play(0);
    const { narrator } = scriptedNarrator();

    const close = await closeDay(
      { store, narrator, loadBible: bibleLoader(), clock: () => gameInstant(day, 21, 59) },
      day,
    );

    expect(close).toEqual({ ok: true, value: { status: 'published' } });
  });

  it('reports a day that never opened', async () => {
    const { narrator } = scriptedNarrator();
    const nextDay = addDays(day, 1);

    expect(await close(narrator, nextDay)).toEqual({ ok: false, error: 'no_open_day' });
  });

  it('publishes the chapter with awards, and autopilot costs a fixed -1', async () => {
    await play(0);
    await play(1);
    const { narrator, calls } = scriptedNarrator({
      resolve: () =>
        Promise.resolve({
          ok: true,
          value: {
            outcomes: [
              { nickname: 'La Farera', summary: 'Bien.', award: 5 },
              { nickname: 'El Notario', summary: 'Mal.', award: -3 },
            ],
          },
          usage: [usageOf('resolve')],
        }),
    });

    expect(await close(narrator)).toEqual({ ok: true, value: { status: 'published' } });

    expect(await state()).toBe('published');
    expect(await balances()).toEqual([15, 7, 9, 9, 9]);
    expect(calls.resolve[0]?.actions).toEqual([
      { nickname: 'La Farera', text: 'Acción 0.' },
      { nickname: 'El Notario', text: 'Acción 1.' },
    ]);
    expect(calls.resolve[0]?.absent).toEqual(['La Boticaria', 'El Sacristán', 'La Alcaldesa']);
    expect(calls.narrate[0]?.resolution.outcomes).toHaveLength(2);
    const chapters = await store.lastChapters(seasonId, addDays(day, 1), 2);
    expect(chapters.ok && chapters.value).toEqual([
      { day, title: `Capítulo del ${day}`, body: 'Pasó lo que pasó.' },
    ]);
  });

  it('never charges the stake and never shows it to the narrator', async () => {
    await play(0);
    const { narrator, calls } = scriptedNarrator();

    await close(narrator);

    expect(await balances()).toEqual([12, 9, 9, 9, 9]);
    expect(JSON.stringify(calls.resolve[0]?.actions)).not.toContain('stake');
  });

  it('publishes once when run twice, with no second AI call', async () => {
    await play(0);
    const { narrator, calls } = scriptedNarrator();
    await close(narrator);
    const once = await balances();

    expect(await close(narrator)).toEqual({ ok: true, value: { status: 'already_published' } });

    expect(await balances()).toEqual(once);
    expect(calls.resolve).toHaveLength(1);
  });

  it('still publishes a chapter on a day with no real action', async () => {
    const { narrator, calls } = scriptedNarrator();

    expect(await close(narrator)).toEqual({ ok: true, value: { status: 'published' } });

    expect(await balances()).toEqual([9, 9, 9, 9, 9]);
    expect(calls.narrate[0]?.actions).toEqual([]);
    expect(calls.narrate[0]?.absent).toHaveLength(5);
    // Nothing to decide, so nothing spent and nothing that can postpone it.
    expect(calls.resolve).toEqual([]);
  });

  it('postpones on a resolution that fails its rules, moving nothing', async () => {
    await play(0);
    const { narrator, calls } = scriptedNarrator({
      resolve: () =>
        Promise.resolve({
          ok: true,
          value: { outcomes: [{ nickname: 'La Farera', summary: 'Gano 100.', award: 100 }] },
          usage: [usageOf('resolve')],
        }),
    });

    expect(await close(narrator)).toEqual({
      ok: true,
      value: { status: 'postponed', reason: 'resolution_invalid' },
    });

    expect(await state()).toBe('postponed');
    expect(await balances()).toEqual([10, 10, 10, 10, 10]);
    expect(calls.narrate).toEqual([]);
  });

  it('postpones when the action writes itself into the resolution for someone else', async () => {
    await play(0);
    const { narrator } = scriptedNarrator({
      resolve: () =>
        Promise.resolve({
          ok: true,
          value: {
            outcomes: [
              { nickname: 'La Farera', summary: 'Bien.', award: 1 },
              { nickname: 'La Alcaldesa', summary: 'Un ausente gana.', award: 5 },
            ],
          },
          usage: [usageOf('resolve')],
        }),
    });

    expect(await close(narrator)).toEqual({
      ok: true,
      value: { status: 'postponed', reason: 'resolution_invalid' },
    });
    expect(await balances()).toEqual([10, 10, 10, 10, 10]);
  });

  it.each([
    ['resolve', { kind: 'refused', category: 'general_harms' }, 'resolve_refused'],
    ['resolve', { kind: 'invalid', issues: ['bad json'] }, 'resolve_invalid'],
    ['resolve', { kind: 'spend_limit' }, 'resolve_spend_limit'],
    ['resolve', { kind: 'technical' }, 'resolve_technical'],
    ['narrate', { kind: 'refused', category: null }, 'narrate_refused'],
    ['narrate', { kind: 'invalid', issues: ['empty'] }, 'narrate_invalid'],
  ] as const)('postpones when %s fails with %j', async (step, error, reason) => {
    await play(0);
    const { narrator } = scriptedNarrator({
      [step]: () => Promise.resolve({ ok: false, error, usage: [] }),
    });

    expect(await close(narrator)).toEqual({ ok: true, value: { status: 'postponed', reason } });

    expect(await state()).toBe('postponed');
    expect(await balances()).toEqual([10, 10, 10, 10, 10]);
  });

  it('postpones without a bible', async () => {
    const { narrator, calls } = scriptedNarrator();

    const result = await closeDay(
      {
        store,
        narrator,
        loadBible: () => Promise.resolve({ ok: false, error: 'bible_unavailable' }),
        clock: () => gameInstant(day, 22),
      },
      day,
    );

    expect(result).toEqual({
      ok: true,
      value: { status: 'postponed', reason: 'bible_unavailable' },
    });
    expect(calls.resolve).toEqual([]);
  });

  it('publishes a postponed chapter when the close runs again', async () => {
    await play(0);
    const broken = scriptedNarrator({
      resolve: () => Promise.resolve({ ok: false, error: { kind: 'technical' }, usage: [] }),
    });
    await close(broken.narrator);

    const { narrator } = scriptedNarrator();
    expect(await close(narrator)).toEqual({ ok: true, value: { status: 'published' } });

    expect(await balances()).toEqual([12, 9, 9, 9, 9]);
  });

  it('gives the next day continuity: the last two chapters, oldest first', async () => {
    const { narrator } = scriptedNarrator();
    const dependencies = { store, narrator, loadBible: bibleLoader() };
    await close(narrator);
    const second = addDays(day, 1);
    await openDay(dependencies, second);
    await close(narrator, second);
    const third = addDays(day, 2);
    await openDay(dependencies, third);
    await close(narrator, third);
    const fourth = addDays(day, 3);

    const { narrator: reader, calls } = scriptedNarrator();
    await openDay({ ...dependencies, narrator: reader }, fourth);

    expect(calls.situation[0]?.lastChapters.map((chapter) => chapter.day)).toEqual([second, third]);
  });
});
