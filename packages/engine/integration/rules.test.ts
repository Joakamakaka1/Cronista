import type { NarratorResult, ResolutionOutput } from '@cronista/core';
import type { Database } from '@cronista/db';
import { PostgrestClient } from '@supabase/postgrest-js';
import { describe, expect, it } from 'vitest';

import { closeDay, openDay, submitAction } from '../src/index.ts';
import { localSupabase } from '../src/local.ts';
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
} from './support.ts';

const { url, secretKey } = localSupabase();
const database = new PostgrestClient<Database>(`${url}/rest/v1`, {
  headers: { apikey: secretKey },
});

const FARERA = 0;
const NOTARIO = 1;
const BOTICARIA = 2;

type Resolve = () => Promise<NarratorResult<ResolutionOutput>>;

/** A season with its first day open, and what a test needs to play it. */
async function season(length = 30) {
  const { day: firstDay, seasonId } = await newSeason(5, length);
  let today = firstDay;

  const engine = (resolve?: Resolve) => {
    const scripted = scriptedNarrator(resolve === undefined ? {} : { resolve });
    return {
      scripted,
      dependencies: {
        store,
        narrator: scripted.narrator,
        memory,
        loadBible: bibleLoader(),
        clock: lateClock,
        alert: alertsInbox().alert,
      },
    };
  };
  await openDay(engine().dependencies, today);

  return {
    seasonId,
    get today() {
      return today;
    },
    act: (index: number, stake: number, text = `Acción ${String(index)}.`) =>
      submitAction(
        { store, clock: () => gameInstant(today, 12) },
        { userId: SIMULATED_PLAYERS[index]?.userId ?? '', action: { text, stake } },
      ),
    close: async (resolve?: Resolve) => {
      const { dependencies, scripted } = engine(resolve);
      const result = await closeDay(dependencies, today);
      return { result, calls: scripted.calls };
    },
    nextDay: async () => {
      today = addDays(today, 1);
      await openDay(engine().dependencies, today);
    },
    balances: async () => {
      const characters = await store.characters(seasonId);
      return characters.ok ? characters.value.map(({ balance }) => balance) : [];
    },
    canon: async () => {
      const canon = await store.canon(seasonId, today);
      if (!canon.ok) throw new Error(canon.error);
      return canon.value;
    },
  };
}

const published = { ok: true, value: { status: 'published' } };

describe('points', () => {
  it('charges at most the stake, and the rest returns', async () => {
    const game = await season();
    await game.act(FARERA, 5);

    const { result } = await game.close(() =>
      answered(outcomeOf('La Farera', { award: 1, influence: 2 })),
    );

    expect(result).toEqual(published);
    expect(await game.balances()).toEqual([9, 9, 9, 9, 9]);
  });

  it('shows the stake to the narrator as the most it may charge', async () => {
    const game = await season();
    await game.act(FARERA, 5);

    const { calls } = await game.close();

    expect(calls.resolve[0]?.actions[0]?.stake).toBe(5);
  });

  it('returns the whole stake when nothing charges it', async () => {
    const game = await season();
    await game.act(FARERA, 10);

    await game.close();

    expect(await game.balances()).toEqual([12, 9, 9, 9, 9]);
  });

  it('lets a player at zero or below play, declaring nothing', async () => {
    const game = await season();
    const sink = () => answered(outcomeOf('La Farera', { award: -3 }));
    for (let round = 0; round < 4; round += 1) {
      await game.act(FARERA, 0);
      await game.close(sink);
      await game.nextDay();
    }
    expect((await game.balances())[FARERA]).toBe(-2);

    expect(await game.act(FARERA, 1)).toEqual({ ok: false, error: 'stake_out_of_range' });
    expect((await game.act(FARERA, 0)).ok).toBe(true);
  });

  it('lets points received today be staked tomorrow at the earliest', async () => {
    const game = await season();
    await game.act(NOTARIO, 5);
    await game.close(() =>
      answered(outcomeOf('El Notario', { payments: [{ to: 'La Farera', points: 5 }] })),
    );
    expect((await game.balances())[FARERA]).toBe(14);

    await game.nextDay();

    expect((await game.act(FARERA, 14)).ok).toBe(true);
  });

  it('does not let a stake count points that a chapter has not published', async () => {
    const game = await season();
    await game.act(NOTARIO, 5);

    expect(await game.act(FARERA, 11)).toEqual({ ok: false, error: 'stake_out_of_range' });
  });
});

