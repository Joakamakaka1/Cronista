import {
  type AiUsage,
  beginCloseReplySchema,
  createSeasonReplySchema,
  type CreateSeasonRejection,
  type Hint,
  openGameDayReplySchema,
  publishChapterReplySchema,
  type Result,
  storeHintReplySchema,
  submitActionReplySchema,
  type SubmitActionRejection,
} from '@cronista/core';
import type { Database } from '@cronista/db';
import { PostgrestClient } from '@supabase/postgrest-js';
import type { z } from 'zod';

/** The store could not answer: an outage, not a rule of the game. */
export type StoreFailure = 'store_unavailable';

/** What a store read answers. */
export type StoreResult<Value> = Result<Value, StoreFailure>;

/** A season as the engine reads it. */
export interface StoredSeason {
  readonly id: number;
  readonly number: number;
  readonly startsOn: string;
  readonly endsOn: string | null;
}

/** A character as the engine reads it. */
export interface StoredCharacter {
  readonly id: number;
  readonly nickname: string;
  readonly balance: number;
}

/** A game day as the engine reads it. */
export interface StoredGameDay {
  readonly id: number;
  readonly day: string;
  readonly state: Database['public']['Enums']['game_day_state'];
  readonly situation: string;
  readonly closedAt: string | null;
}

/** An action that is not struck out, with the nickname and text the narrator may see. */
export interface StoredAction {
  readonly id: number;
  readonly characterId: number;
  readonly origin: Database['public']['Enums']['action_origin'];
  /** Empty for autopilot. */
  readonly text: string | null;
}

/** A published chapter of a season. */
export interface StoredChapter {
  readonly day: string;
  readonly title: string;
  readonly body: string;
}

/** A season to create: real nicknames in production, invented data locally. */
export interface NewSeason {
  readonly number: number;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly characters: readonly { readonly email: string; readonly nickname: string }[];
}

/** The game's database, as the engine needs it. */
export interface GameStore {
  readonly createSeason: (
    season: NewSeason,
  ) => Promise<Result<number, StoreFailure | CreateSeasonRejection>>;
  /** The most recently started season on `day`, ended or not. */
  readonly latestStartedSeason: (day: string) => Promise<StoreResult<StoredSeason | undefined>>;
  readonly characters: (seasonId: number) => Promise<StoreResult<readonly StoredCharacter[]>>;
  /** The character of the player signed in as `userId` in a season. */
  readonly characterOfUser: (
    userId: string,
    seasonId: number,
  ) => Promise<StoreResult<StoredCharacter | undefined>>;
  readonly gameDay: (
    seasonId: number,
    day: string,
  ) => Promise<StoreResult<StoredGameDay | undefined>>;
  /** Whether a day before `day` has no published chapter: canon never advances over one. */
  readonly hasUnresolvedDayBefore: (seasonId: number, day: string) => Promise<StoreResult<boolean>>;
  /** The latest published chapters before `day`, oldest first. */
  readonly lastChapters: (
    seasonId: number,
    day: string,
    count: number,
  ) => Promise<StoreResult<readonly StoredChapter[]>>;
  readonly openGameDay: (
    seasonId: number,
    day: string,
    situation: string,
  ) => Promise<StoreResult<{ readonly gameDayId: number; readonly opened: boolean }>>;
  readonly submitAction: (
    gameDayId: number,
    characterId: number,
    text: string,
    stake: number,
  ) => Promise<Result<number, StoreFailure | SubmitActionRejection>>;
  /** The day's actions, struck-out ones left out: they never reach the model again. */
  readonly actions: (gameDayId: number) => Promise<StoreResult<readonly StoredAction[]>>;
  readonly hint: (gameDayId: number, characterId: number) => Promise<StoreResult<Hint | undefined>>;
  readonly storeHint: (
    gameDayId: number,
    characterId: number,
    hint: Hint,
  ) => Promise<StoreResult<Hint>>;
  readonly beginClose: (
    gameDayId: number,
  ) => Promise<Result<'closing' | 'already_published', StoreFailure | 'no_open_day'>>;
  readonly postponeChapter: (gameDayId: number) => Promise<StoreResult<void>>;
  readonly publishChapter: (
    gameDayId: number,
    chapter: { readonly title: string; readonly body: string },
    awards: readonly { readonly actionId: number; readonly points: number }[],
  ) => Promise<
    Result<'published' | 'already_published', StoreFailure | 'no_open_day' | 'resolution_mismatch'>
  >;
  /** Writes one ledger row per model response. A failure is logged: spend is never worth a day. */
  readonly recordUsage: (usage: readonly AiUsage[], day: string) => Promise<void>;
}

