import {
  createLocalJWKSet,
  type CryptoKey,
  errors,
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createSessionVerifier, supabaseSessionVerifier } from './session.ts';

const supabaseUrl = 'https://example.supabase.co';
const issuer = `${supabaseUrl}/auth/v1`;
const userId = '0b6f3c1e-3a3e-4d0b-9f39-2c1f1d6a7e21';

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let publicJwks: JSONWebKeySet;
let keys: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  signingKey = pair.privateKey;
  otherKey = (await generateKeyPair('ES256')).privateKey;
  publicJwks = { keys: [{ ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'current' }] };
  keys = createLocalJWKSet(publicJwks);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface TokenOptions {
  readonly claims?: JWTPayload;
  readonly issuer?: string;
  readonly audience?: string;
  readonly expiresAt?: string | number;
  readonly key?: CryptoKey;
}

// A token shaped like the ones Supabase Auth issues to a signed-in player.
function playerToken(options: TokenOptions = {}): Promise<string> {
  return new SignJWT({ role: 'authenticated', is_anonymous: false, ...options.claims })
    .setProtectedHeader({ alg: 'ES256', kid: 'current', typ: 'JWT' })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? 'authenticated')
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(options.expiresAt ?? '1h')
    .sign(options.key ?? signingKey);
}

describe('createSessionVerifier', () => {
  it('accepts a player token signed with the project key', async () => {
    const verify = createSessionVerifier({ issuer, keys });
    expect(await verify(await playerToken())).toEqual({ ok: true, value: { userId } });
  });

  it.each([undefined, ''])('reports a missing token (%j)', async (token) => {
    const verify = createSessionVerifier({ issuer, keys });
    expect(await verify(token)).toEqual({ ok: false, error: 'missing' });
  });

  it.each<[string, () => Promise<string>]>([
    ['expired', () => playerToken({ expiresAt: Math.floor(Date.now() / 1000) - 60 })],
    ['from another project', () => playerToken({ issuer: 'https://other.supabase.co/auth/v1' })],
    ['for another audience', () => playerToken({ audience: 'anon' })],
    ['signed with another key', () => playerToken({ key: otherKey })],
    ['anonymous', () => playerToken({ claims: { is_anonymous: true } })],
    ['for another role', () => playerToken({ claims: { role: 'service_role' } })],
    [
      'signed with HS256',
      () =>
        new SignJWT({ role: 'authenticated' })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuer(issuer)
          .setAudience('authenticated')
          .setSubject(userId)
          .setExpirationTime('1h')
          .sign(new TextEncoder().encode('a-shared-secret-that-anyone-could-guess')),
    ],
    ['malformed', () => Promise.resolve('not-a-jwt')],
  ])('rejects a token %s', async (_, token) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const verify = createSessionVerifier({ issuer, keys });
    expect(await verify(await token())).toEqual({ ok: false, error: 'invalid' });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['times out', new errors.JWKSTimeout()],
    ['cannot be fetched', new TypeError('fetch failed')],
  ])(
    'reports the key set as unavailable when it %s, and logs only the error class',
    async (_, failure) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const verify = createSessionVerifier({
        issuer,
        keys: () => Promise.reject(failure),
      });
      expect(await verify(await playerToken())).toEqual({ ok: false, error: 'unavailable' });
      expect(warn).toHaveBeenCalledExactlyOnceWith({
        message: 'session key set unreadable',
        error: failure.name,
      });
    },
  );
});

describe('supabaseSessionVerifier', () => {
  it("verifies against the project's issuer and public key set", async () => {
    const fetchJwks = vi.fn((url: URL | string) => {
      expect(String(url)).toBe(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
      return Promise.resolve(Response.json(publicJwks));
    });
    vi.stubGlobal('fetch', fetchJwks);

    const verify = supabaseSessionVerifier(supabaseUrl);
    expect(await verify(await playerToken())).toEqual({ ok: true, value: { userId } });
    expect(fetchJwks).toHaveBeenCalledOnce();
  });
});
