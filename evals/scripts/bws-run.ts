/** The `bws` version this repository pins; `scoop hold` keeps the install from moving. */
export const requiredBwsVersion = '2.1.0';

/** What {@link prepareBwsRun} reads from the machine. */
export interface BwsMachine {
  /** The output of `bws --version`, or `undefined` when the CLI is not on `PATH`. */
  readonly bwsVersionOutput: () => string | undefined;
  readonly readProjectId: () => string | undefined;
  /** Decrypts the machine account token, so it runs only once every other check has passed. */
  readonly readAccessToken: () => string | undefined;
}

/** How to start `bws run`: the token goes in the environment, because arguments are visible. */
export interface BwsRun {
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
}

/** A run ready to start, or the message that says what is missing. */
export type BwsRunPreparation =
  { readonly ok: true; readonly value: BwsRun } | { readonly ok: false; readonly error: string };

const setupGuide = 'See "Local secrets" in docs/development.md.';

/**
 * Checks the CLI, the project ID and the machine token, and builds the `bws run` that wraps a
 * command.
 *
 * @remarks
 * `bws run` joins its arguments into one string for PowerShell, its default shell on Windows, so
 * each part is quoted here. Unquoted, PowerShell reads `@cronista/evals` as a splat. Some arguments
 * cannot be quoted safely, so they are refused and belong in a script: Windows PowerShell drops an
 * empty one and passes double quotes to a native command unescaped, which splits or corrupts the
 * argument, and it reads U+2018 to U+201B as a single quote, which would end the string and run the
 * rest as code in the process that holds the keys.
 *
 * A command that cannot start leaves `$LASTEXITCODE` null, and `exit $null` would report success,
 * so the status falls back to `$?`.
 */
export function prepareBwsRun(command: readonly string[], machine: BwsMachine): BwsRunPreparation {
  const parts = command[0] === '--' ? command.slice(1) : command;
  if (parts.length === 0) {
    return { ok: false, error: 'Usage: pnpm with-secrets <command> [arguments]' };
  }
  if (parts.some((part) => part === '' || /["‘-‛]/.test(part))) {
    return {
      ok: false,
      error:
        'Empty arguments and double or typographic quotes do not survive Windows PowerShell: use a script.',
    };
  }

  const versionOutput = machine.bwsVersionOutput();
  if (versionOutput === undefined) {
    return {
      ok: false,
      error:
        `The bws CLI is not installed: scoop install bitwarden-secrets-manager-cli@${requiredBwsVersion}, ` +
        `then scoop hold bitwarden-secrets-manager-cli. ${setupGuide}`,
    };
  }
  const version = /^bws (\S+)/m.exec(versionOutput)?.[1] ?? 'unknown';
  if (version !== requiredBwsVersion) {
    return {
      ok: false,
      error: `bws ${version} is installed and this repository pins ${requiredBwsVersion}. ${setupGuide}`,
    };
  }

  const projectId = machine.readProjectId();
  if (!projectId) return { ok: false, error: `No Bitwarden project ID. ${setupGuide}` };

  const accessToken = machine.readAccessToken();
  if (!accessToken) {
    return { ok: false, error: `No readable machine account token. ${setupGuide}` };
  }

  const quoted = parts.map((part) => `'${part.replaceAll("'", "''")}'`).join(' ');
  return {
    ok: true,
    value: {
      args: [
        'run',
        '--project-id',
        projectId,
        '--',
        `& ${quoted}; $ok = $?; if ($null -eq $LASTEXITCODE) { exit [int](-not $ok) }; exit $LASTEXITCODE`,
      ],
      // The organization lives on Bitwarden's EU cloud; this saves every machine a `bws config`.
      environment: { BWS_ACCESS_TOKEN: accessToken, BWS_SERVER_URL: 'https://vault.bitwarden.eu' },
    },
  };
}
