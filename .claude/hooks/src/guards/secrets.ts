/**
 * Keeps secrets out of Claude's context: no reading secret files and no printing credentials.
 */
import type { Decision } from '../input.ts';
import { splitCommands, stripQuoted } from './shell.ts';

/** Paths that hold secrets or private data, wherever they appear in a path or a command. */
const SECRET_PATH =
  /(?:^|[\\/\s'"=:])(?:\.env(?:\.[\w.-]+)?|\.secrets|\.credentials\.json|\.aws[\\/]credentials|[\w.-]+\.(?:pem|key|p12|pfx|age|dump|backup)|[\w.-]+\.sql\.gz)(?=$|[\\/\s'"`;|&)>*?])/i;

/** Commands that would print credentials or the whole environment. */
const CREDENTIAL_PRINTERS = [
  /(?:^|[;&|]\s*)(?:env|set)\s*(?:$|[;&|])/m,
  /\bprintenv\b/,
  /\b(?:Get-ChildItem|gci|dir|ls)\s+env:/i,
  /GetEnvironmentVariable/i,
  // The whole environment, or a variable whose name says it holds a secret
  /\bprocess\.env\b(?!\s*(?:\.|\[\s*['"`])\s*[A-Za-z_]\w*)/,
  /\bprocess\.env\s*(?:\.|\[\s*['"`])\s*\w*(?:KEY|TOKEN|SECRET|PASSWORD)/i,
  /\bCRONISTA_ENV_FILE\b/,
  /\$env:\w*(?:KEY|TOKEN|SECRET|PASSWORD)/i,
  /\$\{?[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)/,
  /\baws\s+configure\s+(?:get|export-credentials)\b/,
  /\bgh\s+auth\s+token\b/,
  /--with-decryption\b/,
];

const REASON =
  'Blocked by .claude/hooks: secrets never pass through Claude (AGENTS.md, "Secrets"). ' +
  'Ask the user to run it themselves, or check existence without values (e.g. `aws ssm describe-parameters`).';

/** Blocks file tools (Read, Edit, Grep, Glob…) that point at a secret path. */
export function checkSecretPaths(paths: readonly string[]): Decision {
  return paths.some((path) => SECRET_PATH.test(path))
    ? { decision: 'deny', reason: REASON }
    : undefined;
}

/** Text searches, whose quoted pattern may mention a secret path without reading it. */
const TEXT_SEARCH = /^\s*(?:grep|egrep|rg|findstr|Select-String|sls|git\s+grep)\b/i;

/** Whether one simple command touches a secret path (a search pattern that merely names one does not). */
function touchesSecretPath(segment: string): boolean {
  if (!SECRET_PATH.test(segment)) return false;
  return !TEXT_SEARCH.test(segment) || SECRET_PATH.test(stripQuoted(segment));
}

/** Blocks shell commands that touch secret paths or print credentials. */
export function checkSecretsInCommand(command: string): Decision {
  const leaks =
    splitCommands(command).some(touchesSecretPath) ||
    CREDENTIAL_PRINTERS.some((pattern) => pattern.test(command));
  return leaks ? { decision: 'deny', reason: REASON } : undefined;
}
