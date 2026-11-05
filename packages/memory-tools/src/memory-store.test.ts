import { describe, expect, it, vi } from 'vitest';

import { createMemoryStore } from './memory-store.ts';

const row = (id: number) => ({
  id,
  content: `Momento ${String(id)}.`,
  characters: [],
  joke: null,
  importance: 3,
  superseded_by: null,
  game_days: { day: '2031-01-01' },
});

describe('seasonMoments', () => {
  it('reads every page, past the 1000 rows the Data API answers at most', async () => {
    const send = vi.fn<typeof fetch>((input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit'));
      const total = 1003;
      const rows = Array.from(
        { length: Math.max(0, Math.min(limit, total - offset)) },
        (_, index) => row(offset + index + 1),
      );
      return Promise.resolve(Response.json(rows));
    });
    const store = createMemoryStore({ url: 'http://127.0.0.1:54321', secretKey: 'k', fetch: send });

    const moments = await store.seasonMoments(1, '2031-02-01');

    expect(moments.ok && moments.value.length).toBe(1003);
    expect(moments.ok && moments.value.at(-1)?.id).toBe(1003);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
