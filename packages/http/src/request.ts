import type { LambdaFunctionURLEvent } from 'aws-lambda';
import type { z } from 'zod';

/**
 * The session JWT of a request. It travels in `X-Session-Token` because CloudFront's origin access
 * control signs the origin request with `Authorization`.
 */
export function sessionToken(event: LambdaFunctionURLEvent): string | undefined {
  return event.headers['x-session-token'];
}

/** Why a request body was not accepted: over the byte limit, or not JSON the schema accepts. */
export type BodyError = 'too_large' | 'invalid';

/** Outcome of reading a request body. */
export type BodyResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: BodyError };

/** Reads a JSON body of at most `maxBytes` UTF-8 bytes and validates it with `schema`. */
export function readJsonBody<Schema extends z.ZodType>(
  event: LambdaFunctionURLEvent,
  schema: Schema,
  maxBytes: number,
): BodyResult<z.output<Schema>> {
  const bytes = Buffer.from(event.body ?? '', event.isBase64Encoded ? 'base64' : 'utf8');
  if (bytes.byteLength > maxBytes) return { ok: false, error: 'too_large' };

  let json: unknown;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { ok: false, error: 'invalid' };
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: 'invalid' };
}
