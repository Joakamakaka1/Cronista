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

const secretsDirectory = join(homedir(), '.secrets', 'cronista');
const projectIdFile = join(secretsDirectory, 'bws-project-id.txt');
const accessTokenFile = join(secretsDirectory, 'bws-access-token.dpapi');

const run = prepareBwsRun(process.argv.slice(2), {
  bwsVersionOutput: () => {
    const version = spawnSync('bws', ['--version'], { encoding: 'utf8' });
    return version.error === undefined ? version.stdout : undefined;
  },
  readProjectId: () =>
    existsSync(projectIdFile) ? readFileSync(projectIdFile, 'utf8').trim() : undefined,
  readAccessToken: () => {
    if (!existsSync(accessTokenFile)) return undefined;
    // Node has no DPAPI of its own. Stderr is dropped because the token must never reach a log.
    const decrypted = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "[System.Net.NetworkCredential]::new('', (Get-Content -Raw -LiteralPath $env:CRONISTA_BWS_TOKEN_FILE | ConvertTo-SecureString)).Password",
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, CRONISTA_BWS_TOKEN_FILE: accessTokenFile },
      },
    );
    return decrypted.status === 0 ? decrypted.stdout.trim() : undefined;
  },
});

if (!run.ok) {
  console.error(run.error);
  process.exitCode = 1;
} else {
  const wrapped = spawnSync('bws', run.value.args, {
    stdio: 'inherit',
    env: { ...process.env, ...run.value.environment },
  });
  process.exitCode = wrapped.status ?? 1;
}
