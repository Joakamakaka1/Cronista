/**
 * Runs a command with the local secrets of Bitwarden Secrets Manager as environment variables of
 * that process alone: nothing is written to disk, and `bws run` keeps the machine token from it.
 *
 * Usage: `pnpm with-secrets <command> [arguments]`
 *
 * @packageDocumentation
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { prepareBwsRun } from './bws-run.ts';
import { decryptDpapiFile, windowsPowerShellEnvironment } from './dpapi.ts';

const secretsDirectory = join(homedir(), '.secrets', 'cronista');
const projectIdFile = join(secretsDirectory, 'bws-project-id.txt');

const run = prepareBwsRun(process.argv.slice(2), {
  bwsVersionOutput: () => {
    const version = spawnSync('bws', ['--version'], { encoding: 'utf8' });
    return version.error === undefined ? version.stdout : undefined;
  },
  readProjectId: () =>
    existsSync(projectIdFile) ? readFileSync(projectIdFile, 'utf8').trim() : undefined,
  readAccessToken: () => decryptDpapiFile(join(secretsDirectory, 'bws-access-token.dpapi')),
});

if (!run.ok) {
  console.error(run.error);
  process.exitCode = 1;
} else {
  // `bws run` starts Windows PowerShell, its default shell, for the wrapped command.
  const wrapped = spawnSync('bws', run.value.args, {
    stdio: 'inherit',
    env: { ...windowsPowerShellEnvironment(), ...run.value.environment },
  });
  process.exitCode = wrapped.status ?? 1;
}
