import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptDpapiFile, windowsPowerShellEnvironment } from './dpapi.ts';

describe.runIf(process.platform === 'win32')('decryptDpapiFile', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'cronista-dpapi-'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true });
  });

  it('decrypts with the module path that PowerShell 7 leaves to its children', () => {
    const encrypted = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "ConvertTo-SecureString 'fake-value' -AsPlainText -Force | ConvertFrom-SecureString",
      ],
      { encoding: 'utf8', env: windowsPowerShellEnvironment() },
    );
    expect(encrypted.stderr).toBe('');
    const file = join(directory, 'token.dpapi');
    writeFileSync(file, encrypted.stdout.trim());
    vi.stubEnv('PSModulePath', join(process.env.ProgramFiles ?? '', 'PowerShell', '7', 'Modules'));

    expect(decryptDpapiFile(file)).toBe('fake-value');
  }, 30_000);

  it('returns nothing for a file that is missing or not encrypted', () => {
    const notEncrypted = join(directory, 'plain.txt');
    writeFileSync(notEncrypted, 'not a dpapi blob');

    expect(decryptDpapiFile(join(directory, 'missing.dpapi'))).toBeUndefined();
    expect(decryptDpapiFile(notEncrypted)).toBeUndefined();
  }, 30_000);
});
