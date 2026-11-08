import {
  type ChapterSummary,
  type HybridSearchRow,
  hybridSearchReplySchema,
  nearestMomentsReplySchema,
  type Result,
  storeChapterChunksReplySchema,
  storeMomentsReplySchema,
  type StoredMoment,
} from '@cronista/core';
import type { Database } from '@cronista/db';
import { PostgrestClient } from '@supabase/postgrest-js';
import type { z } from 'zod';

import type { MemoryReads } from './narrator-tools.ts';

/** The store could not answer: an outage, not a rule of memory. */
export type MemoryStoreFailure = 'store_unavailable';

/** What a memory read answers. */
export type MemoryStoreResult<Value> = Result<Value, MemoryStoreFailure>;

/** Where a search looks: atomic moments, or the chunks of whole chapters. */
export type MemorySource = Database['public']['Enums']['memory_source'];

/** One search, as `hybrid_search` runs it. */
export interface HybridSearch {
  readonly seasonId: number;
  readonly query: string;
  readonly embedding: readonly number[];
  readonly count: number;
  readonly source: MemorySource;
  readonly excludeDays: readonly string[];
}

/** A moment of the season, current or superseded, without its embedding. */
export interface SeasonMoment {
  readonly id: number;
  readonly day: string;
  readonly text: string;
  readonly characters: readonly string[];
  readonly joke: string | null;
  readonly importance: number;
  readonly current: boolean;
}

/** A published chapter whose moments have not reached memory yet. */
export interface PendingChapter {
  readonly gameDayId: number;
  readonly day: string;
  readonly title: string;
  readonly body: string;
}

/** A new moment to write, with its embedding and the earlier moment it replaces, if any. */
export interface MomentToStore {
  readonly text: string;
  readonly characters: readonly string[];
  readonly joke: string | null;
  readonly importance: number;
  readonly embedding: readonly number[];
  readonly supersedes: number | null;
}

/** The memory tables, as retrieval and the close need them. */
export interface MemoryStore {
  readonly hybridSearch: (search: HybridSearch) => Promise<MemoryStoreResult<HybridSearchRow[]>>;
  /** The current moments of earlier days closest to an embedding. */
  readonly nearestMoments: (
    seasonId: number,
    embedding: readonly number[],
    beforeDay: string,
    count: number,
  ) => Promise<MemoryStoreResult<StoredMoment[]>>;
  /** Every moment of the season before `day`, oldest first. */
  readonly seasonMoments: (
    seasonId: number,
    day: string,
  ) => Promise<MemoryStoreResult<SeasonMoment[]>>;
  /** The summaries of published chapters before `day`, newest first. */
  readonly summariesBefore: (
    seasonId: number,
    day: string,
    count: number,
  ) => Promise<MemoryStoreResult<ChapterSummary[]>>;
  readonly chapterSummaries: MemoryReads['chapterSummaries'];
  /** Published chapters up to `day` whose moments are pending, oldest first. */
  readonly pendingChapters: (
    seasonId: number,
    day: string,
  ) => Promise<MemoryStoreResult<PendingChapter[]>>;
  readonly hasChunks: (gameDayId: number) => Promise<MemoryStoreResult<boolean>>;
  readonly storeChunks: (
    gameDayId: number,
    chunks: readonly { readonly text: string; readonly embedding: readonly number[] }[],
  ) => Promise<
    Result<'stored' | 'already_stored', MemoryStoreFailure | 'not_published' | 'invalid_chunks'>
  >;
  readonly storeMoments: (
    gameDayId: number,
    summary: string,
    moments: readonly MomentToStore[],
  ) => Promise<
    Result<
      'written' | 'already_written',
      MemoryStoreFailure | 'not_published' | 'invalid_supersedes' | 'invalid_moment'
    >
  >;
}

/** What {@link createMemoryStore} needs. */
export interface MemoryStoreOptions {
  /** The project URL, with no trailing slash. */
  readonly url: string;
  /** The Supabase secret key, which acts as `service_role`. */
  readonly secretKey: string;
  /** Replaces the global `fetch` in tests. */
  readonly fetch?: typeof fetch;
}

const requestTimeoutMs = 8000;

const unavailable = { ok: false, error: 'store_unavailable' } as const;

// Supabase's default cap on the rows of one Data API reply.
const seasonMomentsPage = 1000;

// pgvector reads a vector as its text form.
const vectorText = (embedding: readonly number[]) => JSON.stringify(embedding);

/**
 * Creates the memory store over the Data API, as `service_role`. Moments and chunks are written only
 * through their SQL functions, which hold the guards.
 */
