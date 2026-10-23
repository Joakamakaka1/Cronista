/**
 * PreToolUse hook: denies or escalates risky tool calls before they run.
 */
import { execFileSync } from 'node:child_process';
import { checkDeployWindow } from './guards/deploy-window.ts';
import { checkGit } from './guards/git.ts';
import { checkProtectedCommand, checkProtectedPath } from './guards/protected-files.ts';
import { checkSecretPaths, checkSecretsInCommand } from './guards/secrets.ts';
import { PreToolUseInputSchema, readHookInput, type Decision } from './input.ts';

const input = await readHookInput(PreToolUseInputSchema);
const { command, file_path, notebook_path, path, pattern, glob } = input.tool_input;
let decisions: Decision[];

if (input.tool_name === 'Bash' || input.tool_name === 'PowerShell') {
  const shellCommand = command ?? '';
  let currentBranch: string | undefined;
  if (/\bgit\b/.test(shellCommand)) {
    try {
      currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: input.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      // Outside a repository there is no branch to protect
    }
  }
  decisions = [
    checkSecretsInCommand(shellCommand),
    checkGit(shellCommand, currentBranch),
    checkDeployWindow(shellCommand, new Date()),
    checkProtectedCommand(shellCommand),
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
    checkSecretPaths(paths.filter((candidate) => candidate !== undefined)),
    editedFile !== undefined && input.tool_name !== 'Read'
      ? checkProtectedPath(editedFile)
      : undefined,
  ];
}

const verdict =
  decisions.find((decision) => decision?.decision === 'deny') ??
  decisions.find((decision) => decision?.decision === 'ask');

if (verdict) {
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
