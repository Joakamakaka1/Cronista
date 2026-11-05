import { z } from 'zod';

const writtenText = z.string().trim().min(1);

// None of these ask for a "reasoning" field: it triggers `reasoning_extraction` refusals.

/** The fewest and most moments one chapter yields. */
export const MOMENTS_PER_CHAPTER = { min: 5, max: 20 } as const;

/** A joke's label: one line, short, because it is searched as a name and shown in every prompt. */
const jokeLabel = z
  .string()
  .max(60)
  .refine((label) => !/[\r\n]/.test(label), { error: 'A joke label is one line.' });

/**
 * What the narrator extracts from a published chapter: a short summary and 5-20 self-contained moments,
 * each with the characters it names, how much it matters and the running joke it belongs to, if any.
 */
export const momentsOutputSchema = z.strictObject({
  summary: writtenText.max(600),
  moments: z
    .array(
      z.strictObject({
        text: writtenText.max(500),
        characters: z.array(writtenText),
        importance: z.int().min(1).max(5),
        joke: jokeLabel.nullable(),
      }),
    )
    .min(MOMENTS_PER_CHAPTER.min)
    .max(MOMENTS_PER_CHAPTER.max),
});

/** Moments extracted from a chapter, validated by {@link momentsOutputSchema}. */
export type MomentsOutput = z.infer<typeof momentsOutputSchema>;

/** A new moment as the narrator extracted it. */
export type ExtractedMoment = MomentsOutput['moments'][number];

/**
 * What the narrator decides for each new moment against its nearest: add it, let it replace one of
 * them, or drop it as already known. Flat, with no union: `target` is the replaced moment's id.
 */
export const comparisonOutputSchema = z.strictObject({
  decisions: z.array(
    z.strictObject({
      moment: z.int().min(1),
      decision: z.enum(['ADD', 'UPDATE', 'NOOP']),
      target: z.int().nullable(),
    }),
  ),
});

/** The decisions on new moments, validated by {@link comparisonOutputSchema}. */
export type ComparisonOutput = z.infer<typeof comparisonOutputSchema>;