export function createMemoryStore(options: MemoryStoreOptions): MemoryStore {
  const send = options.fetch ?? fetch;
  const client = new PostgrestClient<Database>(`${options.url}/rest/v1`, {
    headers: { apikey: options.secretKey },
    fetch: (input, init) => send(input, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) }),
  });

  // The code and nothing else: PostgREST's messages can quote the data they failed on.
  const failed = (operation: string, code: string): typeof unavailable => {
    console.warn({ message: 'memory request failed', operation, code });
    return unavailable;
  };

  const parsedReply = <Schema extends z.ZodType>(
    operation: string,
    schema: Schema,
    reply: { readonly data: unknown; readonly error: { readonly code: string } | null },
  ): MemoryStoreResult<z.infer<Schema>> => {
    if (reply.error !== null) return failed(operation, reply.error.code);
    const parsed = schema.safeParse(reply.data);
    return parsed.success ? { ok: true, value: parsed.data } : failed(operation, 'invalid_reply');
  };

  return {
    hybridSearch: async (search) =>
      parsedReply(
        'hybrid_search',
        hybridSearchReplySchema,
        await client.rpc('hybrid_search', {
          p_season_id: search.seasonId,
          p_query: search.query,
          p_embedding: vectorText(search.embedding),
          p_match_count: search.count,
          p_source: search.source,
          p_exclude_days: [...search.excludeDays],
        }),
      ),

    nearestMoments: async (seasonId, embedding, beforeDay, count) => {
      const reply = parsedReply(
        'nearest_moments',
        nearestMomentsReplySchema,
        await client.rpc('nearest_moments', {
          p_season_id: seasonId,
          p_embedding: vectorText(embedding),
          p_before_day: beforeDay,
          p_count: count,
        }),
      );
      if (!reply.ok) return reply;
      return {
        ok: true,
        value: reply.value.map(({ id, day, content }) => ({ id, day, text: content })),
      };
    },

    seasonMoments: async (seasonId, day) => {
      const moments: SeasonMoment[] = [];
      // Page by page: the Data API answers 1000 rows at most, and a short page is the last one.
      for (let from = 0; ; from += seasonMomentsPage) {
        const { data, error } = await client
          .from('memories')
          .select('id, content, characters, joke, importance, superseded_by, game_days!inner(day)')
          .eq('season_id', seasonId)
          .lt('game_days.day', day)
          .order('id')
          .range(from, from + seasonMomentsPage - 1);
        if (error !== null) return failed('seasonMoments', error.code);
        for (const moment of data) {
          moments.push({
            id: moment.id,
            day: moment.game_days.day,
            text: moment.content,
            characters: moment.characters,
            joke: moment.joke,
            importance: moment.importance,
            current: moment.superseded_by === null,
          });
        }
        if (data.length < seasonMomentsPage) return { ok: true, value: moments };
      }
    },

    summariesBefore: async (seasonId, day, count) => {
      const { data, error } = await client
        .from('game_days')
        .select('day, chapters!inner(summary)')
        .eq('season_id', seasonId)
        .eq('state', 'published')
        .lt('day', day)
        .order('day', { ascending: false })
        .limit(count);
      if (error !== null) return failed('summariesBefore', error.code);
      return {
        ok: true,
        value: data.flatMap(({ day: chapterDay, chapters }) =>
          chapters.summary === null ? [] : [{ day: chapterDay, summary: chapters.summary }],
        ),
      };
    },

    chapterSummaries: async (seasonId, { from, before, limit, offset }) => {
      let query = client
        .from('game_days')
        .select('day, chapters!inner(summary)', { count: 'exact' })
        .eq('season_id', seasonId)
        .eq('state', 'published')
        .lt('day', before)
        .not('chapters.summary', 'is', null);
      if (from !== null) query = query.gte('day', from);
      const { data, error, count } = await query.order('day').range(offset, offset + limit - 1);
      if (error !== null) return failed('chapterSummaries', error.code);
      return {
        ok: true,
        value: {
          summaries: data.flatMap(({ day: chapterDay, chapters }) =>
            chapters.summary === null ? [] : [{ day: chapterDay, summary: chapters.summary }],
          ),
          total: count ?? 0,
        },
      };
    },

    pendingChapters: async (seasonId, day) => {
      const { data, error } = await client
        .from('game_days')
        .select('id, day, chapters!inner(title, body, moments_written_at)')
        .eq('season_id', seasonId)
        .eq('state', 'published')
        .lte('day', day)
        .is('chapters.moments_written_at', null)
        .order('day');
      if (error !== null) return failed('pendingChapters', error.code);
      return {
        ok: true,
        value: data.map(({ id, day: chapterDay, chapters }) => ({
          gameDayId: id,
          day: chapterDay,
          title: chapters.title,
          body: chapters.body,
        })),
      };
    },

    hasChunks: async (gameDayId) => {
      const { count, error } = await client
        .from('chapter_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('game_day_id', gameDayId);
      if (error !== null) return failed('hasChunks', error.code);
      return { ok: true, value: (count ?? 0) > 0 };
    },

    storeChunks: async (gameDayId, chunks) => {
      const reply = parsedReply(
        'store_chapter_chunks',
        storeChapterChunksReplySchema,
        await client.rpc('store_chapter_chunks', {
          p_game_day_id: gameDayId,
          p_chunks: chunks.map(({ text, embedding }) => ({
            content: text,
            embedding: [...embedding],
          })),
        }),
      );
      if (!reply.ok) return reply;
      return reply.value.ok
        ? { ok: true, value: reply.value.status }
        : { ok: false, error: reply.value.error };
    },

    storeMoments: async (gameDayId, summary, moments) => {
      const reply = parsedReply(
        'store_moments',
        storeMomentsReplySchema,
        await client.rpc('store_moments', {
          p_game_day_id: gameDayId,
          p_summary: summary,
          p_moments: moments.map((moment) => ({
            content: moment.text,
            characters: [...moment.characters],
            joke: moment.joke,
            importance: moment.importance,
            embedding: [...moment.embedding],
            supersedes: moment.supersedes,
          })),
        }),
      );
      if (!reply.ok) return reply;
      return reply.value.ok
        ? { ok: true, value: reply.value.status }
        : { ok: false, error: reply.value.error };
    },
  };
}
