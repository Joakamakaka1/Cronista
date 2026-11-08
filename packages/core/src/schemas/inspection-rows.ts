import { z } from 'zod';

// What the `inspect_*` functions answer the owner's local MCP server, as its Postgres driver hands it
// over: bigints as numbers and dates as `YYYY-MM-DD` text. Every row is validated before use.

/** `inspect_season`: the season with the latest published chapter, and its nicknames. */
export const inspectedSeasonRowSchema = z.object({
  id: z.number(),
  number: z.number(),
  last_published: z.iso.date().nullable(),
  characters: z.array(z.string()),
});

/** `inspect_season_moments`: a moment of the season, current or superseded. */
export const seasonMomentRowSchema = z.object({
  id: z.number(),
  day: z.iso.date(),
  text: z.string(),
  characters: z.array(z.string()),
  joke: z.string().nullable(),
  importance: z.number(),
  current: z.boolean(),
});

/**
 * `inspect_chapter_summaries`: a published chapter's summary, and how many the range holds. A page
 * past the end is one row with no day, which still tells the total.
 */
export const summaryRowSchema = z.object({
  day: z.iso.date().nullable(),
  summary: z.string().nullable(),
  total: z.number(),
});

/** `inspect_game_state`: a season's canon and its latest days. */
export const gameStateReplySchema = z.object({
  season: z.object({
    number: z.number(),
    starts_on: z.iso.date(),
    ends_on: z.iso.date().nullable(),
  }),
  characters: z.array(z.object({ nickname: z.string(), balance: z.number(), out: z.boolean() })),
  items: z.array(z.object({ name: z.string(), owner: z.string() })),
  debts: z.array(z.object({ debtor: z.string(), creditor: z.string(), points: z.number() })),
  days: z.array(z.object({ day: z.iso.date(), state: z.string() })),
});

/** `inspect_chapter`: a published chapter, whole. */
export const chapterRowSchema = z.object({
  day: z.iso.date(),
  title: z.string(),
  body: z.string(),
  summary: z.string().nullable(),
});
