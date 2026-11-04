import { z } from 'zod';

import { MAX_AWARD, MIN_AWARD } from '../game-rules.ts';

const writtenText = z.string().trim().min(1);

// None of these ask for a "reasoning" field: it triggers `reasoning_extraction` refusals.

/** What the narrator returns for a day's situation. */
export const situationOutputSchema = z.strictObject({ text: writtenText });

/** A day's situation, validated by {@link situationOutputSchema}. */
export type SituationOutput = z.infer<typeof situationOutputSchema>;

/** What the narrator returns for a hint. */
export const hintOutputSchema = z.strictObject({ text: writtenText });

/** A hint, validated by {@link hintOutputSchema}. */
export type HintOutput = z.infer<typeof hintOutputSchema>;

/**
 * What the narrator decides each action achieves, before any text is written. Which actions it
 * covers is a rule of the day, in `validateResolution`.
 */
export const resolutionOutputSchema = z.strictObject({
  outcomes: z.array(
    z.strictObject({
      nickname: writtenText,
      summary: writtenText,
      award: z.int().min(MIN_AWARD).max(MAX_AWARD),
    }),
  ),
});

/** A resolution, validated by {@link resolutionOutputSchema}. */
export type ResolutionOutput = z.infer<typeof resolutionOutputSchema>;

/** What the narrator returns for a chapter. */
export const chapterOutputSchema = z.strictObject({
  title: writtenText,
  body: writtenText,
});

/** A chapter, validated by {@link chapterOutputSchema}. */
export type ChapterOutput = z.infer<typeof chapterOutputSchema>;
