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
  const core = await import('@cronista/core');
  if (!core.isDeployFrozen(now)) return undefined;
  const reopens = core.deployWindowStart(now, 1);
  return {
    decision: 'deny',
    reason:
      `Blocked by .claude/hooks: deploys are frozen (${core.GAME_TIME_ZONE}) from ` +
      `${formatClock(core.DEPLOY_FREEZE_START_MINUTE_OF_DAY)} to ` +
      `${formatClock(core.DEPLOY_FREEZE_END_MINUTE_OF_DAY)}, around the resolution, and overnight ` +
      `from ${formatClock(core.NIGHT_DEPLOY_FREEZE_START_MINUTE_OF_DAY)} ` +
      `(${formatClock(core.WEEKEND_NIGHT_DEPLOY_FREEZE_START_MINUTE_OF_DAY)} on Friday and Saturday ` +
      `nights) to ${formatClock(core.NIGHT_DEPLOY_FREEZE_END_MINUTE_OF_DAY)}, while nobody can ` +
      'react to a failed deploy.' +
      (reopens.ok ? ` Try again at ${formatClock(core.gameMinuteOfDay(reopens.value))}.` : ''),
  };
}
