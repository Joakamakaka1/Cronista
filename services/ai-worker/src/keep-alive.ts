import type { ParametersResult } from '@cronista/parameters';

/** Why a ping did not reach the database. */
export type PingError =
  | { readonly reason: 'key_unreadable' }
  | { readonly reason: 'unreachable' }
  | { readonly reason: 'rejected'; readonly status: number };

/** The outcome of one {@link createDatabasePing} call. */
export type PingResult = { readonly ok: true } | { readonly ok: false; readonly error: PingError };

/** What {@link createDatabasePing} needs. */
export interface DatabasePingOptions {
  /** The project URL (`https://<ref>.supabase.co`). */
  readonly supabaseUrl: string;
  /** Reads the Supabase secret key (`sb_secret_…`) from SSM. */
  readonly readSecretKey: () => Promise<ParametersResult<'supabase'>>;
  readonly fetch?: typeof fetch;
}

// Long enough for a project that is waking up, short against the job's timeout.
const pingTimeoutMs = 10_000;

/**
 * Creates the keep-alive ping: one query against the database through the Data API, which Supabase
 * counts as user activity, so the Free plan does not pause the project.
 *
 * @remarks
 * A `HEAD` request with an exact count runs the query but returns no rows, so no player data
 * reaches the Lambda. The key is only sent, never returned or logged.
 */
export function createDatabasePing(options: DatabasePingOptions): () => Promise<PingResult> {
  const fetchDatabase = options.fetch ?? fetch;

  return async () => {
    const key = await options.readSecretKey();
    if (!key.ok) return { ok: false, error: { reason: 'key_unreadable' } };

    let reply: Response;
    try {
      reply = await fetchDatabase(`${options.supabaseUrl}/rest/v1/players?select=id`, {
        method: 'HEAD',
        headers: { apikey: key.value.supabase, prefer: 'count=exact' },
        signal: AbortSignal.timeout(pingTimeoutMs),
      });
    } catch {
      return { ok: false, error: { reason: 'unreachable' } };
    }
    return reply.ok
      ? { ok: true }
      : { ok: false, error: { reason: 'rejected', status: reply.status } };
  };
}
