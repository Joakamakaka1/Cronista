import { z } from 'zod';

import { MAX_AWARD, MIN_AWARD } from '../game-rules.ts';

const writtenText = z.string().trim().min(1);

// None of these ask for a "reasoning" field: it triggers `reasoning_extraction` refusals.

/** What the narrator returns for a day's situation. */
export const situationOutputSchema = z.strictObject({ text: writtenText });

/** A day's situation, validated by {@link situationOutputSchema}. */
export type SituationOutput = z.infer<typeof situationOutputSchema>;

/**
 * What the narrator returns for a hint. It goes straight to a player with no other check, so its
 * length is held here as well as in the prompt: an action cannot talk it into copying long passages.
 */
export const hintOutputSchema = z.strictObject({ text: writtenText.max(600) });

/** A hint, validated by {@link hintOutputSchema}. */
export type HintOutput = z.infer<typeof hintOutputSchema>;

/**
 * What the narrator decides each action achieves, before any text is written. Which actions it covers
 * and which changes hold are rules of the day, in `validateResolution`: the ranges of charges and
 * changes stay out of here, because an invalid change is dropped and only that one.
 *
 * @remarks
 * Flat lists and no unions: Zod turns a discriminated union into `oneOf`, which the API's structured
 * output does not accept.
 */
export const resolutionOutputSchema = z.strictObject({
  outcomes: z.array(
    z.strictObject({
      nickname: writtenText,
      summary: writtenText,
      award: z.int().min(MIN_AWARD).max(MAX_AWARD),
      influence: z.int(),
      payments: z.array(z.strictObject({ to: writtenText, points: z.int() })),
      newItems: z.array(z.strictObject({ name: writtenText, price: z.int() })),
      movedItems: z.array(
        z.strictObject({ item: writtenText, from: writtenText, to: writtenText }),
      ),
      newDebts: z.array(z.strictObject({ creditor: writtenText, points: z.int() })),
      paidDebts: z.array(z.strictObject({ creditor: writtenText })),
      outCharacters: z.array(writtenText),
    }),
  ),
});

/** A resolution, validated by {@link resolutionOutputSchema}. */
export type ResolutionOutput = z.infer<typeof resolutionOutputSchema>;

/** What the narrator returns when one action is tested alone. Only a refusal of it matters. */
export const actionTestOutputSchema = z.strictObject({ text: writtenText });

/** An action tested alone, validated by {@link actionTestOutputSchema}. */
export type ActionTestOutput = z.infer<typeof actionTestOutputSchema>;

/**
 * What the narrator returns for a chapter. The pull quote is a line copied from the body and shown
 * set apart. It is decoration, so nothing about it can invalidate the chapter: the engine keeps it
 * only when it is one short line the body really contains, and drops it otherwise.
 */
export const chapterOutputSchema = z.strictObject({
  title: writtenText,
  body: writtenText,
  pullQuote: z.string(),
});

/** A chapter, validated by {@link chapterOutputSchema}. */
export type ChapterOutput = z.infer<typeof chapterOutputSchema>;
