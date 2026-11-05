import {
  type Bible,
  type Memory,
  type MomentDecision,
  NO_MEMORY,
  type Narrator,
  type PastChapter,
  type StoredMoment,
  validateComparison,
  validateMoments,
} from '@cronista/core';
import {
  buildFixedBundle,
  chunkChapter,
  type MemoryStore,
  type MomentToStore,
  type PendingChapter,
  recall,
  RERANK_ENABLED,
  type Voyage,
} from '@cronista/memory-tools';

import { retryingCall } from './retrying-call.ts';
import type { GameStore } from './store.ts';

/** How many earlier moments each new one is compared with. */
export const NEAREST_MOMENTS = 5;

/** The narrator's memory as the engine reaches it: its tables and the embeddings. */
export interface MemoryDependencies {
  readonly store: MemoryStore;
  readonly voyage: Voyage;
}

/** What reading and writing memory needs from the rest of the close. */
interface MemoryContext {
  readonly store: GameStore;
  readonly memory: MemoryDependencies;
}

// -----------------------------------------------------------------------------
// Recalling
// -----------------------------------------------------------------------------

/** What the close knows when it recalls. */
export interface RecallContext {
  readonly seasonId: number;
  readonly day: string;
  /** The season's nicknames, in canon's order. */
  readonly characters: readonly string[];
  /** The chapters the narrator already reads in full. */
  readonly lastChapters: readonly PastChapter[];
  /** Today's situation and real actions. Struck-out actions are never among them. */
  readonly queries: readonly string[];
}

/**
 * What the narrator recalls today: the fixed bundle and the hybrid top-k. Memory never costs a day: a
 * part that cannot be read is left out, and the chapter is written without it.
 */
export async function recallForDay(
  { store, memory }: MemoryContext,
  context: RecallContext,
): Promise<Memory> {
  const fullDays = context.lastChapters.map(({ day }) => day);
  const oldestFull = fullDays.reduce((oldest, day) => (day < oldest ? day : oldest), context.day);

  const [moments, summaries] = await Promise.all([
    memory.store.seasonMoments(context.seasonId, context.day),
    // The chapter just before the full ones, which bridges to them.
    fullDays.length === 0
      ? Promise.resolve({ ok: true as const, value: [] })
      : memory.store.summariesBefore(context.seasonId, oldestFull, 1),
  ]);
  if (!moments.ok || !summaries.ok) {
    console.warn({ message: 'memory not recalled', day: context.day, part: 'bundle' });
    return NO_MEMORY;
  }
  const bundle = buildFixedBundle({
    moments: moments.value,
    characters: context.characters,
    earlierSummary: summaries.value[0] ?? null,
  });

  const inBundle = new Set(
    bundle.characterSheets.flatMap(({ moments: sheet }) => sheet.map(({ text }) => text)),
  );
  const recalled = await recall(
    {
      embedQueries: memory.voyage.embedQueries,
      search: memory.store.hybridSearch,
      rerank: RERANK_ENABLED ? memory.voyage.rerank : undefined,
    },
    {
      seasonId: context.seasonId,
      day: context.day,
      queries: context.queries,
      excludeDays: fullDays,
      excludeIds: moments.value.filter(({ text }) => inBundle.has(text)).map(({ id }) => id),
    },
  );
  await store.recordUsage(recalled.usage, context.day);
  if (!recalled.ok) {
    console.warn({ message: 'memory not recalled', day: context.day, part: recalled.error });
    return { ...bundle, recalled: [] };
  }
  return { ...bundle, recalled: recalled.value.map(({ day, text }) => ({ day, text })) };
}

// -----------------------------------------------------------------------------
// Writing
// -----------------------------------------------------------------------------

/** What writing a chapter's memory needs. */
export interface WriteMemoryContext extends MemoryContext {
  readonly narrator: Pick<Narrator, 'extractMoments' | 'compareMoments'>;
}

/** Why a chapter's memory is still pending. It goes to the logs, never with any text. */
type MemoryFailure =
  | 'store_unavailable'
  | 'chunks_not_embedded'
  | 'chunks_not_stored'
  | `extract_${'refused' | 'invalid' | 'spend_limit' | 'technical'}`
  | 'moments_not_embedded'
  | `compare_${'refused' | 'invalid' | 'spend_limit' | 'technical'}`
  | 'moments_not_stored';

/**
 * Writes the memory of every published chapter of the season up to `day` that is still pending,
 * oldest first: its chunks, then its moments, each compared with its nearest. A failure leaves that
 * chapter pending for the next close, and the chapter stands: it is never undone for memory.
 *
 * @returns How many chapters were written and how many are still pending.
 */
