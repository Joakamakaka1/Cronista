import { describe, expect, it } from 'vitest';

import { checkSpend } from '../src/index.ts';
import { alertsInbox, store, usageOf } from './support.ts';

// A cycle no other run has touched: the alerts it records stay in the local database.
const unusedCycle = () => {
  const year = 3000 + Math.floor(Math.random() * 5000);
  return () => new Date(Date.UTC(year, 5, 25));
};

const spending = (spent: Readonly<Record<string, number>>) => ({
  ...store,
  spendSince: () => Promise.resolve({ ok: true as const, value: spent }),
});

describe('checkSpend', () => {
  it('adds up the ledger per workspace from an instant', async () => {
    const since = new Date(Date.now() - 60_000).toISOString();
    const before = await store.spendSince(since);

    await store.recordUsage(
      [{ ...usageOf('resolve'), workspace: 'evals', costUsd: 1.5 }],
      '2031-01-01',
    );

    const after = await store.spendSince(since);
    const evalsSpend = (reply: typeof before) => (reply.ok ? (reply.value.evals ?? 0) : 0);
    expect(evalsSpend(after) - evalsSpend(before)).toBeCloseTo(1.5, 5);
  });

  it('stays quiet below 50 %', async () => {
    const { alert, alerts } = alertsInbox();

    await checkSpend({ store: spending({ 'game-prod': 7 }), alert, clock: unusedCycle() });

    expect(alerts).toEqual([]);
  });

  it('alerts at 50 % and then at 80 % of a budget, each once per cycle', async () => {
    const { alert, alerts } = alertsInbox();
    const clock = unusedCycle();

    await checkSpend({ store: spending({ 'game-prod': 8 }), alert, clock });
    await checkSpend({ store: spending({ 'game-prod': 9 }), alert, clock });
    expect(alerts.map(({ subject }) => subject)).toEqual([
      'Cronista: game-prod reached 50 % of its budget',
    ]);

    await checkSpend({ store: spending({ 'game-prod': 12 }), alert, clock });
    await checkSpend({ store: spending({ 'game-prod': 13 }), alert, clock });
    expect(alerts.map(({ subject }) => subject)).toEqual([
      'Cronista: game-prod reached 50 % of its budget',
      'Cronista: game-prod reached 80 % of its budget',
    ]);
    expect(alerts[1]?.message).toContain('12.00 $ of its 15 $');
  });

  it('tries an alert again next time when it did not go out', async () => {
    const { alert, alerts } = alertsInbox();
    const clock = unusedCycle();

    await checkSpend({
      store: spending({ dev: 3 }),
      alert: () => Promise.resolve(false),
      clock,
    });
    await checkSpend({ store: spending({ dev: 3 }), alert, clock });

    expect(alerts).toHaveLength(1);
  });

  it('starts over in a new cycle', async () => {
    const { alert, alerts } = alertsInbox();
    const year = 3000 + Math.floor(Math.random() * 5000);

    await checkSpend({
      store: spending({ dev: 3 }),
      alert,
      clock: () => new Date(Date.UTC(year, 5, 25)),
    });
    await checkSpend({
      store: spending({ dev: 3 }),
      alert,
      clock: () => new Date(Date.UTC(year, 6, 25)),
    });

    expect(alerts).toHaveLength(2);
  });
});