describe('charges', () => {
  it('buys influence, an item and a payment from one stake', async () => {
    const game = await season();
    await game.act(FARERA, 6);

    const { result } = await game.close(() =>
      answered(
        outcomeOf('La Farera', {
          award: 0,
          influence: 1,
          payments: [{ to: 'El Notario', points: 2 }],
          newItems: [{ name: 'La lámpara', price: 3 }],
        }),
      ),
    );

    expect(result).toEqual(published);
    // La Farera loses 6; El Notario gets 2 and pays autopilot's -1.
    expect(await game.balances()).toEqual([4, 11, 9, 9, 9]);
    expect((await game.canon()).items).toEqual([{ name: 'La lámpara', owner: 'La Farera' }]);
    const charges = await database
      .from('charges')
      .select('purpose, points')
      .order('id', { ascending: false })
      .limit(3);
    expect(charges.data?.map(({ purpose }) => purpose).sort()).toEqual([
      'influence',
      'item',
      'payment',
    ]);
  });

  it('postpones when charges go over the stake, after one retry', async () => {
    const game = await season();
    await game.act(FARERA, 1);

    const { result, calls } = await game.close(() =>
      answered(outcomeOf('La Farera', { influence: 2 })),
    );

    expect(result).toEqual({
      ok: true,
      value: { status: 'postponed', reason: 'resolution_invalid' },
    });
    expect(calls.resolve).toHaveLength(2);
    expect(await game.balances()).toEqual([10, 10, 10, 10, 10]);
  });
});

describe('items', () => {
  it('drops a new item with no charge and goes on with the day', async () => {
    const game = await season();
    await game.act(FARERA, 3);

    const { result, calls } = await game.close(() =>
      answered(outcomeOf('La Farera', { newItems: [{ name: 'Gratis', price: 0 }] })),
    );

    expect(result).toEqual(published);
    expect((await game.canon()).items).toEqual([]);
    expect(calls.narrate[0]?.resolution.outcomes[0]?.newItems).toEqual([]);
  });

  it('changes hands only from its current owner, and can be taken from an absent owner', async () => {
    const game = await season();
    await game.act(FARERA, 2);
    await game.close(() =>
      answered(outcomeOf('La Farera', { newItems: [{ name: 'La llave', price: 2 }] })),
    );
    await game.nextDay();

    await game.act(NOTARIO, 0);
    await game.act(BOTICARIA, 0);
    const { result, calls } = await game.close(() =>
      answered(
        outcomeOf('El Notario', {
          movedItems: [{ item: 'La llave', from: 'La Farera', to: 'El Notario' }],
        }),
        outcomeOf('La Boticaria', {
          movedItems: [{ item: 'La llave', from: 'La Farera', to: 'La Boticaria' }],
        }),
      ),
    );

    expect(result).toEqual(published);
    expect((await game.canon()).items).toEqual([{ name: 'La llave', owner: 'El Notario' }]);
    expect(calls.narrate[0]?.resolution.outcomes[1]?.movedItems).toEqual([]);
    expect(calls.narrate[0]?.absent).toContain('La Farera');

    // The app shows the theft in that day's chapter.
    const moves = await database
      .from('item_moves')
      .select(
        'item:items!inner(name, season_id), from:characters!from_character_id(nickname), to:characters!to_character_id(nickname), game_day:game_days!inner(day)',
      )
      .eq('item.season_id', game.seasonId);
    expect(moves.data).toEqual([
      {
        item: { name: 'La llave', season_id: game.seasonId },
        from: { nickname: 'La Farera' },
        to: { nickname: 'El Notario' },
        game_day: { day: game.today },
      },
    ]);
  });
});

describe('debts', () => {
  it('is born from the debtor and paid from its stake, reaching the creditor', async () => {
    const game = await season();
    await game.act(FARERA, 0);
    await game.close(() =>
      answered(
        outcomeOf('La Farera', { award: 0, newDebts: [{ creditor: 'El Notario', points: 3 }] }),
      ),
    );
    expect((await game.canon()).debts).toMatchObject([
      { debtor: 'La Farera', creditor: 'El Notario', points: 3 },
    ]);
    expect(await game.balances()).toEqual([10, 9, 9, 9, 9]);
    await game.nextDay();

    await game.act(FARERA, 3);
    const { result } = await game.close(() =>
      answered(outcomeOf('La Farera', { award: 0, paidDebts: [{ creditor: 'El Notario' }] })),
    );

    expect(result).toEqual(published);
    expect((await game.canon()).debts).toEqual([]);
    expect(await game.balances()).toEqual([7, 11, 8, 8, 8]);
  });

  it('drops a debt out of range, and a payment of a debt nobody owes', async () => {
    const game = await season();
    await game.act(FARERA, 5);

    const { result } = await game.close(() =>
      answered(
        outcomeOf('La Farera', {
          newDebts: [{ creditor: 'El Notario', points: 6 }],
          paidDebts: [{ creditor: 'El Notario' }],
        }),
      ),
    );

    expect(result).toEqual(published);
    expect((await game.canon()).debts).toEqual([]);
  });

  it('postpones when paying a debt does not fit the stake', async () => {
    const game = await season();
    await game.act(FARERA, 0);
    await game.close(() =>
      answered(outcomeOf('La Farera', { newDebts: [{ creditor: 'El Notario', points: 3 }] })),
    );
    await game.nextDay();
    await game.act(FARERA, 1);

    const { result } = await game.close(() =>
      answered(outcomeOf('La Farera', { paidDebts: [{ creditor: 'El Notario' }] })),
    );

    expect(result).toEqual({
      ok: true,
      value: { status: 'postponed', reason: 'resolution_invalid' },
    });
  });

  it('charges a fine as a negative award, with no debt', async () => {
    const game = await season();
    await game.act(FARERA, 0);

    await game.close(() => answered(outcomeOf('La Farera', { award: -3 })));

    expect((await game.canon()).debts).toEqual([]);
    expect((await game.balances())[FARERA]).toBe(7);
  });
});

