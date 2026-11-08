import {
  chapterRowSchema,
  characterRowSchema,
  dayRowSchema,
  debtRowSchema,
  hybridSearchReplySchema,
  itemRowSchema,
  seasonMomentRowSchema,
  seasonRowSchema,
  summaryRowSchema,
} from '@cronista/core';
import type { GameReads, MemoryReads, MemoryStoreResult } from '@cronista/memory-tools';
import postgres from 'postgres';
import { z } from 'zod';

/** A Postgres connection that reads only as `memory_reader`. */
export type ReaderSql = postgres.Sql<{ bigint: number; date: string }>;

/** The season the server answers about: the latest one started on or before a day. */
export interface InspectedSeason {
  readonly id: number;
  readonly number: number;
  readonly characters: readonly string[];
}

/** Everything the MCP server reads, as `memory_reader`. */
export interface PostgresReads {
  readonly memory: MemoryReads;
  readonly game: GameReads;
  readonly season: (day: string) => Promise<MemoryStoreResult<InspectedSeason | null>>;
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

  return {
    season: async (day) => {
      const seasons = await read(
        'season',
        z.array(seasonRowSchema),
        (tx) =>
          tx`select id, number, starts_on, ends_on from public.seasons
          where starts_on <= ${day} order by starts_on desc limit 1`,
      );
      if (!seasons.ok) return seasons;
      const [season] = seasons.value;
      if (season === undefined) return { ok: true, value: null };
      const names = await read(
        'characters',
        z.array(z.object({ nickname: z.string() })),
        (tx) =>
          tx`select nickname from public.characters where season_id = ${season.id} order by id`,
      );
      if (!names.ok) return names;
      return {
        ok: true,
        value: {
          id: season.id,
          number: season.number,
          characters: names.value.map(({ nickname }) => nickname),
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
          'season_moments',
          z.array(seasonMomentRowSchema),
          (tx) => tx`select memory.id, game_day.day, memory.content as text, memory.characters,
              memory.joke, memory.importance, memory.superseded_by is null as current
            from public.memories as memory
            join public.game_days as game_day on game_day.id = memory.game_day_id
            where memory.season_id = ${seasonId} and game_day.day < ${day}
            order by memory.id`,
        ),

      chapterSummaries: async (seasonId, { from, before, limit, offset }) => {
        const rows = await read(
          'chapter_summaries',
          z.array(summaryRowSchema),
          (tx) => tx`select game_day.day, chapter.summary, count(*) over () as total
            from public.game_days as game_day
            join public.chapters as chapter on chapter.game_day_id = game_day.id
            where game_day.season_id = ${seasonId}
              and game_day.state = 'published'
              and game_day.day < ${before}
              and (${from}::date is null or game_day.day >= ${from}::date)
              and chapter.summary is not null
            order by game_day.day
            limit ${limit} offset ${offset}`,
        );
        if (!rows.ok) return rows;
        return {
          ok: true,
          value: {
            summaries: rows.value.map(({ day, summary }) => ({ day, summary })),
            total: rows.value[0]?.total ?? 0,
          },
        };
      },
    },

    game: {
      gameState: async (seasonId) => {
        const season = await read(
          'game_season',
          z.array(seasonRowSchema),
          (tx) =>
            tx`select id, number, starts_on, ends_on from public.seasons where id = ${seasonId}`,
        );
        const characters = await read(
          'game_characters',
          z.array(characterRowSchema),
          (tx) => tx`select character.nickname, character.balance,
              coalesce(status.status = 'out', false) as out
            from public.characters as character
            left join public.character_statuses as status
              on status.character_id = character.id
              and status.game_day_id = (
                select latest.game_day_id
                from public.character_statuses as latest
                join public.game_days as game_day on game_day.id = latest.game_day_id
                where game_day.season_id = ${seasonId}
                order by game_day.day desc
                limit 1
              )
            where character.season_id = ${seasonId}
            order by character.id`,
        );
        const items = await read(
          'game_items',
          z.array(itemRowSchema),
          (tx) => tx`select item.name, owner.nickname as owner
            from public.items as item
            join public.characters as owner on owner.id = item.owner_character_id
            where item.season_id = ${seasonId}
            order by item.id`,
        );
        const debts = await read(
          'game_debts',
          z.array(debtRowSchema),
          (tx) => tx`select debtor.nickname as debtor, creditor.nickname as creditor, debt.points
            from public.debts as debt
            join public.characters as debtor on debtor.id = debt.debtor_character_id
            join public.characters as creditor on creditor.id = debt.creditor_character_id
            where debtor.season_id = ${seasonId} and debt.paid_on_day_id is null
            order by debt.id`,
        );
        const days = await read(
          'game_days',
          z.array(dayRowSchema),
          (tx) => tx`select day, state::text as state from public.game_days
            where season_id = ${seasonId} order by day desc limit 14`,
        );
        if (!season.ok || !characters.ok || !items.ok || !debts.ok || !days.ok) return unavailable;
        const [found] = season.value;
        if (found === undefined) return unavailable;
        return {
          ok: true,
          value: {
            season: { number: found.number, startsOn: found.starts_on, endsOn: found.ends_on },
            characters: characters.value,
            items: items.value,
            debts: debts.value,
            days: days.value,
          },
        };
      },

      chapter: async (seasonId, day) => {
        const rows = await read(
          'chapter',
          z.array(chapterRowSchema),
          (tx) => tx`select game_day.day, chapter.title, chapter.body, chapter.summary
            from public.game_days as game_day
            join public.chapters as chapter on chapter.game_day_id = game_day.id
            where game_day.season_id = ${seasonId}
              and game_day.day = ${day}
              and game_day.state = 'published'`,
        );
        if (!rows.ok) return rows;
        return { ok: true, value: rows.value[0] ?? null };
      },
    },
  };
}
