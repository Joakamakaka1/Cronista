import { describe, expect, it, vi } from 'vitest';

import { checkLocalKeys } from './local-keys.ts';

const environment = {
  ANTHROPIC_API_KEY: 'fake-anthropic-value',
  VOYAGE_API_KEY: 'fake-voyage-value',
  LANGFUSE_PUBLIC_KEY: 'fake-langfuse-public-value',
  LANGFUSE_SECRET_KEY: 'fake-langfuse-secret-value',
};

const answering = (status: number) =>
  vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status })));

const headersOf = (send: ReturnType<typeof answering>, url: string) => {
  const call = send.mock.calls.find(([target]) => target === url);
  return new Headers(call?.[1]?.headers);
};

describe('checkLocalKeys', () => {
  it('reports ok and sends each key only to its own provider', async () => {
    const send = answering(200);

    const report = await checkLocalKeys(environment, send);

    expect(report).toEqual({ anthropic: 'ok', voyage: 'ok', langfuse: 'ok' });
    expect(headersOf(send, 'https://api.anthropic.com/v1/messages').get('x-api-key')).toBe(
      environment.ANTHROPIC_API_KEY,
    );
    expect(headersOf(send, 'https://api.voyageai.com/v1/embeddings').get('authorization')).toBe(
      `Bearer ${environment.VOYAGE_API_KEY}`,
    );
    expect(
      headersOf(send, 'https://cloud.langfuse.com/api/public/projects').get('authorization'),
    ).toBe(
      `Basic ${btoa(`${environment.LANGFUSE_PUBLIC_KEY}:${environment.LANGFUSE_SECRET_KEY}`)}`,
    );
  });

  it('keeps the Haiku call to a few tokens', async () => {
    const send = answering(200);

    await checkLocalKeys(environment, send);

    const call = send.mock.calls.find(([url]) => url === 'https://api.anthropic.com/v1/messages');
    expect(JSON.parse(call?.[1]?.body as string)).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 16,
    });
  });

  it('names a missing key and makes no call for that provider', async () => {
    const send = answering(200);

    const report = await checkLocalKeys({ ...environment, VOYAGE_API_KEY: undefined }, send);

    expect(report.voyage).toBe('missing VOYAGE_API_KEY');
    expect(report.anthropic).toBe('ok');
    expect(send.mock.calls.map(([url]) => url)).not.toContain(
      'https://api.voyageai.com/v1/embeddings',
    );
  });

  it('treats an empty value as missing', async () => {
    const report = await checkLocalKeys({ ...environment, ANTHROPIC_API_KEY: '' }, answering(200));

    expect(report.anthropic).toBe('missing ANTHROPIC_API_KEY');
  });

  it('needs both halves of the Langfuse pair', async () => {
    const report = await checkLocalKeys(
      { ...environment, LANGFUSE_SECRET_KEY: undefined },
      answering(200),
    );

    expect(report.langfuse).toBe('missing LANGFUSE_SECRET_KEY');
  });

  it('reduces a refused key to its status', async () => {
    const report = await checkLocalKeys(environment, answering(401));

    expect(report).toEqual({ anthropic: 'http_401', voyage: 'http_401', langfuse: 'http_401' });
  });

  it('tells a timeout from a network failure', async () => {
    const timingOut = vi.fn<typeof fetch>(() =>
      Promise.reject(new DOMException('timed out', 'TimeoutError')),
    );
    const failing = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('fetch failed')));

    expect((await checkLocalKeys(environment, timingOut)).anthropic).toBe('timeout');
    expect((await checkLocalKeys(environment, failing)).anthropic).toBe('unreachable');
  });

  it('never carries a value in the report, not even from an error', async () => {
    const leaking = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError(`bad header ${environment.ANTHROPIC_API_KEY}`)),
    );

    const report = JSON.stringify(await checkLocalKeys(environment, leaking));

    for (const value of Object.values(environment)) expect(report).not.toContain(value);
  });
});