describe('a character out', () => {
  const sendOut = (nickname: string) => () =>
    answered(outcomeOf('La Farera', { outCharacters: [nickname] }));

  it('spends one day out with no stake, narrated from there, and is back after that close', async () => {
    const game = await season();
    await game.act(FARERA, 0);
    await game.close(sendOut('El Notario'));
    await game.nextDay();

    expect((await game.canon()).characters[NOTARIO]?.out).toBe(true);
    expect(await game.act(NOTARIO, 1)).toEqual({ ok: false, error: 'stake_out_of_range' });
    expect((await game.act(NOTARIO, 0)).ok).toBe(true);

    const { calls } = await game.close();
    const seen = calls.resolve[0]?.canon.characters.find(
      ({ nickname }) => nickname === 'El Notario',
    );
    expect(seen?.out).toBe(true);
    expect(calls.resolve[0]?.actions.map(({ nickname }) => nickname)).toContain('El Notario');

    await game.nextDay();
    expect((await game.canon()).characters[NOTARIO]?.out).toBe(false);
    expect((await game.act(NOTARIO, 1)).ok).toBe(true);
  });

  it('is never out two days in a row: that change is dropped and the day goes on', async () => {
    const game = await season();
    await game.act(FARERA, 0);
    await game.close(sendOut('El Notario'));
    await game.nextDay();
    await game.act(FARERA, 0);

    const { result, calls } = await game.close(sendOut('El Notario'));

    expect(result).toEqual(published);
    expect(calls.narrate[0]?.resolution.outcomes[0]?.outCharacters).toEqual([]);
    await game.nextDay();
    expect((await game.canon()).characters[NOTARIO]?.out).toBe(false);
  });

  it('can be an absent character: other actions still affect it', async () => {
    const game = await season();
    await game.act(FARERA, 0);

    await game.close(sendOut('La Boticaria'));
    await game.nextDay();

    expect((await game.canon()).characters[BOTICARIA]?.out).toBe(true);
  });
});

describe('an absent character', () => {
  it('declares nothing and changes no canon of its own: an outcome for it postpones', async () => {
    const game = await season();
    await game.act(FARERA, 0);

    const { result } = await game.close(() =>
      answered(
        outcomeOf('La Farera'),
        outcomeOf('La Alcaldesa', { newDebts: [{ creditor: 'La Farera', points: 1 }] }),
      ),
    );

    expect(result).toEqual({
      ok: true,
      value: { status: 'postponed', reason: 'resolution_invalid' },
    });
    expect((await game.canon()).debts).toEqual([]);
  });

  it('costs a fixed -1 whatever the narrator wrote', async () => {
    const game = await season();

    await game.close();

    expect(await game.balances()).toEqual([9, 9, 9, 9, 9]);
  });
});

describe('the finale', () => {
  it('counts open debts before narrate, and the named winner holds the highest balance', async () => {
    const game = await season(2);
    await game.act(FARERA, 0);
    await game.close(() =>
      answered(
        outcomeOf('La Farera', { award: 0, newDebts: [{ creditor: 'El Notario', points: 2 }] }),
      ),
    );
    await game.nextDay();
    await game.act(NOTARIO, 0);

    const { result, calls } = await game.close(() =>
      answered(
        outcomeOf('El Notario', { award: 1, newDebts: [{ creditor: 'La Boticaria', points: 1 }] }),
      ),
    );

    expect(result).toEqual(published);
    // Before the count: La Farera 9, El Notario 10, the others 8. Then the two debts move.
    const balances = await game.balances();
    expect(balances).toEqual([7, 11, 9, 8, 8]);
    const finale = calls.narrate[0]?.finale;
    expect(finale?.winners).toEqual(['El Notario']);
    expect(finale?.balances.map(({ balance }) => balance)).toEqual(balances);
    expect((await game.canon()).debts).toEqual([]);
  });

  it('shares the win on a tie', async () => {
    const game = await season(1);

    const { calls } = await game.close();

    expect(calls.narrate[0]?.finale?.winners.length).toBe(5);
  });

  it('is only the last chapter', async () => {
    const game = await season(2);

    const { calls } = await game.close();

    expect(calls.narrate[0]?.finale).toBeUndefined();
  });
});
