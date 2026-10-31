import type { ParametersResult } from '@cronista/parameters';
import { describe, expect, it, vi } from 'vitest';

import { createDatabasePing } from './keep-alive.ts';

const supabaseUrl = 'https://invented-ref.supabase.co';
const secretKey: ParametersResult<'supabase'> = {
  ok: true,
  value: { supabase: 'sb_secret_invented' },
};

function pingWith(reply: () => Promise<Response>, key: ParametersResult<'supabase'> = secretKey) {
  const fetch = vi.fn<typeof globalThis.fetch>(() => reply());
  const readSecretKey = vi.fn(() => Promise.resolve(key));
  return { ping: createDatabasePing({ supabaseUrl, readSecretKey, fetch }), fetch, readSecretKey };
}

describe('createDatabasePing', () => {
  it('counts the players with a HEAD request signed by the secret key, which returns no rows', async () => {
    const { ping, fetch } = pingWith(() =>
      Promise.resolve(new Response(null, { status: 200, headers: { 'content-range': '*/5' } })),
    );

    expect(await ping()).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${supabaseUrl}/rest/v1/players?select=id`);
    expect(init?.method).toBe('HEAD');
    expect(new Headers(init?.headers).get('apikey')).toBe('sb_secret_invented');
    expect(new Headers(init?.headers).get('prefer')).toBe('count=exact');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports an unreadable key without calling Supabase', async () => {
    const { ping, fetch } = pingWith(() => Promise.resolve(new Response(null)), {
      ok: false,
      error: { unreadable: ['supabase'] },
    });

    expect(await ping()).toEqual({ ok: false, error: { reason: 'key_unreadable' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports the status when Supabase rejects the request', async () => {
    const { ping } = pingWith(() => Promise.resolve(new Response(null, { status: 401 })));

    expect(await ping()).toEqual({ ok: false, error: { reason: 'rejected', status: 401 } });
  });

  it('reports an unreachable project when the request fails or times out', async () => {
    const { ping } = pingWith(() => Promise.reject(new TypeError('fetch failed')));

    expect(await ping()).toEqual({ ok: false, error: { reason: 'unreachable' } });
  });
});
