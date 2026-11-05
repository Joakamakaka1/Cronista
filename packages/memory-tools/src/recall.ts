import type { AiUsage } from '@cronista/core';

import type { HybridSearch, MemorySource, MemoryStore } from './memory-store.ts';
import { RANKING_WEIGHTS, type RankedMoment, rankRows, type RankingWeights } from './rank.ts';
import type { Voyage } from './voyage.ts';

/** How many moments a recall answers by default: the top-k of `narrator.md`. */
export const RECALL_K = 10;

/** Whether the top-k goes through the reranker: off until the golden set shows a precision problem. */
// Widened, so that code behind the flag type-checks while it is off.
export const RERANK_ENABLED = false as boolean;

/** What {@link recall} needs. */
export interface RecallDependencies {
  readonly embedQueries: Voyage['embedQueries'];
  readonly search: MemoryStore['hybridSearch'];
  /** Reorders the fused top-k; left out, as {@link RERANK_ENABLED} says. */
  readonly rerank?: Voyage['rerank'] | undefined;
  readonly weights?: RankingWeights;
}

/** What to recall, and on which day. */
export interface RecallRequest {
  readonly seasonId: number;
  /** Today: recency counts from it. */
  readonly day: string;
  /** Today's situation and actions, one query each. Struck-out actions are never among them. */
  readonly queries: readonly string[];
  /** Days whose chapters the narrator already reads in full. */
  readonly excludeDays: readonly string[];
  /** Moments the fixed bundle already holds. */
  readonly excludeIds?: readonly number[];
  readonly k?: number;
}

/** A recalled moment, or a chunk of a chapter when moments run short. */
export type RecalledMoment = RankedMoment & { readonly source: MemorySource };

/** What a recall found, or why it found nothing, with the ledger rows of what it spent. */
export type RecallResult = (
  | { readonly ok: true; readonly value: readonly RecalledMoment[] }
  | { readonly ok: false; readonly error: 'embedding_failed' | 'store_unavailable' }
) & { readonly usage: readonly AiUsage[] };

/**
 * Recalls the moments most relevant to today: one hybrid search per query, scored by {@link rankRows},
 * each moment once at its best score. Chunks of whole chapters fill the top-k when moments run short.
 * It is the only way into retrieval, for the close and the golden set alike.
 */
export async function recall(
  dependencies: RecallDependencies,
  request: RecallRequest,
): Promise<RecallResult> {
  const k = request.k ?? RECALL_K;
  const queries = request.queries.map((query) => query.trim()).filter(Boolean);
  if (queries.length === 0) return { ok: true, value: [], usage: [] };

  const embedded = await dependencies.embedQueries(queries);
  const usage: AiUsage[] = [...embedded.usage];
  if (!embedded.ok) return { ok: false, error: 'embedding_failed', usage };

  const excluded = new Set(request.excludeIds);
  const best = async (source: MemorySource) => {
    const searches = await Promise.all(
      queries.map((query, index) =>
        dependencies.search({
          seasonId: request.seasonId,
          query,
          embedding: embedded.value[index] ?? [],
          count: 2 * k,
          source,
          excludeDays: request.excludeDays,
        } satisfies HybridSearch),
      ),
    );
    const byId = new Map<number, RecalledMoment>();
    for (const found of searches) {
      if (!found.ok) return undefined;
      for (const ranked of rankRows(
        found.value,
        request.day,
        dependencies.weights ?? RANKING_WEIGHTS,
      )) {
        if (source === 'moments' && excluded.has(ranked.id)) continue;
        const seen = byId.get(ranked.id);
        if (seen === undefined || ranked.score > seen.score)
          byId.set(ranked.id, { ...ranked, source });
      }
    }
    return [...byId.values()].sort(
      (first, second) => second.score - first.score || first.id - second.id,
    );
  };

  const moments = await best('moments');
  if (moments === undefined) return { ok: false, error: 'store_unavailable', usage };
  let found: readonly RecalledMoment[] = moments;
  if (moments.length < k) {
    const chunks = await best('chunks');
    if (chunks === undefined) return { ok: false, error: 'store_unavailable', usage };
    found = [...moments, ...chunks];
  }

  if (dependencies.rerank !== undefined && found.length > 0) {
    const candidates = found.slice(0, 2 * k);
    const reranked = await dependencies.rerank(
      queries.join('\n'),
      candidates.map(({ text }) => text),
      k,
    );
    usage.push(...reranked.usage);
    // A failed rerank keeps the fused order: it only ever refines it.
    if (reranked.ok) {
      found = reranked.value.flatMap((index) => candidates[index] ?? []);
    }
  }

  return { ok: true, value: found.slice(0, k), usage };
}
