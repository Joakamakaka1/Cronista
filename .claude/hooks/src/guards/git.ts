/**
 * Git checks that permission rules cannot express, because they depend on the current branch or on
 * the name of a new branch. Force pushes, skipped hooks, `reset --hard` and merges are denied by the
 * permission rules in `.claude/settings.json`.
 */
import { BRANCH_PATTERN, PROTECTED_BRANCHES } from '../conventions.ts';
import type { Decision } from '../input.ts';

const BRANCH_CREATION =
  /\bgit\s+(?:checkout\s+-[bB]|switch\s+-[cC]|worktree\s+add\s+(?:\S+\s+)*?-[bB]|branch\s+(?:-[mM]\s+(?:\S+\s+)?)?(?=[^-\s]))\s*(\S+)/;

const GIT_DIRECTORY = /\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/;
const DIRECTORY_CHANGE =
  /(?:^|[;&|\n])\s*(?:cd|chdir|pushd|sl|Set-Location|Push-Location)\s+(?:-(?:Literal)?Path\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/gi;

/** Heredoc bodies and quoted strings: commit messages and other data, never commands. */
const DATA = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)|"(?:[^"\\]|\\.)*"|'[^']*'/g;

function deny(reason: string): Decision {
  return { decision: 'deny', reason: `Blocked by .claude/hooks: ${reason}` };
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
 * Denies commits on a protected branch and new branches outside `<type>/CR-<n>`.
 *
 * @param currentBranch - Branch checked out where the command runs git, if known.
 */
export function checkGit(command: string, currentBranch: string | undefined): Decision {
  const onProtectedBranch =
    currentBranch !== undefined && PROTECTED_BRANCHES.includes(currentBranch);
  // Global options (`git -C <dir>`, `git -c key=value`) must not hide the subcommand
  const commands = command
    .replace(/\bgit(?:\s+-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+))+/g, 'git')
    .replace(DATA, ' ');

  for (const segment of commands.split(/&&|\|\||[;|\n]/)) {
    if (onProtectedBranch && /\bgit\s+commit\b/.test(segment)) {
      return deny(`do not commit on ${currentBranch}. Create a \`<type>/CR-<n>\` branch first.`);
    }
    const newBranch = BRANCH_CREATION.exec(segment)?.[1];
    if (newBranch !== undefined && !BRANCH_PATTERN.test(newBranch)) {
      return deny(
        `branch "${newBranch}" must be \`<type>/CR-<n>\` (e.g. feature/CR-12), CR-n being the Linear issue.`,
      );
    }
  }
  return undefined;
}
