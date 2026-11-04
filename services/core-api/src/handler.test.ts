import type { SessionResult, SessionVerifier } from '@cronista/http';
import { functionUrlEvent } from '@cronista/http/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type CoreApiDependencies, createHandler } from './handler.ts';

const userId = '0b6f3c1e-3a3e-4d0b-9f39-2c1f1d6a7e21';
const token = { 'x-session-token': 'player.jwt' };

afterEach(() => {
  vi.restoreAllMocks();
});

function handlerWith(
  result: SessionResult = { ok: true, value: { userId } },
  submitted: Awaited<ReturnType<CoreApiDependencies['submitAction']>> = {
    ok: true,
    value: { day: '2031-01-01' },
  },
) {
  const verifySession = vi.fn<SessionVerifier>(() => Promise.resolve(result));
  const reportClientError = vi.fn<() => void>();
  const submitAction = vi.fn<CoreApiDependencies['submitAction']>(() => Promise.resolve(submitted));
  return {
    handler: createHandler({
      verifySession,
      reportClientError,
      submitAction,
      log: () => undefined,
    }),
    verifySession,
    reportClientError,
    submitAction,
  };
}

async function call(
  handler: ReturnType<typeof createHandler>,
  options: Parameters<typeof functionUrlEvent>[0],
) {
  const response = await handler(functionUrlEvent(options));
  return { status: response.statusCode, body: JSON.parse(response.body ?? 'null') as unknown };
}

