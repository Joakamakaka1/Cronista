import { HINT_CENSOR_LINE } from '@cronista/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { openDay, requestHint, submitAction } from '../src/index.ts';
import {
  alertsInbox,
  notificationsInbox,
  bibleLoader,
  gameInstant,
  lateClock,
  newSeason,
  scriptedNarrator,
  SIMULATED_PLAYERS,
  store,
  usageOf,
  memory,
  unheard,
} from './support.ts';

const player = (index: number) => SIMULATED_PLAYERS[index]?.userId ?? '';

describe('requestHint', () => {
  let day: string;
  const noon = () => gameInstant(day, 12);
  const dependencies = (narrator: ReturnType<typeof scriptedNarrator>['narrator']) => ({
    store,
    narrator,
    memory,
    loadBible: bibleLoader(),
    clock: noon,
  });

  beforeEach(async () => {
    ({ day } = await newSeason());
    const { narrator } = scriptedNarrator();
    await openDay(
      {
        store,
        narrator,
        memory,
        loadBible: bibleLoader(),
        clock: lateClock,
        alert: alertsInbox().alert,
        notify: notificationsInbox().notify,
      },
      day,
    );
  });

  const play = (index: number, text = 'Enciendo el faro.') =>
    submitAction(
      { store, notify: unheard, clock: noon },
      { userId: player(index), action: { text, stake: 1 } },
    );

  it('rejects a hint before the player has acted, spending nothing', async () => {
    const { narrator, calls } = scriptedNarrator();

    expect(await requestHint(dependencies(narrator), { userId: player(0) })).toEqual({
      ok: false,
      error: 'no_action',
    });
    expect(calls.hint).toEqual([]);
  });

  it('builds the hint from the situation, canon and that action only', async () => {
    await play(0);
    await play(1, 'El secreto del otro jugador.');
    const { narrator, calls } = scriptedNarrator();

    const hint = await requestHint(dependencies(narrator), { userId: player(0) });

    expect(hint).toEqual({ ok: true, value: { text: 'Pista para La Farera.', censored: false } });
    expect(calls.hint[0]?.action).toEqual({ nickname: 'La Farera', text: 'Enciendo el faro.' });
    expect(calls.hint[0]?.situation).toBe(`Situación del ${day}.`);
    expect(JSON.stringify(calls.hint[0])).not.toContain('secreto');
  });

  it('answers a second request with the stored hint and no AI call', async () => {
    await play(0);
    const { narrator, calls } = scriptedNarrator();
    const first = await requestHint(dependencies(narrator), { userId: player(0) });

    expect(await requestHint(dependencies(narrator), { userId: player(0) })).toEqual(first);
    expect(calls.hint).toHaveLength(1);
  });

  it('answers a refusal with the censor line, which spends the quota', async () => {
    await play(0);
    const { narrator, calls } = scriptedNarrator({
      hint: () =>
        Promise.resolve({
          ok: false,
          error: { kind: 'refused', category: 'general_harms' },
          usage: [usageOf('hint', 'general_harms')],
        }),
    });

    const censored = { ok: true, value: { text: HINT_CENSOR_LINE, censored: true } };
    expect(await requestHint(dependencies(narrator), { userId: player(0) })).toEqual(censored);
    expect(await requestHint(dependencies(narrator), { userId: player(0) })).toEqual(censored);
    expect(calls.hint).toHaveLength(1);
  });

  it('spends no quota on a technical failure, so the player can ask again', async () => {
    await play(0);
    const broken = scriptedNarrator({
      hint: () => Promise.resolve({ ok: false, error: { kind: 'technical' }, usage: [] }),
    });

    expect(await requestHint(dependencies(broken.narrator), { userId: player(0) })).toEqual({
      ok: false,
      error: 'hint_unavailable',
    });

    const { narrator } = scriptedNarrator();
    expect(await requestHint(dependencies(narrator), { userId: player(0) })).toEqual({
      ok: true,
      value: { text: 'Pista para La Farera.', censored: false },
    });
  });

  it('gives one hint when two requests race', async () => {
    await play(0);
    const { narrator } = scriptedNarrator();

    const [first, second] = await Promise.all([
      requestHint(dependencies(narrator), { userId: player(0) }),
      requestHint(dependencies(narrator), { userId: player(0) }),
    ]);

    expect(first).toEqual(second);
  });

  it('rejects a user with no character', async () => {
    const { narrator } = scriptedNarrator();

    expect(
      await requestHint(dependencies(narrator), { userId: '00000000-0000-4000-8000-0000000000ff' }),
    ).toEqual({ ok: false, error: 'no_character' });
  });

  it('gives no new hint after the close, but still answers with a stored one', async () => {
    await play(0);
    await play(1);
    const { narrator } = scriptedNarrator();
    await requestHint(dependencies(narrator), { userId: player(0) });
    const late = { ...dependencies(narrator), clock: () => gameInstant(day, 22) };

    expect((await requestHint(late, { userId: player(0) })).ok).toBe(true);
    expect(await requestHint(late, { userId: player(1) })).toEqual({
      ok: false,
      error: 'day_closed',
    });
  });
});
