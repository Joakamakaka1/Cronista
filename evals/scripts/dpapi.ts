import { spawnSync } from 'node:child_process';

/**
 * The environment for anything that starts Windows PowerShell. PowerShell 7 leaves its own modules
 * in `PSModulePath`, and Windows PowerShell then fails to load `ConvertTo-SecureString` from them.
 *
 * @remarks
 * The name is filtered in any case, because a parent process can pass it as `PSMODULEPATH`.
 */
export function windowsPowerShellEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath'),
  );
}

/**
 * Decrypts a file that `ConvertFrom-SecureString` wrote, which only the same Windows user on the
 * same machine can do. Node has no DPAPI of its own, so Windows PowerShell does it.
 *
 * @returns The text, or `undefined` when the file is missing or this user cannot decrypt it.
 */
export function decryptDpapiFile(path: string): string | undefined {
  const decrypted = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "[System.Net.NetworkCredential]::new('', (Get-Content -Raw -LiteralPath $env:CRONISTA_DPAPI_FILE | ConvertTo-SecureString)).Password",
    ],
    {
      encoding: 'utf8',
      // Stderr is dropped because a decrypted value must never reach a log.
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...windowsPowerShellEnvironment(), CRONISTA_DPAPI_FILE: path },
    },
  );
  return decrypted.status === 0 ? decrypted.stdout.trim() || undefined : undefined;
}