/** What {@link createGameStore} needs. */
export interface GameStoreOptions {
  /** The project URL, with no trailing slash. */
  readonly url: string;
  /** The Supabase secret key, which acts as `service_role`. */
  readonly secretKey: string;
  /** Replaces the global `fetch` in tests. */
  readonly fetch?: typeof fetch;
}

// Long enough for a project that is waking up, and short against core-api's 10 s timeout.
const requestTimeoutMs = 8000;

const unavailable = { ok: false, error: 'store_unavailable' } as const;

/**
 * Creates the store over the Data API, as `service_role`. It has no write of its own except the
 * ledger: every other change is a SQL function, which holds the guard.
 */
export function createGameStore(options: GameStoreOptions): GameStore {
  const send = options.fetch ?? fetch;
  const client = new PostgrestClient<Database>(`${options.url}/rest/v1`, {
    headers: { apikey: options.secretKey },
    fetch: (input, init) => send(input, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) }),
  });

  // The code and nothing else: PostgREST's messages can quote the data they failed on.
  const failed = (operation: string, code: string): typeof unavailable => {
    console.warn({ message: 'store request failed', operation, code });
    return unavailable;
  };

  const parsedReply = <Schema extends z.ZodType>(
    operation: string,
    schema: Schema,
    reply: { readonly data: unknown; readonly error: { readonly code: string } | null },
  ): StoreResult<z.infer<Schema>> => {
    if (reply.error !== null) return failed(operation, reply.error.code);
    const parsed = schema.safeParse(reply.data);
    return parsed.success ? { ok: true, value: parsed.data } : failed(operation, 'invalid_reply');
  };

  return {
    createSeason: async (season) => {
      const reply = parsedReply(
        'create_season',
        createSeasonReplySchema,
        await client.rpc('create_season', {
          p_number: season.number,
          p_starts_on: season.startsOn,
          ...(season.endsOn === null ? {} : { p_ends_on: season.endsOn }),
          p_characters: season.characters.map(({ email, nickname }) => ({ email, nickname })),
        }),
      );
      if (!reply.ok) return reply;
      return reply.value.ok
        ? { ok: true, value: reply.value.season_id }
        : { ok: false, error: reply.value.error };
    },

    latestStartedSeason: async (day) => {
      const { data, error } = await client
        .from('seasons')
        .select('id, number, starts_on, ends_on')
        .lte('starts_on', day)
        .order('starts_on', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error !== null) return failed('latestStartedSeason', error.code);
      return {
        ok: true,
        value:
          data === null
            ? undefined
            : {
                id: data.id,
                number: data.number,
                startsOn: data.starts_on,
                endsOn: data.ends_on,
              },
      };
    },

    characters: async (seasonId) => {
      const { data, error } = await client
        .from('characters')
        .select('id, nickname, balance')
        .eq('season_id', seasonId)
        .order('id');
      if (error !== null) return failed('characters', error.code);
      return { ok: true, value: data };
    },

    characterOfUser: async (userId, seasonId) => {
      const { data, error } = await client
        .from('characters')
        .select('id, nickname, balance, players!inner(user_id)')
        .eq('season_id', seasonId)
        .eq('players.user_id', userId)
        .maybeSingle();
      if (error !== null) return failed('characterOfUser', error.code);
      return {
        ok: true,
        value:
          data === null
            ? undefined
            : { id: data.id, nickname: data.nickname, balance: data.balance },
      };
    },

    gameDay: async (seasonId, day) => {
      const { data, error } = await client
        .from('game_days')
        .select('id, day, state, situation, closed_at')
        .eq('season_id', seasonId)
        .eq('day', day)
        .maybeSingle();
      if (error !== null) return failed('gameDay', error.code);
      return {
        ok: true,
        value:
          data === null
            ? undefined
            : {
                id: data.id,
                day: data.day,
                state: data.state,
                situation: data.situation,
                closedAt: data.closed_at,
              },
      };
    },

    hasUnresolvedDayBefore: async (seasonId, day) => {
      const { data, error } = await client
        .from('game_days')
        .select('id')
        .eq('season_id', seasonId)
        .lt('day', day)
        .neq('state', 'published')
        .limit(1);
      if (error !== null) return failed('hasUnresolvedDayBefore', error.code);
      return { ok: true, value: data.length > 0 };
    },

    lastChapters: async (seasonId, day, count) => {
      const { data, error } = await client
        .from('game_days')
        .select('day, chapters!inner(title, body)')
        .eq('season_id', seasonId)
        .eq('state', 'published')
        .lt('day', day)
        .order('day', { ascending: false })
        .limit(count);
      if (error !== null) return failed('lastChapters', error.code);
      return {
        ok: true,
        value: data
          .map(({ day: chapterDay, chapters }) => ({
            day: chapterDay,
            title: chapters.title,
            body: chapters.body,
          }))
          .reverse(),
      };
    },

    openGameDay: async (seasonId, day, situation) => {
      const reply = parsedReply(
        'open_game_day',
        openGameDayReplySchema,
        await client.rpc('open_game_day', {
          p_season_id: seasonId,
          p_day: day,
          p_situation: situation,
        }),
      );
      if (!reply.ok) return reply;
      return {
        ok: true,
        value: { gameDayId: reply.value.game_day_id, opened: reply.value.opened },
      };
    },

    submitAction: async (gameDayId, characterId, text, stake) => {
      const reply = parsedReply(
        'submit_action',
        submitActionReplySchema,
        await client.rpc('submit_action', {
          p_game_day_id: gameDayId,
          p_character_id: characterId,
          p_text: text,
          p_stake: stake,
        }),
      );
      if (!reply.ok) return reply;
      return reply.value.ok
        ? { ok: true, value: reply.value.action_id }
        : { ok: false, error: reply.value.error };
    },

    actions: async (gameDayId) => {
      const { data, error } = await client
        .from('actions')
        .select('id, character_id, origin, action_contents(text)')
        .eq('game_day_id', gameDayId)
        .eq('struck_out', false)
        .order('id');
      if (error !== null) return failed('actions', error.code);
      return {
        ok: true,
        value: data.map((action) => ({
          id: action.id,
          characterId: action.character_id,
          origin: action.origin,
          text: action.action_contents?.text ?? null,
        })),
      };
    },

    hint: async (gameDayId, characterId) => {
      const { data, error } = await client
        .from('hints')
        .select('text, censored')
        .eq('game_day_id', gameDayId)
        .eq('character_id', characterId)
        .maybeSingle();
      if (error !== null) return failed('hint', error.code);
      return { ok: true, value: data ?? undefined };
    },

    storeHint: async (gameDayId, characterId, hint) => {
      const reply = parsedReply(
        'store_hint',
        storeHintReplySchema,
        await client.rpc('store_hint', {
          p_game_day_id: gameDayId,
          p_character_id: characterId,
          p_text: hint.text,
          p_censored: hint.censored,
        }),
      );
      if (!reply.ok) return reply;
      return { ok: true, value: { text: reply.value.text, censored: reply.value.censored } };
    },

    beginClose: async (gameDayId) => {
      const reply = parsedReply(
        'begin_close',
        beginCloseReplySchema,
        await client.rpc('begin_close', { p_game_day_id: gameDayId }),
      );
      if (!reply.ok) return reply;
      return reply.value.ok
        ? { ok: true, value: reply.value.status }
        : { ok: false, error: reply.value.error };
    },

    postponeChapter: async (gameDayId) => {
      const { error } = await client.rpc('postpone_chapter', { p_game_day_id: gameDayId });
      if (error !== null) return failed('postpone_chapter', error.code);
      return { ok: true, value: undefined };
    },

    publishChapter: async (gameDayId, chapter, awards) => {
      const reply = parsedReply(
        'publish_chapter',
        publishChapterReplySchema,
        await client.rpc('publish_chapter', {
          p_game_day_id: gameDayId,
          p_title: chapter.title,
          p_body: chapter.body,
          p_awards: awards.map(({ actionId, points }) => ({ action_id: actionId, points })),
        }),
      );
      if (!reply.ok) return reply;
      return reply.value.ok
        ? { ok: true, value: reply.value.status }
        : { ok: false, error: reply.value.error };
    },

    recordUsage: async (usage, day) => {
      if (usage.length === 0) return;
      const { error } = await client.from('ai_usage').insert(
        usage.map((row) => ({
          workspace: row.workspace,
          function_name: row.function,
          prompt_version: row.promptVersion,
          model: row.model,
          input_tokens: row.inputTokens,
          cache_read_tokens: row.cacheReadTokens,
          cache_write_tokens: row.cacheWriteTokens,
          output_tokens: row.outputTokens,
          cost_usd: row.costUsd,
          latency_ms: row.latencyMs,
          refusal_category: row.refusalCategory,
          game_day: day,
        })),
      );
      if (error !== null) failed('recordUsage', error.code);
    },
  };
}
