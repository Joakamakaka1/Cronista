import { creditCycleStart, type Result, type SpendAlertDue, spendAlertsDue } from '@cronista/core';

import type { RaiseAlert } from './alerts.ts';
import type { GameStore, StoreFailure } from './store.ts';

/** What {@link checkSpend} needs. */
export interface CheckSpendDependencies {
  readonly store: Pick<GameStore, 'spendSince' | 'spendAlertsSent' | 'recordSpendAlert'>;
  readonly alert: RaiseAlert;
  readonly clock: () => Date;
}

/**
 * Adds up the ledger of the current credit cycle and tells the owner when a workspace reaches 50 % or
 * 80 % of its budget, once per cycle and threshold. An alert that did not go out is not recorded, so
 * the next check tries it again.
 *
 * @returns The alerts due this time.
 */
export async function checkSpend({
  store,
  alert,
  clock,
}: CheckSpendDependencies): Promise<Result<readonly SpendAlertDue[], StoreFailure>> {
  const cycleStart = creditCycleStart(clock());
  const [spent, sent] = await Promise.all([
    store.spendSince(`${cycleStart}T00:00:00Z`),
    store.spendAlertsSent(cycleStart),
  ]);
  if (!spent.ok) return spent;
  if (!sent.ok) return sent;

  const due = spendAlertsDue(spent.value, sent.value);
  for (const { workspace, threshold, spentUsd, budgetUsd } of due) {
    const delivered = await alert({
      subject: `Cronista: ${workspace} reached ${String(threshold)} % of its budget`,
      message: `The workspace ${workspace} has spent ${spentUsd.toFixed(2)} $ of its ${String(budgetUsd)} $ in the credit cycle that started on ${cycleStart}. This is the game's own ledger: the workspace's limit in the Claude Console is the safety net.`,
    });
    if (delivered) {
      const recorded = await store.recordSpendAlert({ workspace, cycleStart, threshold });
      if (!recorded.ok) return recorded;
    }
  }
  return { ok: true, value: due };
}
