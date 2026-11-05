import { describe, expect, it } from 'vitest';

import { scoreGoldenSet, seedGoldenSeason } from './golden.ts';

// narrator.md's thresholds for N1, with the cached embeddings: no Voyage call.
describe('the golden set', () => {
  it('finds what each query should, at recall@10 >= 0.85 and MRR >= 0.60', async () => {
    const score = await scoreGoldenSet(await seedGoldenSeason());

    console.info({ message: 'golden set', ...score });
    expect(score.recallAt10).toBeGreaterThanOrEqual(0.85);
    expect(score.mrr).toBeGreaterThanOrEqual(0.6);
  });
});
