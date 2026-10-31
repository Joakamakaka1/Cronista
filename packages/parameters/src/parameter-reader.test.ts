import { describe, expect, it, vi } from 'vitest';

import { createParameterReader } from './parameter-reader.ts';

const parameterNames = {
  anthropic: '/cronista/prod/anthropic/game-api-key',
  voyage: '/cronista/prod/voyage/api-key',
  langfuse: '/cronista/prod/langfuse/secret-key',
};

// The extension's reply for a parameter that exists, with an invented value.
function storedValue(name: string): Response {
  return Response.json({
    Parameter: { Name: name, Type: 'SecureString', Value: `value-of-${name}` },
  });
}

function readerWith(fetchParameter: (name: string) => Promise<Response>) {
  const fetch = vi.fn((input: string | URL | Request) =>
    fetchParameter(
      new URL(input instanceof Request ? input.url : input).searchParams.get('name') ?? '',
    ),
  );
  const read = createParameterReader({
    parameterNames,
    port: 2773,
    sessionToken: 'lambda-session-token',
    fetch,
  });
  return { read, fetch };
}

describe('createParameterReader', () => {
  it('reads every parameter through the extension, decrypted and authorised by the session token', async () => {
    const { read, fetch } = readerWith((name) => Promise.resolve(storedValue(name)));

    expect(await read()).toEqual({
      ok: true,
      value: {
        anthropic: 'value-of-/cronista/prod/anthropic/game-api-key',
        voyage: 'value-of-/cronista/prod/voyage/api-key',
        langfuse: 'value-of-/cronista/prod/langfuse/secret-key',
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:2773/systemsmanager/parameters/get?name=%2Fcronista%2Fprod%2Fvoyage%2Fapi-key&withDecryption=true',
      expect.objectContaining({
        headers: { 'X-Aws-Parameters-Secrets-Token': 'lambda-session-token' },
      }),
    );
  });

  it('names the keys it could not read, and never their values', async () => {
    const { read } = readerWith((name) => {
      if (name === parameterNames.voyage) return Promise.resolve(new Response('', { status: 400 }));
      if (name === parameterNames.langfuse) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve(storedValue(name));
    });

    const result = await read();
    expect(result).toEqual({ ok: false, error: { unreadable: ['voyage', 'langfuse'] } });
    expect(JSON.stringify(result)).not.toContain('value-of');
  });

  it('treats a reply without a value as unreadable', async () => {
    const { read } = readerWith(() => Promise.resolve(Response.json({ Parameter: {} })));
    expect(await read()).toEqual({
      ok: false,
      error: { unreadable: ['anthropic', 'voyage', 'langfuse'] },
    });
  });
});
