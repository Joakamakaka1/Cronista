import {
  type AiUsage,
  type Bible,
  MAX_SUMMARY_CHARACTERS,
  type Memory,
  type MomentDecision,
  NO_MEMORY,
  type Narrator,
  type NarratorTool,
  type PastChapter,
  type StoredMoment,
  validateComparison,
  validateMoments,
} from '@cronista/core';
import {
  bindMemoryTools,
  buildFixedBundle,
  chunkChapter,
  type MemoryStore,
  type MomentToStore,
  NARRATOR_MEMORY_TOOLS,
  type PendingChapter,
  recall,
  RERANK_ENABLED,
  type Voyage,
} from '@cronista/memory-tools';

import { memorySkippedAlert, type RaiseAlert } from './alerts.ts';
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
  /** How many chapters it reads in full at most: with fewer, no chapter lies beyond them. */
  readonly fullChapters: number;
  /** Today's situation and real actions, without any already struck out. */
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

  // Every chapter so far is read in full: a search would find nothing. With more, it searches even with
  // no moment beyond them, because the chunks of a chapter left out of memory can still be found.
  if (context.lastChapters.length < context.fullChapters) {
    return { ...bundle, recalled: [] };
  }

  const inBundle = new Set([
    ...bundle.characterSheets.flatMap(({ moments: sheet }) => sheet.map(({ text }) => text)),
    ...bundle.activeJokes.map(({ moment }) => moment.text),
  ]);
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
// The narrator's tools
// -----------------------------------------------------------------------------

/** The memory tools of one day's chapter, and what their searches have spent. */
export interface DayMemoryTools {
  readonly tools: readonly NarratorTool[];
  /** The ledger rows spent since the last call, which it hands over once. */
  readonly takeUsage: () => AiUsage[];
}

/**
 * The narrator's memory tools, bound to today: they read the season before today and leave out the
 * days the narrator already reads in full.
 */
export function memoryToolsForDay(
  memory: MemoryDependencies,
  context: Pick<RecallContext, 'seasonId' | 'day' | 'characters' | 'lastChapters'>,
): DayMemoryTools {
  const spent: AiUsage[] = [];
  const tools = bindMemoryTools(NARRATOR_MEMORY_TOOLS, {
    seasonId: context.seasonId,
    day: context.day,
    characters: context.characters,
    excludeDays: context.lastChapters.map(({ day }) => day),
    reads: memory.store,
    embedQueries: memory.voyage.embedQueries,
    recordUsage: (usage) => {
      spent.push(...usage);
    },
  });
  return { tools, takeUsage: () => spent.splice(0) };
}

// -----------------------------------------------------------------------------
// Writing
// -----------------------------------------------------------------------------

/** What writing a chapter's memory needs. */
export interface WriteMemoryContext extends MemoryContext {
  readonly narrator: Pick<Narrator, 'extractMoments' | 'compareMoments'>;
  readonly alert: RaiseAlert;
}

/** Why a chapter's memory is not written. It goes to the logs, never with any text. */
type MemoryFailure =
  | 'store_unavailable'
  | 'chunks_not_embedded'
  | 'chunks_not_stored'
  | `extract_${'refused' | 'invalid' | 'spend_limit' | 'technical'}`
  | 'moments_not_embedded'
  | `compare_${'spend_limit' | 'technical'}`
  | 'moments_rejected';

// The same answer would come again, so the chapter is left out instead of blocking the ones after it.
const lasting: ReadonlySet<MemoryFailure> = new Set([
  'extract_refused',
  'extract_invalid',
  'moments_rejected',
]);

/** How many pending chapters one close writes after publishing; the next close takes the rest. */
export const MEMORY_CHAPTERS_PER_CLOSE = 3;

/**
 * Writes the memory of the published chapters of the season up to `day` that are still pending,
 * oldest first and `limit` at most: its chunks, then its moments, each compared with its nearest. An
 * outage leaves that chapter pending for the next close; a failure that would only repeat leaves it
 * out of memory, with its chunks, and tells the owner. The chapter stands either way.
 */
export async function writePendingMemory(
  context: WriteMemoryContext,
  season: { readonly id: number; readonly bible: Bible; readonly characters: readonly string[] },
  day: string,
  limit: number = MEMORY_CHAPTERS_PER_CLOSE,
): Promise<void> {
  const pending = await context.memory.store.pendingChapters(season.id, day);
  if (!pending.ok) return;

  for (const chapter of pending.value.slice(0, limit)) {
    const failure = await writeChapterMemory(context, season, chapter);
    if (failure === undefined) continue;
    console.warn({ message: 'memory not written', day: chapter.day, reason: failure });
    if (!lasting.has(failure)) {
      // Later chapters build on this one's moments, and would supersede what it never wrote.
      return;
    }
    // Its opening paragraph stands in for the summary: the chapter's own words, never invented.
    const opening = chapter.body.split(/\n\s*\n/)[0]?.trim() ?? '';
    const skipped = await context.memory.store.storeMoments(
      chapter.gameDayId,
      (opening === '' ? chapter.title : opening).slice(0, MAX_SUMMARY_CHARACTERS),
      [],
    );
    if (!skipped.ok) return;
    await context.alert(memorySkippedAlert(chapter.day, failure));
  }
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

  const found = await Promise.all(
    embeddings.map((embedding) =>
      memory.store.nearestMoments(season.id, embedding, chapter.day, NEAREST_MOMENTS),
    ),
  );
  const nearest: StoredMoment[][] = [];
  for (const near of found) {
    if (!near.ok) return 'store_unavailable';
    nearest.push(near.value);
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
    if (compared.kind === 'answered') {
      const validation = validateComparison(compared.value, nearestIds);
      if (validation.rejectedUpdates > 0) {
        console.warn({
          message: 'moment updates rejected',
          day: chapter.day,
          count: validation.rejectedUpdates,
        });
      }
      decisions = validation.decisions;
    } else if (compared.kind === 'refused') {
      // Adding loses nothing: a repeated moment costs less than a chapter with none.
      console.warn({ message: 'moments compared by none', day: chapter.day });
    } else {
      return compared.kind === 'invalid' ? 'moments_rejected' : `compare_${compared.kind}`;
    }
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
  if (!stored.ok) return stored.error === 'store_unavailable' ? stored.error : 'moments_rejected';
  return undefined;
}
