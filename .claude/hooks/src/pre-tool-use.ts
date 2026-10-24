/**
 * PreToolUse hook for Bash and PowerShell: denies what permission rules cannot express, because it
 * depends on the current branch or the time (see `guards/git.ts` and `guards/deploy-window.ts`).
 *
 * @remarks
 * It fails closed: if a guard cannot load or crashes, the command is denied. Dependencies are
 * imported inside the `try` so a missing `node_modules` ends in a clear deny, not a crash.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

function deny(reason: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
}

try {
  const [{ PreToolUseInputSchema, readHookInput }, deployWindow, git] = await Promise.all([
    import('./input.ts'),
    import('./guards/deploy-window.ts'),
    import('./guards/git.ts'),
  ]);
  const input = await readHookInput(PreToolUseInputSchema);
  const command = input.tool_input.command ?? '';

  let currentBranch: string | undefined;
  if (/\bgit\b/.test(command)) {
    // With `git -C <dir>` or `cd <dir> && git …` the branch that matters is the one in <dir>
    const directory = git.commandDirectory(command) ?? '.';
    try {
      currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        // Git Bash writes `C:\dev` as `/c/dev`, which Node on Windows does not understand
        cwd: resolve(
          input.cwd,
          process.platform === 'win32'
            ? directory.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:')
            : directory,
        ),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      // Outside a repository there is no branch to protect
    }
  }

  const verdict =
    git.checkGit(command, currentBranch) ??
    (await deployWindow.checkDeployWindow(command, new Date()));
  if (verdict) deny(verdict.reason);
} catch (error) {
  deny(
    `The .claude/hooks guard failed, so the command is blocked: ${String(error)}. ` +
      'If node_modules is missing, ask the user to run `pnpm install` in a terminal.',
  );
}
