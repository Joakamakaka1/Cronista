/**
 * Blocks git operations that bypass the PR flow or lose work, and enforces branch names.
 */
import { BRANCH_PATTERN, PROTECTED_BRANCHES } from '../conventions.ts';
import type { Decision } from '../input.ts';

const BRANCH_CREATION =
  /\bgit\s+(?:checkout\s+-[bB]|switch\s+-[cC]|worktree\s+add\s+(?:\S+\s+)*?-[bB]|branch\s+(?:-[mM]\s+(?:\S+\s+)?)?(?=[^-\s]))\s*(\S+)/;

function deny(reason: string): Decision {
  return { decision: 'deny', reason: `Blocked by .claude/hooks: ${reason}` };
}

/**
 * Checks every git invocation inside a shell command.
 *
 * @param currentBranch - Branch checked out in the hook's working directory, if known.
 */
export function checkGit(command: string, currentBranch: string | undefined): Decision {
  const onProtectedBranch =
    currentBranch !== undefined && PROTECTED_BRANCHES.includes(currentBranch);

  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    if (!/\bgit\b/.test(segment)) continue;

    if (/--no-verify\b/.test(segment) || /\bgit\s+commit\b.*\s-n(?=\s|$)/.test(segment)) {
      return deny(
        'never skip git hooks (--no-verify). If gitleaks blocks a commit, remove the data.',
      );
    }
    if (/\bgit\s+reset\b.*--hard\b/.test(segment)) {
      return deny(
        '`git reset --hard` discards work. Ask the user to run it if it is really needed.',
      );
    }

    if (/\bgit\s+push\b/.test(segment)) {
      if (/\s(?:--force(?:-with-lease)?|-f)(?=\s|=|$)|\s\+\S/.test(segment)) {
        return deny('no force pushes. Add a new commit instead.');
      }
      const targetsProtected = PROTECTED_BRANCHES.some((branch) =>
        new RegExp(`(?:^|[\\s:])${branch}(?=\\s|$)`).test(segment.replace(/\bgit\s+push\b/, '')),
      );
      if (targetsProtected || onProtectedBranch) {
        return deny(
          'master only changes through a squash-merged PR. Push your `<type>/CR-<n>` branch.',
        );
      }
    }

    if (/\bgit\s+commit\b/.test(segment) && onProtectedBranch) {
      return deny(`do not commit on ${currentBranch}. Create a \`<type>/CR-<n>\` branch first.`);
    }

    const newBranch = BRANCH_CREATION.exec(segment)?.[1]?.replace(/^["']|["']$/g, '');
    if (newBranch !== undefined && !BRANCH_PATTERN.test(newBranch)) {
      return deny(
        `branch "${newBranch}" must be \`<type>/CR-<n>\` (e.g. feature/CR-12), CR-n being the Linear issue.`,
      );
    }
  }
  return undefined;
}
