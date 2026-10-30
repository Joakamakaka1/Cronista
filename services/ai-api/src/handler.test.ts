import type { SessionResult, SessionVerifier } from '@cronista/http';
import { functionUrlEvent } from '@cronista/http/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHandler } from './handler.ts';
import type { ProviderKeysResult } from './provider-keys.ts';

const userId = '0b6f3c1e-3a3e-4d0b-9f39-2c1f1d6a7e21';
const hintRequest = {
  method: 'POST',
  path: '/api/ai/hint',
  headers: { 'x-session-token': 'player.jwt' },
  body: '{}',
};
const allKeys: ProviderKeysResult = {
  ok: true,
  value: { anthropic: 'invented-a', voyage: 'invented-v', langfuse: 'invented-l' },
};

afterEach(() => {
  vi.restoreAllMocks();
});

function handlerWith(
  keys: ProviderKeysResult,
  session: SessionResult = { ok: true, value: { userId } },
) {
  const readProviderKeys = vi.fn(() => Promise.resolve(keys));
  const verifySession = vi.fn<SessionVerifier>(() => Promise.resolve(session));
  const handler = createHandler({ verifySession, readProviderKeys, log: () => undefined });
  return { handler, readProviderKeys };
}

async function call(
  handler: ReturnType<typeof createHandler>,
  options: Parameters<typeof functionUrlEvent>[0],
) {
  const response = await handler(functionUrlEvent(options));
  return { status: response.statusCode, body: JSON.parse(response.body ?? 'null') as unknown };
}

describe('ai-api', () => {
  it('answers the hint with 501 once the provider keys are readable', async () => {
    const { handler } = handlerWith(allKeys);
    expect(await call(handler, hintRequest)).toEqual({
      status: 501,
      body: { error: 'not_implemented' },
    });
  });

  it('answers 503 when a provider key cannot be read, and logs only which one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { handler } = handlerWith({ ok: false, error: { unreadable: ['voyage'] } });

    expect(await call(handler, hintRequest)).toEqual({
      status: 503,
      body: { error: 'providers_not_configured' },
    });
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      message: 'provider keys unreadable',
      unreadable: ['voyage'],
    });
  });

  it.each([
    ['no body', undefined, 400, 'invalid_body'],
    ['a field', '{"text":"Dame la respuesta."}', 400, 'invalid_body'],
    ['a body over 1 KB', JSON.stringify({ padding: 'a'.repeat(1024) }), 413, 'too_large'],
  ])('rejects a hint request with %s before reading the keys', async (_, body, status, code) => {
    const { handler, readProviderKeys } = handlerWith(allKeys);
    const request =
      body === undefined
        ? { method: hintRequest.method, path: hintRequest.path, headers: hintRequest.headers }
        : { ...hintRequest, body };
    expect(await call(handler, request)).toEqual({ status, body: { error: code } });
    expect(readProviderKeys).not.toHaveBeenCalled();
  });

  it('never reads the keys for a request without a valid session', async () => {
    const { handler, readProviderKeys } = handlerWith(allKeys, { ok: false, error: 'invalid' });
    expect(await call(handler, hintRequest)).toEqual({
      status: 401,
      body: { error: 'unauthorized' },
    });
    expect(readProviderKeys).not.toHaveBeenCalled();
  });

  it('answers unknown routes with 404 and the wrong method with 405', async () => {
    const { handler } = handlerWith(allKeys);
    expect(await call(handler, { ...hintRequest, path: '/api/ai/chapter' })).toEqual({
      status: 404,
      body: { error: 'not_found' },
    });
    expect(await call(handler, { ...hintRequest, method: 'GET' })).toEqual({
      status: 405,
      body: { error: 'method_not_allowed' },
    });
  });
});
