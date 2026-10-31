import { describe, expect, it } from 'vitest';

import {
  anthropicMessageReplySchema,
  providerCheckEventSchema,
  voyageEmbeddingReplySchema,
} from './provider-check.ts';

describe('providerCheckEventSchema', () => {
  it('accepts only the provider check event', () => {
    expect(providerCheckEventSchema.safeParse({ check: 'providers' }).success).toBe(true);
    expect(providerCheckEventSchema.safeParse({ check: 'database' }).success).toBe(false);
    expect(providerCheckEventSchema.safeParse({ check: 'providers', extra: 1 }).success).toBe(
      false,
    );
  });
});

describe('anthropicMessageReplySchema', () => {
  it('keeps only the reply type, never the model text', () => {
    const reply = {
      id: 'msg_invented',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
    };
    expect(anthropicMessageReplySchema.parse(reply)).toEqual({ type: 'message' });
  });

  it('rejects an error reply', () => {
    const reply = { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } };
    expect(anthropicMessageReplySchema.safeParse(reply).success).toBe(false);
  });
});

describe('voyageEmbeddingReplySchema', () => {
  it('accepts a reply with a non-empty vector', () => {
    const reply = {
      object: 'list',
      data: [{ object: 'embedding', embedding: [0.1, -0.2], index: 0 }],
      model: 'voyage-4-lite',
      usage: { total_tokens: 2 },
    };
    expect(voyageEmbeddingReplySchema.safeParse(reply).success).toBe(true);
  });

  it('rejects a reply without vectors or with an empty one', () => {
    expect(voyageEmbeddingReplySchema.safeParse({ data: [] }).success).toBe(false);
    expect(voyageEmbeddingReplySchema.safeParse({ data: [{ embedding: [] }] }).success).toBe(false);
  });
});
