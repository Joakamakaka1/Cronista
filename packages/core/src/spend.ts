import type { Workspace } from './narrator.ts';

/** The day of the month the credits renew, in UTC, which starts a credit cycle. */
export const CREDIT_RENEWAL_DAY = 19;

/** What each Claude Console workspace may spend in a credit cycle, in dollars. */
export const WORKSPACE_BUDGETS_USD: Readonly<Record<Workspace, number>> = {
  'game-prod': 15,
  evals: 37,
  dev: 5,
};

/** The percentages of a workspace's budget that raise an alert. */
export const SPEND_ALERT_THRESHOLDS = [50, 80] as const;

/** An alert of a credit cycle: which workspace reached which threshold. */
export interface SpendAlertKey {
  readonly workspace: string;
  readonly threshold: number;
}

/** An alert to raise, with the numbers it reports. */
export interface SpendAlertDue extends SpendAlertKey {
  readonly spentUsd: number;
  readonly budgetUsd: number;
}

const isWorkspace = (name: string): name is Workspace => name in WORKSPACE_BUDGETS_USD;

/** The date (`YYYY-MM-DD`, UTC) on which the credit cycle holding `now` started. */
export function creditCycleStart(now: Date): string {
  const monthsBack = now.getUTCDate() >= CREDIT_RENEWAL_DAY ? 0 : 1;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, CREDIT_RENEWAL_DAY),
  )
    .toISOString()
    .slice(0, 10);
}

/**
 * The alerts a cycle's spend has earned and not sent yet.
 *
 * @param spent - The cycle's dollars per workspace.
 * @param sent - The alerts this cycle has already raised.
 */
export function spendAlertsDue(
  spent: Readonly<Record<string, number>>,
  sent: readonly SpendAlertKey[],
): readonly SpendAlertDue[] {
  return Object.entries(spent).flatMap(([workspace, spentUsd]) => {
    if (!isWorkspace(workspace)) return [];
    const budgetUsd = WORKSPACE_BUDGETS_USD[workspace];
    return SPEND_ALERT_THRESHOLDS.filter(
      (threshold) =>
        spentUsd >= (budgetUsd * threshold) / 100 &&
        !sent.some((alert) => alert.workspace === workspace && alert.threshold === threshold),
    ).map((threshold) => ({ workspace, threshold, spentUsd, budgetUsd }));
  });
}
