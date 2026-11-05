import type { HybridSearchRow } from '@cronista/core';
import { describe, expect, it } from 'vitest';

import { rankRows, type RankingWeights } from './rank.ts';

const row = (fields: Partial<HybridSearchRow>): HybridSearchRow => ({
  id: 1,
  day: '2031-01-10',
  content: 'Pasó.',
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

const weights: RankingWeights = {
  importance: 0.01,
  recency: 0.01,
  jokeUse: 0.01,
  recencyHalfLifeDays: 7,
  jokeHalfLifeDays: 2,
};

describe('rankRows', () => {
  it('adds importance and recency to the fused score, and explains each part', () => {
    const [ranked] = rankRows([row({ importance: 5, day: '2031-01-10' })], '2031-01-17', weights);
    expect(ranked?.breakdown).toEqual({
      rrf: 0.02,
      importance: 0.01,
      recency: 0.005,
      jokeUse: 0,
      ranks: { vector: 1, text: null, name: null },
    });
    expect(ranked?.score).toBeCloseTo(0.035);
  });

  it('subtracts the recent use of the same joke', () => {
    const [ranked] = rankRows(
      [row({ joke: 'las velas', joke_last_day: '2031-01-15', day: '2031-01-01' })],
      '2031-01-17',
      weights,
    );
    expect(ranked?.breakdown.jokeUse).toBeCloseTo(0.005);
  });

  it('orders by the final score, so an important old moment can beat a slightly better match', () => {
    const ranked = rankRows(
      [
        row({ id: 1, rrf_score: 0.0196, importance: 1, day: '2031-01-01' }),
        row({ id: 2, rrf_score: 0.0192, importance: 5, day: '2031-01-01' }),
      ],
      '2031-01-17',
      weights,
    );
    expect(ranked.map(({ id }) => id)).toEqual([2, 1]);
  });

  it('gives a chunk, which has no importance, none of that part', () => {
    const [ranked] = rankRows([row({ importance: null })], '2031-01-10', weights);
    expect(ranked?.breakdown.importance).toBe(0);
  });
});
