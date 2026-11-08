import { z } from 'zod';

// The rows the owner's local MCP server reads straight from Postgres, as its driver hands them over:
// bigints as numbers and dates as `YYYY-MM-DD` text. Every one is validated before use.

/** A moment of the season, current or superseded, without its embedding. */
export const seasonMomentRowSchema = z.object({
  id: z.number(),
  day: z.iso.date(),
  text: z.string(),
  characters: z.array(z.string()),
  joke: z.string().nullable(),
  importance: z.number(),
  current: z.boolean(),
});

/** A published chapter's summary, with how many the whole range holds. */
export const summaryRowSchema = z.object({
  day: z.iso.date(),
  summary: z.string(),
  total: z.number(),
});

/** The season the inspection reads: the latest one started. */
export const seasonRowSchema = z.object({
  id: z.number(),
  number: z.number(),
  starts_on: z.iso.date(),
  ends_on: z.iso.date().nullable(),
});

/** A character as canon shows it, with whether it is out on the latest day with a status. */
export const characterRowSchema = z.object({
  nickname: z.string(),
  balance: z.number(),
  out: z.boolean(),
});

/** An item and the nickname of its owner. */
export const itemRowSchema = z.object({ name: z.string(), owner: z.string() });

/** An open debt between two nicknames. */
export const debtRowSchema = z.object({
  debtor: z.string(),
  creditor: z.string(),
  points: z.number(),
});

/** A game day and its state. */
export const dayRowSchema = z.object({ day: z.iso.date(), state: z.string() });

/** A published chapter, whole. */
export const chapterRowSchema = z.object({
  day: z.iso.date(),
  title: z.string(),
  body: z.string(),
  summary: z.string().nullable(),
});
