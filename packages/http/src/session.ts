import { sessionClaimsSchema } from '@cronista/core';
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** The signed-in player behind a request. */
export interface Session {
  readonly userId: string;
}

/**
 * Why a session was not accepted: no token, a token that fails verification, or a key set that
 * could not be read (the token may be fine; the client should not sign out).
 */
export type SessionError = 'missing' | 'invalid' | 'unavailable';

/** Outcome of verifying a session token. */
export type SessionResult =
  | { readonly ok: true; readonly value: Session }
  | { readonly ok: false; readonly error: SessionError };

/** Verifies the session JWT a request carries in `X-Session-Token`. */
export type SessionVerifier = (token: string | undefined) => Promise<SessionResult>;

/** Where {@link createSessionVerifier} checks tokens against. */
export interface SessionVerifierOptions {
  /** Expected `iss` claim: the Supabase Auth URL, `<project URL>/auth/v1`. */
  readonly issuer: string;
  /** Public keys that sign the tokens (the project's JWKS). */
  readonly keys: JWTVerifyGetKey;
}

// Failures that say something about the token itself; any other error means the keys were unreadable.
const rejectedTokenErrors = [
  errors.JWTClaimValidationFailed,
  errors.JWTExpired,
  errors.JWTInvalid,
  errors.JWSInvalid,
  errors.JWSSignatureVerificationFailed,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
  errors.JWKSNoMatchingKey,
  errors.JWKSMultipleMatchingKeys,
] as const;

/**
 * Creates a verifier for Supabase session JWTs: ES256 signature, issuer, `authenticated` audience,
 * expiry, and the claims in `sessionClaimsSchema`.
 */
export function createSessionVerifier(options: SessionVerifierOptions): SessionVerifier {
  return async (token) => {
    if (token === undefined || token === '') return { ok: false, error: 'missing' };
    try {
      const { payload } = await jwtVerify(token, options.keys, {
        issuer: options.issuer,
        audience: 'authenticated',
        algorithms: ['ES256'],
        requiredClaims: ['sub', 'exp'],
      });
      const claims = sessionClaimsSchema.safeParse(payload);
      if (!claims.success) return { ok: false, error: 'invalid' };
      return { ok: true, value: { userId: claims.data.sub } };
    } catch (error) {
      if (rejectedTokenErrors.some((type) => error instanceof type)) {
        return { ok: false, error: 'invalid' };
      }
      // Only the class (JWKSTimeout, TypeError...) tells the failures apart; messages may quote data.
      const name = error instanceof Error ? error.name : 'unknown';
      console.warn({ message: 'session key set unreadable', error: name });
      return { ok: false, error: 'unavailable' };
    }
  };
}

/**
 * Verifier for the tokens of the Supabase project at `supabaseUrl`. Its key set is fetched on first
 * use and cached by `jose`, so create it once per Lambda environment, outside the handler.
 */
export function supabaseSessionVerifier(supabaseUrl: string): SessionVerifier {
  return createSessionVerifier({
    issuer: new URL('/auth/v1', supabaseUrl).href,
    keys: createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', supabaseUrl)),
  });
}
