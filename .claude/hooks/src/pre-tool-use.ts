/**
 * PreToolUse hook: denies or escalates risky tool calls before they run.
 *
 * @remarks
 * It fails closed: if a guard cannot load or crashes, the tool call is denied. Dependencies are
 * imported inside the `try` so a missing `node_modules` ends in a clear deny, not a crash.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { Decision } from './input.ts';

function respond(verdict: NonNullable<Decision>): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: verdict.decision,
        permissionDecisionReason: verdict.reason,
      },
    }),
  );
}

try {
  const [{ PreToolUseInputSchema, readHookInput }, deployWindow, git, protectedFiles, secrets] =
    await Promise.all([
      import('./input.ts'),
      import('./guards/deploy-window.ts'),
      import('./guards/git.ts'),
      import('./guards/protected-files.ts'),
      import('./guards/secrets.ts'),
    ]);
  const input = await readHookInput(PreToolUseInputSchema);
  const { command, file_path, notebook_path, path, pattern, glob } = input.tool_input;
  let decisions: Decision[];

  if (input.tool_name === 'Bash' || input.tool_name === 'PowerShell') {
    const shellCommand = command ?? '';
    let currentBranch: string | undefined;
    if (/\bgit\b/.test(shellCommand)) {
      // With `git -C <dir>` or `cd <dir> && git …` the branch that matters is the one in <dir>
      const directory = git.commandDirectory(shellCommand) ?? '.';
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
    decisions = [
      secrets.checkSecretsInCommand(shellCommand),
      git.checkGit(shellCommand, currentBranch),
      git.checkMerge(shellCommand),
      await deployWindow.checkDeployWindow(shellCommand, new Date()),
      protectedFiles.checkProtectedCommand(shellCommand),
    ];
  } else {
    // Glob's pattern is a path; Grep's pattern is file content, so it is not checked
    const paths = [
      file_path,
      notebook_path,
      path,
      glob,
      input.tool_name === 'Glob' ? pattern : undefined,
    ];
    const editedFile = file_path ?? notebook_path;
    decisions = [
      secrets.checkSecretPaths(paths.filter((candidate) => candidate !== undefined)),
      editedFile !== undefined && input.tool_name !== 'Read'
        ? protectedFiles.checkProtectedPath(editedFile)
        : undefined,
    ];
  }

  const verdict =
    decisions.find((decision) => decision?.decision === 'deny') ??
    decisions.find((decision) => decision?.decision === 'ask');
  if (verdict) respond(verdict);
} catch (error) {
  respond({
    decision: 'deny',
    reason:
      `The .claude/hooks guard failed, so the call is blocked: ${String(error)}. ` +
      'If node_modules is missing, ask the user to run `pnpm install` in a terminal.',
  });
}