export async function writePendingMemory(
  context: WriteMemoryContext,
  season: { readonly id: number; readonly bible: Bible; readonly characters: readonly string[] },
  day: string,
): Promise<{ readonly written: number; readonly pending: number }> {
  const pending = await context.memory.store.pendingChapters(season.id, day);
  if (!pending.ok) return { written: 0, pending: 0 };

  let written = 0;
  for (const chapter of pending.value) {
    const failure = await writeChapterMemory(context, season, chapter);
    if (failure === undefined) {
      written += 1;
    } else {
      console.warn({ message: 'memory not written', day: chapter.day, reason: failure });
      // Later chapters build on this one's moments, and would supersede what it never wrote.
      break;
    }
  }
  return { written, pending: pending.value.length - written };
}

async function writeChapterMemory(
  { store, memory, narrator }: WriteMemoryContext,
  season: { readonly id: number; readonly bible: Bible; readonly characters: readonly string[] },
  chapter: PendingChapter,
): Promise<MemoryFailure | undefined> {
  const record = (usage: Parameters<GameStore['recordUsage']>[0]) =>
    store.recordUsage(usage, chapter.day);

  // The fallback index first: it needs no model, so it stands even when extraction fails.
  const hasChunks = await memory.store.hasChunks(chapter.gameDayId);
  if (!hasChunks.ok) return 'store_unavailable';
  if (!hasChunks.value) {
    const texts = chunkChapter(chapter.body);
    const embedded = await memory.voyage.embedDocuments(texts);
    await record(embedded.usage);
    if (!embedded.ok) return 'chunks_not_embedded';
    const stored = await memory.store.storeChunks(
      chapter.gameDayId,
      texts.map((text, index) => ({ text, embedding: embedded.value[index] ?? [] })),
    );
    if (!stored.ok) return 'chunks_not_stored';
  }

  const earlier = await memory.store.seasonMoments(season.id, chapter.day);
  if (!earlier.ok) return 'store_unavailable';
  const jokes = [...new Set(earlier.value.flatMap(({ joke }) => (joke === null ? [] : [joke])))];

  const extracted = await retryingCall({
    call: (retry) =>
      narrator.extractMoments({
        bible: season.bible,
        chapter: { day: chapter.day, title: chapter.title, body: chapter.body },
        characters: season.characters,
        jokes,
        retry,
      }),
    record: (result) => record(result.usage),
    softerOnRefusal: true,
  });
  if (extracted.kind !== 'answered') return `extract_${extracted.kind}`;
  const moments = validateMoments(extracted.value.moments, {
    characters: season.characters,
    jokes,
  });

  const embedded = await memory.voyage.embedDocuments(moments.map(({ text }) => text));
  await record(embedded.usage);
  if (!embedded.ok) return 'moments_not_embedded';
  const embeddings = moments.map((_, index) => embedded.value[index] ?? []);

  const nearest: StoredMoment[][] = [];
  for (const embedding of embeddings) {
    const found = await memory.store.nearestMoments(
      season.id,
      embedding,
      chapter.day,
      NEAREST_MOMENTS,
    );
    if (!found.ok) return 'store_unavailable';
    nearest.push(found.value);
  }

  // With nothing to compare against, as on a season's first chapter, every moment is new.
  let decisions: readonly MomentDecision[] = moments.map(() => ({ kind: 'add' }));
  const nearestIds = nearest.map((near) => near.map(({ id }) => id));
  if (nearest.some((near) => near.length > 0)) {
    const compared = await retryingCall({
      call: (retry) =>
        narrator.compareMoments({
          bible: season.bible,
          day: chapter.day,
          moments: moments.map(({ text }, index) => ({ text, nearest: nearest[index] ?? [] })),
          retry,
        }),
      record: (result) => record(result.usage),
      problems: (output) => validateComparison(output, nearestIds).issues,
      // What is missing is added, so an answer that still has issues loses nothing.
      canStand: () => true,
      softerOnRefusal: true,
    });
    if (compared.kind !== 'answered') return `compare_${compared.kind}`;
    const validation = validateComparison(compared.value, nearestIds);
    if (validation.rejectedUpdates > 0) {
      console.warn({
        message: 'moment updates rejected',
        day: chapter.day,
        count: validation.rejectedUpdates,
      });
    }
    decisions = validation.decisions;
  }

  const toStore: MomentToStore[] = moments.flatMap((moment, index) => {
    const decision = decisions[index] ?? { kind: 'add' };
    if (decision.kind === 'noop') return [];
    return [
      {
        ...moment,
        embedding: embeddings[index] ?? [],
        supersedes: decision.kind === 'update' ? decision.target : null,
      },
    ];
  });
  const stored = await memory.store.storeMoments(
    chapter.gameDayId,
    extracted.value.summary,
    toStore,
  );
  if (!stored.ok) return 'moments_not_stored';
  return undefined;
}
