import { describe, expect, it, vi } from 'vitest';

import { authenticate } from './authenticate.ts';
import type { SessionVerifier } from './session.ts';
import { functionUrlEvent } from './testing.ts';

const userId = '0b6f3c1e-3a3e-4d0b-9f39-2c1f1d6a7e21';

describe('authenticate', () => {
  it('verifies the X-Session-Token header and returns the session', async () => {
    const verify = vi.fn<SessionVerifier>(() => Promise.resolve({ ok: true, value: { userId } }));
    const event = functionUrlEvent({ headers: { 'x-session-token': 'player.jwt' } });
    expect(await authenticate(event, verify)).toEqual({ ok: true, value: { userId } });
    expect(verify).toHaveBeenCalledWith('player.jwt');
  });

  it.each([
    ['missing', 401, 'unauthorized'],
    ['invalid', 401, 'unauthorized'],
    ['unavailable', 503, 'auth_unavailable'],
  ] as const)('answers a %s session with %i', async (error, status, code) => {
    const result = await authenticate(functionUrlEvent(), () =>
      Promise.resolve({ ok: false, error }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.statusCode).toBe(status);
    expect(JSON.parse(result.error.body ?? '')).toEqual({ error: code });
  });
});
