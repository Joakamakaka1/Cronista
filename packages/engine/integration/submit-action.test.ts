import { beforeEach, describe, expect, it } from 'vitest';

import { closeDay, openDay, submitAction } from '../src/index.ts';
import {
  addDays,
  alertsInbox,
  bibleLoader,
  gameInstant,
  lateClock,
  newSeason,
  scriptedNarrator,
  SIMULATED_PLAYERS,
  store,
  memory,
} from './support.ts';

const player = (index: number) => SIMULATED_PLAYERS[index]?.userId ?? '';
const action = { text: 'Enciendo el faro.', stake: 3 };

describe('submitAction', () => {
  let day: string;
  let seasonId: number;

  beforeEach(async () => {
    ({ day, seasonId } = await newSeason(4));
    const { narrator } = scriptedNarrator();
    await openDay(
      {
        store,
        narrator,
        memory,
        loadBible: bibleLoader(4),
        clock: lateClock,
        alert: alertsInbox().alert,
      },
      day,
    );
  });

  const at =
    (hour: number, minute = 0) =>
    () =>
      gameInstant(day, hour, minute);

  it("stores a player's action for the day", async () => {
    const result = await submitAction({ store, clock: at(12) }, { userId: player(0), action });

    expect(result).toEqual({ ok: true, value: { day } });
    const gameDay = await store.gameDay(seasonId, day);
    const actions = await store.actions(gameDay.ok && gameDay.value ? gameDay.value.id : 0);
    expect(actions.ok && actions.value.map(({ text, origin }) => [text, origin])).toEqual([
      ['Enciendo el faro.', 'player'],
    ]);
  });

  it('rejects a second action, keeping the first', async () => {
    const dependencies = { store, clock: at(12) };
    await submitAction(dependencies, { userId: player(0), action });

    const second = await submitAction(dependencies, {
      userId: player(0),
      action: { text: 'Otra cosa.', stake: 0 },
    });

    expect(second).toEqual({ ok: false, error: 'action_already_sent' });
  });

  it('rejects a stake above the balance or below zero, and accepts the whole balance', async () => {
    const dependencies = { store, clock: at(12) };

    expect(
      await submitAction(dependencies, {
        userId: player(0),
        action: { text: 'Nada.', stake: -1 },
      }),
    ).toEqual({ ok: false, error: 'stake_out_of_range' });
    expect(
      await submitAction(dependencies, {
        userId: player(0),
        action: { text: 'Todo.', stake: 11 },
      }),
    ).toEqual({ ok: false, error: 'stake_out_of_range' });
    expect(
      await submitAction(dependencies, {
        userId: player(0),
        action: { text: 'Todo.', stake: 10 },
      }),
    ).toEqual({ ok: true, value: { day } });
  });

  it('rejects a signed-in user with no player, and a player with no character', async () => {
    const dependencies = { store, clock: at(12) };

    expect(
      await submitAction(dependencies, {
        userId: '00000000-0000-4000-8000-0000000000ff',
        action,
      }),
    ).toEqual({ ok: false, error: 'no_character' });
    expect(await submitAction(dependencies, { userId: player(4), action })).toEqual({
      ok: false,
      error: 'no_character',
    });
  });

  it('rejects an action on a day that has not opened', async () => {
    const result = await submitAction(
      { store, clock: () => gameInstant(addDays(day, 1), 7) },
      { userId: player(0), action },
    );

    expect(result).toEqual({ ok: false, error: 'day_not_open' });
  });

  it('rejects an action at 22:00, and takes one at 21:59', async () => {
    expect(await submitAction({ store, clock: at(21, 59) }, { userId: player(0), action })).toEqual(
      { ok: true, value: { day } },
    );
    expect(await submitAction({ store, clock: at(22) }, { userId: player(1), action })).toEqual({
      ok: false,
      error: 'day_closed',
    });
  });

  it('rejects an action once the close has started, whatever the clock says', async () => {
    const { narrator } = scriptedNarrator();
    await closeDay(
      {
        store,
        narrator,
        memory,
        loadBible: bibleLoader(4),
        clock: at(22),
        alert: alertsInbox().alert,
      },
      day,
    );

    // A request that passed the clock check just before the close.
    const late = await submitAction({ store, clock: at(21, 59) }, { userId: player(1), action });

    expect(late).toEqual({ ok: false, error: 'day_closed' });
  });
});
