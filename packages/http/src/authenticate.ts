import type { APIGatewayProxyStructuredResultV2, LambdaFunctionURLEvent } from 'aws-lambda';

import { sessionToken } from './request.ts';
import { jsonResponse } from './response.ts';
import type { Session, SessionVerifier } from './session.ts';

/** The request's session, or the response to send when there is no valid one. */
export type AuthenticationResult =
  | { readonly ok: true; readonly value: Session }
  | { readonly ok: false; readonly error: APIGatewayProxyStructuredResultV2 };

/**
 * Verifies the request's session token. A missing or invalid token gets a 401; an unreadable key set
 * gets a 503, so the client keeps its session and retries.
 */
export async function authenticate(
  event: LambdaFunctionURLEvent,
  verifySession: SessionVerifier,
): Promise<AuthenticationResult> {
  const session = await verifySession(sessionToken(event));
  if (session.ok) return session;
  return session.error === 'unavailable'
    ? { ok: false, error: jsonResponse(503, { error: 'auth_unavailable' }) }
    : { ok: false, error: jsonResponse(401, { error: 'unauthorized' }) };
}
