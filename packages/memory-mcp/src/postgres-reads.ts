import {
  chapterRowSchema,
  gameStateReplySchema,
  hybridSearchReplySchema,
  inspectedSeasonRowSchema,
  seasonMomentRowSchema,
  summaryRowSchema,
} from '@cronista/core';
import type { GameReads, MemoryReads, MemoryStoreResult } from '@cronista/memory-tools';
import postgres from 'postgres';
import { z } from 'zod';

/** A Postgres connection that reads only as `memory_reader`. */
export type ReaderSql = postgres.Sql<{ bigint: number; date: string }>;

/** The season the server answers about, and the day of its latest published chapter. */
export interface InspectedSeason {
  readonly id: number;
  readonly number: number;
  readonly lastPublished: string | null;
  readonly characters: readonly string[];
}

/** Everything the MCP server reads, as `memory_reader`. */
export interface PostgresReads {
  readonly memory: MemoryReads;
  readonly game: GameReads;
  /** The season with the latest published chapter, or the latest started when none has one. */
  readonly season: () => Promise<MemoryStoreResult<InspectedSeason | null>>;
}

/**
 * Opens a connection whose every query runs in a read-only transaction as `memory_reader`, so the
 * role's grants and policies hold even where the login is a stronger role, as postgres is locally.
 * Bigints arrive as numbers and dates as text, as the domain's schemas read them.
 */
export function connectReader(url: string): ReaderSql {
  return postgres(url, {
    max: 2,
    idle_timeout: 30,
    connect_timeout: 10,
    // The server speaks MCP on stdout, so Postgres notices go nowhere.
    onnotice: () => undefined,
    types: {
      bigint: { to: 20, from: [20], serialize: String, parse: Number },
      date: { to: 1082, from: [1082], serialize: String, parse: String },
    },
  });
}

const unavailable = { ok: false, error: 'store_unavailable' } as const;

/** Reads memory and game state as `memory_reader`, each read in its own read-only transaction. */
export function createPostgresReads(sql: ReaderSql): PostgresReads {
  const read = async <Schema extends z.ZodType>(
    operation: string,
    schema: Schema,
    query: (tx: postgres.TransactionSql<{ bigint: number; date: string }>) => Promise<unknown>,
  ): Promise<MemoryStoreResult<z.infer<Schema>>> => {
    try {
      const rows = await sql.begin('read only', async (tx) => {
        await tx`set local role memory_reader`;
        return query(tx);
      });
      const parsed = schema.safeParse(rows);
      if (parsed.success) return { ok: true, value: parsed.data };
      console.error(JSON.stringify({ message: 'unexpected rows', operation }));
      return unavailable;
    } catch (error) {
      // The code only: Postgres errors can quote the data they failed on.
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'unknown';
      console.error(JSON.stringify({ message: 'read failed', operation, code }));
      return unavailable;
    }
  };

  // Each read calls one function of `packages/db`, which holds the SQL.
  return {
    season: async () => {
      const rows = await read(
        'inspect_season',
        z.array(inspectedSeasonRowSchema),
        (tx) => tx`select * from public.inspect_season()`,
      );
      if (!rows.ok) return rows;
      const [season] = rows.value;
      if (season === undefined) return { ok: true, value: null };
      return {
        ok: true,
        value: {
          id: season.id,
          number: season.number,
          lastPublished: season.last_published,
          characters: season.characters,
        },
      };
    },

    memory: {
      hybridSearch: (search) =>
        read(
          'hybrid_search',
          hybridSearchReplySchema,
          (tx) => tx`select * from public.hybrid_search(
            ${search.seasonId},
            ${search.query},
            ${JSON.stringify(search.embedding)}::extensions.halfvec(1024),
            ${search.count},
            ${search.source}::public.memory_source,
            ${[...search.excludeDays]}::date[]
          )`,
        ),

      seasonMoments: (seasonId, day) =>
        read(
          'inspect_season_moments',
          z.array(seasonMomentRowSchema),
          (tx) => tx`select * from public.inspect_season_moments(${seasonId}, ${day}::date)`,
        ),

      chapterSummaries: async (seasonId, { from, before, limit, offset }) => {
        const rows = await read(
          'inspect_chapter_summaries',
          z.array(summaryRowSchema),
          (tx) => tx`select * from public.inspect_chapter_summaries(
            ${seasonId}, ${from}::date, ${before}::date, ${limit}, ${offset}
          )`,
        );
        if (!rows.ok) return rows;
        return {
          ok: true,
          value: {
            summaries: rows.value.flatMap(({ day, summary }) =>
              day === null || summary === null ? [] : [{ day, summary }],
            ),
            total: rows.value[0]?.total ?? 0,
          },
        };
      },
    },

    game: {
      gameState: async (seasonId) => {
        const rows = await read(
          'inspect_game_state',
          z.array(z.object({ state: gameStateReplySchema })),
          (tx) => tx`select public.inspect_game_state(${seasonId}) as state`,
        );
        if (!rows.ok) return rows;
        const [found] = rows.value;
        if (found === undefined) return unavailable;
        const { season, characters, items, debts, days } = found.state;
        return {
          ok: true,
          value: {
            season: { number: season.number, startsOn: season.starts_on, endsOn: season.ends_on },
            characters,
            items,
            debts,
            days,
          },
        };
      },

      chapter: async (seasonId, day) => {
        const rows = await read(
          'inspect_chapter',
          z.array(chapterRowSchema),
          (tx) => tx`select * from public.inspect_chapter(${seasonId}, ${day}::date)`,
        );
        if (!rows.ok) return rows;
        return { ok: true, value: rows.value[0] ?? null };
      },
    },
  };
}
