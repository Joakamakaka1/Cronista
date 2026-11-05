import type { AiUsage, HybridSearchRow } from '@cronista/core';
import { describe, expect, it, vi } from 'vitest';

import { buildFixedBundle } from './fixed-bundle.ts';
import { chunkChapter } from './chunk-chapter.ts';
import type { HybridSearch, SeasonMoment } from './memory-store.ts';
import { recall } from './recall.ts';

const moment = (id: number, fields: Partial<SeasonMoment> = {}): SeasonMoment => ({
  id,
  day: '2031-01-01',
  text: `Momento ${String(id)}.`,
  characters: [],
  joke: null,
  importance: 3,
  current: true,
  ...fields,
});

describe('buildFixedBundle', () => {
  it('gives each character its 3 most important current moments, newest first on a tie', () => {
    const bundle = buildFixedBundle({
      moments: [
        moment(1, { characters: ['La Farera'], importance: 5 }),
        moment(2, { characters: ['La Farera'], importance: 2, day: '2031-01-03' }),
        moment(3, { characters: ['La Farera', 'El Notario'], importance: 4, day: '2031-01-02' }),
        moment(4, { characters: ['La Farera'], importance: 4, day: '2031-01-03' }),
        moment(5, { characters: ['La Farera'], importance: 5, current: false }),
      ],
      characters: ['La Farera', 'El Notario', 'La Boticaria'],
      earlierSummary: null,
    });
    expect(bundle.characterSheets).toEqual([
      {
        nickname: 'La Farera',
        moments: [
          { day: '2031-01-01', text: 'Momento 1.' },
          { day: '2031-01-03', text: 'Momento 4.' },
          { day: '2031-01-02', text: 'Momento 3.' },
        ],
      },
      { nickname: 'El Notario', moments: [{ day: '2031-01-02', text: 'Momento 3.' }] },
    ]);
  });

  it('gives the 5 jokes told most recently, each with its latest current moment', () => {
    const jokes = ['a', 'b', 'c', 'd', 'e', 'f'].map((joke, index) =>
      moment(10 + index, { joke, day: `2031-01-0${String(index + 1)}` }),
    );
    const bundle = buildFixedBundle({
      moments: [
        ...jokes,
        moment(20, { joke: 'a', day: '2031-01-09', current: false }),
        moment(21, { joke: 'a', day: '2031-01-08' }),
      ],
      characters: [],
      earlierSummary: { day: '2031-01-01', summary: 'Resumen.' },
    });
    expect(bundle.activeJokes.map(({ joke }) => joke)).toEqual(['a', 'f', 'e', 'd', 'c']);
    expect(bundle.activeJokes[0]?.moment).toEqual({ day: '2031-01-08', text: 'Momento 21.' });
    expect(bundle.earlierSummary).toEqual({ day: '2031-01-01', summary: 'Resumen.' });
  });
});

describe('chunkChapter', () => {
  it('keeps whole paragraphs together up to the size of a chunk', () => {
    const paragraph = (words: number) => Array.from({ length: words }, () => 'palabra').join(' ');
    const body = [paragraph(120), paragraph(60), paragraph(100), paragraph(10)].join('\n\n');
    expect(chunkChapter(body).map((chunk) => chunk.split(' ').length)).toEqual([180, 110]);
  });

  it('cuts a paragraph longer than a chunk by words', () => {
    const body = Array.from({ length: 450 }, () => 'x').join(' ');
    expect(chunkChapter(body).map((chunk) => chunk.split(' ').length)).toEqual([200, 200, 50]);
  });
});

const row = (id: number, fields: Partial<HybridSearchRow> = {}): HybridSearchRow => ({
  id,
  day: '2031-01-01',
  content: `Momento ${String(id)}.`,
  characters: [],
  joke: null,
  importance: 3,
  joke_last_day: null,
  vector_rank: 1,
  text_rank: null,
  name_rank: null,
  rrf_score: 0.02,
  ...fields,
});

