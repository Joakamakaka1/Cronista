import { EMBEDDING_DIMENSIONS } from '@cronista/core';
import { describe, expect, it, type Mock, vi } from 'vitest';

import { createVoyage } from './voyage.ts';

const vector = (value: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => value);

const embeddingsReply = (count: number, tokens = 30) =>
  Response.json({
    object: 'list',
    data: Array.from({ length: count }, (_, index) => ({
      object: 'embedding',
      index,
      embedding: vector(index + 1),
    })).reverse(),
    model: 'voyage-4',
    usage: { total_tokens: tokens },
  });

const textOf = (init: RequestInit | undefined) => (typeof init?.body === 'string' ? init.body : '');

const bodyOf = (send: Mock<typeof fetch>, call = 0): Record<string, unknown> =>
  JSON.parse(textOf(send.mock.calls[call]?.[1])) as Record<string, unknown>;

describe('createVoyage', () => {
  it('embeds documents with voyage-4 at 1024 dimensions, in input order', async () => {
    const send = vi.fn<typeof fetch>(() => Promise.resolve(embeddingsReply(2, 1_000_000)));
    const voyage = createVoyage({ apiKey: 'invented-key', workspace: 'dev', fetch: send });

    const result = await voyage.embedDocuments(['Uno.', 'Dos.']);

    expect(result.ok && result.value.map((embedding) => embedding[0])).toEqual([1, 2]);
    expect(send).toHaveBeenCalledWith('https://api.voyageai.com/v1/embeddings', expect.anything());
    expect(bodyOf(send)).toEqual({
      model: 'voyage-4',
      input: ['Uno.', 'Dos.'],
      input_type: 'document',
      output_dimension: 1024,
    });
    expect(new Headers(send.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer invented-key',
    );
    expect(result.usage).toEqual([
      expect.objectContaining({
        workspace: 'dev',
        function: 'embed_documents',
        model: 'voyage-4',
        inputTokens: 1_000_000,
        outputTokens: 0,
        costUsd: 0.06,
      }),
    ]);
  });

  it('embeds queries with voyage-4-lite, which shares the space of voyage-4', async () => {
    const send = vi.fn<typeof fetch>(() => Promise.resolve(embeddingsReply(1, 1_000_000)));
    const voyage = createVoyage({ apiKey: 'k', workspace: 'game-prod', fetch: send });

    const result = await voyage.embedQueries(['¿Qué pasó con el faro?']);

    expect(result.ok).toBe(true);
    expect(bodyOf(send)).toMatchObject({ model: 'voyage-4-lite', input_type: 'query' });
    expect(result.usage[0]).toMatchObject({ function: 'embed_query', costUsd: 0.02 });
  });

  it('sends long lists in batches and answers them in one piece', async () => {
    const send = vi.fn<typeof fetch>((_url, init) => {
      const { input } = JSON.parse(textOf(init)) as { input: string[] };
      return Promise.resolve(embeddingsReply(input.length));
    });
    const voyage = createVoyage({ apiKey: 'k', workspace: 'dev', fetch: send });

    const result = await voyage.embedDocuments(
      Array.from({ length: 130 }, (_, i) => `M${String(i)}`),
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(result.ok && result.value).toHaveLength(130);
    expect(result.usage).toHaveLength(2);
  });

  it('answers nothing to embed without calling', async () => {
    const send = vi.fn<typeof fetch>();
    const voyage = createVoyage({ apiKey: 'k', workspace: 'dev', fetch: send });
    expect(await voyage.embedQueries([])).toEqual({ ok: true, value: [], usage: [] });
    expect(send).not.toHaveBeenCalled();
  });

  it('retries a busy or failing service once, then fails without quoting it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const send = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('Your text: secreto del jugador', { status: 503 })),
    );
    const voyage = createVoyage({ apiKey: 'k', workspace: 'dev', fetch: send });

    const result = await voyage.embedDocuments(['secreto del jugador']);

    expect(result).toEqual({ ok: false, error: 'technical', usage: [] });
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secreto');
    warn.mockRestore();
  });

  it('waits out a rate limit as long as the reply asks, and then answers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const waits: number[] = [];
    let calls = 0;
    const send = vi.fn<typeof fetch>(() => {
      calls += 1;
      return Promise.resolve(
        calls < 3
          ? new Response('', { status: 429, headers: { 'retry-after': '7' } })
          : embeddingsReply(1),
      );
    });
    const voyage = createVoyage({
      apiKey: 'k',
      workspace: 'dev',
      fetch: send,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });

    const result = await voyage.embedQueries(['faro']);

    expect(result.ok).toBe(true);
    expect(waits).toEqual([7000, 7000]);
  });

  it('gives up on a rate limit that lasts, without waiting past a minute', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const waits: number[] = [];
    const send = vi.fn<typeof fetch>(() => Promise.resolve(new Response('', { status: 429 })));
    const voyage = createVoyage({
      apiKey: 'k',
      workspace: 'dev',
      fetch: send,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });

    const result = await voyage.embedQueries(['faro']);

    expect(result.ok).toBe(false);
    expect(waits.reduce((total, wait) => total + wait, 0)).toBeLessThanOrEqual(60_000);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('fails on a reply that is not one vector per input', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const send = vi.fn<typeof fetch>(() => Promise.resolve(embeddingsReply(1)));
    const voyage = createVoyage({ apiKey: 'k', workspace: 'dev', fetch: send });

    expect((await voyage.embedDocuments(['Uno.', 'Dos.'])).ok).toBe(false);
  });

  it('reranks with rerank-2.5-lite, answering the documents by relevance', async () => {
    const send = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          object: 'list',
          data: [
            { index: 2, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.4 },
          ],
          model: 'rerank-2.5-lite',
          usage: { total_tokens: 500_000 },
        }),
      ),
    );
    const voyage = createVoyage({ apiKey: 'k', workspace: 'dev', fetch: send });

    const result = await voyage.rerank('faro', ['a', 'b', 'c'], 2);

    expect(result.ok && result.value).toEqual([2, 0]);
    expect(send).toHaveBeenCalledWith('https://api.voyageai.com/v1/rerank', expect.anything());
    expect(bodyOf(send)).toEqual({
      model: 'rerank-2.5-lite',
      query: 'faro',
      documents: ['a', 'b', 'c'],
      top_k: 2,
    });
    expect(result.usage[0]).toMatchObject({ function: 'rerank', costUsd: 0.01 });
  });
});
