import { describe, expect, it } from 'vitest';

import { sessionClaimsSchema } from './session.ts';

const signedInPlayer = {
  iss: 'https://example.supabase.co/auth/v1',
  aud: 'authenticated',
  sub: '0b6f3c1e-3a3e-4d0b-9f39-2c1f1d6a7e21',
  role: 'authenticated',
  is_anonymous: false,
  email: 'ana@example.com',
};

describe('sessionClaimsSchema', () => {
  it('accepts a signed-in user and keeps only the claims the API relies on', () => {
    expect(sessionClaimsSchema.parse(signedInPlayer)).toEqual({
      sub: signedInPlayer.sub,
      role: 'authenticated',
      is_anonymous: false,
    });
  });

  it('accepts tokens without is_anonymous', () => {
    expect(
      sessionClaimsSchema.safeParse({ ...signedInPlayer, is_anonymous: undefined }).success,
    ).toBe(true);
  });

  it('rejects anonymous sessions', () => {
    expect(sessionClaimsSchema.safeParse({ ...signedInPlayer, is_anonymous: true }).success).toBe(
      false,
    );
  });

  it('rejects any role other than authenticated', () => {
    for (const role of ['anon', 'service_role', undefined]) {
      expect(sessionClaimsSchema.safeParse({ ...signedInPlayer, role }).success).toBe(false);
    }
  });

  it('rejects a subject that is not a user id', () => {
    expect(sessionClaimsSchema.safeParse({ ...signedInPlayer, sub: 'admin' }).success).toBe(false);
  });
});
