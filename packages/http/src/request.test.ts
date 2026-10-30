import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { readJsonBody, sessionToken } from './request.ts';
import { functionUrlEvent } from './testing.ts';

const noteSchema = z.strictObject({ text: z.string() });

describe('sessionToken', () => {
  it('reads the X-Session-Token header', () => {
    const event = functionUrlEvent({ headers: { 'x-session-token': 'header.payload.signature' } });
    expect(sessionToken(event)).toBe('header.payload.signature');
  });

  it('ignores Authorization, which carries the CloudFront signature', () => {
    const event = functionUrlEvent({
      headers: { authorization: 'Bearer header.payload.signature' },
    });
    expect(sessionToken(event)).toBeUndefined();
  });
});

describe('readJsonBody', () => {
  it('parses a JSON body with the schema', () => {
    const event = functionUrlEvent({ method: 'POST', body: '{"text":"Abro la puerta."}' });
    expect(readJsonBody(event, noteSchema, 8192)).toEqual({
      ok: true,
      value: { text: 'Abro la puerta.' },
    });
  });

  it('decodes a base64 body', () => {
    const body = Buffer.from('{"text":"Señal"}').toString('base64');
    const event = functionUrlEvent({ method: 'POST', body, isBase64Encoded: true });
    expect(readJsonBody(event, noteSchema, 8192)).toEqual({ ok: true, value: { text: 'Señal' } });
  });

  it('measures the limit in UTF-8 bytes, not characters', () => {
    // 6 characters, 7 bytes: "ñ" takes two.
    const event = functionUrlEvent({ method: 'POST', body: '"año!"' });
    expect(readJsonBody(event, z.string(), 6)).toEqual({ ok: false, error: 'too_large' });
    expect(readJsonBody(event, z.string(), 7)).toEqual({ ok: true, value: 'año!' });
  });

  it.each([
    ['no body', undefined],
    ['a body that is not JSON', 'text=hola'],
    ['a body the schema rejects', '{"text":42}'],
  ])('reports %s as invalid', (_, body) => {
    const event = functionUrlEvent({ method: 'POST', ...(body === undefined ? {} : { body }) });
    expect(readJsonBody(event, noteSchema, 8192)).toEqual({ ok: false, error: 'invalid' });
  });
});
