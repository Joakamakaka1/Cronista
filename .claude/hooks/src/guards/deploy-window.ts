/**
 * Blocks production deploys while the daily resolution runs.
 */
import type { Decision } from '../input.ts';

const DEPLOY_COMMAND = /\bcdk\s+(?:deploy|destroy)\b|\bsupabase\s+db\s+push\b/;

/**
 * Denies `cdk deploy`/`destroy` and `supabase db push` during the 21:30-23:00 freeze.
 *
 * @remarks
 * `@cronista/core` is imported only for deploy commands: this guard runs before every tool call,
 * and a broken `packages/core` must not block the edits that would fix it.
 */
export async function checkDeployWindow(command: string, now: Date): Promise<Decision> {
  if (!DEPLOY_COMMAND.test(command)) return undefined;
  const { isDeployFrozen } = await import('@cronista/core');
  if (!isDeployFrozen(now)) return undefined;
  return {
    decision: 'deny',
    reason:
      'Blocked by .claude/hooks: deploys are frozen from 21:30 to 23:00 (Europe/Madrid) ' +
      'so they never overlap the 22:00 resolution. Try again after 23:00.',
  };
}