const usage: AiUsage = {
  workspace: 'dev',
  function: 'embed_query',
  promptVersion: 'none',
  model: 'voyage-4-lite',
  inputTokens: 10,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  latencyMs: 1,
  refusalCategory: null,
};

describe('recall', () => {
  const embedQueries = vi.fn((texts: readonly string[]) =>
    Promise.resolve({ ok: true as const, value: texts.map(() => [0.1]), usage: [usage] }),
  );

  it('searches with each query and keeps each moment once, at its best score', async () => {
    const search = vi.fn((request: HybridSearch) =>
      Promise.resolve({
        ok: true as const,
        value:
          request.source === 'chunks'
            ? []
            : request.query === 'faro'
              ? [row(1, { rrf_score: 0.03 }), row(2, { rrf_score: 0.01 })]
              : [row(2, { rrf_score: 0.05 }), row(3, { rrf_score: 0.001 })],
      }),
    );

    const result = await recall(
      { embedQueries, search },
      {
        seasonId: 7,
        day: '2031-01-05',
        queries: ['faro', 'velas', ' '],
        excludeDays: ['2031-01-04'],
        k: 10,
      },
    );

    expect(result.ok && result.value.map(({ id }) => id)).toEqual([2, 1, 3]);
    expect(embedQueries).toHaveBeenCalledWith(['faro', 'velas']);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ seasonId: 7, source: 'moments', excludeDays: ['2031-01-04'] }),
    );
    expect(result.usage).toEqual([usage]);
  });

  it('fills up to k with chunks only when moments run short, and leaves out what the bundle has', async () => {
    const search = vi.fn((request: HybridSearch) =>
      Promise.resolve({
        ok: true as const,
        value:
          request.source === 'chunks'
            ? [row(1, { content: 'Trozo.' }), row(9, { content: 'Otro trozo.' })]
            : [row(1), row(4)],
      }),
    );

    const result = await recall(
      { embedQueries, search },
      { seasonId: 7, day: '2031-01-05', queries: ['faro'], excludeDays: [], excludeIds: [4], k: 3 },
    );

    expect(result.ok && result.value.map(({ source, id }) => `${source}:${String(id)}`)).toEqual([
      'moments:1',
      'chunks:1',
      'chunks:9',
    ]);
  });

  it('reorders with the reranker only when it is given', async () => {
    const search = vi.fn((request: HybridSearch) =>
      Promise.resolve({
        ok: true as const,
        value: request.source === 'chunks' ? [] : [row(1, { rrf_score: 0.05 }), row(2)],
      }),
    );
    const rerank = vi.fn(() => Promise.resolve({ ok: true as const, value: [1], usage: [] }));

    const result = await recall(
      { embedQueries, search, rerank },
      { seasonId: 7, day: '2031-01-05', queries: ['faro', 'velas'], excludeDays: [], k: 1 },
    );

    expect(rerank).toHaveBeenCalledWith('faro\nvelas', ['Momento 1.', 'Momento 2.'], 1);
    expect(result.ok && result.value.map(({ id }) => id)).toEqual([2]);
  });

  it('fails when the queries cannot be embedded', async () => {
    const failing = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: 'technical' as const, usage: [] }),
    );
    const result = await recall(
      { embedQueries: failing, search: vi.fn() },
      { seasonId: 7, day: '2031-01-05', queries: ['faro'], excludeDays: [] },
    );
    expect(result).toEqual({ ok: false, error: 'embedding_failed', usage: [] });
  });

  it('recalls nothing, and spends nothing, with nothing to ask', async () => {
    const result = await recall(
      { embedQueries, search: vi.fn() },
      { seasonId: 7, day: '2031-01-05', queries: [], excludeDays: [] },
    );
    expect(result).toEqual({ ok: true, value: [], usage: [] });
  });
});
