/**
 * SessionStart hook: tells Claude where it stands (branch, pending changes, deploy freeze).
 */
import { execFileSync } from 'node:child_process';
import { deployWindowStart, gameMinuteOfDay, isDeployFrozen } from '@cronista/core';
import { formatClock } from './clock.ts';
import { PROTECTED_BRANCHES } from './conventions.ts';
import { readHookInput, SessionStartInputSchema } from './input.ts';

const input = await readHookInput(SessionStartInputSchema);
const now = new Date();
const lines = [`Game time (Europe/Madrid): ${formatClock(gameMinuteOfDay(now))}.`];

try {
  const git = (args: string[]): string =>
    execFileSync('git', args, {
      cwd: input.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const changes = git(['status', '--porcelain']).split('\n').filter(Boolean).length;
  lines.push(`Branch: ${branch}. Uncommitted files: ${changes}.`);
  if (PROTECTED_BRANCHES.includes(branch)) {
    lines.push(
      `${branch} only changes through squash-merged PRs: before editing, create a \`<type>/CR-<n>\` ` +
        'branch in this folder, with no worktree, once no other session is editing it.',
    );
  }
} catch {
  lines.push('Not inside a git repository.');
}

const reopens = deployWindowStart(now, 1);
if (isDeployFrozen(now) && reopens.ok) {
  lines.push(
    `Deploy freeze is active until ${formatClock(gameMinuteOfDay(reopens.value))}: no deploys, ` +
      'no deploy approvals and no merges to master.',
  );
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') },
  }),
);
