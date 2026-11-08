import type { Result } from '@cronista/core';

/** The database of `supabase start`, whose credentials are the CLI's public defaults. */
export const LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Which database the server reads, and how it connects. */
export interface Target {
  readonly kind: 'local' | 'prod';
  readonly url: string;
}

// The pooler names a role `<role>.<project ref>`; a direct connection names it alone.
const isMemoryReader = (username: string) =>
  username === 'memory_reader' || username.startsWith('memory_reader.');

/**
 * Local Supabase unless `CRONISTA_MCP_TARGET=prod` asks for production, which then needs the URL of
 * the read-only role in `CRONISTA_MCP_DATABASE_URL`. An error never quotes the URL: it holds a password.
 */
export function targetFrom(environment: NodeJS.ProcessEnv): Result<Target, string> {
  const target = environment.CRONISTA_MCP_TARGET ?? 'local';
  if (target === 'local') return { ok: true, value: { kind: 'local', url: LOCAL_DATABASE_URL } };
  if (target !== 'prod') {
    return { ok: false, error: 'CRONISTA_MCP_TARGET must be "local" or "prod".' };
  }
  const url = environment.CRONISTA_MCP_DATABASE_URL;
  if (url === undefined || url === '') {
    return {
      ok: false,
      error: 'Production needs CRONISTA_MCP_DATABASE_URL, the connection string of memory_reader.',
    };
  }
  let username: string;
  try {
    username = decodeURIComponent(new URL(url).username);
  } catch {
    return { ok: false, error: 'CRONISTA_MCP_DATABASE_URL is not a valid connection string.' };
  }
  if (!isMemoryReader(username)) {
    return {
      ok: false,
      error:
        'Production is read only as memory_reader: CRONISTA_MCP_DATABASE_URL names another role.',
    };
  }
  return { ok: true, value: { kind: 'prod', url } };
}
