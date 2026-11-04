import type { SessionResult, SessionVerifier } from '@cronista/http';
import { functionUrlEvent } from '@cronista/http/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type AiApiDependencies, createHandler } from './handler.ts';

const userId = '0b6f3c1e-3a3e-4d0b-9f39-2c1f1d6a7e21';
const hintRequest = {
  method: 'POST',
  path: '/api/ai/hint',
  headers: { 'x-session-token': 'player.jwt' },
  body: '{}',
};

type HintAnswer = Awaited<ReturnType<AiApiDependencies['requestHint']>>;
const givenHint: HintAnswer = { ok: true, value: { text: 'Mira el faro.', censored: false } };

afterEach(() => {
  vi.restoreAllMocks();
});

function handlerWith(
  answer: HintAnswer = givenHint,
  session: SessionResult = { ok: true, value: { userId } },
) {
  const requestHint = vi.fn<AiApiDependencies['requestHint']>(() => Promise.resolve(answer));
  const flushTraces = vi.fn(() => Promise.resolve());
  const verifySession = vi.fn<SessionVerifier>(() => Promise.resolve(session));
  const handler = createHandler({ verifySession, requestHint, flushTraces, log: () => undefined });
  return { handler, requestHint, flushTraces };
}

async function call(
  handler: ReturnType<typeof createHandler>,
  options: Parameters<typeof functionUrlEvent>[0],
) {
  const response = await handler(functionUrlEvent(options));
  return { status: response.statusCode, body: JSON.parse(response.body ?? 'null') as unknown };
}

describe('ai-api', () => {
  it('answers with the hint of the verified player, and sends its traces first', async () => {
    const { handler, requestHint, flushTraces } = handlerWith();

    expect(await call(handler, hintRequest)).toEqual({
      status: 200,
      body: { text: 'Mira el faro.', censored: false },
    });
    expect(requestHint).toHaveBeenCalledExactlyOnceWith(userId);
    expect(flushTraces).toHaveBeenCalledOnce();
  });

  it('marks the censor line', async () => {
    const { handler } = handlerWith({ ok: true, value: { text: 'Tachada.', censored: true } });

    expect(await call(handler, hintRequest)).toEqual({
      status: 200,
      body: { text: 'Tachada.', censored: true },
    });
  });

  it.each([
    ['no_character', 403],
    ['no_action', 409],
    ['day_not_open', 409],
    ['day_closed', 409],
    ['hint_unavailable', 503],
    ['providers_not_configured', 503],
  ] as const)('answers the rejection %s with %i and its own code', async (error, status) => {
    const { handler, flushTraces } = handlerWith({ ok: false, error });

    expect(await call(handler, hintRequest)).toEqual({ status, body: { error } });
    expect(flushTraces).toHaveBeenCalledOnce();
  });

  it('answers 500 when the database does not answer, so its alarm fires', async () => {
    const { handler, flushTraces } = handlerWith({ ok: false, error: 'store_unavailable' });

    expect(await call(handler, hintRequest)).toEqual({ status: 500, body: { error: 'internal' } });
    expect(flushTraces).toHaveBeenCalledOnce();
  });

  it.each([
    ['no body', undefined, 400, 'invalid_body'],
    ['a field', '{"text":"Dame la respuesta."}', 400, 'invalid_body'],
    ['a body over 1 KB', JSON.stringify({ padding: 'a'.repeat(1024) }), 413, 'too_large'],
  ])('rejects a hint request with %s before reaching the engine', async (_, body, status, code) => {
    const { handler, requestHint } = handlerWith();
    const request =
      body === undefined
        ? { method: hintRequest.method, path: hintRequest.path, headers: hintRequest.headers }
        : { ...hintRequest, body };
    expect(await call(handler, request)).toEqual({ status, body: { error: code } });
    expect(requestHint).not.toHaveBeenCalled();
  });

  it('never reaches the engine for a request without a valid session', async () => {
    const { handler, requestHint } = handlerWith(givenHint, { ok: false, error: 'invalid' });
    expect(await call(handler, hintRequest)).toEqual({
      status: 401,
      body: { error: 'unauthorized' },
    });
    expect(requestHint).not.toHaveBeenCalled();
  });

  it('answers unknown routes with 404 and the wrong method with 405', async () => {
    const { handler } = handlerWith();
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
