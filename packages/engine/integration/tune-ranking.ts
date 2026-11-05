/**
 * Tunes α, β and γ of the final score on the golden set, against the local Supabase with the cached
 * embeddings: no AI call. α and β are chosen for recall at 10 and MRR; γ is a brake on repeating a joke,
 * so it takes the smallest value that keeps both thresholds. The script prints the grid, best first;
 * the weights are chosen from it and set in RANKING_WEIGHTS by hand.
 *
 * Usage: `pnpm golden:tune`.
 *
 * @packageDocumentation
 */
import { RANKING_WEIGHTS, type RankingWeights } from '@cronista/memory-tools';

import { scoreGoldenSet, seedGoldenSeason } from './golden.ts';

const season = await seedGoldenSeason();

const rows: {
  readonly weights: RankingWeights;
  readonly recallAt10: number;
  readonly mrr: number;
}[] = [];
for (const importance of [0, 0.001, 0.0025, 0.005, 0.01]) {
  for (const recency of [0, 0.0025, 0.004, 0.005, 0.006, 0.01]) {
    for (const jokeUse of [0, 0.0025, 0.005, 0.01, 0.02]) {
      const weights = { ...RANKING_WEIGHTS, importance, recency, jokeUse };
      const { recallAt10, mrr } = await scoreGoldenSet(season, weights);
      rows.push({ weights, recallAt10, mrr });
    }
  }
}

rows.sort((first, second) => second.mrr + second.recallAt10 - (first.mrr + first.recallAt10));
console.log('importance  recency  jokeUse  recall@10  MRR');
for (const { weights, recallAt10, mrr } of rows.slice(0, 20)) {
  console.log(
    [weights.importance, weights.recency, weights.jokeUse, recallAt10, mrr]
      .map((value) => value.toFixed(4).padStart(9))
      .join('  '),
  );
}
const current = await scoreGoldenSet(season);
console.log(
  `\nCurrent weights: recall@10 ${current.recallAt10.toFixed(4)}, MRR ${current.mrr.toFixed(4)}, misses ${current.misses.join(', ') || 'none'}`,
);
