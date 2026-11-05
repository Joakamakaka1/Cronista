import {
  type AiUsage,
  beginCloseReplySchema,
  type Canon,
  type CanonCharacter,
  createSeasonReplySchema,
  type CreateSeasonRejection,
  type Hint,
  openGameDayReplySchema,
  type PastChapter,
  postponeChapterReplySchema,
  publishChapterReplySchema,
  type Result,
  spendAlertsReplySchema,
  spendByWorkspaceReplySchema,
  storeHintReplySchema,
  submitActionReplySchema,
  type SubmitActionRejection,
} from '@cronista/core';
import type { Database } from '@cronista/db';
import { PostgrestClient } from '@supabase/postgrest-js';
import type { z } from 'zod';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

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
  /** What players read while the chapter is postponed. */
  readonly newspaperMessage: string | null;
}

/** An action that is not struck out, with the text the narrator may see. */
export interface StoredAction {
  readonly id: number;
  readonly characterId: number;
  readonly origin: Database['public']['Enums']['action_origin'];
  /** Empty for autopilot. */
  readonly text: string | null;
  /** 0 for autopilot. */
  readonly stake: number;
}

/** Canon as the narrator reads it, with the ids that publishing needs. */
export interface StoredCanon extends Canon {
  readonly characters: readonly (CanonCharacter & { readonly id: number })[];
}

/** What a chapter changes, written as one step with it. */
export interface Publication {
  readonly awards: { actionId: number; points: number }[];
  readonly struckOut: readonly number[];
  readonly charges: {
    actionId: number;
    points: number;
    purpose: 'influence' | 'payment';
    recipientId: number | null;
  }[];
  readonly newItems: { actionId: number; name: string; price: number }[];
  readonly movedItems: { actionId: number; name: string; fromId: number; toId: number }[];
  readonly newDebts: { actionId: number; creditorId: number; points: number }[];
  readonly paidDebts: { actionId: number; debtId: number }[];
  readonly outCharacters: { actionId: number; characterId: number }[];
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
  /** Canon as it stands on `day`: balances, items, open debts and who spends that day out. */
  readonly canon: (seasonId: number, day: string) => Promise<StoreResult<StoredCanon>>;
  /** The character of the player signed in as `userId` in a season. */
  readonly characterOfUser: (
    userId: string,
    seasonId: number,
  ) => Promise<StoreResult<StoredCharacter | undefined>>;
  readonly gameDay: (
    seasonId: number,
    day: string,
  ) => Promise<StoreResult<StoredGameDay | undefined>>;
  /** The earliest day before `day` with no published chapter: canon never advances over one. */
  readonly unresolvedDayBefore: (
    seasonId: number,
    day: string,
  ) => Promise<StoreResult<string | undefined>>;
  /** The latest published chapters before `day`, oldest first. */
  readonly lastChapters: (
    seasonId: number,
    day: string,
    count: number,
  ) => Promise<StoreResult<readonly PastChapter[]>>;
  readonly openGameDay: (
    seasonId: number,
    day: string,
    situation: string,
  ) => Promise<
    Result<
      { readonly gameDayId: number; readonly opened: boolean },
      StoreFailure | 'later_day_open'
    >
  >;
  readonly submitAction: (
    gameDayId: number,
    characterId: number,
    text: string,
    stake: number,
  ) => Promise<Result<number, StoreFailure | SubmitActionRejection>>;
  /** The day's actions, struck-out ones left out: they never reach the model again. */
  readonly actions: (gameDayId: number) => Promise<StoreResult<readonly StoredAction[]>>;
  /** What one character's player wrote that day, if they sent an action that is not struck out. */
  readonly ownActionText: (
    gameDayId: number,
    characterId: number,
  ) => Promise<StoreResult<string | undefined>>;
  readonly hint: (gameDayId: number, characterId: number) => Promise<StoreResult<Hint | undefined>>;
  readonly storeHint: (
    gameDayId: number,
    characterId: number,
    hint: Hint,
  ) => Promise<StoreResult<Hint>>;
  readonly beginClose: (
    gameDayId: number,
  ) => Promise<Result<'closing' | 'already_published', StoreFailure | 'no_open_day'>>;
  /** Answers whether this call is the one that postponed it. */
  readonly postponeChapter: (
    gameDayId: number,
    message: string,
  ) => Promise<StoreResult<{ readonly first: boolean }>>;
  readonly publishChapter: (
    gameDayId: number,
    chapter: { readonly title: string; readonly body: string },
    publication: Publication,
  ) => Promise<
    Result<'published' | 'already_published', StoreFailure | 'no_open_day' | 'resolution_mismatch'>
  >;
  /** Writes one ledger row per model response. A failure is logged: spend is never worth a day. */
  readonly recordUsage: (usage: readonly AiUsage[], day: string) => Promise<void>;
  /** The dollars each workspace has spent since an instant. */
  readonly spendSince: (since: string) => Promise<StoreResult<Readonly<Record<string, number>>>>;
  /** The spend alerts a credit cycle has already raised. */
  readonly spendAlertsSent: (
    cycleStart: string,
  ) => Promise<StoreResult<readonly { readonly workspace: string; readonly threshold: number }[]>>;
  readonly recordSpendAlert: (alert: {
    readonly workspace: string;
    readonly cycleStart: string;
    readonly threshold: number;
  }) => Promise<StoreResult<void>>;
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

// -----------------------------------------------------------------------------
// The store over the Data API
// -----------------------------------------------------------------------------

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

