import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { type BwsMachine, prepareBwsRun, requiredBwsVersion } from './bws-run.ts';
import { windowsPowerShellEnvironment } from './dpapi.ts';

const accessToken = 'fake-machine-token';
const projectId = 'fake-project-id';
// A command that cannot start leaves `$LASTEXITCODE` null, and `exit $null` would report success.
const exitWithCommandStatus =
  '; $ok = $?; if ($null -eq $LASTEXITCODE) { exit [int](-not $ok) }; exit $LASTEXITCODE';

const readyMachine: BwsMachine = {
  bwsVersionOutput: () => `bws ${requiredBwsVersion}\n`,
  readProjectId: () => projectId,
  readAccessToken: () => accessToken,
};

describe('prepareBwsRun', () => {
  it('scopes the run to the project and passes the token only in the environment', () => {
    const run = prepareBwsRun(['node', 'script.ts'], readyMachine);

    expect(run).toEqual({
      ok: true,
      value: {
        args: [
          'run',
          '--project-id',
          projectId,
          '--',
          `& 'node' 'script.ts'${exitWithCommandStatus}`,
        ],
        environment: {
          BWS_ACCESS_TOKEN: accessToken,
          BWS_SERVER_URL: 'https://vault.bitwarden.eu',
        },
      },
    });
    if (run.ok) expect(run.value.args.join(' ')).not.toContain(accessToken);
  });

  it('quotes every argument, so PowerShell does not read @scope as a splat or an apostrophe as code', () => {
    const run = prepareBwsRun(['pnpm', '--filter', '@cronista/evals', "it's"], readyMachine);

    expect(run.ok && run.value.args.at(-1)).toBe(
      `& 'pnpm' '--filter' '@cronista/evals' 'it''s'${exitWithCommandStatus}`,
    );
  });

  it('ignores the separator that pnpm may forward', () => {
    const run = prepareBwsRun(['--', 'node', '--version'], readyMachine);

    expect(run.ok && run.value.args.at(-1)).toBe(`& 'node' '--version'${exitWithCommandStatus}`);
  });

  it.each([
    ['a double quote', 'say "hi"'],
    ['an empty argument', ''],
    ['the typographic quote U+2018', '\u2018x'],
    ['the typographic quote U+2019', 'it\u2019s'],
    ['the typographic quote U+201A', '\u201Ax'],
    ['the typographic quote U+201B', '\u201Bx'],
  ])('refuses %s, which Windows PowerShell would corrupt or run as code', (_name, argument) => {
    expect(prepareBwsRun(['node', 'script.ts', argument], readyMachine)).toEqual({
      ok: false,
      error: expect.stringContaining('do not survive Windows PowerShell') as string,
    });
  });

  it('keeps typographic double quotes, which stay inside a single-quoted string', () => {
    const run = prepareBwsRun(['node', '\u201Cx\u201D'], readyMachine);

    expect(run.ok && run.value.args.at(-1)).toBe(
      `& 'node' '\u201Cx\u201D'${exitWithCommandStatus}`,
    );
  });

  describe.runIf(process.platform === 'win32')('through Windows PowerShell', () => {
    const statusOf = (command: string[]) => {
      const run = prepareBwsRun(command, readyMachine);
      const script = run.ok ? run.value.args.at(-1) : undefined;
      if (script === undefined) throw new Error('The command was refused.');
      return spawnSync('powershell', ['-NoProfile', '-Command', script], {
        env: windowsPowerShellEnvironment(),
        stdio: 'ignore',
      }).status;
    };

    it('reports a command that cannot start as a failure', () => {
      expect(statusOf(['cronista-no-such-command'])).toBe(1);
    }, 30_000);

    it('passes on the exit code of the command', () => {
      expect(statusOf(['node', '-e', 'process.exit(7)'])).toBe(7);
      expect(statusOf(['node', '-e', 'process.exit(0)'])).toBe(0);
    }, 30_000);

    it('reports a failing cmdlet, and a working one as a success', () => {
      expect(statusOf(['Get-Item', 'C:\\cronista-no-such-path'])).toBe(1);
      expect(statusOf(['Get-Location'])).toBe(0);
    }, 30_000);
  });

  it.each([[[]], [['--']]])('asks for a command when given %j', (command) => {
    expect(prepareBwsRun(command, readyMachine)).toEqual({
      ok: false,
      error: expect.stringContaining('Usage: pnpm with-secrets') as string,
    });
  });

  it('says how to install the CLI when it is missing', () => {
    const run = prepareBwsRun(['node'], { ...readyMachine, bwsVersionOutput: () => undefined });

    expect(run).toEqual({
      ok: false,
      error: expect.stringContaining(
        `scoop install bitwarden-secrets-manager-cli@${requiredBwsVersion}`,
      ) as string,
    });
  });

  it('names both versions when the CLI differs from the pinned one', () => {
    const run = prepareBwsRun(['node'], {
      ...readyMachine,
      bwsVersionOutput: () => 'bws 9.9.9\n',
    });

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.error).toContain('9.9.9');
      expect(run.error).toContain(requiredBwsVersion);
    }
  });

  it.each([undefined, ''])('fails clearly when the project ID is %j', (missing) => {
    const run = prepareBwsRun(['node'], { ...readyMachine, readProjectId: () => missing });

    expect(run).toEqual({
      ok: false,
      error: expect.stringContaining('Bitwarden project ID') as string,
    });
  });

  it.each([undefined, ''])('fails clearly when the machine token is %j', (missing) => {
    const run = prepareBwsRun(['node'], { ...readyMachine, readAccessToken: () => missing });

    expect(run).toEqual({
      ok: false,
      error: expect.stringContaining('machine account token') as string,
    });
  });

  it('never decrypts the token when an earlier check fails', () => {
    let tokenReads = 0;
    prepareBwsRun(['node'], {
      ...readyMachine,
      readProjectId: () => undefined,
      readAccessToken: () => {
        tokenReads += 1;
        return accessToken;
      },
    });

    expect(tokenReads).toBe(0);
  });
});
