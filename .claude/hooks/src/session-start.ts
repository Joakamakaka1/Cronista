/**
 * SessionStart hook: tells Claude where it stands (branch, pending changes, deploy freeze).
 */
import { execFileSync } from 'node:child_process';
import { gameMinuteOfDay, isDeployFrozen } from '@cronista/core';
import { PROTECTED_BRANCHES } from './conventions.ts';
import { readHookInput, SessionStartInputSchema } from './input.ts';

const input = await readHookInput(SessionStartInputSchema);
const now = new Date();
const minute = gameMinuteOfDay(now);
const clock = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const lines = [`Game time (Europe/Madrid): ${clock}.`];

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

if (isDeployFrozen(now)) {
  lines.push('Deploy freeze is active until 23:00: no deploys and no merges to master.');
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') },
  }),
);