    canon: async (seasonId, day) => {
      const characters = await client
        .from('characters')
        .select('id, nickname, balance')
        .eq('season_id', seasonId)
        .order('id');
      if (characters.error !== null) return failed('canon', characters.error.code);
      const nicknames = new Map(characters.data.map(({ id, nickname }) => [id, nickname]));
      const nicknameOf = (id: number) => nicknames.get(id) ?? '';

      const [items, debts, latest] = await Promise.all([
        client
          .from('items')
          .select('name, owner_character_id')
          .eq('season_id', seasonId)
          .order('id'),
        client
          .from('debts')
          .select('id, debtor_character_id, creditor_character_id, points')
          .in('debtor_character_id', [...nicknames.keys()])
          .is('paid_on_day_id', null)
          .order('id'),
        client
          .from('game_days')
          .select('character_statuses(character_id, status)')
          .eq('season_id', seasonId)
          .eq('state', 'published')
          .lt('day', day)
          .order('day', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (items.error !== null) return failed('canon', items.error.code);
      if (debts.error !== null) return failed('canon', debts.error.code);
      if (latest.error !== null) return failed('canon', latest.error.code);

      // What the latest chapter wrote is where they spend this day.
      const out = new Set(
        latest.data?.character_statuses
          .filter(({ status }) => status === 'out')
          .map(({ character_id }) => character_id),
      );
      return {
        ok: true,
        value: {
          characters: characters.data.map((character) => ({
            ...character,
            out: out.has(character.id),
          })),
          items: items.data.map(({ name, owner_character_id }) => ({
            name,
            owner: nicknameOf(owner_character_id),
          })),
          debts: debts.data.map((debt) => ({
            id: debt.id,
            debtor: nicknameOf(debt.debtor_character_id),
            creditor: nicknameOf(debt.creditor_character_id),
            points: debt.points,
          })),
        },
      };
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
        .select('id, day, state, situation, closed_at, newspaper_message')
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
                newspaperMessage: data.newspaper_message,
              },
      };
    },

    unresolvedDayBefore: async (seasonId, day) => {
      const { data, error } = await client
        .from('game_days')
        .select('day')
        .eq('season_id', seasonId)
        .lt('day', day)
        .neq('state', 'published')
        .order('day')
        .limit(1)
        .maybeSingle();
      if (error !== null) return failed('unresolvedDayBefore', error.code);
      return { ok: true, value: data?.day };
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
      return reply.value.ok
        ? { ok: true, value: { gameDayId: reply.value.game_day_id, opened: reply.value.opened } }
        : { ok: false, error: reply.value.error };
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
        .select('id, character_id, origin, action_contents(text, stake)')
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
          stake: action.action_contents?.stake ?? 0,
        })),
      };
    },

    ownActionText: async (gameDayId, characterId) => {
      const { data, error } = await client
        .from('actions')
        .select('action_contents(text)')
        .eq('game_day_id', gameDayId)
        .eq('character_id', characterId)
        .eq('struck_out', false)
        .maybeSingle();
      if (error !== null) return failed('ownActionText', error.code);
      return { ok: true, value: data?.action_contents?.text };
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

    postponeChapter: async (gameDayId, message) => {
      const reply = parsedReply(
        'postpone_chapter',
        postponeChapterReplySchema,
        await client.rpc('postpone_chapter', { p_game_day_id: gameDayId, p_message: message }),
      );
      return reply.ok ? { ok: true, value: { first: reply.value.first } } : reply;
    },

    publishChapter: async (gameDayId, chapter, publication) => {
      const reply = parsedReply(
        'publish_chapter',
        publishChapterReplySchema,
        await client.rpc('publish_chapter', {
          p_game_day_id: gameDayId,
          p_title: chapter.title,
          p_body: chapter.body,
          p_resolution: {
            awards: publication.awards.map(({ actionId, points }) => ({
              action_id: actionId,
              points,
            })),
            struck_out: [...publication.struckOut],
            charges: publication.charges.map(({ actionId, points, purpose, recipientId }) => ({
              action_id: actionId,
              points,
              purpose,
              recipient_character_id: recipientId,
            })),
            new_items: publication.newItems.map(({ actionId, name, price }) => ({
              action_id: actionId,
              name,
              price,
            })),
            moved_items: publication.movedItems.map(({ actionId, name, fromId, toId }) => ({
              action_id: actionId,
              name,
              from_character_id: fromId,
              to_character_id: toId,
            })),
            new_debts: publication.newDebts.map(({ actionId, creditorId, points }) => ({
              action_id: actionId,
              creditor_character_id: creditorId,
              points,
            })),
            paid_debts: publication.paidDebts.map(({ actionId, debtId }) => ({
              action_id: actionId,
              debt_id: debtId,
            })),
            out_characters: publication.outCharacters.map(({ actionId, characterId }) => ({
              action_id: actionId,
              character_id: characterId,
            })),
          },
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

    spendSince: async (since) =>
      parsedReply(
        'spend_by_workspace',
        spendByWorkspaceReplySchema,
        await client.rpc('spend_by_workspace', { p_since: since }),
      ),

    spendAlertsSent: async (cycleStart) =>
      parsedReply(
        'spendAlertsSent',
        spendAlertsReplySchema,
        await client
          .from('spend_alerts')
          .select('workspace, threshold')
          .eq('cycle_start', cycleStart),
      ),

    recordSpendAlert: async ({ workspace, cycleStart, threshold }) => {
      const { error } = await client
        .from('spend_alerts')
        .upsert(
          { workspace, cycle_start: cycleStart, threshold },
          { onConflict: 'workspace,cycle_start,threshold', ignoreDuplicates: true },
        );
      if (error !== null) return failed('recordSpendAlert', error.code);
      return { ok: true, value: undefined };
    },
  };
}
