import { describe, expect, it } from 'vitest';

import {
  EMBEDDING_DIMENSIONS,
  hybridSearchReplySchema,
  voyageEmbeddingsReplySchema,
} from './memory-replies.ts';

describe('voyageEmbeddingsReplySchema', () => {
  const vector = (length: number) => Array.from({ length }, () => 0.1);

  it('accepts vectors of the dimensions memory stores', () => {
    const reply = {
      object: 'list',
      data: [{ object: 'embedding', index: 0, embedding: vector(EMBEDDING_DIMENSIONS) }],
      model: 'voyage-4',
      usage: { total_tokens: 12 },
    };
    expect(voyageEmbeddingsReplySchema.safeParse(reply).success).toBe(true);
  });

  it('rejects a vector of any other size, which the database would refuse', () => {
    const reply = { data: [{ index: 0, embedding: vector(512) }], usage: { total_tokens: 1 } };
    expect(voyageEmbeddingsReplySchema.safeParse(reply).success).toBe(false);
  });
});

describe('hybridSearchReplySchema', () => {
  it('reads a row with the rank of each list, or none', () => {
    const row = {
      id: 1,
      day: '2031-01-02',
      content: 'Pasó.',
      characters: ['La Farera'],
      joke: null,
      importance: 3,
      joke_last_day: null,
      vector_rank: 1,
      text_rank: null,
      name_rank: 2,
      rrf_score: 0.04,
    };
    expect(hybridSearchReplySchema.parse([row])).toEqual([row]);
  });
});
