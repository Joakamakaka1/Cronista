/**
 * Blocks production deploys while the daily resolution runs.
 */
import { isDeployFrozen } from '@cronista/core';
import type { Decision } from '../input.ts';

const DEPLOY_COMMAND = /\bcdk\s+(?:deploy|destroy)\b|\bsupabase\s+db\s+push\b/;

/** Denies `cdk deploy`/`destroy` and `supabase db push` during the 22:30-00:00 freeze. */
export function checkDeployWindow(command: string, now: Date): Decision {
  if (!DEPLOY_COMMAND.test(command) || !isDeployFrozen(now)) return undefined;
  return {
    decision: 'deny',
    reason:
      'Blocked by .claude/hooks: deploys are frozen from 22:30 to 00:00 (Europe/Madrid) ' +
      'so they never overlap the 23:00 resolution. Try again after midnight.',
  };
}
