/**
 * Blocks production deploys during the deploy freezes.
 */
import { formatClock } from '../clock.ts';
import type { Decision } from '../input.ts';

// Local deploys, the front's bucket, and approving or starting the deploy workflows.
const DEPLOY_COMMAND =
  /\bcdk\s+(?:deploy|destroy)\b|\bsupabase\s+db\s+push\b|\baws\s+s3\s+sync\b|\bpending_deployments\b|\bgh\s+workflow\s+run\s+["']?deploy/i;

/**
 * Denies deploy commands while deploys are frozen (`isDeployFrozen` in `@cronista/core`).
 *
 * @remarks
 * `@cronista/core` is imported only for deploy commands: this guard runs before every tool call,
 * and a broken `packages/core` must not block the edits that would fix it.
 */
export async function checkDeployWindow(command: string, now: Date): Promise<Decision> {
  if (!DEPLOY_COMMAND.test(command)) return undefined;
  const { deployWindowStart, gameMinuteOfDay, isDeployFrozen } = await import('@cronista/core');
  if (!isDeployFrozen(now)) return undefined;
  const reopens = deployWindowStart(now, 1);
  return {
    decision: 'deny',
    reason:
      'Blocked by .claude/hooks: deploys are frozen from 21:30 to 23:00 (Europe/Madrid), around ' +
      'the 22:00 resolution, and overnight from 01:00 (03:00 on Friday and Saturday nights) to ' +
      '08:30, while nobody can react to a failed deploy.' +
      (reopens.ok ? ` Try again at ${formatClock(gameMinuteOfDay(reopens.value))}.` : ''),
  };
}
