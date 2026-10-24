/**
 * Blocks git operations that bypass the PR flow or lose work, enforces branch names and keeps
 * merges with the user.
 */
import { BRANCH_PATTERN, PROTECTED_BRANCHES } from '../conventions.ts';
import type { Decision } from '../input.ts';
import { splitCommands, stripQuoted } from './shell.ts';

const BRANCH_CREATION =
  /\bgit\s+(?:checkout\s+-[bB]|switch\s+-[cC]|worktree\s+add\s+(?:\S+\s+)*?-[bB]|branch\s+(?:-[mM]\s+(?:\S+\s+)?)?(?=[^-\s]))\s*(\S+)/;

const GIT_DIRECTORY = /\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/;
const DIRECTORY_CHANGE =
  /(?:^|[;&|\n])\s*(?:cd|chdir|pushd|sl|Set-Location|Push-Location)\s+(?:-(?:Literal)?Path\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/gi;

/** Commands that run their quoted or heredoc argument as code. */
const INTERPRETER =
  /\b(?:bash|sh|zsh|dash|pwsh|powershell|cmd|node|deno|bun|python3?|perl|ruby|eval|iex|Invoke-Expression|Start-Process|xargs)\b/i;

/** Git configuration set through environment variables (`GIT_CONFIG_KEY_n`, `GIT_CONFIG_PARAMETERS`). */
const HOOKS_PATH_FROM_ENV = /\bGIT_CONFIG_(?:KEY_\d+|PARAMETERS)\b[^\n]*core\.hooksPath/i;

const SKIP_HOOKS_REASON =
  'never skip git hooks (--no-verify). If gitleaks blocks a commit, remove the data.';

function deny(reason: string): Decision {
  return { decision: 'deny', reason: `Blocked by .claude/hooks: ${reason}` };
}

/** Whether a `git config` call writes `core.hooksPath` (reading it, or restoring `.githooks`, is fine). */
function writesHooksPath(segment: string): boolean {
  const config = /\bgit\s+config\b(.*?)\bcore\.hooksPath\b(?:\s+(\S+))?/i.exec(segment);
  if (!config) return false;
  // Both the flag form (`--unset`) and the subcommand form (`git config unset`)
  if (/(?:--|\b)(?:unset|unset-all|add|replace-all|edit)\b/.test(config[1] ?? '')) return true;
  const value = config[2]?.replace(/^["']|["']$/g, '');
  // A redirection such as `2>&1` is not a value
  return value !== undefined && !/^-|^\d*[<>|&]/.test(value) && value !== '.githooks';
}

/**
 * Finds the directory a shell command runs git in: the last `cd`/`Set-Location` before the first git
 * call, combined with `git -C <dir>` when there is one.
 *
 * @returns The directory as written in the command, or `undefined` if the command does not change it.
 */
export function commandDirectory(command: string): string | undefined {
  const gitIndex = command.search(/\bgit\b/);
  const beforeGit = gitIndex === -1 ? command : command.slice(0, gitIndex);
  let changedTo: string | undefined;
  for (const match of beforeGit.matchAll(DIRECTORY_CHANGE)) {
    changedTo = match[1] ?? match[2] ?? match[3];
  }

  const target = GIT_DIRECTORY.exec(command);
  const gitDirectory = target?.[1] ?? target?.[2] ?? target?.[3];
  if (gitDirectory === undefined) return changedTo;
  const isAbsolute = /^(?:[\\/]|[a-zA-Z]:)/.test(gitDirectory);
  return changedTo === undefined || isAbsolute ? gitDirectory : `${changedTo}/${gitDirectory}`;
}

/**
 * Checks every git invocation inside a shell command.
 *
 * @param currentBranch - Branch checked out where the command runs git, if known.
 */
export function checkGit(command: string, currentBranch: string | undefined): Decision {
  if (HOOKS_PATH_FROM_ENV.test(command)) return deny(SKIP_HOOKS_REASON);

  const onProtectedBranch =
    currentBranch !== undefined && PROTECTED_BRANCHES.includes(currentBranch);
  let verdict: Decision;

  for (const rawSegment of splitCommands(command)) {
    // Drop global options (`git -C <dir>`, `git -c key=value`) so they cannot hide the subcommand
    const segment = rawSegment.replace(/\bgit(?:\s+-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+))+/g, 'git');
    if (!/\bgit\b/.test(segment)) continue;

    const skipsHooks =
      /--no-verify\b/.test(segment) ||
      /\bgit\s+commit\b.*\s-[a-zA-Z]*n[a-zA-Z]*(?=\s|$)/.test(segment) ||
      /\s-c\s+["']?core\.hooksPath\b/i.test(rawSegment) ||
      writesHooksPath(segment);
    if (skipsHooks) return deny(SKIP_HOOKS_REASON);

    if (/\bgit\s+reset\b.*--hard\b/.test(segment)) {
      return deny(
        '`git reset --hard` discards work. Ask the user to run it if it is really needed.',
      );
    }

    if (/\bgit\s+push\b/.test(segment)) {
      if (
        /\s(?:--force(?:-with-lease|-if-includes)?|-[a-zA-Z]*f[a-zA-Z]*)(?=\s|=|$)|\s\+\S/.test(
          segment,
        )
      ) {
        return deny('no force pushes. Add a new commit instead.');
      }
      const targetsProtected = PROTECTED_BRANCHES.some((branch) =>
        new RegExp(`(?:^|[\\s:/])${branch}(?=\\s|$)`).test(segment.replace(/\bgit\s+push\b/, '')),
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

    if (
      /\bgit\s+clean\b/.test(segment) &&
      /\s(?:-[a-zA-Z]*f[a-zA-Z]*|--force)(?=\s|$)/.test(segment)
    ) {
      // Keep looking: a later segment may still deserve a deny
      verdict = {
        decision: 'ask',
        reason: '`git clean -f` deletes untracked files for good. The user must approve it.',
      };
    }
  }
  return verdict;
}

/**
 * Keeps merges with the user: denies `gh pr merge` in any form and the merge API (REST and GraphQL).
 *
 * @remarks
 * Quoted text is ignored when looking for the command, so a commit message that mentions merging
 * is fine. Like the permission rules, this is a tripwire, not a security boundary.
 */
export function checkMerge(command: string): Decision {
  // Quoted text and heredocs are code, not data, when an interpreter runs them
  const stripped = stripQuoted(command);
  const commands = INTERPRETER.test(stripped) ? command : stripped;
  const mergesPr = /\bgh\b(?:\s+(?:-R|--repo)\s+\S+)*\s+pr\s+merge\b/.test(commands);
  const callsApi = /\bgh\s+(?:(?:-R|--repo)\s+\S+\s+)*api\b/.test(commands);
  const mergesThroughApi =
    callsApi && /pulls\/\d+\/merge|mergePullRequest|PullRequestAutoMerge/i.test(command);
  // A GraphQL query read from a file or a substitution cannot be inspected, so it is never allowed
  const hiddenGraphQl =
    callsApi && /\bgraphql\b/.test(command) && /--input\b|=@|\$\(|`/.test(command);
  return mergesPr || mergesThroughApi || hiddenGraphQl
    ? deny('only the user merges pull requests. Tell the user the PR is ready instead.')
    : undefined;
}
