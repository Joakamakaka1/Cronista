import { apiErrorReplySchema, type Result } from '@cronista/core';

import { supabase } from '../supabase.ts';

/** What a POST to the API returned: its body on success, or an error code. */
export type ApiReply = Result<unknown, string>;

// Waits before each retry while the API cannot check sessions (503 auth_unavailable).
const authRetryDelays = [1000, 2000, 4000] as const;

/**
 * POSTs `body` as JSON to `path` with the player's session.
 *
 * @remarks
 * Every POST carries the session in `X-Session-Token` and the body's SHA-256 in
 * `x-amz-content-sha256`, which CloudFront's origin access control needs to sign it. A 503
 * `auth_unavailable` keeps the session and retries; a 401 ends the session on this device, which
 * returns the player to the sign-in screen. Network failures come back as the `network` code.
 */
export async function postToApi(
  path: string,
  body: unknown,
  { retryAuth = true }: { readonly retryAuth?: boolean } = {},
): Promise<ApiReply> {
  const json = JSON.stringify(body);
  const hash = await sha256Hex(json);

  for (let attempt = 0; ; attempt += 1) {
    const { data } = await supabase.auth.getSession();
    if (data.session === null) return { ok: false, error: 'unauthorized' };

    let response: Response;
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-session-token': data.session.access_token,
          'x-amz-content-sha256': hash,
        },
        body: json,
        cache: 'no-store',
        credentials: 'omit',
      });
    } catch {
      return { ok: false, error: 'network' };
    }

    const reply: unknown = await response.json().catch(() => null);
    if (response.ok) return { ok: true, value: reply };

    const parsed = apiErrorReplySchema.safeParse(reply);
    const error = parsed.success ? parsed.data.error : 'internal';
    const delay = authRetryDelays[attempt];
    if (error === 'auth_unavailable' && retryAuth && delay !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (response.status === 401) await supabase.auth.signOut({ scope: 'local' });
    return { ok: false, error };
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
