/**
 * Asks the user before Claude changes the files that guard the repo itself.
 */
import type { Decision } from '../input.ts';

const PROTECTED_PATH =
  /(?:^|[\\/\s'"])(?:\.gitleaks\.toml|\.gitleaksignore|\.githooks[\\/]|\.claude[\\/]settings(?:\.local)?\.json|\.claude[\\/]hooks[\\/]|\.github[\\/]workflows[\\/]|\.github[\\/]dependabot\.ya?ml|\.coderabbit\.ya?ml|\.snyk(?![\w.-]))/;

const SHELL_WRITE =
  /\bsed\s+-i|(?:^|[^0-9&>])>(?!&)|\btee\b|\b(?:mv|cp|rm)\s|\b(?:Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|New-Item)\b/i;

const DECISION: Decision = {
  decision: 'ask',
  reason:
    'Protected file (secret scanning, git hooks, Claude settings/hooks, CI, Snyk, CodeRabbit or Dependabot). The user must approve this change.',
};

/** Asks before Edit/Write touch a protected file. */
export function checkProtectedPath(filePath: string): Decision {
  return PROTECTED_PATH.test(filePath) ? DECISION : undefined;
}

/** Asks before a shell command writes to a protected file. */
export function checkProtectedCommand(command: string): Decision {
  return PROTECTED_PATH.test(command) && SHELL_WRITE.test(command) ? DECISION : undefined;
}
