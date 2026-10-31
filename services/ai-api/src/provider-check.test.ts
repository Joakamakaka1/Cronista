import type { ParametersResult } from '@cronista/parameters';
import { describe, expect, it, vi } from 'vitest';

import { createProviderCheck, type ProviderKey } from './provider-check.ts';

const langfuseUrl = 'https://cloud.langfuse.example';
const allKeys: ParametersResult<ProviderKey> = {
  ok: true,
  value: {
    anthropic: 'invented-anthropic-key',
    voyage: 'invented-voyage-key',
    langfuse: 'sk-lf-invented',
    langfusePublic: 'pk-lf-invented',
  },
};

const anthropicReply = () =>
  Response.json({ type: 'message', content: [{ type: 'text', text: 'ok' }] });
const voyageReply = () => Response.json({ data: [{ embedding: [0.1, 0.2] }] });
const langfuseReply = () => Response.json({});

type Replies = Readonly<Record<'anthropic' | 'voyage' | 'langfuse', () => Promise<Response>>>;
const allOk: Replies = {
  anthropic: () => Promise.resolve(anthropicReply()),
  voyage: () => Promise.resolve(voyageReply()),
  langfuse: () => Promise.resolve(langfuseReply()),
};

function checkWith(replies: Partial<Replies> = {}, keys = allKeys) {
  const reply = { ...allOk, ...replies };
  const fetch = vi.fn<typeof globalThis.fetch>((input) => {
    const host = new URL(input instanceof Request ? input.url : input).host;
    if (host === 'api.anthropic.com') return reply.anthropic();
    if (host === 'api.voyageai.com') return reply.voyage();
    return reply.langfuse();
  });
  const readProviderKeys = vi.fn(() => Promise.resolve(keys));
  return { check: createProviderCheck({ readProviderKeys, langfuseUrl, fetch }), fetch };
}

function requestTo(fetch: ReturnType<typeof checkWith>['fetch'], urlStart: string) {
  const call = fetch.mock.calls.find(([input]) =>
    (input instanceof Request ? input.url : input.toString()).startsWith(urlStart),
  );
  const init = call?.[1];
  return {
    headers: new Headers(init?.headers),
    body: JSON.parse(typeof init?.body === 'string' ? init.body : 'null') as unknown,
  };
}

describe('createProviderCheck', () => {
  it('calls Haiku, Voyage and Langfuse with their keys and reports each one ok', async () => {
    const { check, fetch } = checkWith();

    const report = await check();

    expect(report).toMatchObject({
      status: 'checked',
      anthropic: 'ok',
      voyage: 'ok',
      langfuse: 'ok',
    });
    const traceId = report.status === 'checked' ? report.traceId : '';
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);

    const anthropic = requestTo(fetch, 'https://api.anthropic.com/v1/messages');
    expect(anthropic.headers.get('x-api-key')).toBe('invented-anthropic-key');
    expect(anthropic.headers.get('anthropic-version')).toBe('2026-10-21');
    expect(anthropic.body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 16 });

    const voyage = requestTo(fetch, 'https://api.voyageai.com/v1/embeddings');
    expect(voyage.headers.get('authorization')).toBe('Bearer invented-voyage-key');
    expect(voyage.body).toMatchObject({ model: 'voyage-4-lite', input_type: 'query' });

    const langfuse = requestTo(fetch, `${langfuseUrl}/api/public/otel/v1/traces`);
    expect(langfuse.headers.get('authorization')).toBe(
      `Basic ${btoa('pk-lf-invented:sk-lf-invented')}`,
    );
    // The trace the owner looks for in Langfuse is the one the report names.
    expect(JSON.stringify(langfuse.body)).toContain(traceId);
  });

  it('reports an error class per provider, and never a key or the model text', async () => {
    const { check } = checkWith({
      anthropic: () => Promise.resolve(new Response('{}', { status: 401 })),
      voyage: () => Promise.resolve(Response.json({ data: [] })),
      langfuse: () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
    });

    const report = await check();

    expect(report).toMatchObject({
      anthropic: 'http_401',
      voyage: 'invalid_reply',
      langfuse: 'timeout',
    });
    expect(JSON.stringify(report)).not.toMatch(/invented|sk-lf|pk-lf/);
  });

  it('reports a provider it cannot reach', async () => {
    const { check } = checkWith({ voyage: () => Promise.reject(new TypeError('fetch failed')) });
    expect(await check()).toMatchObject({ anthropic: 'ok', voyage: 'unreachable' });
  });

  it('calls no provider when a key cannot be read, and names only which one', async () => {
    const { check, fetch } = checkWith(
      {},
      { ok: false, error: { unreadable: ['langfusePublic'] } },
    );

    expect(await check()).toEqual({ status: 'keys_unreadable', unreadable: ['langfusePublic'] });
    expect(fetch).not.toHaveBeenCalled();
  });
});