describe('core-api', () => {
  it('answers GET /api/me with the signed-in player', async () => {
    const { handler, verifySession } = handlerWith();
    expect(await call(handler, { path: '/api/me', headers: token })).toEqual({
      status: 200,
      body: { userId },
    });
    expect(verifySession).toHaveBeenCalledWith('player.jwt');
  });

  it.each([
    ['missing', 401, 'unauthorized'],
    ['invalid', 401, 'unauthorized'],
    ['unavailable', 503, 'auth_unavailable'],
  ] as const)('answers a %s session with %i before routing', async (error, status, code) => {
    const { handler } = handlerWith({ ok: false, error });
    for (const path of ['/api/me', '/api/actions', '/api/client-errors', '/api/unknown']) {
      expect(await call(handler, { path, method: 'POST' })).toEqual({
        status,
        body: { error: code },
      });
    }
  });

  it('stores the action for the player of the verified session', async () => {
    const { handler, submitAction } = handlerWith();
    const body = JSON.stringify({ text: ' Escondo el mapa en la bodega. ', stake: 2 });

    expect(
      await call(handler, { method: 'POST', path: '/api/actions', headers: token, body }),
    ).toEqual({ status: 201, body: { day: '2031-01-01' } });
    expect(submitAction).toHaveBeenCalledExactlyOnceWith({
      userId,
      action: { text: 'Escondo el mapa en la bodega.', stake: 2 },
    });
  });

  it.each([
    ['no_character', 403],
    ['day_not_open', 409],
    ['day_closed', 409],
    ['action_already_sent', 409],
    ['stake_out_of_range', 422],
  ] as const)('answers the rejection %s with %i and its own code', async (error, status) => {
    const { handler } = handlerWith(undefined, { ok: false, error });
    const body = JSON.stringify({ text: 'Huyo.', stake: 0 });

    expect(
      await call(handler, { method: 'POST', path: '/api/actions', headers: token, body }),
    ).toEqual({ status, body: { error } });
  });

  it('answers 500 when the database does not answer, so its alarm fires', async () => {
    const { handler } = handlerWith(undefined, { ok: false, error: 'store_unavailable' });
    const body = JSON.stringify({ text: 'Huyo.', stake: 0 });

    expect(
      await call(handler, { method: 'POST', path: '/api/actions', headers: token, body }),
    ).toEqual({ status: 500, body: { error: 'internal' } });
  });

  it('rejects an action with no stake or a negative one before reaching the engine', async () => {
    const { handler, submitAction } = handlerWith();
    for (const action of [{ text: 'Huyo.' }, { text: 'Huyo.', stake: -1 }]) {
      expect(
        await call(handler, {
          method: 'POST',
          path: '/api/actions',
          headers: token,
          body: JSON.stringify(action),
        }),
      ).toEqual({ status: 400, body: { error: 'invalid_body' } });
    }
    expect(submitAction).not.toHaveBeenCalled();
  });

  it('rejects an action over 1000 characters', async () => {
    const { handler } = handlerWith();
    const body = JSON.stringify({ text: 'a'.repeat(1001), stake: 0 });
    expect(
      await call(handler, { method: 'POST', path: '/api/actions', headers: token, body }),
    ).toEqual({ status: 400, body: { error: 'invalid_body' } });
  });

  it('rejects a body over 8 KB before parsing it', async () => {
    const { handler } = handlerWith();
    const body = JSON.stringify({ text: ' '.repeat(8192) });
    expect(
      await call(handler, { method: 'POST', path: '/api/actions', headers: token, body }),
    ).toEqual({ status: 413, body: { error: 'too_large' } });
  });

  describe('POST /api/client-errors', () => {
    const report = {
      type: 'TypeError',
      script: '/check.js',
      line: 48,
      column: 17,
      release: '0.19.0',
    };
    const sendReport = (handler: ReturnType<typeof createHandler>, body: string) =>
      call(handler, { method: 'POST', path: '/api/client-errors', headers: token, body });

    it('answers 204 with no body, and writes one log entry and one metric', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { handler, reportClientError } = handlerWith();

      expect(await sendReport(handler, JSON.stringify(report))).toEqual({
        status: 204,
        body: null,
      });

      // An exact match: the log must hold the report and nothing about the player.
      expect(error).toHaveBeenCalledExactlyOnceWith({ message: 'client error', ...report });
      expect(reportClientError).toHaveBeenCalledOnce();
    });

    it('writes nothing for a request without a session', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { handler, reportClientError } = handlerWith({ ok: false, error: 'missing' });

      expect(await sendReport(handler, JSON.stringify(report))).toEqual({
        status: 401,
        body: { error: 'unauthorized' },
      });

      expect(error).not.toHaveBeenCalled();
      expect(reportClientError).not.toHaveBeenCalled();
    });

    it.each([
      ['a message', { ...report, message: 'texto de un jugador' }],
      ['a page URL', { ...report, url: 'https://cronista.jcvstro.dev/#access_token=secret' }],
      ['a script path with a query', { ...report, script: '/check.js?token=secret' }],
      ['a free-text type', { ...report, type: 'Cannot read properties of undefined' }],
    ])('refuses %s with 400, and writes nothing', async (_, invalid) => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { handler, reportClientError } = handlerWith();

      expect(await sendReport(handler, JSON.stringify(invalid))).toEqual({
        status: 400,
        body: { error: 'invalid_body' },
      });

      expect(error).not.toHaveBeenCalled();
      expect(reportClientError).not.toHaveBeenCalled();
    });

    it('rejects a body over 8 KB before parsing it', async () => {
      const { handler, reportClientError } = handlerWith();

      expect(
        await sendReport(handler, JSON.stringify({ ...report, script: `/${'a'.repeat(8192)}.js` })),
      ).toEqual({ status: 413, body: { error: 'too_large' } });

      expect(reportClientError).not.toHaveBeenCalled();
    });

    it('answers any other method with 405', async () => {
      const { handler } = handlerWith();
      expect(await call(handler, { path: '/api/client-errors', headers: token })).toEqual({
        status: 405,
        body: { error: 'method_not_allowed' },
      });
    });
  });

  it('answers unknown routes with 404 and the wrong method with 405', async () => {
    const { handler } = handlerWith();
    expect(await call(handler, { path: '/api/nope', headers: token })).toEqual({
      status: 404,
      body: { error: 'not_found' },
    });
    expect(await call(handler, { method: 'DELETE', path: '/api/me', headers: token })).toEqual({
      status: 405,
      body: { error: 'method_not_allowed' },
    });
  });
});
