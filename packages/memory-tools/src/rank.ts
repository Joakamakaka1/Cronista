import type { HybridSearchRow } from '@cronista/core';

/** How much each signal adds to, or takes from, the fused score of a search. */
export interface RankingWeights {
  /** α: a moment of importance 5 adds all of it, one of importance 1 nothing. */
  readonly importance: number;
  /** β: a moment of today adds all of it, and it halves every `recencyHalfLifeDays`. */
  readonly recency: number;
  /** γ: a joke told today takes all of it, and it halves every `jokeHalfLifeDays`. */
  readonly jokeUse: number;
  readonly recencyHalfLifeDays: number;
  readonly jokeHalfLifeDays: number;
}

/**
 * α, β and γ as the golden set tuned them (`pnpm golden:tune`). RRF at k = 50 tops out at 3/51, about
 * 0.059, so each weight is a share of that scale.
 *
 * @remarks
 * Importance barely helps retrieval on the golden set, and more of it costs MRR, so α only breaks
 * ties: importance does its work in the character sheets. γ is a brake on repeating a joke, not a
 * relevance signal, so it is the smallest that keeps recall at 10 at 1.0 (MRR 0.90).
 */
export const RANKING_WEIGHTS: RankingWeights = {
  importance: 0.001,
  recency: 0.005,
  jokeUse: 0.0025,
  recencyHalfLifeDays: 7,
  jokeHalfLifeDays: 2,
};

/** Why a moment ranked where it did: each part of its score and its rank in each list. */
export interface RankingBreakdown {
  readonly rrf: number;
  readonly importance: number;
  readonly recency: number;
  /** Taken from the score. */
  readonly jokeUse: number;
  readonly ranks: {
    readonly vector: number | null;
    readonly text: number | null;
    readonly name: number | null;
  };
}

/** A search result with its final score. */
export interface RankedMoment {
  readonly id: number;
  readonly day: string;
  readonly text: string;
  readonly characters: readonly string[];
  readonly joke: string | null;
  readonly score: number;
  readonly breakdown: RankingBreakdown;
}

const daysBetween = (earlier: string, later: string) =>
  Math.max(0, (Date.parse(later) - Date.parse(earlier)) / 86_400_000);

const halved = (days: number, halfLife: number) => 0.5 ** (days / halfLife);

/**
 * Scores search rows on `today`: RRF + α · importance + β · recency − γ · recent use of the same joke,
 * best first.
 */
export function rankRows(
  rows: readonly HybridSearchRow[],
  today: string,
  weights: RankingWeights = RANKING_WEIGHTS,
): RankedMoment[] {
  return rows
    .map((row) => {
      const breakdown: RankingBreakdown = {
        rrf: row.rrf_score,
        importance: row.importance === null ? 0 : (weights.importance * (row.importance - 1)) / 4,
        recency: weights.recency * halved(daysBetween(row.day, today), weights.recencyHalfLifeDays),
        jokeUse:
          row.joke_last_day === null
            ? 0
            : weights.jokeUse *
              halved(daysBetween(row.joke_last_day, today), weights.jokeHalfLifeDays),
        ranks: { vector: row.vector_rank, text: row.text_rank, name: row.name_rank },
      };
      return {
        id: row.id,
        day: row.day,
        text: row.content,
        characters: row.characters,
        joke: row.joke,
        score: breakdown.rrf + breakdown.importance + breakdown.recency - breakdown.jokeUse,
        breakdown,
      };
    })
    .sort((first, second) => second.score - first.score || first.id - second.id);
}
