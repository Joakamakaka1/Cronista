import { z } from 'zod';

const rejected = <Code extends string>(codes: readonly [Code, ...Code[]]) =>
  z.object({ ok: z.literal(false), error: z.enum(codes) });

/** What `create_season` answers. */
export const createSeasonReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), season_id: z.number() }),
  rejected([
    'invalid_dates',
    'season_number_taken',
    'dates_overlap',
    'no_characters',
    'unknown_player',
    'invalid_characters',
  ]),
]);

/** Why a season was not created. */
export type CreateSeasonRejection = Extract<
  z.infer<typeof createSeasonReplySchema>,
  { ok: false }
>['error'];

/** What `open_game_day` answers. */
export const openGameDayReplySchema = z.object({
  ok: z.literal(true),
  game_day_id: z.number(),
  opened: z.boolean(),
});

/** What `submit_action` answers. */
export const submitActionReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), action_id: z.number() }),
  rejected([
    'no_character',
    'day_not_open',
    'day_closed',
    'action_already_sent',
    'stake_out_of_range',
  ]),
]);

/** Why an action was not stored. Each one reaches the player as its own error code. */
export type SubmitActionRejection = Extract<
  z.infer<typeof submitActionReplySchema>,
  { ok: false }
>['error'];

/** What `store_hint` answers: the hint stored, which may be an earlier request's. */
export const storeHintReplySchema = z.object({
  ok: z.literal(true),
  text: z.string(),
  censored: z.boolean(),
});

/** What `begin_close` answers. */
export const beginCloseReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), status: z.enum(['closing', 'already_published']) }),
  rejected(['no_open_day']),
]);

/** What `postpone_chapter` answers: whether this call is the one that postponed it. */
export const postponeChapterReplySchema = z.object({ ok: z.literal(true), first: z.boolean() });

/** What `spend_by_workspace` answers: the dollars per workspace. */
export const spendByWorkspaceReplySchema = z.record(z.string(), z.number());

/** The rows of `spend_alerts` a check reads. */
export const spendAlertsReplySchema = z.array(
  z.object({ workspace: z.string(), threshold: z.number() }),
);

/** What `publish_chapter` answers. */
export const publishChapterReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), status: z.enum(['published', 'already_published']) }),
  rejected(['no_open_day', 'resolution_mismatch']),
]);
